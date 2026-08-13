/**
 * ブラウザ側の画像処理パイプライン。
 * Workers で HEIC デコードや EXIF 解析をやると必ず詰まるので、
 * EXIF抽出 / HEIC変換 / サムネイル生成はすべてここで完結させ、
 * Worker には確定した値とバイナリだけを渡す。
 */
import exifr from 'exifr';
import type { CoordSource, TimeSource } from './types';

export const DISPLAY_EDGE = 1600;
export const THUMB_EDGE = 400;
/**
 * 表示用1枚のバイト数の上限。
 *
 * 画像を D1 に入れる構成では、大きな BLOB を1リクエストで書くと Worker の
 * 実行上限に当たって Cloudflare が 503 を返す（src/db/storage.ts のコメント参照）。
 * サーバ側の上限 500KB より確実に小さくなるよう、ここでは 400KB を目標にする。
 * 岩肌や樹林のような細部の多い写真は 1600px / 品質0.86 だと 800KB を超えるので、
 * 収まるまで画質→寸法の順に落とす。長辺1600pxのままでも画質0.6程度までは
 * スマホの画面では劣化がほぼ分からない。
 */
const DISPLAY_BUDGET_BYTES = 400_000;

export interface PreparedPhoto {
  file: File;
  name: string;
  hash: string;
  originalBlob: Blob;
  displayBlob: Blob;
  thumbBlob: Blob;
  previewUrl: string;
  meta: {
    content_hash: string;
    mime: string;
    ext: string;
    byte_size: number;
    width: number | null;
    height: number | null;
    taken_at_raw: string | null;
    time_source: TimeSource;
    lat: number | null;
    lng: number | null;
    altitude: number | null;
    coord_source: CoordSource;
    camera_model: string | null;
  };
}

const isHeic = (file: File) =>
  /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * iOS Safari は HEIC をネイティブにデコードできる。読める場合は 1.3MB の
 * heic2any を読み込まない（回線とメモリの節約。スマホからの取り込みが主用途）。
 */
async function decodableBlob(file: File): Promise<Blob> {
  if (!isHeic(file)) return file;
  try {
    if (typeof createImageBitmap === 'function') {
      const probe = await createImageBitmap(file);
      probe.close();
      return file;
    }
  } catch {
    // ネイティブに読めない → 変換にフォールバック
  }
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  return Array.isArray(out) ? out[0] : (out as Blob);
}

interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * 表示用の生成元を得る（原本は無加工のまま）。
 *
 * EXIF Orientation が付いている写真は <img> 経由で読む。<img> は
 * image-orientation: from-image が既定なのでどのブラウザでも正立するのに対し、
 * createImageBitmap の imageOrientation オプションは Safari 16.4 未満で無視され、
 * iPhone の縦位置写真が横倒しのまま保存されてしまう。
 */
async function loadDrawable(blob: Blob, needsOrientationFix: boolean): Promise<Drawable> {
  if (needsOrientationFix || typeof createImageBitmap !== 'function') {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  }
  const bitmap = await createImageBitmap(blob);
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
}

async function resize(drawable: Drawable, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(drawable.width, drawable.height));
  const width = Math.max(1, Math.round(drawable.width * scale));
  const height = Math.max(1, Math.round(drawable.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context を取得できませんでした');
  ctx.drawImage(drawable.source, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('リサイズに失敗しました'))),
      'image/jpeg',
      quality,
    ),
  );
}

/**
 * 上限バイト数に収まるまで、画質を落とし、それでも駄目なら長辺を縮める。
 * 画質を先に落とすのは、山の写真では解像度のほうが情報量として効くため。
 */
async function resizeWithinBudget(
  drawable: Drawable,
  edge: number,
  quality: number,
  budget: number,
): Promise<Blob> {
  let blob = await resize(drawable, edge, quality);
  for (const q of [0.72, 0.62, 0.52]) {
    if (blob.size <= budget) return blob;
    quality = q;
    blob = await resize(drawable, edge, quality);
  }
  // 画質を落としきっても超える場合だけ縮める（長辺1024pxで打ち切る）
  while (blob.size > budget && edge > 1024) {
    edge = Math.round(edge * 0.8);
    blob = await resize(drawable, edge, quality);
  }
  return blob;
}

/**
 * 中身のハッシュだけを求める。
 *
 * 取り込み済みかどうかは、重い処理（HEIC変換・デコード・リサイズ）の前に
 * これで判定する。取り込みが途中で止まっても、同じ写真をもう一度選べば
 * 済んだ分は解析せずに飛ばせる。
 */
