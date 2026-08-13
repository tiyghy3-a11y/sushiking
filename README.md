# YamaLog

山行写真アーカイブ。**GPXを扱わず、写真のEXIFだけで山行記録を成立させる。**

写真の撮影時刻・緯度経度・GPS標高を百名山マスタと突き合わせ、どの山かの自動判定・進捗マップ・標高推移・区間ペースを復元する。EXIFが欠けた写真も一級市民として保存・表示される。

仕様の全体は [SPEC.md](./SPEC.md)、UIの設計指針は [DESIGN.md](./DESIGN.md)（**UIを書く前に必読**）。

---

## 技術スタック

| 領域 | 選定 |
|---|---|
| ランタイム | Cloudflare Workers + Hono |
| DB | Cloudflare D1 |
| オブジェクトストレージ | Cloudflare R2 |
| フロント | React + Vite（Workers Assets で同一Workerから配信） |
| 地図 | MapLibre GL JS + 国土地理院タイル |
| EXIF / HEIC / サムネ生成 | exifr・heic2any・Canvas（**すべてクライアント側**） |
| グラフ | Recharts |
| 認証 | Cloudflare Access |

画像処理をWorkerでやるとCPU時間制限とライブラリ互換性で詰まるため、Worker の責務は「受け取ったものをR2とD1に置く」だけに限定している。

## まず触ってみる

Cloudflareのアカウントなしで動く。D1もR2もローカル（`.wrangler/state` 配下）に作られる。

```bash
npm install
npm run setup:local   # マイグレーション + 百名山マスタ投入
npm start             # ビルドして http://127.0.0.1:8787 で起動

# 別ターミナルで、中身のあるデモデータを入れる
npm run demo
```

`npm run demo` は合成画像にEXIF相当のメタデータを付けて投入し、山行3本（槍ヶ岳〜穂高岳の縦走 / 富士山 / 丹沢山）と未分類の写真7枚を作る。座標を落とした写真や撮影時刻のない写真も混ぜてあるので、**座標の補間・「日付不明」ブロック・山の自動判定・撮影者バッジ**まで一通り確認できる。消すときは `npm run demo:reset`。

**スマホで触る場合** は `npm run start:lan` で起動し、同じWi-Fiにいるスマホから `http://<PCのIPアドレス>:8787` を開く（IPは macOS なら `ipconfig getifaddr en0`、Windows なら `ipconfig`）。

開発時はViteのHMRを使う方が速い（`npm run dev:worker` と `npm run dev` を別ターミナルで起動 → http://127.0.0.1:5173）。

## セットアップ

```bash
npm install

# D1 と R2 を作成し、出力された database_id を wrangler.toml に書く
npx wrangler d1 create yamalog
npx wrangler r2 bucket create yamalog-photos

# スキーマ適用（ローカル）
npm run db:migrate:local

# 百名山マスタの投入（ローカル）
npm run seed:local

# フロント + Worker を起動（別ターミナルで2つ）
npm run dev:worker      # http://127.0.0.1:8787
npm run dev             # http://127.0.0.1:5173（/api と /img は :8787 にプロキシ）
```

本番へのデプロイ手順（Cloudflare Access・iPhoneのホーム画面追加まで）は **[DEPLOY.md](./DEPLOY.md)** にまとめてある。**独自ドメインは不要**で、`workers.dev` の URL に直接 Access をかけられる。

### 認証

