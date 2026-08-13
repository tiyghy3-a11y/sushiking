/**
 * 画像バイト列の保存先。
 *
 * - `d1`: 表示用とサムネイルを D1 の photo_blobs に入れる。原本は保存しない。
 *         R2 の有効化（支払い方法の登録）が不要なので、既定をこちらにしている。
 * - `r2`: 原本・表示用・サムネイルを R2 に入れる（SPEC 本来の構成）。
 *         wrangler.toml で r2_buckets を有効にし、PHOTO_STORAGE="r2" にすると使える。
 *
 * EXIF 抽出はブラウザ側で完結しているため、原本が無くても山の自動判定・
 * 地図・統計・進捗マップは同じように動く。
 */
import type { Env } from './types';

export type StorageMode = 'd1' | 'r2';
export type Variant = 'original' | 'display' | 'thumb';

/** D1 の1値あたりの上限に余裕を持たせた、画像1枚の上限 */
export const MAX_D1_BLOB_BYTES = 900_000;

export interface StoredImage {
  body: Uint8Array | ReadableStream;
  mime: string;
  byteSize: number | null;
}

export interface PutOptions {
  /** 原本の拡張子（R2 のキー設計に使う） */
  ext?: string;
  /** 原本のキーに使う日付（撮影時刻。無ければ現在時刻） */
  basisIso?: string;
}

export interface PhotoStorage {
  readonly mode: StorageMode;
  /** 原本を保存する構成かどうか */
  readonly keepsOriginal: boolean;
  put(photoId: string, variant: Variant, bytes: ArrayBuffer, mime: string, opts?: PutOptions): Promise<void>;
  get(photoId: string, variant: Variant): Promise<StoredImage | null>;
  remove(photoId: string): Promise<void>;
}

/** 環境変数から保存先を決める。未設定なら d1（カード登録なしで動く側） */
export function resolveStorageMode(env: Env): StorageMode {
  return env.PHOTO_STORAGE === 'r2' ? 'r2' : 'd1';
}

export function getStorage(env: Env): PhotoStorage {
  return resolveStorageMode(env) === 'r2' ? new R2Storage(env) : new D1Storage(env);
}

class D1Storage implements PhotoStorage {
  readonly mode = 'd1' as const;
  readonly keepsOriginal = false;

  constructor(private readonly env: Env) {}

  async put(photoId: string, variant: Variant, bytes: ArrayBuffer, mime: string): Promise<void> {
    // 原本は保存しない構成なので、呼ばれても無視する
    if (variant === 'original') return;
    if (bytes.byteLength > MAX_D1_BLOB_BYTES) {
      throw new Error(
        `画像が大きすぎます（${Math.round(bytes.byteLength / 1024)}KB）。` +
          `D1 保存モードでは1枚 ${Math.round(MAX_D1_BLOB_BYTES / 1024)}KB までです`,
      );
    }
    await this.env.DB.prepare(
      `INSERT OR REPLACE INTO photo_blobs (photo_id, variant, bytes, byte_size, mime)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(photoId, variant, bytes, bytes.byteLength, mime)
      .run();
  }

  async get(photoId: string, variant: Variant): Promise<StoredImage | null> {
    const row = await this.env.DB.prepare(
      `SELECT bytes, byte_size, mime FROM photo_blobs WHERE photo_id = ? AND variant = ?`,
    )
      .bind(photoId, variant)
      .first<{ bytes: unknown; byte_size: number; mime: string }>();
    if (!row) return null;
    const bytes = toBytes(row.bytes);
    if (!bytes) return null;
    return { body: bytes, mime: row.mime, byteSize: bytes.byteLength };
  }

  async remove(photoId: string): Promise<void> {
    await this.env.DB.prepare(`DELETE FROM photo_blobs WHERE photo_id = ?`).bind(photoId).run();
  }
}

/**
 * D1 から取り出した BLOB をバイト列にする。
 * D1 は BLOB を数値配列で返すことがあり、そのまま Response に渡すと
 * 「1,2,3,...」という文字列として配信されてしまう（画像が壊れる）。
 */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  return null;
}

/** R2 のキー設計は SPEC のまま */
export const r2Key = (photoId: string, variant: Variant, ext = 'jpg', basisIso?: string): string => {
  if (variant === 'original') {
    const basis = basisIso ?? new Date().toISOString();
    return `original/${basis.slice(0, 4)}/${basis.slice(5, 7)}/${photoId}.${ext}`;
  }
  return `${variant}/${photoId}.jpg`;
};

class R2Storage implements PhotoStorage {
  readonly mode = 'r2' as const;
  readonly keepsOriginal = true;

  constructor(private readonly env: Env) {}

  private bucket(): R2Bucket {
    if (!this.env.BUCKET) {
      throw new Error('PHOTO_STORAGE=r2 ですが R2 バケットのバインディングがありません');
    }
    return this.env.BUCKET;
  }

  async put(
    photoId: string,
    variant: Variant,
    bytes: ArrayBuffer,
    mime: string,
    opts: PutOptions = {},
  ): Promise<void> {
    await this.bucket().put(r2Key(photoId, variant, opts.ext, opts.basisIso), bytes, {
      httpMetadata: { contentType: mime },
    });
  }

  async get(photoId: string, variant: Variant): Promise<StoredImage | null> {
    // 原本のキーは撮影日と拡張子を含むため、写真の行に記録したものを使う
    const row = await this.env.DB.prepare(
      `SELECT r2_key_original AS original, r2_key_display AS display, r2_key_thumb AS thumb
         FROM photos WHERE id = ?`,
    )
      .bind(photoId)
      .first<Record<Variant, string | null>>();
    const key = row?.[variant] ?? r2Key(photoId, variant);
    const object = await this.bucket().get(key);
    if (!object) return null;
    return {
      body: object.body,
      mime: object.httpMetadata?.contentType ?? 'image/jpeg',
      byteSize: object.size,
    };
  }

  async remove(photoId: string): Promise<void> {
    await this.bucket().delete([
      r2Key(photoId, 'original'),
      r2Key(photoId, 'display'),
      r2Key(photoId, 'thumb'),
    ]);
  }
}