export async function hashFile(file: File): Promise<string> {
  return sha256Hex(await file.arrayBuffer());
}

/**
 * 1ファイルを取り込み可能な形に整える。
 * EXIFが無くても失敗にはしない（欠損は異常系ではなく通常系）。
 */
export async function preparePhoto(file: File, knownHash?: string): Promise<PreparedPhoto> {
  const buffer = await file.arrayBuffer();
  const hash = knownHash ?? (await sha256Hex(buffer));

  let exif: Record<string, unknown> = {};
  try {
    exif = ((await exifr.parse(buffer, { gps: true, tiff: true, exif: true })) ?? {}) as Record<
      string,
      unknown
    >;
  } catch {
    exif = {};
  }

  const takenExif = exif.DateTimeOriginal ?? exif.CreateDate;
  const takenIso =
    takenExif instanceof Date && Number.isFinite(takenExif.getTime()) ? takenExif.toISOString() : null;

  // 時刻: EXIF > ファイルの lastModified > （UIで手入力） > 不明
  const time_source: TimeSource = takenIso ? 'exif' : file.lastModified ? 'file' : 'none';
  const taken_at_raw =
    takenIso ?? (file.lastModified ? new Date(file.lastModified).toISOString() : null);

  const lat = typeof exif.latitude === 'number' ? exif.latitude : null;
  const lng = typeof exif.longitude === 'number' ? exif.longitude : null;
  let altitude = typeof exif.GPSAltitude === 'number' ? exif.GPSAltitude : null;
  // GPSAltitudeRef が 1 なら海面下なので負値にする
  if (altitude != null && Number(exif.GPSAltitudeRef) === 1) altitude = -altitude;

  const orientation = typeof exif.Orientation === 'number' ? exif.Orientation : 1;
  const drawable = await loadDrawable(await decodableBlob(file), orientation !== 1);
  const [displayBlob, thumbBlob] = await Promise.all([
    resizeWithinBudget(drawable, DISPLAY_EDGE, 0.86, DISPLAY_BUDGET_BYTES),
    resize(drawable, THUMB_EDGE, 0.78),
  ]);
  drawable.release();

  return {
    file,
    name: file.name,
    hash,
    originalBlob: file, // 原本は絶対に加工しない
    displayBlob,
    thumbBlob,
    previewUrl: URL.createObjectURL(thumbBlob),
    meta: {
      content_hash: hash,
      mime: file.type || (isHeic(file) ? 'image/heic' : 'image/jpeg'),
      ext: (file.name.split('.').pop() ?? 'jpg').toLowerCase(),
      byte_size: file.size,
      // Orientation 適用後の実寸を採る（EXIFの値は回転前で、縦横が逆になることがある）
      width: drawable.width || (typeof exif.ExifImageWidth === 'number' ? exif.ExifImageWidth : null),
      height: drawable.height || (typeof exif.ExifImageHeight === 'number' ? exif.ExifImageHeight : null),
      taken_at_raw,
      time_source,
      lat,
      lng,
      altitude,
      coord_source: (lat != null && lng != null ? 'exif' : 'none') as CoordSource,
      camera_model: typeof exif.Model === 'string' ? exif.Model : null,
    },
  };
}

export function buildUploadForm(
  prepared: PreparedPhoto,
  extra: {
    contributor_id: string | null;
    batch_id: string | null;
    time_offset_sec: number;
    /** 原本を保存しない構成なら false。送らずに済ませて通信量を1/3に抑える */
    keepsOriginal?: boolean;
  },
): FormData {
  const { keepsOriginal = true, ...meta } = extra;
  const form = new FormData();
  form.set('meta', JSON.stringify({ ...prepared.meta, ...meta }));
  // 原本を保存しない構成でも、Worker 側の検証を通すために形だけは送る（サムネで代用）
  form.set(
    'original',
    keepsOriginal ? prepared.originalBlob : prepared.thumbBlob,
    prepared.name,
  );
  form.set('display', prepared.displayBlob, `${prepared.name}.display.jpg`);
  form.set('thumb', prepared.thumbBlob, `${prepared.name}.thumb.jpg`);
  return form;
}

/** 並列度を絞って順に流す（Workers のボディサイズ制限があるので1リクエスト1枚） */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    }),
  );
}
