-- 訂正：農場メンバーが要約の画面で AI の取り出しを直し、人の版を新しく作る（ADR 0006）。
-- 版は派生物の一揃いなので、差分ではなく、直した後の取り出しの全件から新しい版を作る。
-- 元の音声・写真、元にした版とその取り出しは書き換えない。文字起こしは元にした版のものを写す。
-- 「訂正済みの記録」は、人の版を 1 つ以上持つ記録（作り直しはこれを対象から外す）。

-- 人の版には、訂正者と元にした版を持たせる。訂正日時は版を作った日時（created_at）。
alter table public.versions
  add column corrected_by_member_id uuid references public.farm_members (id),
  add column based_on_version_id uuid references public.versions (id),
  add constraint versions_human_has_corrector
    check ((author = 'human') = (corrected_by_member_id is not null)),
  add constraint versions_human_has_base
    check ((author = 'human') = (based_on_version_id is not null));

-- 人の版を作れるのは、自分を訂正者とする農場メンバーだけ（農場を離れたメンバーは作れない）。
-- 元にした版は同じ記録の版に限る。
create policy "農場メンバーは同じ農場の記録に自分を訂正者として人の版を作れる" on public.versions
  for insert to authenticated
  with check (
    author = 'human'
    and private.is_me(corrected_by_member_id, farm_id)
    and exists (select 1 from public.records r where r.id = record_id and r.farm_id = versions.farm_id)
    and exists (select 1 from public.versions b where b.id = versions.based_on_version_id and b.record_id = versions.record_id)
  );

