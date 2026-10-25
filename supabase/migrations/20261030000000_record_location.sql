-- 記録した場所。記録者が位置情報を許可していれば、端末が記録と一緒に送る（任意）。
-- 位置を登録した圃場の近くで記録したら、その圃場を候補として構造化に渡す（決めるのは構造化の側）。
alter table public.records
  add column latitude double precision check (latitude between -90 and 90),
  add column longitude double precision check (longitude between -180 and 180),
  add constraint records_latitude_longitude_together check ((latitude is null) = (longitude is null));

-- 位置の精度（メートル、端末が見積もった誤差の半径）。端末が返さなければ null。
-- 精度が粗い位置からは、圃場の候補を出さない。
alter table public.records
  add column location_accuracy_meters double precision check (location_accuracy_meters >= 0),
  add constraint records_location_accuracy_needs_location check (location_accuracy_meters is null or latitude is not null);
