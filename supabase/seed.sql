-- ローカル開発用の初期データ（npx supabase db reset で入る）。本番には入れない。
-- dev@example.com でマジックリンクを送ると、メールは Mailpit（http://127.0.0.1:54324）に届く。

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'dev@example.com', '', now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  'email', '{"sub": "11111111-1111-1111-1111-111111111111", "email": "dev@example.com"}',
  now(), now(), now()
);

insert into public.farms (id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '開発用の農場');

insert into public.farm_members (farm_id, user_id, display_name, spoken_names) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '開発者', array['わたし']),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, '父', array['親父', 'お父さん']);

insert into public.fields (farm_id, name, spoken_names, latitude, longitude, retired_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1番ハウス', array['1番', '手前のハウス'], 34.70, 135.50, null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '3番ハウス', array['3番', '奥のハウス'], null, null, null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '旧2番ハウス', array['2番'], null, null, now());

insert into public.crops (farm_id, name, spoken_names) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'トマト', array['とまと']),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'キュウリ', array['きゅうり']);

insert into public.varieties (farm_id, crop_id, name, spoken_names)
select c.farm_id, c.id, v.name, v.spoken_names
from public.crops c
join (values
  ('トマト', '桃太郎', array['ももたろう']),
  ('トマト', 'アイコ', array[]::text[])
) as v (crop_name, name, spoken_names) on v.crop_name = c.name
where c.farm_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
