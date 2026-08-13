# デプロイ手順

Cloudflare Workers に載せ、**自分が指定したメールアドレスだけ**が使える状態にして、iPhoneのホーム画面から開けるようにするまでの手順。

前提として **Cloudflare に載せたドメインが1つ必要**。`*.workers.dev` には Cloudflare Access を適用できないため（Access は自分のゾーンのホスト名に対して設定する）、独自ドメインで受ける。`wrangler.toml` では `workers_dev = false` にしてある。

---

## 1. リソースを作る

```bash
npx wrangler login

npx wrangler d1 create yamalog          # 出力の database_id を wrangler.toml に貼る
npx wrangler r2 bucket create yamalog-photos
```

`wrangler.toml` の `database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"` を置き換える。

## 2. スキーマと百名山マスタ

```bash
npm run db:migrate      # 本番D1にマイグレーション（自動実行しない方針なので手で叩く）
npm run seed            # 百名山マスタを投入
```

## 3. 独自ドメインを割り当てる

ドメインを Cloudflare に追加（ネームサーバーを向ける）してから、`wrangler.toml` のコメントを外して設定する。

```toml
[[routes]]
pattern = "yamalog.example.com"
custom_domain = true
```

`custom_domain = true` にしておくと、デプロイ時に DNS レコードまで作られる。

## 4. Cloudflare Access で入口を絞る

Cloudflare ダッシュボード → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**

| 項目 | 設定 |
|---|---|
| Application name | YamaLog |
| Session Duration | **1 month**（ホーム画面アプリで頻繁に再ログインさせないため） |
| Public hostname | `yamalog.example.com`（手順3のドメイン） |

**Policy** を1つ作る。

| 項目 | 設定 |
|---|---|
| Policy name | 許可ユーザー |
| Action | Allow |
| Include | **Emails** → 自分と、使わせたい人のメールアドレスを列挙 |

ログイン方法は **One-time PIN**（メールに届く6桁コード）が一番手間がない。相手にアカウントを作らせる必要がない。Google などの IdP を足してもよい。

作成後、アプリケーションの **Overview** に出る **Application Audience (AUD) Tag** をコピーする。
チームドメインは Zero Trust → Settings → Custom Pages などで確認できる `your-team.cloudflareaccess.com` の形。

## 5. Worker 側にも許可リストを渡す

Access はエッジで認証するが、**Worker 自身でもトークンを検証する**（署名・aud・有効期限・メール許可リスト）。二重にしておくと、ルート設定のミスや将来 `workers_dev` を戻したときにも素通りしない。

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # 例: your-team.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # 手順4でコピーした AUD Tag
npx wrangler secret put ALLOWED_EMAILS       # you@example.com,friend@example.com
```

メールアドレスをリポジトリに置かないよう、`wrangler.toml` ではなく secret にする。

**この3つが未設定のままだと、Worker はすべてのリクエストに 503 を返して閉じたままになる**（設定漏れで公開されるのを防ぐため）。`/api/health` だけは死活監視用に認証なしで応答する。

## 6. デプロイ

```bash
npm run build
npx wrangler deploy
```

GitHub Actions を使う場合は Repository secrets に登録すると `main` への push で自動デプロイされる。

| キー | 取得元 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens（Workers Scripts:Edit / D1:Edit / R2:Edit に絞る） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント概要 |

D1のマイグレーションは事故を避けるため Actions では実行しない。スキーマを変えたときは手元から `npm run db:migrate` を叩く。

## 7. 動作確認

```bash
curl -i https://yamalog.example.com/api/health          # 200
curl -i https://yamalog.example.com/api/progress        # Access のログインへリダイレクト
```

ブラウザで開くと Access のログイン画面 → メールにPINが届く → アプリが表示される。
許可リスト外のアドレスでログインすると、Access は通っても Worker が **403** を返す。

## 8. iPhoneのホーム画面に追加

1. **Safari** で `https://yamalog.example.com` を開く（Chrome では「ホーム画面に追加」でスタンドアロン表示にならない）
2. Access のログインを済ませる
3. 共有ボタン → **ホーム画面に追加** → 追加

これで次の状態になる。

- アイコン: 黒地に山のマーク（`web/public/apple-touch-icon.png`）
- Safari のURLバーなしの全画面（`display: standalone`）
- ステータスバーはグローバルナビと同じ黒
- セーフエリア（ノッチ・ホームインジケータ）を避けたレイアウト

アイコンやアプリ名を変えたいときは `scripts/make-icons.ts` と `web/public/manifest.webmanifest` を編集して `npm run icons` → 再デプロイ。

**オフラインでは開けない。** Service Worker を入れていないため（Phase 0 の「やらないこと」）。山でも見たい場合は Phase 1 で検討する。

Access のセッションが切れると、ホーム画面アプリの中でログイン画面が出る。手順4で Session Duration を長め（1 month）にしておくと再ログインの頻度が下がる。

---

## セキュリティ上の判断メモ

- **アセットも認証の対象にしている。** `[assets]` は既定だと Worker より先にアセットを返すため、アプリシェルやJSが誰でも取れてしまう。`run_worker_first = true` で必ず Worker を通すようにした（そのぶんアセット配信も Worker 呼び出しになる）
- **画像のキャッシュは `private`。** 個人の写真なので共有キャッシュに載せない（SPEC の `public` から変更）。`photo_id` は不変なのでブラウザ側は永続キャッシュしてよい
- **`workers_dev = false`。** Access を適用できない入口を作らない
- **Worker 側の検証は許可リストまで見る。** Access のポリシーを緩めても、`ALLOWED_EMAILS` にないアドレスは 403 になる
- 写真の実データはリポジトリに入らない（`.gitignore`）。原本はR2にのみ置く
