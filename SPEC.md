# 山行写真アーカイブ（仮称: YamaLog）Phase 0 仕様書

> Claude Code に渡して実装を開始するための仕様書。
> Phase 0 のゴールは「過去の山行写真を全部投入して、百名山の進捗マップが埋まり、山行ごとに振り返れる状態」。

---

## 1. コンセプト

**GPXを扱わず、写真のEXIFだけで山行記録を成立させる。**

写真には撮影時刻・緯度経度・GPS標高が埋まっている。これを百名山マスタと突き合わせれば、どの山かの自動判定・進捗マップ・標高推移・区間ペースまでが復元できる。専用のロガーアプリを作らずに、アーカイブと分析の両方を満たすのが狙い。

ただし他人からもらった写真はEXIFが欠損しうる。そこで**「写真はactivity（山行）に属する」を正とし、EXIFはあくまで自動割り当てのヒント**として扱う。EXIFがなくても写真は一級市民として保存・表示される。

### 設計原則

1. **EXIFは必須にしない。** 座標も時刻も nullable。欠損を異常系ではなく通常系として扱う
2. **由来を必ず記録する。** 座標・時刻それぞれに source を持たせ、アルバム表示は全件・分析は信頼できるものだけ、と用途で切り分ける
3. **手動での上書きを常に許す。** 自動判定は初期値の提案にすぎない
4. **原本は絶対に加工しない。** R2にオリジナルを保存し、表示用は別途生成する

---

## 2. Phase 0 のスコープ

### やること

- 写真の一括アップロード（ブラウザ / ローカルCLIスクリプト両方）
- EXIF抽出、座標・時刻の3段階フォールバック
- 撮影者ごとの時計オフセット補正
- 百名山マスタとの最近傍マッチによる山の自動判定
- 山行（activity）のCRUD、写真の割り当て・付け替え
- 未分類トレイ（activity未割り当ての写真を日付単位で処理）
- 百名山進捗マップ + 完登カウンタ
- 山行詳細: 写真グリッド / 撮影地点の地図プロット / 標高グラフ / 統計値
- 山ごとのページ（同じ山の複数回の山行をまとめる）

### やらないこと（Phase 1以降）

- GPXのインポート・リアルタイムGPSロギング
- pHashによる近似重複検出（完全一致のハッシュ重複のみ対応）
- 外部への共有・公開機能
- オフライン対応、モバイルネイティブアプリ
- 百名山以外の山マスタ（二百名山等）

---

## 3. 技術スタック

| 領域 | 選定 | 備考 |
|---|---|---|
| ランタイム | Cloudflare Workers | |
| APIフレームワーク | Hono | |
| DB | Cloudflare D1 | |
| オブジェクトストレージ | Cloudflare R2 | 原本・サムネイル |
| フロント | React + Vite (SPA) | Workers Assets で同一Workerから配信 |
| 地図 | MapLibre GL JS | |
| 地図タイル | 国土地理院タイル | 標準地図 / 淡色 / 写真 / 傾斜量図を切替 |
| EXIF抽出 | exifr | **ブラウザ側で実行** |
| HEIC変換 | heic2any | **ブラウザ側で実行** |
| グラフ | Recharts | 標高プロファイル |
| 認証 | Cloudflare Access | 個人利用のためこれで十分 |
| デザイン指針 | DESIGN.md（getdesign apple） | 後述。UI実装前に必読 |
| ソース管理 | GitHub + GitHub Actions | 後述 |

### 重要: 画像処理はクライアント側で行う

WorkersでHEICデコードやEXIF解析をやると、ライブラリの互換性とCPU時間制限で必ず詰まる。以下をすべてブラウザ（またはローカルNodeスクリプト）で完結させ、Workerには**確定した値とバイナリだけ**を渡す。

- EXIF抽出
- HEIC → JPEG 変換
- サムネイル生成（長辺1600px / 長辺400px の2種）

Worker側の責務は「受け取ったものをR2とD1に置く」だけに限定する。

### 地図タイルURL

```
標準地図: https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png
淡色地図: https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png
写真:     https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg
傾斜量図: https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png
```

出典表記「国土地理院」をアトリビューションとして必ず表示する。

---

## 4. データモデル（D1 / SQLite）

