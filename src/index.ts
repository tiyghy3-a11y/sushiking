import express from "express";
import {
  middleware,
  messagingApi,
  WebhookEvent,
  MiddlewareConfig,
  SignatureValidationFailed,
  JSONParseError,
} from "@line/bot-sdk";
import { chat, resetHistory } from "./claude.js";

const channelSecret = process.env.LINE_CHANNEL_SECRET;
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!channelSecret || !channelAccessToken || !process.env.ANTHROPIC_API_KEY) {
  console.error(
    "環境変数 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN / ANTHROPIC_API_KEY を設定してください",
  );
  process.exit(1);
}

const middlewareConfig: MiddlewareConfig = { channelSecret };
const lineClient = new messagingApi.MessagingApiClient({ channelAccessToken });

// LINEのテキストメッセージ1通は最大5000文字
const LINE_TEXT_LIMIT = 5000;
// 1回の返信で送れるメッセージは最大5通
const MAX_MESSAGES_PER_REPLY = 5;

function splitForLine(text: string): messagingApi.TextMessage[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += LINE_TEXT_LIMIT) {
    chunks.push(text.slice(i, i + LINE_TEXT_LIMIT));
  }
  return chunks
    .slice(0, MAX_MESSAGES_PER_REPLY)
    .map((chunk) => ({ type: "text", text: chunk }));
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  const userId = event.source.userId ?? "anonymous";
  const userText = event.message.text.trim();

  // 「リセット」で会話履歴をクリア
  if (userText === "リセット" || userText.toLowerCase() === "reset") {
    resetHistory(userId);
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "会話履歴をリセットしました🧹" }],
    });
    return;
  }

  // 考え中のローディングアニメーションを表示(1対1トークのみ有効)
  if (event.source.type === "user") {
    lineClient
      .showLoadingAnimation({ chatId: userId, loadingSeconds: 60 })
      .catch(() => {});
  }

  try {
    const replyText = await chat(userId, userText);
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: splitForLine(replyText),
    });
  } catch (err) {
    console.error("返信エラー:", err);
    // 応答トークンの期限切れなどでreplyが失敗した場合はpushで送る
    try {
      await lineClient.pushMessage({
        to: userId,
        messages: [
          {
            type: "text",
            text: "すみません、エラーが発生しました。もう一度お試しください🙏",
          },
        ],
      });
    } catch {
      // pushも失敗したら諦める(無料枠の上限などの可能性)
    }
  }
}

const app = express();

app.get("/", (_req, res) => {
  res.send("LINE Claude Bot is running");
});

// LINEの署名検証はmiddlewareが行う(express.jsonより前に置くこと)
app.post("/webhook", middleware(middlewareConfig), (req, res) => {
  const events: WebhookEvent[] = req.body.events ?? [];

  // LINEには即200を返し、処理は非同期で行う(タイムアウト対策)
  res.status(200).end();

  for (const event of events) {
    handleEvent(event).catch((err) => console.error("イベント処理エラー:", err));
  }
});

// LINE署名検証エラーは401、JSONパースエラーは400を返す
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err instanceof SignatureValidationFailed) {
      res.status(401).send("invalid signature");
      return;
    }
    if (err instanceof JSONParseError) {
      res.status(400).send("invalid body");
      return;
    }
    next(err);
  },
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`サーバー起動: http://localhost:${port} (webhook: /webhook)`);
});
