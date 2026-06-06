import Tesseract from 'tesseract.js';

export interface ReceiptResult {
  /** 読み取れた合計金額（円・ドルなどの数値のみ） */
  amount: number | null;
  /** ISO形式の日付 (yyyy-mm-dd) */
  date: string | null;
  /** 店名など、内容の候補 */
  title: string | null;
  /** OCRの生テキスト（デバッグ・確認用） */
  rawText: string;
}

/** 全角数字・記号を半角に変換する */
function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/￥/g, '¥');
}

/** 合計を示すキーワード（優先度の高い順） */
const TOTAL_KEYWORDS = [
  '合計', '合 計', 'ご利用金額', 'お会計', 'お買上', 'お買上げ',
  '総計', '総額', '請求', 'total', 'amount',
];

/** 合計として採用したくない行のキーワード（小計・お釣り・預り・ポイントなど） */
const EXCLUDE_KEYWORDS = [
  '小計', 'お預', 'お預り', 'お預かり', 'お釣', 'おつり', '釣り', '釣銭',
  '預り', 'お返し', 'point', 'ポイント', '残高', '前回', 'tel', '電話',
];

/** 1行からお金とみなせる数値を抽出する */
function extractAmounts(line: string): number[] {
  const amounts: number[] = [];
  // ¥/$ 付き、または カンマ区切り、または 末尾に円 が付くものを金額とみなす
  const re = /(?:[¥$]\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\s*円)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const matched = m[0];
    const num = parseInt(m[1].replace(/,/g, ''), 10);
    if (isNaN(num)) continue;
    const hasCurrencyHint = /[¥$]|円|,/.test(matched);
    // 通貨の手がかりが無く、かつ短い数字（電話番号や個数など）は除外しやすくする
    if (!hasCurrencyHint && num < 10) continue;
    amounts.push(num);
  }
  return amounts;
}

/** OCRテキストから合計金額を推定する */
function parseAmount(lines: string[]): number | null {
  // 1. 合計キーワードを含む行を優先（除外キーワードを含む行は無視）
  for (const keyword of TOTAL_KEYWORDS) {
    let best: number | null = null;
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (!lower.includes(keyword.toLowerCase())) continue;
      if (EXCLUDE_KEYWORDS.some(ex => lower.includes(ex.toLowerCase()))) continue;
      const amounts = extractAmounts(line);
      if (amounts.length === 0) continue;
      const lineMax = Math.max(...amounts);
      if (best === null || lineMax > best) best = lineMax;
    }
    if (best !== null) return best;
  }

  // 2. フォールバック：通貨の手がかりがある数値のうち最大のもの
  let fallback: number | null = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (EXCLUDE_KEYWORDS.some(ex => lower.includes(ex.toLowerCase()))) continue;
    if (!/[¥$]|円|,/.test(line)) continue;
    const amounts = extractAmounts(line);
    if (amounts.length === 0) continue;
    const lineMax = Math.max(...amounts);
    if (fallback === null || lineMax > fallback) fallback = lineMax;
  }
  return fallback;
}

/** OCRテキストから日付を推定する */
function parseDate(text: string): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const isValid = (y: number, mo: number, d: number) =>
    y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

  // yyyy[/-.年]mm[/-.月]dd
  let m = text.match(/(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (isValid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }

  // yy[/-.]mm[/-.]dd （20yy と解釈）
  m = text.match(/\b(\d{2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\b/);
  if (m) {
    const [y, mo, d] = [2000 + +m[1], +m[2], +m[3]];
    if (isValid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }

  return null;
}

/** OCRテキストから店名などの内容候補を推定する */
function parseTitle(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 2) continue;
    // 数字・記号だけの行はスキップ
    if (!/[^\d\s¥$.,:\-/円*#]/.test(trimmed)) continue;
    // レシートでよくある定型句はスキップ
    if (/領収|レシート|receipt|ありがとう|いらっしゃ|登録番号|TEL|電話/i.test(trimmed)) continue;
    return trimmed.slice(0, 30);
  }
  return null;
}

/** OCRの生テキストを解析して金額・日付・内容を取り出す */
export function parseReceiptText(rawText: string): ReceiptResult {
  const normalized = toHalfWidth(rawText);
  const lines = normalized
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  return {
    amount: parseAmount(lines),
    date: parseDate(normalized),
    title: parseTitle(lines),
    rawText,
  };
}

/** レシート画像を OCR してテキストを抽出する */
export async function scanReceipt(
  image: File | Blob | string,
  onProgress?: (progress: number) => void,
): Promise<ReceiptResult> {
  const { data } = await Tesseract.recognize(image, 'jpn+eng', {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    },
  });
  return parseReceiptText(data.text);
}
