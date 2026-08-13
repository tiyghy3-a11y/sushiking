# YamaLog 引き継ぎメモ（Phase 0 時点）

写真のEXIFだけで山行記録を成立させる個人用アーカイブ。SPEC.md の Phase 0 をひととおり実装し、ローカルで動作確認済み。**Cloudflare にデプロイ済み・稼働中**（<https://yamalog.tiyg-hy-3.workers.dev>）。Cloudflare Access（One-time PIN / Session 1 month / Emails で限定）と secret 3つも設定済み。

このファイルは別の場所でプランを練るための材料集。仕様の正典は [SPEC.md](./SPEC.md)、UI指針は [DESIGN.md](./DESIGN.md)、デプロイ手順は [DEPLOY.md](./DEPLOY.md)。

---

## 1. リポジトリ

| 項目 | 値 |
|---|---|
| 現リポジトリ | `tiyghy3-a11y/sushiking`（https://github.com/tiyghy3-a11y/sushiking） |
| 作業ブランチ | **`claude/repo-init-design-review-h8popj`** |
| 移行先 | **新リポジトリ `yamalog`（Private 推奨）** — 手順は下 |
| ベースコミット | `87b7024` YamaLog Phase 0 |
| 規模 | `main` 比で 109ファイル / 約 +14,900 −4,901 行。TS/TSX/SQL/CSS で約8,000行 |
| PR | **作らない**（`sushiking` にはマージしない） |

```bash
git clone -b claude/repo-init-design-review-h8popj https://github.com/tiyghy3-a11y/sushiking.git yamalog
```

### main との関係 → **別リポジトリへ分離することに決定**

`main` にはこのリポジトリの**元の中身（割り勘アプリ sushiking）**が入っており、こちらの作業とは別に PR #5 がマージされて `8de1458` まで進んでいる。作業ブランチは「リポジトリ初期化」の指示に従い、割り勘アプリのファイルを撤去して YamaLog に置き換えてある。

このブランチを `sushiking` の `main` にマージすると割り勘アプリが消えるため、**YamaLog は新しいリポジトリへ移す**。`sushiking` は一切触らない（このブランチも残したままでよい）。

#### 移す手順

GitHub で空のリポジトリ `yamalog` を作る（**Private** 推奨。`wrangler.toml` のバインディング構成が読めるため）。README も .gitignore も追加しない。

```bash
git clone -b claude/repo-init-design-review-h8popj \
  https://github.com/tiyghy3-a11y/sushiking.git yamalog
cd yamalog

git remote rename origin sushiking
git remote add origin https://github.com/tiyghy3-a11y/yamalog.git
git branch -m main
git push -u origin main
```

これで `main` が YamaLog になる。GitHub の Settings → Branches で `main` を既定ブランチにしておく。

履歴には割り勘アプリのコミットが祖先として残る（作業ツリーには1ファイルも無い）。気になるなら、`git push` の前に履歴を切る。

```bash
git checkout --orphan clean-main
git commit -m "YamaLog Phase 0"
git branch -D main && git branch -m main
```

**`sushiking` 側では何もしない。** 割り勘アプリは `main`（`8de1458`）にそのまま残る。

デプロイ用の Repository secrets（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）は新リポジトリ側に登録する。

### 実際に触れるデモ

https://claude.ai/code/artifact/3fa4704f-ecfc-462a-b398-d9665cb7c010

UIを1枚のHTML（2.8MB）に固めたもの。API・DB・R2の代わりにページ内のインメモリモックが応答する。距離計算・座標補間・統計は本番と同じ `src/lib` を呼ぶので数値と挙動は実装どおり。地図タイルだけは外部通信が遮断されるため下地のみ。スマホのブラウザで開ける。

---

## 2. 実装状況（SPEC.md 11章の実装順序）