```sql
-- 百名山マスタ
CREATE TABLE mountains (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  name_kana     TEXT,
  elevation     INTEGER NOT NULL,      -- m
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  area          TEXT,                  -- 山域（例: 南アルプス）
  prefectures   TEXT,                  -- JSON配列 ["山梨県","長野県"]
  is_hyakumeizan INTEGER NOT NULL DEFAULT 1,
  match_radius_m INTEGER NOT NULL DEFAULT 3000  -- 自動判定の許容半径
);
CREATE INDEX idx_mountains_latlng ON mountains(lat, lng);

-- 撮影者（自分 + 同行者）
CREATE TABLE contributors (
  id                     TEXT PRIMARY KEY,   -- uuid
  name                   TEXT NOT NULL,
  is_self                INTEGER NOT NULL DEFAULT 0,
  default_time_offset_sec INTEGER NOT NULL DEFAULT 0,  -- カメラ時計のずれ補正
  created_at             TEXT NOT NULL
);

-- 山行
CREATE TABLE activities (
  id          TEXT PRIMARY KEY,        -- uuid
  title       TEXT NOT NULL,
  start_date  TEXT NOT NULL,           -- YYYY-MM-DD
  end_date    TEXT NOT NULL,
  note        TEXT,                    -- 自由記述（装備・行動食・反省など）
  members     TEXT,                    -- 自由記述
  cover_photo_id TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_activities_date ON activities(start_date DESC);

-- 山行と山の多対多（縦走で複数座を踏むため）
CREATE TABLE activity_mountains (
  activity_id TEXT NOT NULL,
  mountain_id INTEGER NOT NULL,
  summited_at TEXT,                    -- ISO8601, nullable
  is_primary  INTEGER NOT NULL DEFAULT 0,  -- 主峰フラグ
  PRIMARY KEY (activity_id, mountain_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (mountain_id) REFERENCES mountains(id)
);

-- 写真
CREATE TABLE photos (
  id             TEXT PRIMARY KEY,     -- uuid
  activity_id    TEXT,                 -- NULL = 未分類トレイ
  contributor_id TEXT,

  r2_key_original TEXT NOT NULL,
  r2_key_display  TEXT NOT NULL,       -- 長辺1600px
  r2_key_thumb    TEXT NOT NULL,       -- 長辺400px

  taken_at       TEXT,                 -- ISO8601, オフセット補正適用後
  taken_at_raw   TEXT,                 -- 補正前の生値（監査用）
  time_source    TEXT NOT NULL,        -- exif | file | manual | none

  lat            REAL,
  lng            REAL,
  altitude       REAL,                 -- m, GPS標高
  coord_source   TEXT NOT NULL,        -- exif | interpolated | manual | none

  width          INTEGER,
  height         INTEGER,
  mime           TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  content_hash   TEXT NOT NULL,        -- SHA-256（完全一致の重複検出用）
  camera_model   TEXT,
  caption        TEXT,
  is_favorite    INTEGER NOT NULL DEFAULT 0,

  created_at     TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);
CREATE INDEX idx_photos_activity ON photos(activity_id, taken_at);
CREATE INDEX idx_photos_unassigned ON photos(activity_id, taken_at) WHERE activity_id IS NULL;
CREATE UNIQUE INDEX idx_photos_hash ON photos(content_hash);

-- 取り込みバッチ（やり直し・一括削除のため）
CREATE TABLE import_batches (
  id             TEXT PRIMARY KEY,
  contributor_id TEXT,
  time_offset_sec INTEGER NOT NULL DEFAULT 0,
  photo_count    INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE photo_batch_map (
  photo_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  PRIMARY KEY (photo_id, batch_id)
);
```

### R2 のキー設計

```
original/{yyyy}/{mm}/{photo_id}.{ext}
display/{photo_id}.jpg
thumb/{photo_id}.jpg
```

---

## 5. 写真取り込みフロー

### 5.1 全体の流れ

```
[ファイル選択]
  → HEICならJPEG変換
  → exifrでEXIF抽出
  → SHA-256算出、既存hashと照合（重複ならスキップ）
  → display / thumb 生成
  → 撮影者・時計オフセットを指定
  → アップロード（Worker）
  → R2保存 + photos INSERT（activity_id = NULL）
  → 未分類トレイへ
```

**重要:** アップロード直後は必ず未分類。activityへの割り当ては後段の別処理にする。自動でactivityを作ると、判定を間違えたときの巻き戻しが面倒になる。

