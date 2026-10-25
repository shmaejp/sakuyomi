# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現状

骨組み（#3）、音声の記録から要約まで（#4）、計測（#5）、写真付きの記録・写真だけの記録（#6）、取り出しの詳細（#7）。写真を 0 枚以上撮ってから録音して送る（写真だけでもよい）と、AI の版（文字起こし・取り出し・圃場/作目/品種への結びつき・実施日・判断者・根拠・資材/量/倍率）と計測（秒数・トークン数・料金）・出来事「記録」が保存され、写真と要約が表示される。写真は端末で長い辺 2000px の JPEG に縮めて送り、それを正本にする（ADR 0001）。同じ記録 ID の扱い・圏外の送信待ちはまだない。仕様は GitHub Issues の #1（記録から即時応答まで）と #2（訂正）、作業はその sub-issue のチケットで進める。企画書 `事業企画書_栽培ナレッジSSOT_前田晋弥.pptx` は読み取り専用。

Git リポジトリとして管理しており、GitHub の非公開リポジトリ `shmaejp/sakuyomi`（リモート名 `origin`、既定ブランチ `main`）に接続している。構成やコマンドを変えたら、このファイルも直すこと。

## コマンド

ローカルの Supabase は Docker が要る。初回は `npm install` → `npm run db:start` → `.env.example` を `.env.local` に写し、`npx supabase status -o env` の `API_URL`・`ANON_KEY` を入れる。

- `npm run dev`：PWA を http://localhost:5173 で起動する
- `npm run db:start`／`db:stop`：ローカルの Supabase を起動・停止する（Studio は http://127.0.0.1:54323、メールは Mailpit http://127.0.0.1:54324 に届く）
- `npm run db:reset`：マイグレーションと `supabase/seed.sql` を入れ直す。開発用の `dev@example.com` でログインできる
- `npm run db:types`：スキーマから `src/lib/database.types.ts` を生成する。マイグレーションを変えたら必ず実行する（手で直さない）
- `npm test`：すべてのテスト。`npm run test:unit`（`src/**/*.test.ts(x)`）と `npm run test:db`（`tests/db`、起動中のローカル Supabase に対して走る）に分けても走らせられる
- `npm run typecheck`／`npm run build`

## 構成

- `src/`：PWA（Vite + React）。`src/lib/supabase.ts` がクライアント、`src/farm.ts` のようにデータを読む関数は Supabase のクライアントを引数で受け取り、画面からもテストからも同じ関数を使う。`src/photo.ts` は撮った写真を送る前に縮める
- `supabase/functions/record/`：記録処理関数の入口（Deno）。処理の本体は `supabase/functions/_shared/record.ts` の `handleRecordRequest` で、差し替えられる 2 つの部品（文字起こし・構造化、型は `_shared/parts.ts`）を外から受け取る。本物は `_shared/claude-structurer.ts`（Claude Opus 5.5、effort `low`）と `_shared/openai-transcriber.ts`（仮置き）。日付は日本時間で数える（`_shared/dates.ts`）。テストは偽物の部品を渡して `handleRecordRequest` を Node から直接呼ぶ（`tests/db/record.test.ts`）
- `supabase/functions/` は Deno 向けなので import に `.ts` を付ける（`tsconfig.json` の `allowImportingTsExtensions`）。npm の依存は `supabase/functions/record/deno.json` にも同じ版で書く。関数をローカルで動かすには `npx supabase functions serve record`
- `supabase/migrations/`：スキーマと RLS。`supabase/seed.sql` はローカル専用の初期データ
- `docs/metrics.md`：計測（週あたりの記録数・処理秒数・AI 利用コスト）を集計する SQL の例。計測の表や Claude のモデル・単価を変えたら直す
- `supabase/farms/farm.example.sql`：農場を登録する SQL のひな形（登録画面ができるまではこれで登録する）
- `tests/db/`：RLS などを、ローカルの Supabase に対してログイン中の農場メンバーとして確かめるテスト。`TestData`（`tests/db/support.ts`）がテストごとにデータとユーザーを作って片付ける

