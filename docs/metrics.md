# 計測の集計

外部の分析ツールは使わず、DB に残した出来事（`events`）と記録ごとの計測（`record_metrics`）を SQL で集計する。Studio（http://127.0.0.1:54323）の SQL Editor や、本番の Supabase の SQL Editor で走らせる。週は日本時間の月曜始まりで区切る。

## 何が残るか

- `records.recorded_at`：記録日時（端末で記録した日時）
- `records.received_at`：受け取った日時（サーバーが記録を受け取った日時）。記録日時との差で、圏外から送られた記録を区別する
- `events`：出来事。記録を受け取ると `kind = 'record'` の行が DB のトリガーで残る（文字起こし・構造化に失敗しても残る）
- `record_metrics`：AI の版を作れた記録ごとに 1 行。文字起こし・構造化・版の保存に失敗した呼び出しの計測は残らない。同じ記録 ID で送り直して版を作れたら、その呼び出しの計測が残る（失敗した呼び出しでかかった秒数・料金は入らないので、料金はわずかに少なめに出る）。文字起こし・構造化・合計の秒数、Claude の入力/出力トークン数、文字起こしの料金（米ドル。分からなければ null）。合計の秒数は、記録処理関数がリクエストを受けてから版を保存し終えるまで。写真だけの記録は文字起こしをしないので、文字起こしの秒数・料金は null（平均には入らない）

## 週あたりの記録数（農場ごと）

取り出しが 0 件の記録（聞き取れなかった記録など）の件数も別に出す。週は記録日時で区切る（圏外から後で送られた記録も、記録した週に数える）。記録を削除しても出来事は残る（`record_id` が null になる）ので、そのときは出来事の日時で数える。以下の記録数の例も同じ。

```sql
select
  f.name as farm,
  date_trunc('week', coalesce(r.recorded_at, e.occurred_at) at time zone 'Asia/Tokyo')::date as week,
  count(*) as records,
  count(*) filter (where r.id is not null and not exists (
    select 1 from extractions x
    join versions v on v.id = x.version_id
    where v.record_id = r.id
  )) as records_without_extractions
from events e
left join records r on r.id = e.record_id
join farms f on f.id = e.farm_id
where e.kind = 'record'
group by f.name, week
order by f.name, week;
```

## 週あたりの記録数（記録者ごと）

```sql
select
  f.name as farm,
  m.display_name as recorder,
  date_trunc('week', coalesce(r.recorded_at, e.occurred_at) at time zone 'Asia/Tokyo')::date as week,
  count(*) as records
from events e
left join records r on r.id = e.record_id
join farms f on f.id = e.farm_id
join farm_members m on m.id = e.member_id
where e.kind = 'record'
group by f.name, m.display_name, week
order by f.name, m.display_name, week;
```

## 処理秒数の平均（週ごと）

10 秒の目標を見るため、合計の秒数の 90 パーセンタイルと、10 秒を超えた件数も出す。

```sql
select
  date_trunc('week', r.recorded_at at time zone 'Asia/Tokyo')::date as week,
  count(*) as records,
  round(avg(mt.transcription_seconds)::numeric, 2) as avg_transcription_seconds,
  round(avg(mt.structuring_seconds)::numeric, 2) as avg_structuring_seconds,
  round(avg(mt.total_seconds)::numeric, 2) as avg_total_seconds,
  round((percentile_cont(0.9) within group (order by mt.total_seconds))::numeric, 2) as p90_total_seconds,
  count(*) filter (where mt.total_seconds > 10) as over_10_seconds
from record_metrics mt
join records r on r.id = mt.record_id
group by week
order by week;
```

## AI 利用コスト（農場ごと・月ごと）

Claude はトークン数だけを残し、料金は集計のときに単価を掛けて出す（単価が変わっても過去の記録から出し直せるように）。文字起こしは仕組みごとに課金の形が違う（トークン・秒数など）ので、部品が料金にしてから残す。単価は Claude Opus 5.5 の 100 万トークンあたり入力 $4・出力 $20（2026-10 時点）。モデルや単価を変えたら、ここも直す。断られたときに別のモデルで答え直す設定（fallbacks）が働いた記録は、そのモデルの単価になるので、ここでの値は目安。文字起こしの料金は部品が返した値をそのまま足す（null は数えない）。

```sql
select
  f.name as farm,
  date_trunc('month', r.recorded_at at time zone 'Asia/Tokyo')::date as month,
  count(*) as records,
  sum(mt.input_tokens) as input_tokens,
  sum(mt.output_tokens) as output_tokens,
  round(sum(mt.input_tokens * 4.0 + mt.output_tokens * 20.0) / 1e6, 4) as claude_usd,
  round(sum(mt.transcription_cost_usd), 4) as transcription_usd,
  count(*) filter (where mt.transcription_cost_usd is null) as records_without_transcription_cost
from record_metrics mt
join records r on r.id = mt.record_id
join farms f on f.id = mt.farm_id
group by f.name, month
order by f.name, month;
```

## 圏外から送られた記録

記録日時から受け取った日時までが 5 分を超えた記録を、圏外で貯まってから送られたものとみなす（境目は目安）。

```sql
select
  date_trunc('week', recorded_at at time zone 'Asia/Tokyo')::date as week,
  count(*) as records,
  count(*) filter (where received_at - recorded_at > interval '5 minutes') as sent_later,
  max(received_at - recorded_at) as longest_delay
from records
group by week
order by week;
```

## 要約がないままの記録

文字起こし・構造化・版の保存に失敗し、まだ版のない記録。同じ記録 ID で送り直されると版ができて、ここから消える。取り出しが 0 件の記録（聞き取れなかった記録）は版があるので、ここには入らない。

```sql
select
  f.name as farm,
  r.id as record_id,
  r.recorded_at,
  r.received_at
from records r
join farms f on f.id = r.farm_id
where not exists (select 1 from versions v where v.record_id = r.id)
order by r.received_at desc;
```