Cloudflare Access で入口を絞り、**Worker 側でも Access のトークンを検証する**（署名・aud・有効期限・メール許可リスト）。`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `ALLOWED_EMAILS` が未設定だと全リクエストに 503 を返して閉じたままになるので、設定漏れで公開されることはない。

Preview URL（`<version>-yamalog.<subdomain>.workers.dev`）は Access の対象外で認証を迂回する入口になるため、`wrangler.toml` の `preview_urls = false` で塞いである。**ここは戻さないこと。**

ローカル開発では Access が前段にいないため `.dev.vars` の `ACCESS_DISABLED="1"` で外す（`npm run setup:local` が作る。コミットされないので本番には存在しない）。

## 百名山マスタの座標について

`seeds/hyakumeizan.csv` の `lat` / `lng` には**暫定座標が入っており、全件 `verified=0`（未確認）**。

- 山頂ではなく数百m〜1kmずれている可能性がある
- 北アルプス・南アルプスは `match_radius_m` が 1500m なので、このズレが山の誤判定に直結する

**一括で確定させるなら標高データを使う。**

```bash
npm run verify:coords              # 検証だけ（書き込まない）
npm run verify:coords -- --write   # 山頂に合わせて CSV を書き換え、verified=1 にする
```

国土地理院の標高タイル（DEM）を読んで各山の周囲から実際の最高地点を探し、CSV の標高値と突き合わせる（`scripts/verify-coords.ts`）。書き換えたら `npm run seed:local` / `npm run seed` で反映する。

個別に直したいときは `/settings` の百名山マスタ編集で、地図上のピンをドラッグして山頂に合わせ、「保存して確認済みにする」を押す。

`npm run seed:coords`（地名検索API・`scripts/fetch-coords.ts`）もあるが、**地名検索は山頂ではなく代表点を返す**。「富士山」で引くと山梨県鳴沢村の点（山頂から約10km）が候補に並ぶため、名前の一致度と既存座標からの距離で候補を絞る実装にしてある。それでも当たらない山があるので、一括確定には `verify:coords` を使うこと。

`peak_alias` は深田久弥の命名と実際の最高峰名が異なる山（阿寒岳→雌阿寒岳、大雪山→旭岳、吾妻山→西吾妻山など）に入れてあり、地名検索ではこちらを優先して問い合わせる。

## スマホ前提の作り

日常の利用はスマホからを想定している。DESIGN.md の Responsive Behavior / Touch Targets に沿って以下を守る。

- **タップ対象は最低44px。** グローバルナビは文字12pxのままタップ領域だけバー全高（44px）に広げてある
- **サブナビは52pxのバーを保ったまま横スクロールさせる。** 折り返して縦積みにしない（ボタンには `white-space: nowrap`）
- **写真グリッドは734px以下で2列、密度優先の面（未分類トレイ・取り込み）は3列**
- **モーダルは下から出るシート**（片手で閉じられる位置に）
- **ライトボックスは横スワイプで写真送り。** ダブルタップはピンチズームと競合するので使わない。選択モード中の拡大は専用ボタン（⤢）
- **ノッチ・ホームインジケータを避ける。** `env(safe-area-inset-*)` と `100dvh`（URLバーの伸縮で見切れないように）
- **フォームは17px。** iOS Safari がフォーカス時に自動ズームする閾値（16px）を下回らないこと
- **ホーム画面に追加して使える。** `manifest.webmanifest` で `display: standalone`、ステータスバーはナビと同じ黒、アイコンは `npm run icons` で生成（追加手順は DEPLOY.md）
- **横スクロールを発生させない。** 幅の広い表は `.table-scroll` で表の中だけ流す
- 地図のズームボタンはスマホでは出さない（29px角で小さいため、ピンチ操作に任せる）

取り込みまわりのスマホ対策:

- HEICは**まずブラウザのネイティブデコードを試す**。iOS Safariは読めるので、その場合1.3MBの `heic2any` を読み込まない
- EXIF Orientation付きの写真は `<img>` 経由でデコードする。`createImageBitmap` の `imageOrientation` オプションは Safari 16.4 未満で無視され、iPhoneの縦位置写真が横倒しになるため
- ブラウザからの取り込みは**一度に500枚まで**。6枚ずつ「解析→送信→メモリ解放」を繰り返すので、枚数が増えてもメモリは増えない。数千枚の初回投入はCLI（`scripts/bulk-import.ts`）で

## 写真の運用ルール

**LINEで写真を送ると位置情報とEXIFが削除される。** 山行ごとに **iCloud共有アルバム / Googleフォトの共有リンク** を1本立てて集める運用にすれば、EXIFが保持されるので欠損がほとんど発生しない。

写真の実データは1枚もリポジトリに入れない（`.gitignore` で `*.jpg` 等を除外済み）。原本はR2にしか存在しない状態を保つ。

## 過去写真の一括投入

数千枚の初回投入はブラウザでは現実的でないので、CLIを使う。

```bash
# 件数とEXIF充足率だけ確認
npx tsx scripts/bulk-import.ts ~/Pictures/yama --dry-run

