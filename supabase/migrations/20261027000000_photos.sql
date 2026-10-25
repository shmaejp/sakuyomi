-- 写真付きの記録・写真だけの記録。
-- 写真も音声と同じく正本で、originals バケットの <farm_id>/<record_id>/photos/<撮った順> に置き、書き換えない（ADR 0001）。

-- 撮った順の、正本の写真のパス。記録には音声か写真の少なくとも一方がある。
alter table public.records
  add column photo_paths text[] not null default '{}',
  add constraint records_has_audio_or_photos
    check (audio_path is not null or cardinality(photo_paths) > 0);

-- 写真だけの記録は文字起こしをしないので、文字起こしの秒数がない。
alter table public.record_metrics
  alter column transcription_seconds drop not null;

-- 写真だけの記録では文字起こしがない（null）。省けるよう、transcript を最後の既定値つきの引数にする。
-- 中身は 20261026000000_metrics.sql の save_ai_version と同じ。
drop function public.save_ai_version(uuid, text, jsonb, jsonb);

create function public.save_ai_version(target_record_id uuid, items jsonb, metrics jsonb, transcript text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  record_farm_id uuid;
  new_version_id uuid;
  new_extraction_id uuid;
  item jsonb;
  link jsonb;
  item_position integer := 0;
begin
  select r.farm_id into record_farm_id from public.records r where r.id = target_record_id;
  if record_farm_id is null then
    raise exception 'record % not found', target_record_id using errcode = 'P0002';
  end if;

  insert into public.versions (farm_id, record_id, author, transcript)
  values (record_farm_id, target_record_id, 'ai', transcript)
  returning id into new_version_id;

  for item in select * from jsonb_array_elements(items) loop
    insert into public.extractions (farm_id, version_id, position, kind, body)
    values (
      record_farm_id, new_version_id, item_position,
      (item ->> 'kind')::public.extraction_kind, item ->> 'body'
    )
    returning id into new_extraction_id;
    item_position := item_position + 1;

    for link in select * from jsonb_array_elements(coalesce(item -> 'fields', '[]')) loop
      insert into public.extraction_fields (farm_id, extraction_id, field_id, spoken_as)
      values (record_farm_id, new_extraction_id, (link ->> 'id')::uuid, link ->> 'spoken_as');
    end loop;

    for link in select * from jsonb_array_elements(coalesce(item -> 'crops', '[]')) loop
      insert into public.extraction_crops (farm_id, extraction_id, crop_id, spoken_as)
      values (record_farm_id, new_extraction_id, (link ->> 'id')::uuid, link ->> 'spoken_as');
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

revoke all on function public.save_ai_version(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_ai_version(uuid, jsonb, jsonb, text) to authenticated;