### 5.2 時刻の決定

| 優先度 | ソース | time_source |
|---|---|---|
| 1 | EXIF `DateTimeOriginal` | `exif` |
| 2 | ファイルの lastModified | `file` |
| 3 | ユーザーが手入力 | `manual` |
| 4 | 不明 | `none` |

決定した時刻に `contributor.default_time_offset_sec`（またはバッチ指定のオフセット）を加算し `taken_at` へ。補正前の値は `taken_at_raw` に残す。

**時計オフセットの求め方（UI提案）:** 取り込み画面で「基準にする自分の写真」と「同じ瞬間を写した相手の写真」を1組選ばせ、差分を自動計算してオフセット候補として提示する。山頂標識の写真を使えば十分な精度が出る。手入力も可能にする。

### 5.3 座標の決定（3段階フォールバック）

**Step 1 — EXIF:** `GPSLatitude` / `GPSLongitude` があればそのまま採用。`coord_source = 'exif'`。`GPSAltitude` も取得（`GPSAltitudeRef` が1なら負値にする）。

**Step 2 — 時系列補間:** 座標がなく `taken_at` がある写真について、**同一activity内**の `coord_source = 'exif'` な写真を `taken_at` 昇順に並べ、対象時刻を挟む前後2点から線形補間する。

- 前後2点の時間差が **2時間** を超える場合は補間しない
- 対象時刻が系列の範囲外の場合、最近傍点との時間差が **30分** 以内なら座標をコピー、超えるなら補間しない
- 成功時 `coord_source = 'interpolated'`

この処理はactivityへの割り当て時、および割り当て済み写真の追加時に再実行する。

**Step 3 — 手動/なし:** 上記で決まらなければ `coord_source = 'none'`。地図上をクリックして手動指定した場合は `manual`。

### 5.4 coord_source の用途別の扱い

| 用途 | 使うデータ |
|---|---|
| 写真グリッド・アルバム表示 | **全件** |
| 地図上のピン表示 | `exif` / `interpolated` / `manual`（interpolatedは半透明で区別） |
| 標高グラフ | **`exif` のみ** |
| 距離・ペース・累積標高の算出 | **`exif` のみ** |
| 山の自動判定 | **`exif` のみ** |

分析系に interpolated を混ぜると数値が汚れるので必ず除外する。

### 5.5 重複の扱い

Phase 0 では SHA-256 の完全一致のみ検出し、一致したらアップロードをスキップして「n件は取り込み済みのためスキップしました」と表示する。

圧縮・リサイズを経た近似重複は検出できない。これは Phase 1 で pHash を導入して対応する（`photos.phash` カラムを追加し、ハミング距離で近傍探索）。Phase 0 では割り切る。

### 5.6 運用上の推奨（実装ではなく運用ルール）

LINEで写真を送ると位置情報とEXIFが削除される。**iCloud共有アルバム / Googleフォトの共有リンク**ならEXIFが保持されるので、山行ごとに共有アルバムを1本立てる運用にすれば、そもそも欠損がほとんど発生しない。READMEにこの旨を明記する。

---

## 6. 山の自動判定

未分類の写真をactivityに割り当てる際、および山を推定する際のロジック。

1. 対象写真群のうち `coord_source = 'exif'` のものを抽出
2. 各写真について、`mountains` 全件との距離を Haversine で計算
3. `match_radius_m` 以内の山を候補とし、最も近いものを紐付け
4. 写真群全体で最頻の山を **主峰候補**、その他の候補も **通過候補** として提示

**必ず「提案」として出し、ユーザーが確定させる。** 自動確定はしない。縦走では複数座がヒットするので、チェックボックスで複数選択できるUIにする。

半径は山によって適切な値が違う（独立峰は広く、連峰の隣接ピークは狭く）ため `match_radius_m` をマスタで個別に持つ。デフォルト3000m、北アルプス等の稠密なエリアは1500m程度に調整する。

---

## 7. 統計値の算出

すべて `coord_source = 'exif'` の写真のみを `taken_at` 昇順に並べて計算する。

