-- 農場の初期データを入れる SQL のひな形。登録画面ができるまでは、これで農場を登録する。
--
-- 手順：
--   1. アプリを使う農場メンバーを、Supabase の Authentication → Users → Invite user でメールアドレスから招待する
--      （アプリからの新規登録は止めてあるので、招待した人だけがマジックリンクでログインできる）
--   2. このファイルを写して < > の部分を書き換え、SQL Editor（ローカルなら Studio）で実行する
--   3. アプリでログインし、農場の名前と圃場・作目の一覧が出ることを確かめる
--
-- 呼び名（spoken_names）は、畑での言い方を複数書ける。例：array['3番ハウス', '奥のハウス']

begin;

with farm as (
  insert into public.farms (name)
  values ('<農場の名前>')
  returning id
),
members as (
  -- アプリを使うメンバーは、招待したメールアドレスで auth.users と結びつける。
  -- アプリを使わないメンバーは、email を null にする。
  insert into public.farm_members (farm_id, user_id, display_name, spoken_names)
  select farm.id, u.id, m.display_name, m.spoken_names
  from farm
  cross join (values
    ('<メンバーの名前>', '<メールアドレス>', array['<呼び名>']),
    ('<アプリを使わないメンバーの名前>', null, array['<呼び名>'])
  ) as m (display_name, email, spoken_names)
  left join auth.users u on u.email = m.email
  returning user_id
),
fields as (
  -- 位置は任意。わからなければ null, null にする。
  insert into public.fields (farm_id, name, spoken_names, latitude, longitude)
  select farm.id, f.name, f.spoken_names, f.latitude, f.longitude
  from farm
  cross join (values
    ('<圃場の名前>', array['<呼び名>'], null::double precision, null::double precision)
  ) as f (name, spoken_names, latitude, longitude)
  returning id
)
insert into public.crops (farm_id, name, spoken_names)
select farm.id, c.name, c.spoken_names
from farm
cross join (values
  ('<作目の名前>', array['<呼び名>'])
) as c (name, spoken_names);

-- 招待していないメールアドレスを書くと、そのメンバーは user_id が null（アプリを使わないメンバー）になる。
-- 結びつかなかった人がいないか、ここで確かめる。
select display_name, user_id is not null as uses_app
from public.farm_members
order by created_at desc;

commit;