| # | 項目 | 状態 |
|---|---|---|
| 0 | リポジトリ初期化（.gitignore / DESIGN.md / Actions） | 完了 |
| 1 | Workers + Hono + Vite/React、D1/R2バインディング | 完了 |
| 2 | スキーマ適用と百名山マスタ投入 | 完了（**座標は暫定値のまま**。確定用の `verify:coords` は用意済み・手元で実行） |
| 3 | アップロードパイプライン（EXIF・HEIC・サムネ・重複スキップ） | 完了 |
| 4 | 未分類トレイ | 完了 |
| 5 | 山の自動判定（Haversine・最近傍・提案UI） | 完了 |
| 6 | 山行詳細（写真グリッド・ライトボックス・地図タブ） | 完了 |
| 7 | 座標補間と統計（線形補間・統計算出・標高グラフ） | 完了 |
| 8 | ホーム進捗マップと山ページ | 完了 |
| 9 | CLI一括投入スクリプト | 完了 |
| 10 | 過去写真の実データ投入と判定半径チューニング | **未着手**（手元作業） |
| — | 認証・デプロイ準備（DEPLOY.md） | 完了 |
| — | Cloudflare へのデプロイ | 完了（<https://yamalog.tiyg-hy-3.workers.dev>。画像は D1 保存＝R2不要。Access + secret 3つ設定済みで**稼働中**） |
| — | スマホ最適化・ホーム画面対応 | 完了（実機Safari未検証） |

### テストと検証

- ユニットテスト **83件**（距離・補間・統計・Access検証・DEMの山頂探索・地名検索の候補選択）— `npm test`
- ローカル `wrangler dev` + D1/R2 に対する E2E 26アサーション（取り込み→判定→補間→統計→削除まで）
- Chromium で全ルート描画確認、iPhone相当（390×844）で横スクロールなし・44pxタップ対象を確認
- 認証の fail-closed（設定なしで HTML/JS/manifest すべて503）をローカルで確認

---

## 3. 構成

```
migrations/0001_init.sql      D1スキーマ
seeds/hyakumeizan.csv         百名山マスタ（座標は暫定・verified=0）
scripts/
  verify-coords.ts            地理院DEMで山頂を特定して座標を確定
  fetch-coords.ts             地名検索APIで空欄の座標を補完
  seed.ts                     CSV → D1
  bulk-import.ts              写真の一括投入（数千枚用）
  demo-seed.ts                デモデータ投入（--reset で削除）
  build-demo.ts               単一HTMLデモのビルド
  make-icons.ts               ホーム画面アイコン生成
  ensure-dev-vars.ts          ローカル用 .dev.vars を作る
src/                          Worker (Hono)
  lib/                        純粋ロジック（geo / interpolate / stats / time / access）
  db/                         D1・R2に触る処理
  routes/                     APIルート
web/                          フロント (Vite + React)
  src/pages/                  Home / Activities / ActivityDetail / Inbox / MountainPage / Import / Settings
  src/components/             MapView / PhotoGrid / Lightbox / Modal / MountainPicker / ElevationChart
  src/demo/                   デモ用のインメモリAPI
  public/                     manifest とアイコン
```

技術スタック: Cloudflare Workers + Hono / D1 / R2 / React + Vite（Workers Assets で同一Workerから配信）/ MapLibre GL JS + 国土地理院タイル / Recharts / exifr + heic2any（**ブラウザ側**）/ Cloudflare Access。

### データモデル（要約）

`mountains`（百名山100件・`match_radius_m` を山ごとに持つ）、`contributors`（撮影者・時計オフセット）、`activities`（山行）、`activity_mountains`（多対多・縦走用・`is_primary`）、`photos`（`activity_id` が NULL なら未分類トレイ）、`import_batches` + `photo_batch_map`。

写真の要点: 座標・時刻は **nullable**。`time_source` = `exif|file|manual|none`、`coord_source` = `exif|interpolated|manual|none`。`content_hash` に UNIQUE 制約（完全一致の重複検出）。

### API