| 指標 | 算出方法 |
|---|---|
| 行動時間 | 最初と最後の写真の時刻差 |
| 移動距離 | 連続する2点間のHaversine距離の総和 |
| 累積標高 | 標高列を**移動中央値（window=5）で平滑化**した後、前点比 **+10m以上** の上昇のみ加算 |
| 最高到達点 | 平滑化後の標高の最大値 |
| 平均ペース | 移動距離 ÷ 行動時間 |
| 区間ペース | 連続2点間の距離 ÷ 時間差 |

### 精度に関する注意（UIに明記すること）

GPS標高は誤差が **±20m程度** ある。また写真は連続的に撮るものではないため、点と点の間の起伏は取りこぼす。したがって算出値は**実際より小さく出る傾向**があり、あくまで目安として扱う。

山行詳細画面の統計セクションに「写真のGPS情報から算出した推定値です」と注記を出す。Phase 1でGPXを取り込んだ場合は、GPX由来の値でこれを上書きできる設計にしておく（`activities` に `stats_source` カラムを将来追加する想定）。

---

## 8. 画面構成

### 8.1 ホーム `/`

- 百名山進捗マップ（MapLibre、日本全国）
  - 完登した山: 塗りつぶしピン、クリックで山ページへ
  - 未踏の山: 輪郭のみのピン
- 完登カウンタ「32 / 100」、山域別の内訳バー
- 直近の山行カード3件

### 8.2 山行一覧 `/activities`

日付降順のカードリスト。カバー写真、タイトル、山名、日付、写真枚数。年でグルーピング。

### 8.3 山行詳細 `/activities/:id`

- ヘッダー: タイトル、日付、山名（複数可）、メンバー、統計サマリ
- タブ: **写真** / **地図** / **データ** / **メモ**
  - 写真: 時系列グリッド。撮影者バッジ、座標なしは薄いアイコンで区別。クリックでライトボックス
  - 地図: 撮影地点をピン表示、時系列に線で結ぶ。interpolatedは半透明。ピンにサムネイル
  - データ: 標高プロファイル（Recharts、X軸=時刻）、区間ペース、統計テーブル
  - メモ: `note` の編集（装備・行動食・反省点）
- 操作: 写真追加、写真の付け替え、カバー写真設定、山の紐付け編集

### 8.4 未分類トレイ `/inbox`

**Phase 0 で最も重要な画面。** 過去数年分の投入がここを通る。

- 未割り当て写真を**撮影日でグルーピング**して表示
- 日付ブロックごとに以下のアクションを1クリックで
  - 「この日の写真で新しい山行を作成」→ 山の自動判定結果をプリセットしたモーダル
  - 「既存の山行に追加」→ 山行を検索して選択
- 写真個別のチェックボックスで部分選択も可能
- 時刻なしの写真は「日付不明」ブロックにまとめ、手動割り当てのみ

### 8.5 山ページ `/mountains/:id`

その山の情報（標高・山域・都道府県）と、その山を含む全山行の一覧。同じ山に複数回登った記録がここに集まる。未踏の山でも表示可能。

### 8.6 取り込み `/import`

ドラッグ&ドロップ or ファイル選択。撮影者の選択（新規作成も可）、時計オフセットの設定UI、進捗バー、結果サマリ（成功n件 / 重複スキップn件 / EXIFなしn件）。

### 8.7 設定 `/settings`

撮影者の管理、地図タイルのデフォルト、百名山マスタの座標・判定半径の編集。

---

## 9. API 設計（Hono）

```
GET    /api/mountains                     山マスタ一覧（進捗フラグ付き）
GET    /api/mountains/:id                 山詳細 + 関連山行
PATCH  /api/mountains/:id                 座標・判定半径の編集

GET    /api/activities                    一覧（ページング）
POST   /api/activities                    作成
GET    /api/activities/:id                詳細（写真・統計込み）
PATCH  /api/activities/:id                更新
DELETE /api/activities/:id                削除（写真は未分類に戻す）
PUT    /api/activities/:id/mountains      紐付け山の一括更新
POST   /api/activities/:id/photos         写真をこのactivityに割り当て（配列）
GET    /api/activities/:id/stats          統計値（算出はサーバー側）

GET    /api/photos/unassigned             未分類トレイ用（日付グルーピング済み）
PATCH  /api/photos/:id                    caption / 座標手動指定 / favorite
DELETE /api/photos/:id                    削除（R2からも削除）
POST   /api/photos/check-hashes           hash配列を投げて既存判定（重複スキップ用）
POST   /api/photos/upload                 multipart。EXIF由来の値はフィールドで受け取る

GET    /api/contributors
POST   /api/contributors
PATCH  /api/contributors/:id

GET    /api/progress                      百名山進捗サマリ
```

