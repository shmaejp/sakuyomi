-- 取り出しの詳細：品種と、取り出しから品種への結びつき、実施日、判断の判断者と根拠、作業の資材・量・倍率。
-- 言葉の意味は GLOSSARY.md を参照。

-- 品種。作目の下に任意で登録する（例：トマトの桃太郎とアイコ）。作目と同じ農場のものに限る。
alter table public.crops add constraint crops_id_farm_id_key unique (id, farm_id);

create table public.varieties (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  crop_id uuid not null,
  name text not null check (name <> ''),
  spoken_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (crop_id, farm_id) references public.crops (id, farm_id)
);

create index varieties_farm_id_idx on public.varieties (farm_id);
create index varieties_crop_id_idx on public.varieties (crop_id);

alter table public.varieties enable row level security;

-- 書き込みは、圃場・作目と同じく、当面は初期データの SQL だけで行う。
revoke all on public.varieties from anon, authenticated;
grant select on public.varieties to authenticated;

create policy "農場メンバーは同じ農場の品種を見られる" on public.varieties
  for select to authenticated
  using (private.is_farm_member(farm_id));

-- 取り出しと品種の結びつき。圃場・作目と同じく、登録にない品種は spoken_as だけを残す（未確定）。
create table public.extraction_varieties (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  variety_id uuid references public.varieties (id),
  spoken_as text check (spoken_as <> ''),
  check (variety_id is not null or spoken_as is not null)
);

create index extraction_varieties_extraction_id_idx on public.extraction_varieties (extraction_id);
create index extraction_varieties_variety_id_idx on public.extraction_varieties (variety_id);

alter table public.extraction_varieties enable row level security;

revoke all on public.extraction_varieties from anon, authenticated;
grant select, insert on public.extraction_varieties to authenticated;

create policy "農場メンバーは同じ農場の品種の結びつきを見られる" on public.extraction_varieties
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは同じ農場の取り出しを品種に結びつけられる" on public.extraction_varieties
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (select 1 from public.extractions e where e.id = extraction_id and e.farm_id = extraction_varieties.farm_id)
    and (variety_id is null or exists (
      select 1 from public.varieties v where v.id = variety_id and v.farm_id = extraction_varieties.farm_id
    ))
  );

-- 実施日。話から読み取り、読み取れなければ記録日時の日付（日本時間）にする。
-- これまでの取り出しは、記録日時の日付で埋める。
alter table public.extractions add column performed_on date;

update public.extractions e
set performed_on = (r.recorded_at at time zone 'Asia/Tokyo')::date
from public.versions v
join public.records r on r.id = v.record_id
where v.id = e.version_id;

alter table public.extractions alter column performed_on set not null;

create index extractions_performed_on_idx on public.extractions (farm_id, performed_on);

-- 判断者。判断にだけあり、判断には必ずある（既定は記録者）。アプリを使わない農場メンバーでもよい。
-- これまでの判断は、記録者で埋める。
alter table public.extractions
  add column judge_member_id uuid references public.farm_members (id);

update public.extractions e
set judge_member_id = r.recorder_member_id
from public.versions v
join public.records r on r.id = v.record_id
where v.id = e.version_id and e.kind = 'judgment';

alter table public.extractions
  add constraint extractions_judge_only_for_judgment
    check ((kind = 'judgment') = (judge_member_id is not null));

create index extractions_judge_member_id_idx on public.extractions (judge_member_id);

-- 判断者も、記録と同じ農場のメンバーに限る。
drop policy "農場メンバーは同じ農場の版に取り出しを作れる" on public.extractions;

create policy "農場メンバーは同じ農場の版に取り出しを作れる" on public.extractions
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (select 1 from public.versions v where v.id = version_id and v.farm_id = extractions.farm_id)
    and (judge_member_id is null or exists (
      select 1 from public.farm_members m where m.id = judge_member_id and m.farm_id = extractions.farm_id
    ))
  );

-- 根拠。判断 1 つに 0 件以上あり、1 つ 1 つが同じ記録の観察を指す（observation_id）か、文章だけ（body）か。
-- 農場の外の人（JA の指導員など）の助言も、文章だけの根拠になる。
-- 過去の記録の観察を指すこと、記録を削除したときに文章だけの根拠に置き換えることは、まだ扱わない。
create table public.grounds (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  judgment_id uuid not null references public.extractions (id) on delete cascade,
  position integer not null,
  observation_id uuid references public.extractions (id),
  body text check (body <> ''),
  check ((observation_id is null) <> (body is null)),
  unique (judgment_id, position)
);

create index grounds_judgment_id_idx on public.grounds (judgment_id);
create index grounds_observation_id_idx on public.grounds (observation_id);

alter table public.grounds enable row level security;

revoke all on public.grounds from anon, authenticated;
grant select, insert on public.grounds to authenticated;

create policy "農場メンバーは同じ農場の根拠を見られる" on public.grounds
  for select to authenticated
  using (private.is_farm_member(farm_id));