```
GET    /api/health                      認証なし（死活監視）
GET    /api/me                          ログイン中のメール
GET    /api/progress                    進捗サマリ
GET    /api/mountains                   一覧（進捗フラグ付き）
GET    /api/mountains/:id               詳細 + 関連山行
PATCH  /api/mountains/:id               座標・判定半径・確認済みフラグ
GET    /api/activities                  一覧（ページング）
POST   /api/activities                  作成（photo_ids と山の紐付けを同時に渡せる）
GET    /api/activities/:id              詳細（写真・山・統計込み）
PATCH  /api/activities/:id              更新
DELETE /api/activities/:id              削除（写真は未分類に戻す）
PUT    /api/activities/:id/mountains    紐付け山の一括更新
POST   /api/activities/:id/photos       写真を割り当て（付け替えも）
DELETE /api/activities/:id/photos       写真を未分類に戻す
GET    /api/activities/:id/stats         統計
GET    /api/activities/:id/suggest-mountains  山の自動判定（提案）
GET    /api/photos/unassigned           未分類トレイ（日付グルーピング済み）
POST   /api/photos/suggest-mountains    写真群から山を推定
POST   /api/photos/check-hashes         重複判定
POST   /api/photos/upload               multipart（1リクエスト1枚）
PATCH  /api/photos/:id                  caption / 座標手動 / favorite / 時刻
DELETE /api/photos/:id                  削除（R2からも）
GET    /api/contributors, POST, PATCH /api/contributors/:id
POST   /api/import-batches, GET
GET    /img/{thumb|display|original}/:id
```

---

## 4. 主要な設計判断（理由つき）

| 判断 | 理由 |
|---|---|
| 画像処理は全部クライアント側 | WorkersでHEICデコード/EXIF解析はCPU時間と互換性で詰まる。Workerは「R2とD1に置く」だけ |
| アップロード直後は必ず未分類 | 自動でactivityを作ると誤判定の巻き戻しが面倒 |
| 山の判定は「提案」に留める | 縦走で複数座がヒットする。確定はユーザー |
| `interpolated` は分析から除外 | 標高グラフ・距離・ペース・累積標高・山判定は `exif` のみ。混ぜると数値が汚れる |
| 補間の閾値 2時間 / 30分 | 前後2点が2時間超なら補間しない。系列外は最近傍30分以内なら座標コピー |
| 累積標高は移動中央値(window=5)後に+10m以上のみ加算 | GPSノイズの切り捨て。**写真の間の起伏は取りこぼすので実際より小さく出る**（UIに注記済み） |
| 既定は原本を保存しない（`PHOTO_STORAGE="d1"`） | R2 の有効化には支払い方法の登録が必要なため、表示用1600px・サムネ400pxだけを D1 に入れる構成を既定にした。EXIF抽出はブラウザ側で終わっているので山判定・地図・統計は変わらない。原本は端末の写真ライブラリに残す。R2 を使う場合は `wrangler.toml` の `r2_buckets` を有効化して `PHOTO_STORAGE="r2"` |
| `run_worker_first = true` | `[assets]` は既定でアセットをWorkerより先に返し、アプリシェルとJSが誰でも取れてしまう。実際に200が返るのを確認して塞いだ |
| `preview_urls = false` | Access は workers.dev の本体URLにかかる。Preview URL は対象外なので、開いていると認証を迂回する入口になる |
| 座標の確定は地名検索でなく標高データ | 地名検索は山頂ではなく代表点を返す（「富士山」の候補に山頂から約10kmの点が並ぶ）。DEMから「標高が一致する局所最高点」を探すほうが確実 |
| 山頂探索は範囲内の最高点を採らない | 前穂高岳3090mの1500m圏内に奥穂高岳3190mがあり、最高点を採ると隣の峰へ吸着する。CSVの標高値との一致を条件にする |
| 画像の Cache-Control を `private` | 個人の写真を共有キャッシュに載せない（**SPECの `public` から意図的に変更**） |
| Worker側でもAccessトークンを検証 | Access の設定を外したときや別ホスト名（Preview URL 等）から入られたときに素通りしないため。Cloudflare 自身も workers.dev で Access を使う場合は Worker 側で aud と JWKS を検証するよう案内している |
| 認証未設定なら503 | 設定漏れで公開される事故を防ぐ（fail closed） |
| `verified` と `peak_alias` を mountains に追加 | CSVが持っている情報。SPECのDDLには無いが座標確認の運用に必要 |

---

## 5. 認証とデプロイ（詳細は DEPLOY.md）

