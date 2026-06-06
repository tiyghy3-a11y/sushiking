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
  '合計', '合 計', '計', 'ご利用金額', 'お会計', 'お買上', 'お買上げ',
  '総計', '総額', 'お支払', '請求', 'total', 'amount',
];

/** 合計として採用したくない行のキーワード（小計・お釣り・預り・ポイントなど） */
const EXCLUDE_KEYWORDS = [
  '小計', 'お預', 'お預り', 'お預かり', 'お釣', 'おつり', '釣り', '釣銭',
  '預り', 'お返し', 'point', 'ポイント', '残高', '前回', 'tel', '電話',
  'バーコード', '番号',
];

interface AmountCandidate {
  value: number;
  /** ¥・$・円・カンマ など、金額であることを示す手がかりがあるか */
  hint: boolean;
}

/** 行から日付・時刻・電話番号など金額ではない数字列を取り除く */
function stripNonAmountNoise(line: string): string {
  return line
    // 日付 yyyy/mm/dd, yyyy年mm月dd日
    .replace(/\d{4}\s*[/\-.年]\s*\d{1,2}\s*[/\-.月]\s*\d{1,2}\s*日?/g, ' ')
    // 日付 yy/mm/dd
    .replace(/\b\d{2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2}\b/g, ' ')
    // 時刻 HH:MM(:SS)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    // 電話番号っぽい（ハイフン区切り）
    .replace(/\b\d{2,4}-\d{2,4}-\d{3,4}\b/g, ' ')
    // レシート番号・バーコードなど長い数字列（8桁以上）
    .replace(/\b\d{8,}\b/g, ' ');
}

/** 1行からお金とみなせる数値を抽出する */
function extractAmounts(line: string): AmountCandidate[] {
  const cleaned = stripNonAmountNoise(line);
  const amounts: AmountCandidate[] = [];
  // ¥/$ 付き、または カンマ区切り、または 末尾に円 が付くものを金額とみなす
  const re = /(?:[¥$]\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\s*円)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const matched = m[0];
    const num = parseInt(m[1].replace(/,/g, ''), 10);
    if (isNaN(num) || num <= 0 || num > 9_999_999) continue;
    const hint = /[¥$]|円|,/.test(matched);
    // 通貨の手がかりが無く、かつ短い数字（個数など）は弱いので除外しやすくする
    if (!hint && num < 10) continue;
    amounts.push({ value: num, hint });
  }
  return amounts;
}

/** OCRテキストから合計金額を推定する */
function parseAmount(lines: string[]): number | null {
  const lower = (s: string) => s.toLowerCase();
  const isExcluded = (line: string) =>
    EXCLUDE_KEYWORDS.some(ex => lower(line).includes(lower(ex)));
  const maxOf = (cands: AmountCandidate[]) => Math.max(...cands.map(c => c.value));

  // Pass 1: 合計キーワードを含む行を優先（同じ行に数字が無ければ次の行も見る）
  for (const keyword of TOTAL_KEYWORDS) {
    let best: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!lower(line).includes(lower(keyword))) continue;
      if (isExcluded(line)) continue;
      let cands = extractAmounts(line);
      if (cands.length === 0 && i + 1 < lines.length && !isExcluded(lines[i + 1])) {
        cands = extractAmounts(lines[i + 1]);
      }
      if (cands.length === 0) continue;
      const lineMax = maxOf(cands);
      if (best === null || lineMax > best) best = lineMax;
    }
    if (best !== null) return best;
  }

  // Pass 2: 通貨の手がかり（¥・$・円・カンマ）がある数値のうち最大のもの
  let hinted: number | null = null;
  for (const line of lines) {
    if (isExcluded(line)) continue;
    const cands = extractAmounts(line).filter(c => c.hint);
    if (cands.length === 0) continue;
    const lineMax = maxOf(cands);
    if (hinted === null || lineMax > hinted) hinted = lineMax;
  }
  if (hinted !== null) return hinted;

  // Pass 3: フォールバック。レシート内で最も大きい妥当な数値（多くの場合これが合計）
  let any: number | null = null;
  for (const line of lines) {
    if (isExcluded(line)) continue;
    const cands = extractAmounts(line);
    if (cands.length === 0) continue;
    const lineMax = maxOf(cands);
    if (any === null || lineMax > any) any = lineMax;
  }
  return any;
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
    if (!/[^\d\s¥$.,:\-/円*#()]/.test(trimmed)) continue;
    // レシートでよくある定型句はスキップ
    if (/領収|レシート|receipt|ありがとう|いらっしゃ|登録番号|TEL|電話/i.test(trimmed)) continue;
    // 日本語(漢字・ひらがな・カタカナ)を含む行を優先したいので、英数字だけの短い行はスキップ
    const hasJa = /[぀-ヿ一-鿿]/.test(trimmed);
    if (!hasJa && trimmed.replace(/[^A-Za-z]/g, '').length < 3) continue;
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

/**
 * OCR精度を上げるための画像前処理。
 * 拡大してグレースケール化し、コントラストを強調する。
 */
async function preprocessImage(file: File | Blob): Promise<HTMLCanvasElement | Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      el.src = url;
    });

    // 小さい画像は拡大、大きすぎる画像は縮小して、長辺を約1600pxに揃える
    const targetMax = 1600;
    const longest = Math.max(img.width, img.height) || targetMax;
    const factor = Math.min(3, Math.max(0.5, targetMax / longest));
    const width = Math.round(img.width * factor);
    const height = Math.round(img.height * factor);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, width, height);

    // グレースケール化 + コントラスト強調
    const imageData = ctx.getImageData(0, 0, width, height);
    const d = imageData.data;
    const contrast = 1.4;
    const intercept = 128 * (1 - contrast);
    for (let i = 0; i < d.length; i += 4) {
      let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      gray = gray * contrast + intercept;
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
      d[i] = d[i + 1] = d[i + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** レシート画像を OCR してテキストを抽出する */
export async function scanReceipt(
  image: File | Blob | string,
  onProgress?: (progress: number) => void,
): Promise<ReceiptResult> {
  let input: Tesseract.ImageLike = image;
  if (typeof image !== 'string') {
    input = await preprocessImage(image);
  }

  const { data } = await Tesseract.recognize(input, 'jpn+eng', {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    },
  });
  return parseReceiptText(data.text);
}
