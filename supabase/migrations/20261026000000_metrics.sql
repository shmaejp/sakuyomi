-- 計測：記録の受け取った日時、出来事、記録ごとの処理秒数・トークン数・文字起こしの料金。
-- 外部の分析ツールは使わず、SQL で集計する（集計の例は docs/metrics.md）。

-- 受け取った日時。記録日時（端末で記録した日時）との差で、圏外から送られた記録を区別する。
alter table public.records rename column created_at to received_at;

-- 出来事。今は「記録」だけで、参照・問いかけは作るときに足す。
create type public.event_kind as enum ('record');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  member_id uuid not null references public.farm_members (id),
  kind public.event_kind not null,
  record_id uuid references public.records (id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index events_farm_id_occurred_at_idx on public.events (farm_id, occurred_at);

alter table public.events enable row level security;

-- 出来事は、記録を受け取ったときに下のトリガーだけが書く（アプリからは書けない）。
revoke all on public.events from anon, authenticated;
grant select on public.events to authenticated;

create policy "農場メンバーは同じ農場の出来事を見られる" on public.events
  for select to authenticated
  using (private.is_farm_member(farm_id));

create function private.record_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.events (farm_id, member_id, kind, record_id, occurred_at)
  values (new.farm_id, new.recorder_member_id, 'record', new.id, new.received_at);
  return new;
end;
$$;

revoke all on function private.record_received() from public;

create trigger records_received
  after insert on public.records
  for each row execute function private.record_received();

-- 記録ごとの計測。AI の版を作れたときに、版と一緒に save_ai_version で書く。
-- 料金は米ドル。文字起こしの仕組みが料金を返さなければ null。
create table public.record_metrics (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  record_id uuid not null references public.records (id) on delete cascade,
  version_id uuid not null unique references public.versions (id) on delete cascade,
  transcription_seconds double precision not null check (transcription_seconds >= 0),
  structuring_seconds double precision not null check (structuring_seconds >= 0),
  total_seconds double precision not null check (total_seconds >= 0),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  transcription_cost_usd numeric check (transcription_cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index record_metrics_record_id_idx on public.record_metrics (record_id);

alter table public.record_metrics enable row level security;

revoke all on public.record_metrics from anon, authenticated;
grant select, insert on public.record_metrics to authenticated;

create policy "農場メンバーは同じ農場の計測を見られる" on public.record_metrics
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは同じ農場の版に計測を残せる" on public.record_metrics
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (
      select 1 from public.versions v
      where v.id = version_id and v.record_id = record_metrics.record_id and v.farm_id = record_metrics.farm_id
    )
  );

-- save_ai_version に計測を足す。版と計測を 1 つのトランザクションで保存する。
-- metrics は { transcription_seconds, structuring_seconds, seconds_before_save, input_tokens, output_tokens, transcription_cost_usd }。
-- seconds_before_save は関数がリクエストを受けてからこの呼び出しまでの秒数。合計の秒数は、それに版の保存にかかった秒数を足す。
drop function public.save_ai_version(uuid, text, jsonb);

create function public.save_ai_version(target_record_id uuid, transcript text, items jsonb, metrics jsonb)
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

revoke all on function public.save_ai_version(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_ai_version(uuid, text, jsonb, jsonb) to authenticated;