画像配信は `GET /img/thumb/:id` `GET /img/display/:id` でWorker経由。Cache-Control を `public, max-age=31536000, immutable` にする。

### アップロードの注意

Workers のリクエストボディサイズ制限があるため、**1リクエスト1枚**とし、フロント側で並列度3〜5に絞って逐次アップロードする。数千枚の初回投入はブラウザでは現実的でないので、後述のCLIスクリプトを使う。

---

## 10. 初回一括投入用CLIスクリプト

`scripts/bulk-import.ts`（ローカルNode実行）

```
使い方: npx tsx scripts/bulk-import.ts <ディレクトリ> --contributor "自分" --offset 0
```

- ディレクトリを再帰的に走査し、jpg/jpeg/heic/png を対象にする
- `exifr` でEXIF抽出、`sharp` でHEIC変換とリサイズ
- SHA-256を算出し、`/api/photos/check-hashes` で既存分を除外
- 並列度3で `/api/photos/upload` に投入
- 進捗をコンソール表示、失敗分は `failed.json` に書き出して再実行可能に
- `--dry-run` で件数とEXIF充足率だけ確認できるようにする

**数千枚の過去写真はこれで入れる。** ブラウザからのアップロードは日常の追加用と割り切る。

---

## 10.5 デザイン指針（DESIGN.md）

プロジェクトルートで以下を実行し、`DESIGN.md` を生成する。

```bash
npx getdesign@latest add apple
```

**UIを書く前に必ず `DESIGN.md` を読むこと。** Claude Code には「UI実装の前にDESIGN.mdを参照する」と明示的に指示する。

このデザインシステムは「写真を主役にし、UIのクロームを後退させる」思想で、本アプリの目的と完全に一致している。主要な指針は以下。

- **アクセントカラーは Action Blue `#0066cc` の1色のみ。** 装飾的なグラデーションを足さない
- **クローム（ナビゲーション、ツールバー等）に影を付けない。** 影は「面の上に置かれた写真」にだけ使う唯一のシグネチャ
- **明／暗のキャンバスを交互に配置**し、写真タイルはエッジトゥエッジで見せる
- **タイポグラフィは SF Pro Display / SF Pro Text**、大見出しは負のレタースペーシング
- ベースカラー: ink `#1d1d1f`、canvas `#ffffff`、parchment `#f5f5f7`、ダークタイル `#272729` 系

**本アプリでの適用方針**

- 山行詳細の写真グリッドはダークキャンバス（`#000000`〜`#272729`）に置き、写真を発光させる
- ホームの進捗マップと山行一覧はライトキャンバス（`#ffffff` / `#f5f5f7`）
- 未分類トレイは作業画面なのでライト、密度高め
- 統計値や標高グラフは Action Blue の単色で描く。多色パレットは使わない

DESIGN.md はプロジェクトの進行に合わせて追記・調整してよい。

---

## 10.6 GitHub 運用

### リポジトリ構成

```
yamalog/
├── DESIGN.md              # getdesign で生成。UI実装前に必読
├── README.md              # セットアップ手順、運用ルール（共有アルバムの件など）
├── SPEC.md                # この仕様書
├── wrangler.toml
├── package.json
├── tsconfig.json
├── .gitignore
├── .dev.vars              # ローカル用シークレット（コミットしない）
├── migrations/
│   └── 0001_init.sql
├── seeds/
│   └── hyakumeizan.csv
├── scripts/
│   ├── fetch-coords.ts    # 座標補完
│   ├── seed.ts            # CSV → D1 投入
│   └── bulk-import.ts     # 写真一括投入
├── src/                   # Worker (Hono)
│   ├── index.ts
│   ├── routes/
│   ├── lib/
│   └── db/
└── web/                   # フロント (Vite + React)
    ├── index.html
    └── src/
```

### .gitignore に必ず含めるもの

```
node_modules/
dist/
.wrangler/
.dev.vars
.env
*.local
.DS_Store

# 実データを絶対にコミットしない
/photos/
/uploads/
*.jpg
*.jpeg
*.heic
*.png
!web/src/assets/**
failed.json
```

