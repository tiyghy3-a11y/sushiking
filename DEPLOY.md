# デプロイ手順

Cloudflare Workers に載せ、**自分が指定したメールアドレスだけ**が使える状態にして、iPhoneのホーム画面から開けるようにするまでの手順。

> **デプロイ済み（2026-08-13）**: <https://yamalog.tiyg-hy-3.workers.dev>
> 画像は D1 に保存する構成（`PHOTO_STORAGE="d1"`、原本は保存しない）なので R2 は不要。
> 残っているのは[手順4](#4-workersdev-に-cloudflare-access-をかける)（Access）と[手順5](#5-worker-側にも許可リストを渡す)（secret 3つ）だけ。
> それが済むまで Worker は全リクエストに 503 を返すので、中身は誰にも見えない。

**独自ドメインは不要。** `workers.dev` の URL に Cloudflare Access を直接かけられる（ダッシュボードの Worker 設定に「Enable Cloudflare Access」がある）。Cloudflare 側の案内も「Access を有効にしたうえで、Worker 内で `aud` と JWKS を使って JWT を検証すること」で、その検証は `src/lib/access.ts` に実装済み。追加のコードは要らない。

独自ドメインで受けたい場合は末尾の[付録](#付録独自ドメインで受ける場合)を参照。

> **順番が大事。** 先にデプロイして Worker を作らないと、Access を有効にする画面が出てこない。認証が未設定のうちは Worker が全リクエストに 503 を返すので、先にデプロイしても中身は誰にも見えない（fail closed）。

---

## 手順1〜3をまとめて実行する

手作業でやるなら次節から順に進めればよいが、`npx wrangler login` を済ませたあとなら1コマンドで通る。

```bash
npx wrangler login
npm run deploy:bootstrap              # 何をするか見るだけなら -- --dry-run
```

D1 の作成 →`wrangler.toml` への `database_id` 書き込み → R2 の作成 → マイグレーション → 百名山マスタ投入 → ビルド → デプロイ、までを順に行う。何度実行しても壊れない（既にあるものは作らない。マスタが入っていれば投入をスキップする。`/settings` で直した座標を CSV の値で上書きしないため）。

終わったら **手順4（Access）と手順5（secret）** に進む。そこまで済むまで Worker は全リクエストに 503 を返すので、デプロイ済みでも中身は誰にも見えない。

GitHub Actions から実行する場合は、Repository secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録して、**Deploy** ワークフローを `bootstrap` にチェックを入れて手動実行する（手順7参照）。

## 1. リソースを作る

```bash
npx wrangler login

npx wrangler d1 create yamalog          # 出力の database_id を wrangler.toml に貼る
npx wrangler r2 bucket create yamalog-photos
```

`wrangler.toml` の `database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"` を置き換える。

## 2. スキーマと百名山マスタ

```bash
npm run db:migrate      # 本番D1にマイグレーション（事故防止のため手で叩く方針）
npm run seed            # 百名山マスタを投入
```

座標を先に直しておきたい場合は、この前に `npm run verify:coords -- --write` を回す（[座標の確定](#座標の確定)参照）。

## 3. 最初のデプロイ

```bash
npm run build
npx wrangler deploy
```

`https://yamalog.<自分のサブドメイン>.workers.dev` が生える。この時点では secret が未設定なので、開いても **503「認証が未設定です」** が返るだけ。この URL を控えておく。

`wrangler.toml` に `preview_urls = false` を入れてあるので、`<version>-yamalog.<subdomain>.workers.dev` という別入口はこのデプロイで無効になる。**ここは必ず無効のままにする**（Access は `workers.dev` の本体 URL にかかり、Preview URL は対象外のため、開いていると認証を迂回する入口になる）。

## 4. workers.dev に Cloudflare Access をかける

ダッシュボード → **Workers & Pages** → **yamalog** → **Settings** → **Domains & Routes**

| 対象 | 操作 |
|---|---|
| `workers.dev` | **Enable Cloudflare Access** をクリック |
| Preview URLs | **Disabled** になっていることを確認（手順3で無効化済み） |

初回は Zero Trust チームの作成を求められる。チーム名を決めると `<チーム名>.cloudflareaccess.com` がチームドメインになる。これが後で使う `ACCESS_TEAM_DOMAIN`。

続けて **Manage Cloudflare Access** から、作られた Access アプリケーションを開いて中身を詰める。

| 項目 | 設定 |
|---|---|
| Application name | YamaLog |
| Session Duration | **1 month**（ホーム画面アプリで頻繁に再ログインさせないため） |

**Policy** を1つ。

| 項目 | 設定 |
|---|---|
| Policy name | 許可ユーザー |
| Action | Allow |
| Include | **Emails** → 自分のメールアドレス（後から追加できる） |

ログイン方法は **One-time PIN**（メールに届く6桁コード）が一番手間がない。相手にアカウントを作らせずに済む。Zero Trust → Settings → Authentication で有効になっているか確認する。Google などの IdP を足してもよい。

最後に、アプリケーションの **Overview** に出る **Application Audience (AUD) Tag** をコピーする。

## 5. Worker 側にも許可リストを渡す

Access はエッジで認証するが、**Worker 自身でもトークンを検証する**（署名・aud・有効期限・メール許可リスト）。Access の設定を触ったときやポリシーを緩めたときに、素通りする状態を作らないための二重化。

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # 例: your-team.cloudflareaccess.com（https:// は付けない）
npx wrangler secret put ACCESS_AUD           # 手順4でコピーした AUD Tag
npx wrangler secret put ALLOWED_EMAILS       # you@example.com,friend@example.com
```

メールアドレスをリポジトリに置かないよう、`wrangler.toml` ではなく secret にする。secret は保存した時点で反映されるので再デプロイは不要。

**この3つが未設定だと、Worker はすべてのリクエストに 503 を返して閉じたままになる。**

## 6. 動作確認

ブラウザで `https://yamalog.<サブドメイン>.workers.dev` を開く。

1. Access のログイン画面が出る
2. メールアドレスを入れると6桁のPINが届く
3. 入力するとアプリが表示される

確認しておきたい点。

| 確認 | 期待する結果 |
|---|---|
| 未ログインでアクセス | Access のログイン画面（アプリのHTMLもJSも返らない） |
| 許可リスト外のアドレスでログイン | Access は通るが Worker が **403** |
| `curl -i https://yamalog.<サブドメイン>.workers.dev/api/progress` | Access のログインへリダイレクト（302） |
| `<version>-yamalog.<サブドメイン>.workers.dev` | 到達しない（Preview URLs 無効） |

`/api/health` は Worker 側では認証を通していないが、Access がホスト名全体にかかるためエッジで止まる。外形監視を入れたい場合は Zero Trust → Access で `/api/health` だけを対象にしたアプリケーションを作り、**Bypass** ポリシーを当てる。個人利用なら不要。

## 7. GitHub Actions で自動デプロイ（任意）

Repository secrets に登録すると `main` への push で自動デプロイされる。

| キー | 取得元 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens（Workers Scripts:Edit / D1:Edit / R2:Edit に絞る） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント概要 |

D1のマイグレーションは事故を避けるため Actions では実行しない。スキーマを変えたときは手元から `npm run db:migrate` を叩く。

## 8. iPhoneのホーム画面に追加

1. **Safari** で `https://yamalog.<サブドメイン>.workers.dev` を開く（Chrome では「ホーム画面に追加」でスタンドアロン表示にならない）
2. Access のログインを済ませる
3. 共有ボタン → **ホーム画面に追加** → 追加

これで次の状態になる。

- アイコン: 黒地に山のマーク（`web/public/apple-touch-icon.png`）
- URLバーなしの全画面（`display: standalone`）
- ステータスバーはグローバルナビと同じ黒
- セーフエリア（ノッチ・ホームインジケータ）を避けたレイアウト

アイコンやアプリ名を変えたいときは `scripts/make-icons.ts` と `web/public/manifest.webmanifest` を編集して `npm run icons` → 再デプロイ。

**オフラインでは開けない。** Service Worker を入れていないため（Phase 0 の「やらないこと」）。山でも見たい場合は Phase 1 で検討する。

Access のセッションが切れると、ホーム画面アプリの中でログイン画面が出る。手順4で Session Duration を長め（1 month）にしてあれば再ログインの頻度は下がる。

---

## 座標の確定

百名山マスタの座標は暫定値で、初期状態は全件 `verified=0`。**北アルプス・南アルプスは判定半径 1500m** なので、ズレがそのまま山の誤判定になる。

```bash
npm run verify:coords              # 検証だけ（書き込まない）
npm run verify:coords -- --write   # 山頂に合わせて CSV を書き換え、verified=1 にする
```

国土地理院の標高タイル（DEM）を読んで、各山の周囲から**実際の最高地点**を探し、CSV の標高値と突き合わせる。地名検索API（`npm run seed:coords`）は山頂ではなく代表点を返すことがあり、「富士山」で引くと山梨県鳴沢村の点（山頂から約10km）が先頭に来る。座標の一括確定にはこちらを使う。

書き換えたら `npm run seed` で D1 に反映する。個別に直したいときは `/settings` の百名山マスタ編集で地図のピンをドラッグする。

---

## GitHub Pages について（デモ限定）

**本体は GitHub Pages では動かない。** Pages は静的ファイル配信しかできないため、以下が全部使えない。

| 必要なもの | Pages では |
|---|---|
| API（Hono） | サーバーが無いので動かない |
| D1（山行・写真のメタデータ） | 無い |
| R2（写真の原本・表示用・サムネ） | 無い |
| Cloudflare Access（利用者の制限） | Pages にアクセス制御は無い（public リポジトリなら誰でも閲覧できる） |

置けるのは**インメモリのモックで動くデモ**だけ。データはページ内だけに存在し、リロードで消える。写真は合成画像で、実データは一切含まない。

```bash
npm run build:demo -- --standalone   # dist/demo-pages/ に完全なHTML一式が出る
```

公開は `.github/workflows/pages.yml`（push か手動実行）。**Settings → Pages → Source を「GitHub Actions」にしておく必要がある**（「Deploy from a branch」のままだとデプロイが失敗する）。

公開先: `https://<ユーザー名>.github.io/<リポジトリ名>/`

サブパス配信でも動くよう、参照は相対パスにし、manifest の `start_url` / `scope` も `./` にしてある。デモもホーム画面に追加できる（standalone表示・アイコンつき）ので、実機の見え方の確認には使える。

**費用について。** 本体を載せる Cloudflare 側も無料枠で足りる（Workers 10万リクエスト/日、D1、Access 50ユーザーまで）。ただし R2 は初回有効化のときに支払い方法の登録を求められることがある。「無料で試す」目的なら Pages のデモで見た目と操作を確認し、写真を実際に入れる段階で Workers に載せるのが順番として楽。

---

## 付録：独自ドメインで受ける場合

`workers.dev` の URL が気になる、あるいは将来ドメインを移したいときは以下。Cloudflare Registrar なら .com が年10ドル程度で取れる。

1. ドメインを Cloudflare に追加（ネームサーバーを向ける）
2. `wrangler.toml` を編集

```toml
workers_dev = false      # 入口を1つにする
preview_urls = false

[[routes]]
pattern = "yamalog.example.com"
custom_domain = true
```

3. `npx wrangler deploy`（`custom_domain = true` なら DNS レコードも作られる）
4. Zero Trust → Access → Applications で、対象ホスト名を `yamalog.example.com` に変更（または新規に Self-hosted アプリを作る）
5. AUD Tag が変わった場合は `npx wrangler secret put ACCESS_AUD` をやり直す

---

## セキュリティ上の判断メモ

- **アセットも認証の対象にしている。** `[assets]` は既定だと Worker より先にアセットを返すため、アプリシェルやJSが誰でも取れてしまう。`run_worker_first = true` で必ず Worker を通す（そのぶんアセット配信も Worker 呼び出しになり、課金対象のリクエスト数が増える）
- **Preview URLs は無効。** Access は `workers.dev` の本体 URL にかかる。Preview URL を開けておくと認証を迂回する入口になる
- **画像のキャッシュは `private`。** 個人の写真なので共有キャッシュに載せない（SPEC の `public` から変更）。`photo_id` は不変なのでブラウザ側は永続キャッシュしてよい
- **Worker 側の検証は許可リストまで見る。** Access のポリシーを緩めても、`ALLOWED_EMAILS` にないアドレスは 403 になる
- **未設定なら 503。** 設定漏れで公開される事故を防ぐ（fail closed）
- 写真の実データはリポジトリに入らない（`.gitignore`）。原本はR2にのみ置く
