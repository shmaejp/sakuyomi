-- 即時応答の後半：要約の後に別の呼び出しで返す、直近の記録と去年の同じ時期の記録。
-- 記録の中身は、その記録の最新の版から出す（訂正すれば人の版が最新になる、ADR 0006）。
-- どの関数も呼び出したメンバーの権限で動くので、RLS で他の農場の記録は決して返らない。

-- 記録ごとの最新の版。
create view public.latest_versions with (security_invoker = true) as
  select distinct on (record_id) id, record_id, farm_id
  from public.versions
  order by record_id, created_at desc, id desc;

grant select on public.latest_versions to authenticated;

-- 直近の記録：最新の版の取り出しが、記録の最新の版と同じ圃場または同じ作目に結びつく、同じ農場の記録。
-- 新しい順に max_count 件。
create function public.recent_records(target_record_id uuid, max_count integer)
returns table (record_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with target_extractions as (
    select e.id
    from public.latest_versions v
    join public.extractions e on e.version_id = v.id
    where v.record_id = target_record_id
  ),
  target_fields as (
    select l.field_id from public.extraction_fields l
    where l.extraction_id in (select id from target_extractions) and l.field_id is not null
  ),
  target_crops as (
    select l.crop_id from public.extraction_crops l
    where l.extraction_id in (select id from target_extractions) and l.crop_id is not null
  )
  select r.id
  from public.records r
  join public.latest_versions v on v.record_id = r.id
  where r.id <> target_record_id
    and r.farm_id = (select farm_id from public.records where id = target_record_id)
    and exists (
      select 1
      from public.extractions e
      where e.version_id = v.id
        and (
          exists (
            select 1 from public.extraction_fields l
            where l.extraction_id = e.id and l.field_id in (select field_id from target_fields)
          )
          or exists (
            select 1 from public.extraction_crops l
            where l.extraction_id = e.id and l.crop_id in (select crop_id from target_crops)
          )
        )
    )
  order by r.recorded_at desc, r.id
  limit max_count
$$;

revoke all on function public.recent_records(uuid, integer) from public, anon;
grant execute on function public.recent_records(uuid, integer) to authenticated;

-- 去年の同じ時期の記録：最新の版の取り出しが同じ作目に結びつき、その実施日が、記録の取り出しの実施日の
-- 1 年前の同じ日付から前後 season_days 日に入る記録。品種が一致するものを先に、次に日付の近いものを先にする。
create function public.last_year_records(target_record_id uuid, season_days integer)
returns table (record_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with target_extractions as (
    select e.id, e.performed_on
    from public.latest_versions v
    join public.extractions e on e.version_id = v.id
    where v.record_id = target_record_id
  ),
  target_items as (
    select l.crop_id, (e.performed_on - interval '1 year')::date as a_year_ago
    from target_extractions e
    join public.extraction_crops l on l.extraction_id = e.id
    where l.crop_id is not null
  ),
  target_varieties as (
    select l.variety_id from public.extraction_varieties l
    where l.extraction_id in (select id from target_extractions) and l.variety_id is not null
  ),
  matches as (
    select
      r.id,
      r.recorded_at,
      exists (
        select 1 from public.extraction_varieties l
        where l.extraction_id = e.id
          and l.variety_id in (select variety_id from target_varieties)
      ) as same_variety,
      abs(e.performed_on - t.a_year_ago) as days_apart
    from public.records r
    join public.latest_versions v on v.record_id = r.id
    join public.extractions e on e.version_id = v.id
    join public.extraction_crops c on c.extraction_id = e.id
    join target_items t on t.crop_id = c.crop_id
    where r.id <> target_record_id
      and r.farm_id = (select farm_id from public.records where id = target_record_id)
      and e.performed_on between t.a_year_ago - season_days and t.a_year_ago + season_days
  )
  select id
  from matches
  group by id, recorded_at
  order by bool_or(same_variety) desc, min(days_apart), recorded_at desc, id
$$;

revoke all on function public.last_year_records(uuid, integer) from public, anon;
grant execute on function public.last_year_records(uuid, integer) to authenticated;
