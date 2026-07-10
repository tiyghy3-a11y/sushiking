import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY を環境変数から読み込む

const MODEL = "claude-opus-4-8";
const MAX_HISTORY_MESSAGES = 40; // ユーザーごとに保持する最大メッセージ数(20往復分)

const SYSTEM_PROMPT = `あなたはLINE上で動作するフレンドリーなアシスタントです。
ユーザーとは日本語で自然に会話してください(相手が他の言語を使う場合はその言語に合わせてください)。
LINEのチャットなので、返信は簡潔に、読みやすくまとめてください。長すぎる説明は避け、必要なら箇条書きを使ってください。
Markdownの記法(** や ## など)はLINEでは表示されないので使わないでください。`;

// ユーザーIDごとの会話履歴(メモリ保持。サーバー再起動でリセットされる)
const histories = new Map<string, Anthropic.MessageParam[]>();

export function resetHistory(userId: string): void {
  histories.delete(userId);
}

export async function chat(userId: string, userText: string): Promise<string> {
  const history = histories.get(userId) ?? [];
  history.push({ role: "user", content: userText });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    thinking: { type: "adaptive" },
    // LINEの応答トークンは有効期限が短いため、レイテンシ優先で effort を下げる
    output_config: { effort: "low" },
    messages: history,
  });

  // 履歴には thinking ブロックを含む content 全体をそのまま保存する(マルチターンの推奨パターン)
  history.push({ role: "assistant", content: response.content });

  // 古いメッセージを削る際は user/assistant の順序が崩れないよう2件単位で落とす
  while (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, 2);
  }
  histories.set(userId, history);

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || "(うまく返答できませんでした。もう一度試してください)";
}