識別子は英語にし、用語集の言葉とは次のように対応させる：農場 `farm`、農場メンバー `farm_member`、圃場 `field`、作目 `crop`、品種 `variety`、呼び名 `spoken_names`、廃止 `retired_at`、離脱 `left_at`、記録 `record`、記録者 `recorder`、記録日時 `recorded_at`、正本（ストレージのバケット）`originals`、音声 `audio`、写真 `photo`、版 `version`、取り出し `extraction`（観察 `observation`・判断 `judgment`・作業 `work`）、実施日 `performed_on`、判断者 `judge`、根拠 `ground`、資材 `material`・量 `amount`・倍率 `dilution`、受け取った日時 `received_at`、出来事 `event`、記録ごとの計測 `record_metrics`。結びつきが未確定のときは、話の中の言い方を `spoken_as` に残す。

ログインは、アプリからの新規登録を止めてあり（`shouldCreateUser: false`、`enable_signup = false`）、招待した人だけがマジックリンクで入れる。iPhone のホーム画面に置いた PWA は Safari と保存場所が別なので、同じメールに載る 6 桁のコードでも入れる（`supabase/templates/magic_link.html`）。本番の Supabase でも、新規登録を止め、同じメールのテンプレートにすること。

## 秘密情報

- API キーなどの秘密情報は環境変数で渡し、コードに直接書かない。必要な変数名は `.env.example` に名前だけ書き、値は `.env.local` に入れる。必要性が確かめられない変数は足さない
- Edge Functions の秘密情報（`ANTHROPIC_API_KEY`・`OPENAI_API_KEY`）は `supabase/functions/.env.example` に名前だけ書き、ローカルでは同じフォルダの `.env` に入れる
- `.env`・`.env.*` は git に入れない（`.gitignore`）。`.env.example` だけは入れる
- Claude Code は `.env.example` 以外の `.env` 系ファイルを読めない。`.claude/settings.json` の `permissions.deny` と PreToolUse Hook（`.claude/hooks/protect-env.mjs`）で止めている。Hook は、鍵を表示する `supabase status` も止める（出力を `/dev/null` に捨てるときは通す）。`.env.local` の作成や値の確認は、ユーザーが自分で行う
- 秘密情報をログ・エラーメッセージ・ターミナルに出さない。DB のテストは `supabase status` の出力を画面に出さずに鍵を読む（`tests/db/global-setup.ts`）

## コード品質の自動チェック

- 書式と Linter は Biome（`biome.json`）に一本化している。Prettier・ESLint は入れない。Markdown と生成した型は対象外
- 初回は `npm install`。`prepare` で `git config core.hooksPath .githooks` が設定される
- 整形：`npm run format`／Lint：`npm run lint`
- Claude Code がファイルを編集・作成すると、PostToolUse Hook（`.claude/settings.json`）がそのファイルを Biome で整形する
- commit 前に `.githooks/pre-commit` が `biome check`・`tsc --noEmit`・unit のテストを走らせる。ローカルの Supabase が起動していれば DB のテストも走らせる。失敗すると commit が止まる

## 技術スタック（決定済み・未実装）

- **言語**：TypeScript（スマホ側・サーバー側とも）。両方をこのリポジトリ 1 つにまとめ、データベースの型を共有する
- **スマホ側**：PWA（Vite + React の SPA）。Cloudflare Pages または Vercel に置く。圏外で録った記録は端末に貯め、アプリを開いたときに送る（ADR 0003）
- **サーバー側**：Supabase（Postgres・ストレージ・認証・Edge Functions、東京リージョン）（ADR 0004）。開発中は無料プラン、家族が実際の記録を始める日に Pro へ上げる
- **マルチテナント**：最初から全データに農場を持たせ、RLS で他の農場のデータを見えなくする
- **ログイン**：メールのマジックリンク。セッションは長期間保持する
- **記録の処理**：同期型。アップロード → 文字起こし → Claude で構造化 → 保存し、関数の応答として要約を返す。直近の記録・去年の同じ時期の記録は要約の後に別途取得する
- **文字起こし**：未選定。n1 の録音 20 件ほどで候補を比べて決める。決めるまでは差し替えられる作りにする。条件は、圃場名・作目名・資材名を語彙として渡せること、送ったデータを学習に使わないこと
- **構造化・問いかけ**：Claude Opus 5.5（`claude-opus-5-5`）を effort `low` で使う。10 秒を超えるようなら、計測値を見てモデル変更を検討する
- **問いかけでの記録の探し方**：埋め込み・ベクトル検索は使わない。圃場・作目・時期で記録を絞り込み、構造化結果をそのまま Claude に渡す（ADR 0005）
- **計測**：外部の分析ツールは使わない。出来事（記録・参照・問いかけ）と、記録ごとの処理秒数・トークン数・文字起こし料金を DB に残し、SQL で集計する
- **テスト**：Vitest。Claude・文字起こしを呼ぶ部分は差し替えてテストできるようにする。構造化の質は、訂正済みの記録から作る評価用の記録集で確かめる