**独自ドメインは不要。** `workers.dev` の URL に Cloudflare Access を直接かけられる（Worker の Settings → Domains & Routes → workers.dev の **Enable Cloudflare Access**）。Cloudflare 側も「Access を有効にしたうえで Worker 内で aud と JWKS を検証すること」を案内していて、その検証は `src/lib/access.ts` に実装済み。**追加コードは要らない。**

> Phase 0 の作業時は「`*.workers.dev` には Access を適用できない」という前提で書いていたが、これは誤り。招待制ログインの自前実装も不要。

順番が大事で、**先にデプロイして Worker を作らないと Access を有効にする画面が出ない**。認証が未設定のうちは Worker が全リクエストに 503 を返すので、先にデプロイしても中身は見えない。

1. `wrangler d1 create` / `r2 bucket create` → `database_id` を `wrangler.toml` に貼る
2. `npm run db:migrate` → `npm run seed`
3. `npm run build && npx wrangler deploy` → `https://yamalog.<サブドメイン>.workers.dev` が生える（この時点では503）
4. Worker の Settings → Domains & Routes → workers.dev の **Enable Cloudflare Access**。**Preview URLs が Disabled になっていることも確認**
5. Access アプリの Policy で Include を **Emails**、ログインは **One-time PIN**、Session Duration は **1 month**。**AUD Tag** をコピー
6. `wrangler secret put` で `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `ALLOWED_EMAILS`（secret は保存した時点で反映。再デプロイ不要）

`wrangler.toml` は `workers_dev = true` / `preview_urls = false` にしてある。**Preview URL（`<version>-yamalog.<subdomain>.workers.dev`）は Access の対象外**で、開いていると認証を迂回する入口になるため必ず塞いだままにする。

`/api/health` は Worker 側では認証を通していないが、Access がホスト名全体にかかるためエッジで止まる。外形監視を入れるなら Access 側でそのパスに Bypass ポリシーを当てる。

独自ドメインで受けたくなった場合の手順は DEPLOY.md の付録にある。

### iPhoneのホーム画面

Safari で開いて 共有 → ホーム画面に追加。`display: standalone`、ステータスバーは黒（ナビと同色）、アイコンは `npm run icons` で生成。**オフラインでは開けない**（Service Worker なし。Phase 0 の「やらないこと」）。

---

## 6. これから決めること・やること

### 決まったこと

| 論点 | 結論 |
|---|---|
| `main` をどうするか | **YamaLog を新リポジトリへ分離**。`sushiking` は触らない（[1章](#main-との関係--別リポジトリへ分離することに決定)に手順） |
| ドメインを用意するか | **不要**。`workers.dev` に Access を直接かける（[5章](#5-認証とデプロイ詳細は-deploymd)） |
| 座標をどう確定させるか | **`npm run verify:coords -- --write`**。地理院の標高タイルから山頂を特定する |

### Phase 0 の残り（この順が素直）

1. 新リポジトリへ移す（[1章](#main-との関係--別リポジトリへ分離することに決定)）
2. `npm run verify:coords -- --write` → `npm run seed:local` で座標を確定
3. デプロイして Access をかける（[DEPLOY.md](./DEPLOY.md)）
4. 過去写真の実データ投入（`scripts/bulk-import.ts`、まず `--dry-run` でEXIF充足率を見る）
5. 投入結果を見て `match_radius_m` をチューニング
6. 実機 iOS Safari での確認（`backdrop-filter`、`100dvh`、HEICのネイティブデコード分岐、ホーム画面追加）
7. 地図タイルの実描画確認（この環境からは国土地理院に到達できず未確認）

### Phase 1 以降の候補（SPEC.md 12章）

GPXインポートとGPX由来統計での上書き（`activities.stats_source` を将来追加する想定）／pHashによる近似重複検出（`photos.phash` 追加 + ハミング距離）／オフライン対応（Service Worker）／二百名山・三百名山マスタ／山行記録のPDF・Web書き出し／装備リストの構造化。

### 運用ルール（README にも記載）

**LINEで写真を送るとEXIFと位置情報が消える。** iCloud共有アルバム / Googleフォトの共有リンクなら保持されるので、山行ごとに共有アルバムを1本立てる運用にする。

---

## 7. 既知の制約・注意点

- **百名山の座標は暫定値のまま**（全件 `verified=0`）。地理院のホストがこの作業環境から遮断されていて確定できていない。数百m〜1kmずれている可能性がある。手元で `npm run verify:coords -- --write` を回せば確定する（DEM から山頂を特定して `verified=1` にする。所要2〜3分）
- **`npm run seed:coords`（地名検索API）を単独で信用しない。** 地名検索は山頂ではなく代表点を返す。「富士山」の候補には山頂から約10km離れた鳴沢村の点や各地の「小富士山」「富士山駅」が並ぶ。完全一致 + 既存座標からの距離で絞る実装に直したが、座標の確定には `verify:coords` を使うこと
- **実機 iOS Safari 未検証**（環境にSafariが無い）。検証はChromiumのモバイルエミュレーション
- **地図タイル未描画**（環境から国土地理院に到達できない）。ピンと軌跡の座標は正しいことを確認済み
- **ブラウザからの取り込みは一度に500枚まで**。6枚ずつ解析→送信→解放を繰り返す（全部解析してから送るとiPhoneでタブが落ちる）。数千枚はCLI
- 縦走の「行動時間」は最初と最後の写真の時刻差なので、1泊2日だと31時間などになる（SPEC通りの定義。仮眠時間を含む）
- JSバンドルが約1.5MB（heic2any は動的importで分離済み）。初回ロードはやや重い
- `run_worker_first = true` によりアセット配信もWorker呼び出しになる（課金対象のリクエスト数が増える）
- コスト: R2のストレージ（原本＋1600px＋400px の3本分）とWorkerのリクエスト数が主。写真枚数が決まってから現行の料金表で見積もる

---

## 8. コマンド早見表

```bash
# ローカルで動かす（Cloudflareアカウント不要）
npm install
npm run setup:local        # マイグレーション + 百名山マスタ + .dev.vars 作成
npm start                  # ビルドして http://127.0.0.1:8787
npm run demo               # デモデータ投入（別ターミナル）/ demo:reset で削除
npm run start:lan          # スマホ実機から http://<PCのIP>:8787

