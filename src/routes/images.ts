import { Hono } from 'hono';
import { getStorage, type Variant } from '../db/storage';
import type { Env } from '../db/types';

export const images = new Hono<{ Bindings: Env }>();

const VARIANTS: Variant[] = ['thumb', 'display', 'original'];

/**
 * 画像を配信する。保存先（D1 / R2）は storage.ts が判断する。
 * photo_id は不変・中身も差し替えないので、ブラウザ側は永続キャッシュしてよい。
 * 個人の写真なので共有キャッシュには載せない（private）。
 */
images.get('/:variant/:id', async (c) => {
  const variant = c.req.param('variant') as Variant;
  if (!VARIANTS.includes(variant)) return c.json({ error: 'unknown variant' }, 404);

  const storage = getStorage(c.env);
  if (variant === 'original' && !storage.keepsOriginal) {
    return c.json(
      { error: '原本は保存していません（表示用とサムネイルのみ）。原本は端末の写真ライブラリにあります' },
      404,
    );
  }

  const image = await storage.get(c.req.param('id'), variant);
  if (!image) return c.json({ error: 'not found' }, 404);

  const headers = new Headers({
    'Content-Type': image.mime || 'image/jpeg',
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  if (image.byteSize != null) headers.set('Content-Length', String(image.byteSize));
  return new Response(image.body, { headers });
});