**写真の実データは1枚もリポジトリに入れない。** R2にしか存在しない状態を保つ。

### ブランチ運用

個人開発なので軽量に。`main` を常にデプロイ可能な状態に保ち、機能ごとに `feat/xxx` を切ってPRでマージする。実装順序の各ステップが1ブランチ1PRの単位になる。

- `feat/01-setup`
- `feat/02-schema-seed`
- `feat/03-upload-pipeline`
- 以下、実装順序に対応

PRの粒度を保つことで、Claude Code の作業単位とレビュー単位が一致する。

### GitHub Actions によるデプロイ

`.github/workflows/deploy.yml`

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Repository secrets に登録するもの**

| キー | 取得元 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflareダッシュボード → API Tokens。権限は Workers Scripts:Edit / D1:Edit / R2:Edit に絞る |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflareダッシュボードのアカウント概要 |

D1のマイグレーションは事故を避けるため自動実行せず、`npx wrangler d1 migrations apply` を手動で叩く。

### リポジトリの可視性

**Private を強く推奨。** 公開すると `wrangler.toml` のD1/R2バインディング名やAccess設定の構成が読める。将来公開したくなったら、その時点でシークレット類を洗い直してからにする。

---

## 11. 実装順序

Claude Code には以下の順で進めさせる。各ステップで動作確認できる状態にすること。

0. **リポジトリ初期化** — GitHubにprivateリポジトリ作成、`.gitignore` 設置、`npx getdesign@latest add apple` で DESIGN.md 生成、GitHub Actions とsecretsの設定
1. **プロジェクト初期化** — Workers + Hono + Vite/React、wrangler.toml、D1/R2バインディング、Cloudflare Access
2. **スキーマ適用と百名山マスタ投入** — マイグレーションSQL、`scripts/fetch-coords.ts` で座標を補完し目視確認、`scripts/seed.ts` でD1へ投入
3. **アップロードパイプライン** — `/import` 画面、EXIF抽出、HEIC変換、サムネ生成、`/api/photos/upload`、R2保存、重複スキップ
4. **未分類トレイ** — 日付グルーピング、activity作成、既存activityへの追加
5. **山の自動判定** — Haversine、最近傍マッチ、提案UI
6. **山行詳細** — 写真グリッド、ライトボックス、地図タブ（MapLibre + 国土地理院タイル）
7. **座標補間と統計** — 線形補間ロジック、統計算出、標高グラフ
8. **ホーム進捗マップと山ページ** — 完登カウンタ、山域別内訳
9. **CLI一括投入スクリプト**
10. **過去写真の実データ投入と、判定半径のチューニング**

---

## 12. Phase 1 以降の候補

- GPXインポート（YAMAP / ヤマレコからエクスポート）と、GPX由来の統計での上書き
- pHashによる近似重複検出
- Flutterでの自前GPSロガー、オフライン地図
- 二百名山・三百名山マスタの追加
- 山行記録のPDF/Web書き出し
- 装備リストの構造化（Phase 0では自由記述の `note` に留める）

---

## 付録: 百名山マスタCSVのフォーマット

`seeds/hyakumeizan.csv`

```csv
id,name,name_kana,elevation,lat,lng,area,prefectures,match_radius_m,peak_alias,verified
1,利尻山,りしりざん,1721,,,北海道,"[""北海道""]",3000,,0
4,阿寒岳,あかんだけ,1499,,,北海道,"[""北海道""]",3000,雌阿寒岳,0
```

**lat / lng は初期状態では空欄。** `scripts/fetch-coords.ts` が国土地理院の地名検索APIから取得して埋める。

`peak_alias` は、深田久弥の命名と実際の最高峰の名前が異なる山に入れてある（阿寒岳→雌阿寒岳、大雪山→旭岳、吾妻山→西吾妻山など）。地名検索ではこちらを優先して問い合わせる。

`verified` は座標を地理院地図で目視確認済みかのフラグ。**スクリプトが取得した座標は必ず確認すること。** 地名検索は山頂ではなく代表点を返す場合があり、数百m〜1kmずれることがある。北アルプス・南アルプスは `match_radius_m` が1500mなので、このずれが誤判定に直結する。

確認は `/settings` の山マスタ編集画面で地図上にピンを表示し、ドラッグで補正できるようにしておくと後から楽になる。
