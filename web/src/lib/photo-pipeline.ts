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

async function heicToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  return Array.isArray(out) ? out[0] : (out as Blob);
}

async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  // EXIF Orientation はここで正立させる（表示用は補正済み・原本は無加工）
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

async function resize(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context を取得できませんでした');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('リサイズに失敗しました'))),
      'image/jpeg',
      quality,
    ),
  );
}

/**
 * 1ファイルを取り込み可能な形に整える。
 * EXIFが無くても失敗にはしない（欠損は異常系ではなく通常系）。
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);

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

  const decodable = isHeic(file) ? await heicToJpeg(file) : file;
  const bitmap = await loadBitmap(decodable);
  const [displayBlob, thumbBlob] = await Promise.all([
    resize(bitmap, DISPLAY_EDGE, 0.86),
    resize(bitmap, THUMB_EDGE, 0.78),
  ]);
  bitmap.close();

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
      width: typeof exif.ExifImageWidth === 'number' ? exif.ExifImageWidth : null,
      height: typeof exif.ExifImageHeight === 'number' ? exif.ExifImageHeight : null,
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
  extra: { contributor_id: string | null; batch_id: string | null; time_offset_sec: number },
): FormData {
  const form = new FormData();
  form.set('meta', JSON.stringify({ ...prepared.meta, ...extra }));
  form.set('original', prepared.originalBlob, prepared.name);
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