# 開発
npm run dev:worker         # :8787（API）
npm run dev                # :5173（Vite HMR、/api と /img をプロキシ）
npm test                   # ユニットテスト83件
npm run typecheck          # Worker / web / scripts の3プロジェクト

# データ
npm run verify:coords            # 座標をDEMで検証（書き込まない）
npm run verify:coords -- --write # 山頂に寄せて verified=1 にする
npm run seed:coords -- --force   # 地名検索APIで再取得（代表点。確定には使わない）
npm run bulk-import -- ~/Pictures/yama --contributor "自分" --dry-run
npm run build:demo         # 単一HTMLデモ → dist/demo/yamalog-demo.html
npm run icons              # ホーム画面アイコン再生成

# 本番
npm run db:migrate && npm run seed
npm run build && npx wrangler deploy
```

## 9. 読むと早いファイル

| 知りたいこと | 見る場所 |
|---|---|
| 仕様の全体 | `SPEC.md` |
| UIの決まり | `DESIGN.md`（**UI実装前に必読**）、`web/src/styles/tokens.css` |
| 距離・補間・統計のロジック | `src/lib/geo.ts` / `interpolate.ts` / `stats.ts` + 各 `.test.ts` |
| 認証 | `src/lib/access.ts` / `src/index.ts` のミドルウェア / `DEPLOY.md` |
| 座標の確定 | `scripts/verify-coords.ts` / `scripts/lib/dem.ts` + `dem.test.ts` |
| 取り込みの流れ | `web/src/lib/photo-pipeline.ts`（ブラウザ側）→ `src/routes/photos.ts`（Worker側） |
| 未分類トレイの動き | `web/src/pages/Inbox.tsx` |
| デモの仕組み | `web/src/demo/mock-api.ts` |
| スマホ対応 | `web/src/styles/app.css` の `@media (max-width: 734px)` ブロック |
