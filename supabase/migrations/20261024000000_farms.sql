-- 農場と、その中の農場メンバー・圃場・作目。
-- すべての行に農場を持たせ、RLS で他の農場のデータを見えなくする。
-- 言葉の意味は GLOSSARY.md を参照。呼び名は spoken_names（畑での言い方を複数持てる）。

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name <> ''),
  created_at timestamptz not null default now()
);

-- 農場メンバー。user_id が null なら、アプリを使わず名前だけが登録されたメンバー。
-- left_at があれば農場を離れたメンバーで、農場の記録は見られないが名前は残る。
create table public.farm_members (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  user_id uuid references auth.users (id),
  display_name text not null check (display_name <> ''),
  spoken_names text[] not null default '{}',
  left_at timestamptz,
  created_at timestamptz not null default now(),
  unique (farm_id, user_id)
);

-- 圃場。位置は任意。retired_at があれば廃止された圃場（過去の記録はそのまま残る）。
create table public.fields (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  name text not null check (name <> ''),
  spoken_names text[] not null default '{}',
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);

create table public.crops (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms (id),
  name text not null check (name <> ''),
  spoken_names text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index farm_members_user_id_idx on public.farm_members (user_id);
create index fields_farm_id_idx on public.fields (farm_id);
create index crops_farm_id_idx on public.crops (farm_id);

-- ログイン中の人が、その農場の（離れていない）農場メンバーかどうか。
-- RLS の中から farm_members を読むので security definer にし、API には出さない private スキーマに置く。
create schema if not exists private;
grant usage on schema private to authenticated;

create function private.is_farm_member(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.farm_members m
    where m.farm_id = target_farm_id
      and m.user_id = (select auth.uid())
      and m.left_at is null
  );
$$;

revoke all on function private.is_farm_member(uuid) from public;
grant execute on function private.is_farm_member(uuid) to authenticated;

alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.fields enable row level security;
alter table public.crops enable row level security;

-- ログインしていない人には何も見せない。書き込みは、当面は初期データの SQL だけで行う。
revoke all on public.farms, public.farm_members, public.fields, public.crops from anon, authenticated;
grant select on public.farms, public.farm_members, public.fields, public.crops to authenticated;

create policy "農場メンバーは自分の農場を見られる" on public.farms
  for select to authenticated
  using (private.is_farm_member(id));

create policy "農場メンバーは同じ農場のメンバーを見られる" on public.farm_members
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは同じ農場の圃場を見られる" on public.fields
  for select to authenticated
  using (private.is_farm_member(farm_id));

create policy "農場メンバーは同じ農場の作目を見られる" on public.crops
  for select to authenticated
  using (private.is_farm_member(farm_id));