# 実投入（撮影者と時計オフセットを指定）
npx tsx scripts/bulk-import.ts ~/Pictures/yama --contributor "自分" --offset 0

# 失敗分だけ再実行
npx tsx scripts/bulk-import.ts --retry-failed
```

- jpg/jpeg/heic/heif/png を再帰的に走査
- `exifr` でEXIF抽出、`sharp` でリサイズ（長辺1600px / 400px）
- SHA-256を算出し `/api/photos/check-hashes` で既存分を除外
- 並列度3（`--concurrency` で変更可）で `/api/photos/upload` に投入
- 失敗分は `failed.json` に書き出される

ブラウザからの `/import` は日常の追加用。

**取り込んだ写真は必ず未分類トレイに入る。** activityへの割り当ては `/inbox` で行う。自動でactivityを作らないのは、判定を間違えたときの巻き戻しを楽にするため。

## データの考え方

- **EXIFは必須にしない。** 座標も時刻も nullable。欠損は異常系ではなく通常系
- **由来を必ず記録する。** `time_source` = exif / file / manual / none、`coord_source` = exif / interpolated / manual / none
- **手動での上書きを常に許す。** 自動判定は初期値の提案にすぎない
- **原本は絶対に加工しない。** R2にオリジナルを保存し、表示用（1600px）とサムネ（400px）は別途生成

`coord_source` の用途別の扱い:

| 用途 | 使うデータ |
|---|---|
| 写真グリッド・アルバム表示 | 全件 |
| 地図上のピン表示 | exif / interpolated / manual（interpolatedは半透明） |
| 標高グラフ・距離・ペース・累積標高・山の自動判定 | **exif のみ** |

統計値は写真のGPS情報から算出した推定値。GPS標高は誤差±20m程度あり、写真は連続的に撮るものではないため、実際より小さく出る傾向がある（UIにも注記を出している）。

## 開発

```bash
npm test          # ロジックのユニットテスト（距離・補間・統計）
npm run typecheck # Worker / web / scripts の3プロジェクトを型検査
npm run build     # 型検査 + フロントのビルド（dist/web）
```

### ディレクトリ

```
migrations/   D1マイグレーション
seeds/        百名山マスタCSV
scripts/      fetch-coords / seed / bulk-import
src/          Worker (Hono)
  lib/        純粋ロジック（geo・interpolate・stats・time。web/scriptsからも読む）
  db/         D1・R2に触る処理
  routes/     APIルート
web/          フロント (Vite + React)
```

### GitHub 運用

`main` を常にデプロイ可能な状態に保ち、機能ごとに `feat/xxx` を切ってPRでマージする。

Repository secrets に以下を登録すると `main` へのpushで自動デプロイされる。

| キー | 取得元 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflareダッシュボード → API Tokens（Workers Scripts:Edit / D1:Edit / R2:Edit に絞る） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflareダッシュボードのアカウント概要 |

リポジトリは **Private 推奨**（`wrangler.toml` のバインディング構成が読めるため）。

## Phase 0 の実装状況

- [x] 0. リポジトリ初期化（.gitignore / DESIGN.md / GitHub Actions）
- [x] 1. プロジェクト初期化（Workers + Hono + Vite/React、D1/R2バインディング）
- [x] 2. スキーマ適用と百名山マスタ投入（座標は要目視確認）
- [x] 3. アップロードパイプライン（EXIF・HEIC変換・サムネ生成・重複スキップ）
- [x] 4. 未分類トレイ（日付グルーピング、activity作成、既存activityへの追加）
- [x] 5. 山の自動判定（Haversine・最近傍マッチ・提案UI）
- [x] 6. 山行詳細（写真グリッド・ライトボックス・地図タブ）
- [x] 7. 座標補間と統計（線形補間・統計算出・標高グラフ）
- [x] 8. ホーム進捗マップと山ページ
- [x] 9. CLI一括投入スクリプト
- [ ] 10. 過去写真の実データ投入と、判定半径のチューニング

Phase 1 以降の候補は SPEC.md 12章を参照。
