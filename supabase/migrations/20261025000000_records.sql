-- 記録と、そこから作った版・取り出し・圃場/作目への結びつき。
-- 正本（音声）はストレージの originals バケットに置き、書き換えない（ADR 0001）。
-- 文字起こしと取り出しは版ごとの派生物で、版を作ったのが AI か人かを持つ（ADR 0006）。
-- 圃場・作目は記録ではなく取り出しに、多対多で結びつける（ADR 0002）。

-- 記録。id は端末で採番する（送り直しても二重にならないようにするため）。
-- recorded_at は端末で記録した日時。recorder_member_id はアプリを使う農場メンバー。
create table public.records (
  id uuid primary key,
  farm_id uuid not null references public.farms (id),
  recorder_member_id uuid not null references public.farm_members (id),
  recorded_at timestamptz not null,
  audio_path text,
  created_at timestamptz not null default now()
);

create type public.version_author as enum ('ai', 'human');

-- 版。記録を消せば、版とそこから作ったものも消える。
create table public.versions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  record_id uuid not null references public.records (id) on delete cascade,
  author public.version_author not null,
  transcript text,
  created_at timestamptz not null default now()
);

-- 取り出しの種別：観察・判断・作業。1 つの表に入れて種別で区別する。
create type public.extraction_kind as enum ('observation', 'judgment', 'work');

create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  version_id uuid not null references public.versions (id) on delete cascade,
  position integer not null,
  kind public.extraction_kind not null,
  body text not null check (body <> ''),
  unique (version_id, position)
);

-- 取り出しと圃場・作目の結びつき。登録にない場所・作物の話は未確定として、
-- id を持たずに話の中の言い方（spoken_as）だけを残す。
create table public.extraction_fields (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  field_id uuid references public.fields (id),
  spoken_as text check (spoken_as <> ''),
  check (field_id is not null or spoken_as is not null)
);

create table public.extraction_crops (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  crop_id uuid references public.crops (id),
  spoken_as text check (spoken_as <> ''),
  check (crop_id is not null or spoken_as is not null)
);

create index records_farm_id_idx on public.records (farm_id);
create index versions_record_id_idx on public.versions (record_id);
create index extractions_version_id_idx on public.extractions (version_id);
create index extraction_fields_extraction_id_idx on public.extraction_fields (extraction_id);
create index extraction_fields_field_id_idx on public.extraction_fields (field_id);
create index extraction_crops_extraction_id_idx on public.extraction_crops (extraction_id);
create index extraction_crops_crop_id_idx on public.extraction_crops (crop_id);

-- ログイン中の人が、そのメンバー本人で、農場を離れていないかどうか。
create function private.is_me(member_id uuid, target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.farm_members m
    where m.id = member_id
      and m.farm_id = target_farm_id
      and m.user_id = (select auth.uid())
      and m.left_at is null
  );
$$;

revoke all on function private.is_me(uuid, uuid) from public;
grant execute on function private.is_me(uuid, uuid) to authenticated;

alter table public.records enable row level security;
alter table public.versions enable row level security;
alter table public.extractions enable row level security;
alter table public.extraction_fields enable row level security;
alter table public.extraction_crops enable row level security;

-- 記録は書き換えない。版・取り出しは save_ai_version でまとめて書く。
revoke all on public.records, public.versions, public.extractions,
  public.extraction_fields, public.extraction_crops from anon, authenticated;
grant select, insert on public.records, public.versions, public.extractions,
  public.extraction_fields, public.extraction_crops to authenticated;

create policy "農場メンバーは同じ農場の記録を見られる" on public.records
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは自分を記録者として記録を残せる" on public.records
  for insert to authenticated
  with check (private.is_me(recorder_member_id, farm_id));

create policy "農場メンバーは同じ農場の版を見られる" on public.versions
  for select to authenticated
  using (private.is_farm_member(farm_id));

-- 書き込みでは、親の行（記録・版・取り出し）と結びつける圃場・作目も同じ農場のものに限る。
-- 親の行は RLS で自分の農場のものしか見えないので、見えるかどうかで確かめられる。
-- 人の版（訂正）はまだ作れない。訂正（#2）を作るときに開く。
create policy "農場メンバーは同じ農場の記録に AI の版を作れる" on public.versions
  for insert to authenticated
  with check (
    author = 'ai'
    and private.is_farm_member(farm_id)
    and exists (select 1 from public.records r where r.id = record_id and r.farm_id = versions.farm_id)
  );

create policy "農場メンバーは同じ農場の取り出しを見られる" on public.extractions
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは同じ農場の版に取り出しを作れる" on public.extractions
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (select 1 from public.versions v where v.id = version_id and v.farm_id = extractions.farm_id)
  );

create policy "農場メンバーは同じ農場の圃場の結びつきを見られる" on public.extraction_fields
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは同じ農場の取り出しを圃場に結びつけられる" on public.extraction_fields
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (select 1 from public.extractions e where e.id = extraction_id and e.farm_id = extraction_fields.farm_id)
    and (field_id is null or exists (
      select 1 from public.fields f where f.id = field_id and f.farm_id = extraction_fields.farm_id
    ))
  );

create policy "農場メンバーは同じ農場の作目の結びつきを見られる" on public.extraction_crops
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは同じ農場の取り出しを作目に結びつけられる" on public.extraction_crops
  for insert to authenticated
  with check (
    private.is_farm_member(farm_id)
    and exists (select 1 from public.extractions e where e.id = extraction_id and e.farm_id = extraction_crops.farm_id)
    and (crop_id is null or exists (
      select 1 from public.crops c where c.id = crop_id and c.farm_id = extraction_crops.farm_id
    ))
  );

-- AI の版を、文字起こし・取り出し・結びつきごと 1 つのトランザクションで保存する。
-- 途中で失敗して版だけが残ることのないようにするため。呼んだ人の権限で動き、RLS が効く。
-- items は [{ kind, body, fields: [{ id } | { spoken_as }], crops: [...] }]。
-- 結びつける圃場・作目が記録と同じ農場のものかは、insert のポリシーで確かめる。
create function public.save_ai_version(target_record_id uuid, transcript text, items jsonb)
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

  return new_version_id;
end;
$$;

revoke all on function public.save_ai_version(uuid, text, jsonb) from public, anon;
grant execute on function public.save_ai_version(uuid, text, jsonb) to authenticated;

-- 正本を置くバケット。農場ごとのフォルダ（<farm_id>/<record_id>/...）に分ける。
-- 書き換え・削除の方針は作らない（正本は書き換えない）。
insert into storage.buckets (id, name, public) values ('originals', 'originals', false);

create function private.is_farm_member_folder(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.farm_members m
    where m.farm_id::text = (storage.foldername(object_name))[1]
      and m.user_id = (select auth.uid())
      and m.left_at is null
  );
$$;

revoke all on function private.is_farm_member_folder(text) from public;
grant execute on function private.is_farm_member_folder(text) to authenticated;

create policy "農場メンバーは同じ農場の正本を置ける" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'originals' and private.is_farm_member_folder(name));

create policy "農場メンバーは同じ農場の正本を見られる" on storage.objects
  for select to authenticated
  using (bucket_id = 'originals' and private.is_farm_member_folder(name));
