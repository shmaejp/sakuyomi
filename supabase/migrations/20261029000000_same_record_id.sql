-- 同じ記録 ID の扱い。同じ記録 ID で何度呼ばれても、正本・記録・AI の版が 1 つずつになるようにする。
-- 要約は保存した版から作り直して返すので、結びつきにも並び順を持たせる（送り直しても同じ要約が返るように）。

-- 結びつきの並び順。これまでの結びつきには、仮に id の順で振る。
alter table public.extraction_fields add column position integer;
alter table public.extraction_crops add column position integer;
alter table public.extraction_varieties add column position integer;

update public.extraction_fields t set position = n.position
from (select id, (row_number() over (partition by extraction_id order by id) - 1)::integer as position
      from public.extraction_fields) n
where n.id = t.id;

update public.extraction_crops t set position = n.position
from (select id, (row_number() over (partition by extraction_id order by id) - 1)::integer as position
      from public.extraction_crops) n
where n.id = t.id;

update public.extraction_varieties t set position = n.position
from (select id, (row_number() over (partition by extraction_id order by id) - 1)::integer as position
      from public.extraction_varieties) n
where n.id = t.id;

alter table public.extraction_fields
  alter column position set not null,
  add constraint extraction_fields_extraction_id_position_key unique (extraction_id, position);
alter table public.extraction_crops
  alter column position set not null,
  add constraint extraction_crops_extraction_id_position_key unique (extraction_id, position);
alter table public.extraction_varieties
  alter column position set not null,
  add constraint extraction_varieties_extraction_id_position_key unique (extraction_id, position);

-- save_ai_version に、結びつきの並び順と、同じ記録の AI の版を 2 つ作らない決まりを足す。
-- 同じ記録 ID の呼び出しが重なっても版が 1 つになるよう、記録ごとのロックを取ってから、AI の版が既にあればその id を返す。
-- 作り直し（新しい AI の版を足すこと）は、作るときに別の関数にする。
-- 引数と items の形は 20261028000000_extraction_details.sql と同じ。
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
  ground jsonb;
  item_position integer := 0;
  ground_position integer;
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

    insert into public.extraction_fields (farm_id, extraction_id, position, field_id, spoken_as)
    select record_farm_id, new_extraction_id, (l.ordinality - 1)::integer,
      (l.value ->> 'id')::uuid, l.value ->> 'spoken_as'
    from jsonb_array_elements(coalesce(item -> 'fields', '[]')) with ordinality as l;

    insert into public.extraction_crops (farm_id, extraction_id, position, crop_id, spoken_as)
    select record_farm_id, new_extraction_id, (l.ordinality - 1)::integer,
      (l.value ->> 'id')::uuid, l.value ->> 'spoken_as'
    from jsonb_array_elements(coalesce(item -> 'crops', '[]')) with ordinality as l;

    insert into public.extraction_varieties (farm_id, extraction_id, position, variety_id, spoken_as)
    select record_farm_id, new_extraction_id, (l.ordinality - 1)::integer,
      (l.value ->> 'id')::uuid, l.value ->> 'spoken_as'
    from jsonb_array_elements(coalesce(item -> 'varieties', '[]')) with ordinality as l;

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