-- 版に取り出しと、その結びつき・根拠・資材を入れる。AI の版と人の版で同じものを使う。
-- items の形は save_ai_version と同じ（20261028000000_extraction_details.sql）。
-- 呼んだ人の権限で動き、RLS が効く。API には出さないので private に置く。
create function private.insert_extractions(target_version_id uuid, target_farm_id uuid, items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_extraction_id uuid;
  extraction_ids uuid[] := '{}';
  item jsonb;
  ground jsonb;
  item_position integer := 0;
  ground_position integer;
begin
  for item in select * from jsonb_array_elements(items) loop
    insert into public.extractions (farm_id, version_id, position, kind, body, performed_on, judge_member_id)
    values (
      target_farm_id, target_version_id, item_position,
      (item ->> 'kind')::public.extraction_kind, item ->> 'body',
      (item ->> 'performed_on')::date, (item ->> 'judge_member_id')::uuid
    )
    returning id into new_extraction_id;
    extraction_ids := extraction_ids || new_extraction_id;
    item_position := item_position + 1;

    insert into public.extraction_fields (farm_id, extraction_id, position, field_id, spoken_as)
    select target_farm_id, new_extraction_id, (l.ordinality - 1)::integer,
      (l.value ->> 'id')::uuid, l.value ->> 'spoken_as'
    from jsonb_array_elements(coalesce(item -> 'fields', '[]')) with ordinality as l;

    insert into public.extraction_crops (farm_id, extraction_id, position, crop_id, spoken_as)
    select target_farm_id, new_extraction_id, (l.ordinality - 1)::integer,
      (l.value ->> 'id')::uuid, l.value ->> 'spoken_as'
    from jsonb_array_elements(coalesce(item -> 'crops', '[]')) with ordinality as l;

    insert into public.extraction_varieties (farm_id, extraction_id, position, variety_id, spoken_as)
    select target_farm_id, new_extraction_id, (l.ordinality - 1)::integer,
      (l.value ->> 'id')::uuid, l.value ->> 'spoken_as'
    from jsonb_array_elements(coalesce(item -> 'varieties', '[]')) with ordinality as l;

    insert into public.work_materials (farm_id, work_id, position, name, amount, dilution)
    select target_farm_id, new_extraction_id, (m.ordinality - 1)::integer,
      m.value ->> 'name', m.value ->> 'amount', m.value ->> 'dilution'
    from jsonb_array_elements(coalesce(item -> 'materials', '[]')) with ordinality as m;
  end loop;

  -- 配列の添字は 1 から、items の位置は 0 から。
  item_position := 0;
  for item in select * from jsonb_array_elements(items) loop
    item_position := item_position + 1;
    ground_position := 0;
    for ground in select * from jsonb_array_elements(coalesce(item -> 'grounds', '[]')) loop
      if ground ? 'observation' and extraction_ids[(ground ->> 'observation')::integer + 1] is null then
        raise exception 'ground points to no extraction (%)', ground ->> 'observation' using errcode = '22023';
      end if;
      insert into public.grounds (farm_id, judgment_id, position, observation_id, body)
      values (
        target_farm_id, extraction_ids[item_position], ground_position,
        extraction_ids[(ground ->> 'observation')::integer + 1], ground ->> 'body'
      );
      ground_position := ground_position + 1;
    end loop;
  end loop;
end;
$$;

revoke all on function private.insert_extractions(uuid, uuid, jsonb) from public, anon;
grant execute on function private.insert_extractions(uuid, uuid, jsonb) to authenticated;

-- save_ai_version の取り出しを入れる部分を、private.insert_extractions に移す。振る舞いは変えない。
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

-- 訂正を保存する入口。1 つのトランザクションで人の版を作り、{ status, version_id } を返す。
-- - corrected：人の版を新しく作った（version_id はその版）
-- - unchanged：直した後の取り出しが元にした版と同じなので、版を作らなかった（version_id は元にした版）
-- - stale：元にした版が最新の版ではない（他の人が先に訂正した）ので、保存しなかった（version_id は最新の版）
-- items の形は save_ai_version と同じ。判断で judge_member_id がなければ、記録者を判断者にする。
-- 呼んだ人の権限で動き、RLS が効く。他の農場の記録は見えないので、訂正もできない。
create function public.correct_record(target_record_id uuid, base_version_id uuid, items jsonb)
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

-- 版の中身（取り出しと、その結びつき・判断者・根拠・資材）を比べられる形にする。何も変えない訂正を見分けるために使う。
-- 登録された圃場・作目・品種への結びつきは id で比べ、話の中の言い方は未確定のときだけ比べる。
create function private.version_content(target_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', e.kind,
    'body', e.body,
    'performed_on', e.performed_on,
    'judge_member_id', e.judge_member_id,
    'fields', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.field_id, 'spoken_as', case when l.field_id is null then l.spoken_as end
      ) order by l.position), '[]')
      from public.extraction_fields l where l.extraction_id = e.id
    ),
    'crops', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.crop_id, 'spoken_as', case when l.crop_id is null then l.spoken_as end
      ) order by l.position), '[]')
      from public.extraction_crops l where l.extraction_id = e.id
    ),
    'varieties', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.variety_id, 'spoken_as', case when l.variety_id is null then l.spoken_as end
      ) order by l.position), '[]')
      from public.extraction_varieties l where l.extraction_id = e.id
    ),
    'grounds', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'observation', o.position, 'body', case when g.observation_id is null then g.body end
      ) order by g.position), '[]')
      from public.grounds g
      left join public.extractions o on o.id = g.observation_id
      where g.judgment_id = e.id
    ),
    'materials', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', m.name, 'amount', m.amount, 'dilution', m.dilution
      ) order by m.position), '[]')
      from public.work_materials m where m.work_id = e.id
    )
  ) order by e.position), '[]')
  from public.extractions e
  where e.version_id = target_version_id
$$;

revoke all on function private.version_content(uuid) from public, anon;
grant execute on function private.version_content(uuid) to authenticated;

revoke all on function public.correct_record(uuid, uuid, jsonb) from public, anon;
grant execute on function public.correct_record(uuid, uuid, jsonb) to authenticated;