## データの持ち方（決定済み・未実装）

言葉の意味は `GLOSSARY.md`、理由は `docs/adr/` を参照。

```
農場 ─┬─ 農場メンバー（アカウントあり/なし、離脱、呼び名）
      ├─ 圃場（位置は任意、廃止、呼び名）
      ├─ 作目（呼び名）── 品種（任意）
      └─ 記録（記録者、記録日時）
            ├─ 音声 0〜1・写真 0 以上 ……………… 正本（書き換えない、ADR 0001）
            └─ 版（作ったのは AI か人か、ADR 0006）…… 派生物
                  ├─ 文字起こし
                  └─ 取り出し（種別：観察／判断／作業、実施日）
                        ├─ 圃場・作目・品種への結びつき（多対多、未確定可、ADR 0002）
                        ├─ 判断のみ：判断者、根拠 0 件以上（観察を指す or 文章だけ）
                        └─ 作業のみ：資材・量・倍率（任意）
出来事（記録・参照・問いかけ）、記録ごとの処理秒数・トークン数・料金
```

- 観察・判断・作業は 1 つの表に入れ、種別で区別する
- 訂正は人が作る新しい版。作り直しは訂正されていない記録にだけ行う
- 記録を削除したとき、その観察を指していた他の判断の根拠は、観察の文章を写した文章だけの根拠に置き換える
- すべての行に農場を持たせ、RLS で他の農場のデータを見えなくする

## プロダクト概要（企画書より）

**サクヨミ**：家族農場向けの「栽培ナレッジ SSOT（Single Source of Truth）」。農家がスマホの音声・写真で栽培判断とその根拠を数秒で記録し、生成 AI が構造化してクラウドに集約する。目的は、暗黙知になっている栽培技術を後継者に引き継げる農場の資産にすること。

想定する処理の流れ：

1. **記録**：畑でスマホに話す・撮る（作業中は手がふさがるため、数秒で終わる音声入力が前提）
2. **AI 構造化**：生成 AI が判断と根拠を整理し、タグ付けする
3. **即時応答**：記録した直後に要約を返す
4. **蓄積・検索**：クラウドに集約し、「去年の自分の判断」を検索できるようにする

### 設計上の最重要要件

記録ツールが定着しない本当の原因は、技術やコストではなく**報酬の遅延**（入力の手間はすぐに発生するのに、便益は翌シーズン以降にしか返ってこない）と分析されている。そのため、**入力直後に要約・参照を返す UX** がプロダクトの核になる。入力負荷を増やす機能や、応答を遅らせる設計は避けること。目標は、電波がある場合に録音終了から要約が出るまで 10 秒以内とする（過去の記録の表示は要約より後でもよい。10 秒が妥当かは n1 で検証する）。

### 方針・前提

- 想定ユーザー：40〜60 代の家族農場経営者（1〜3ha 規模）。最初のユーザー（n1）は開発者本人の農場（大阪近郊、1.5ha）
- 作る範囲：AI 構造化エンジンは自前で構築する。クラウド AI 基盤（API）とサーバーは外部サービスを利用し、汎用部分は作り込まない
- 将来の連携候補：WAGRI などの農業データ連携基盤
- ツール単体では課金しない（導入講座・伴走コンサルとセットで提供する）。そのため、課金機能より記録の定着を優先する
- 自農場プロトタイプで計測する指標：記録継続率（週あたりの記録数、合格ラインは週 5 件以上を 3 か月継続）、参照頻度、AI 利用コスト（想定は月数千円/農場）。これらを計測できるようにしておくとよい

## Agent skills

### Issue tracker

Issue と仕様は GitHub Issues（`shmaejp/sakuyomi`）で管理し、`gh` CLI で操作する。`docs/agents/issue-tracker.md` を参照。

### Triage labels

既定の 5 つのラベル（`needs-triage`・`needs-info`・`ready-for-agent`・`ready-for-human`・`wontfix`）を名前を変えずに使う。`docs/agents/triage-labels.md` を参照。

### Domain docs

1 つの文脈だけの構成（ルートの `GLOSSARY.md` と `docs/adr/`）。`docs/agents/domain.md` を参照。
