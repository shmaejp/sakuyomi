-- 版と取り出しは、記録処理（save_ai_version）と訂正（correct_record）の入口からだけ書けるようにする（#15）。
-- これまでは、農場メンバーなら PostgREST から版・取り出しの表に直接 INSERT でき、入口の検査
-- （古い版を元にした訂正・品種と作目・何も変えない訂正・1 回での保存）を飛ばせた。書き終えた版に後から足すこともできた。
--
-- 入口の関数は、最初に private.begin_writing_version() で sakuyomi.writing_version = on を
-- そのトランザクションの間だけ立てる。7 つの表には、その設定が on のときだけ INSERT を通す制限的なポリシーを足す。
-- いまある RLS はそのまま効く。
--
-- 利用者が入口の外から on にできないのは、次の前提による。
-- - PostgREST の 1 つの要求は 1 つのトランザクションで、SET 文は送れない。ヘッダーから立つ設定は request.* だけ
-- - set_config は PUBLIC に実行権があるが、API に出しているのは public スキーマの関数だけで、pg_catalog の関数は呼べない
-- - public スキーマに、任意の設定を変えられる関数を置かない（置くとこの守りが破れる）

create function private.is_writing_version()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(current_setting('sakuyomi.writing_version', true), '') = 'on'
$$;

-- 入口の関数の中で印を立てる。設定の名前と値は、この 2 つの関数の中だけに書く。
create function private.begin_writing_version()
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select set_config('sakuyomi.writing_version', 'on', true);
  select null::void
$$;

revoke all on function private.is_writing_version() from public, anon;
grant execute on function private.is_writing_version() to authenticated;
revoke all on function private.begin_writing_version() from public, anon;
grant execute on function private.begin_writing_version() to authenticated;

-- 入口の 2 つの関数に、最初に印を立てる 1 行を足す。それ以外は 20261101000000_corrections.sql と同じ。
create or replace function public.save_ai_version(target_record_id uuid, items jsonb, metrics jsonb, transcript text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  record_farm_id uuid;
  new_version_id uuid;
begin
  perform private.begin_writing_version();
  select r.farm_id into record_farm_id from public.records r where r.id = target_record_id;
  if record_farm_id is null then
    raise exception 'record % not found', target_record_id using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_record_id::text, 0));
  select v.id into new_version_id
  from public.versions v
  where v.record_id = target_record_id and v.author = 'ai'
  order by v.created_at
  limit 1;
  if new_version_id is not null then
    return new_version_id;
  end if;

  insert into public.versions (farm_id, record_id, author, transcript)
  values (record_farm_id, target_record_id, 'ai', transcript)
  returning id into new_version_id;

  perform private.insert_extractions(new_version_id, record_farm_id, items);

  -- now() はこの呼び出しのトランザクションが始まった時刻なので、clock_timestamp() との差が版の保存にかかった秒数になる。
  insert into public.record_metrics (
    farm_id, record_id, version_id,
    transcription_seconds, structuring_seconds, total_seconds,
    input_tokens, output_tokens, transcription_cost_usd
  )
  values (
    record_farm_id, target_record_id, new_version_id,
    (metrics ->> 'transcription_seconds')::double precision,
    (metrics ->> 'structuring_seconds')::double precision,
    (metrics ->> 'seconds_before_save')::double precision
      + extract(epoch from clock_timestamp() - now()),
    (metrics ->> 'input_tokens')::integer,
    (metrics ->> 'output_tokens')::integer,
    (metrics ->> 'transcription_cost_usd')::numeric
  );

  return new_version_id;
end;
$$;

create or replace function public.correct_record(target_record_id uuid, base_version_id uuid, items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.records;
  latest_version_id uuid;
  corrector_id uuid;
  new_version_id uuid;
begin
  perform private.begin_writing_version();
  select * into target from public.records r where r.id = target_record_id;
  if not found then
    raise exception 'record % not found', target_record_id using errcode = 'P0002';
  end if;

  -- 同じ記録の訂正が重なっても、後から来たほうは stale になるよう、記録ごとのロックを取ってから最新の版を見る。
  perform pg_advisory_xact_lock(hashtextextended(target_record_id::text, 0));
  select v.id into latest_version_id from public.latest_versions v where v.record_id = target_record_id;
  if latest_version_id is null then
    raise exception 'record % has no version to correct', target_record_id using errcode = 'P0002';
  end if;
  if latest_version_id <> base_version_id then
    return jsonb_build_object('status', 'stale', 'version_id', latest_version_id);
  end if;

  select m.id into corrector_id
  from public.farm_members m
  where m.farm_id = target.farm_id and m.user_id = (select auth.uid()) and m.left_at is null;

  select coalesce(jsonb_agg(
    case
      when i.value ->> 'kind' = 'judgment' and i.value ->> 'judge_member_id' is null
        then i.value || jsonb_build_object('judge_member_id', target.recorder_member_id)
      else i.value
    end
    order by i.ordinality
  ), '[]')
  into items
  from jsonb_array_elements(items) with ordinality as i;

  begin
    insert into public.versions (farm_id, record_id, author, transcript, corrected_by_member_id, based_on_version_id)
    select target.farm_id, target_record_id, 'human', b.transcript, corrector_id, b.id
    from public.versions b
    where b.id = base_version_id
    returning id into new_version_id;

    perform private.insert_extractions(new_version_id, target.farm_id, items);

    if private.version_content(new_version_id) = private.version_content(base_version_id) then
      raise exception 'nothing to correct' using errcode = 'S0001';
    end if;

    -- 何も変えていなければ、ここまでで返る。品種は、同じ取り出しに結びついた作目の品種に限る（他の農場の品種は見えないので、これでも拒否される）。
    if exists (
      select 1
      from jsonb_array_elements(items) i, jsonb_array_elements(coalesce(i.value -> 'varieties', '[]')) l
      where l.value ? 'id'
        and not exists (
          select 1 from public.varieties v
          where v.id = (l.value ->> 'id')::uuid
            and v.crop_id in (
              select (c.value ->> 'id')::uuid
              from jsonb_array_elements(coalesce(i.value -> 'crops', '[]')) c
              where c.value ? 'id'
            )
        )
    ) then
      raise exception 'variety does not belong to the linked crops' using errcode = '22023';
    end if;
  exception
    when sqlstate 'S0001' then
      return jsonb_build_object('status', 'unchanged', 'version_id', base_version_id);
  end;

  return jsonb_build_object('status', 'corrected', 'version_id', new_version_id);
end;
$$;

create policy "版は記録処理と訂正の入口からだけ作れる" on public.versions
  as restrictive for insert to authenticated
  with check (private.is_writing_version());

create policy "取り出しは記録処理と訂正の入口からだけ作れる" on public.extractions
  as restrictive for insert to authenticated
  with check (private.is_writing_version());

create policy "圃場の結びつきは記録処理と訂正の入口からだけ作れる" on public.extraction_fields
  as restrictive for insert to authenticated
  with check (private.is_writing_version());

create policy "作目の結びつきは記録処理と訂正の入口からだけ作れる" on public.extraction_crops
  as restrictive for insert to authenticated
  with check (private.is_writing_version());

create policy "品種の結びつきは記録処理と訂正の入口からだけ作れる" on public.extraction_varieties
  as restrictive for insert to authenticated
  with check (private.is_writing_version());

create policy "根拠は記録処理と訂正の入口からだけ作れる" on public.grounds
  as restrictive for insert to authenticated
  with check (private.is_writing_version());

create policy "資材は記録処理と訂正の入口からだけ作れる" on public.work_materials
  as restrictive for insert to authenticated
  with check (private.is_writing_version());