-- 根拠を持てるのは判断だけ。指せるのは、同じ版（同じ記録）の観察だけ。
create policy "農場メンバーは同じ農場の判断に根拠を残せる" on public.grounds
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (
      select 1 from public.extractions j
      where j.id = judgment_id and j.farm_id = grounds.farm_id and j.kind = 'judgment'
        and (grounds.observation_id is null or exists (
          select 1 from public.extractions o
          where o.id = grounds.observation_id and o.version_id = j.version_id and o.kind = 'observation'
        ))
    )
  );

-- 作業に使った資材・量・倍率。作業 1 つに 0 件以上（混ぜて使えば資材ごとに 1 行）。
-- 話されたまま文章で残す（量・倍率は「200リットル」「1000倍」など）。資材の登録の一覧（マスタ）はない。
create table public.work_materials (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  work_id uuid not null references public.extractions (id) on delete cascade,
  position integer not null,
  name text not null check (name <> ''),
  amount text check (amount <> ''),
  dilution text check (dilution <> ''),
  unique (work_id, position)
);

create index work_materials_work_id_idx on public.work_materials (work_id);
-- 文字起こしの語彙に、農場の過去の作業に出た資材名を渡すため。
create index work_materials_farm_id_idx on public.work_materials (farm_id);

alter table public.work_materials enable row level security;

revoke all on public.work_materials from anon, authenticated;
grant select, insert on public.work_materials to authenticated;

create policy "農場メンバーは同じ農場の資材を見られる" on public.work_materials
  for select to authenticated
  using (private.is_farm_member(farm_id));

-- 資材を持てるのは作業だけ。
create policy "農場メンバーは同じ農場の作業に資材を残せる" on public.work_materials
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (
      select 1 from public.extractions w
      where w.id = work_id and w.farm_id = work_materials.farm_id and w.kind = 'work'
    )
  );

-- save_ai_version に判断者・根拠・資材を足す。引数は 20261027000000_photos.sql と同じ。
-- items の 1 つ 1 つに performed_on（YYYY-MM-DD）が要り、varieties: [{ id } | { spoken_as }] を足せる。判断なら judge_member_id と grounds: [{ observation: <items の中の観察の位置> } | { body }] を、
-- 作業なら materials: [{ name, amount, dilution }] を足せる。
-- 根拠が観察を指すので、取り出しをすべて入れてから根拠を入れる。
create or replace function public.save_ai_version(target_record_id uuid, items jsonb, metrics jsonb, transcript text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  record_farm_id uuid;
  new_version_id uuid;
  new_extraction_id uuid;
  extraction_ids uuid[] := '{}';
  item jsonb;
  link jsonb;
  ground jsonb;
  item_position integer := 0;
  ground_position integer;
begin
  select r.farm_id into record_farm_id from public.records r where r.id = target_record_id;
  if record_farm_id is null then
    raise exception 'record % not found', target_record_id using errcode = 'P0002';
  end if;

  insert into public.versions (farm_id, record_id, author, transcript)
  values (record_farm_id, target_record_id, 'ai', transcript)
  returning id into new_version_id;

  for item in select * from jsonb_array_elements(items) loop
    insert into public.extractions (farm_id, version_id, position, kind, body, performed_on, judge_member_id)
    values (
      record_farm_id, new_version_id, item_position,
      (item ->> 'kind')::public.extraction_kind, item ->> 'body',
      (item ->> 'performed_on')::date, (item ->> 'judge_member_id')::uuid
    )
    returning id into new_extraction_id;
    extraction_ids := extraction_ids || new_extraction_id;
    item_position := item_position + 1;

    for link in select * from jsonb_array_elements(coalesce(item -> 'fields', '[]')) loop
      insert into public.extraction_fields (farm_id, extraction_id, field_id, spoken_as)
      values (record_farm_id, new_extraction_id, (link ->> 'id')::uuid, link ->> 'spoken_as');
    end loop;

    for link in select * from jsonb_array_elements(coalesce(item -> 'crops', '[]')) loop
      insert into public.extraction_crops (farm_id, extraction_id, crop_id, spoken_as)
      values (record_farm_id, new_extraction_id, (link ->> 'id')::uuid, link ->> 'spoken_as');
    end loop;

    for link in select * from jsonb_array_elements(coalesce(item -> 'varieties', '[]')) loop
      insert into public.extraction_varieties (farm_id, extraction_id, variety_id, spoken_as)
      values (record_farm_id, new_extraction_id, (link ->> 'id')::uuid, link ->> 'spoken_as');
    end loop;

    insert into public.work_materials (farm_id, work_id, position, name, amount, dilution)
    select record_farm_id, new_extraction_id, (m.ordinality - 1)::integer,
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
        record_farm_id, extraction_ids[item_position], ground_position,
        extraction_ids[(ground ->> 'observation')::integer + 1], ground ->> 'body'
      );
      ground_position := ground_position + 1;
    end loop;
  end loop;

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
