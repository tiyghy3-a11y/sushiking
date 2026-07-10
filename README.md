# LINE Claude チャットボット

LINEでClaude(Anthropic AI)と会話できるチャットボットです。
LINE公式アカウントにメッセージを送ると、Claudeが返信します。会話履歴はユーザーごとに記憶されます(サーバー再起動でリセット)。

## 仕組み

```
LINEアプリ → LINEプラットフォーム → このサーバー(/webhook) → Claude API → 返信
```

## 必要なもの

1. **LINE Developersアカウント**(無料) — https://developers.line.biz/
2. **Anthropic APIキー**(有料・従量課金) — https://console.anthropic.com/
3. **Node.js 20以上**

## セットアップ手順

### 1. LINE公式アカウント(Messaging APIチャネル)を作る

1. [LINE Developersコンソール](https://developers.line.biz/console/)にログイン
2. プロバイダーを作成(名前は何でもOK)
3. 「Messaging API」チャネルを作成
   - ※2024年9月以降は先に[LINE公式アカウント](https://entry.line.biz/form/entry/unverified)を作成してから、[公式アカウント管理画面](https://manager.line.biz/)の「設定 > Messaging API」で有効化する流れです
4. 以下の2つを控える:
   - **チャネルシークレット**(チャネル基本設定タブ)
   - **チャネルアクセストークン(長期)**(Messaging API設定タブで発行)
5. Messaging API設定タブで:
   - **応答メッセージ**: オフ(LINE公式アカウント管理画面の応答設定から)
   - **Webhook**: オン

### 2. サーバーを起動する

```bash
npm install
cp .env.example .env
# .env を編集して3つのキーを設定する
npm run dev
```

### 3. Webhook URLを設定する

サーバーをインターネットに公開し、そのURLをLINEに登録します。

**ローカルで試す場合(ngrok):**

```bash
npx ngrok http 3000
```

表示された `https://xxxx.ngrok-free.app` を使い、LINE Developersコンソールの
「Messaging API設定 > Webhook URL」に以下を登録して「検証」を押します:

```
https://xxxx.ngrok-free.app/webhook
```

**本番運用する場合:**

[Render](https://render.com/)や[Railway](https://railway.app/)などのホスティングサービスにデプロイするのが簡単です。

- ビルドコマンド: `npm install && npm run build`
- 起動コマンド: `npm start`
- 環境変数に `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `ANTHROPIC_API_KEY` を設定

デプロイ後のURL + `/webhook` をWebhook URLに登録してください。

### 4. 友だち追加して話しかける

LINE DevelopersコンソールのMessaging API設定タブにあるQRコードから
公式アカウントを友だち追加し、メッセージを送ると Claude が返信します🎉

## 使い方

- 普通にメッセージを送るだけでOK
- 「**リセット**」と送ると会話履歴をクリア

## カスタマイズ

- **キャラクター設定**: `src/claude.ts` の `SYSTEM_PROMPT` を書き換えると、口調や役割を変えられます
- **モデル**: `MODEL`(デフォルト: `claude-opus-4-8`)を変更できます
- **賢さと速度のバランス**: `output_config.effort` を `"low"` → `"medium"` や `"high"` にすると、返信が遅くなる代わりに複雑な質問に強くなります
- **記憶する会話量**: `MAX_HISTORY_MESSAGES` で調整

## 注意事項

- 会話履歴はメモリ上に保持しているため、サーバーが再起動すると消えます。永続化したい場合はRedisやデータベースの導入を検討してください
- LINEの無料プランではpushメッセージの通数に上限があります(replyは無制限)
- Claude APIの利用には従量課金が発生します
