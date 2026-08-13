import { Hono } from 'hono';
import type { Env, PhotoRow } from '../db/types';

export const images = new Hono<{ Bindings: Env }>();

const VARIANTS = {
  thumb: 'r2_key_thumb',
  display: 'r2_key_display',
  original: 'r2_key_original',
} as const;

type Variant = keyof typeof VARIANTS;

/**
 * R2 の中身を Worker 経由で配信する。
 * photo_id は不変・内容も差し替えないので immutable キャッシュにできる。
 */
images.get('/:variant/:id', async (c) => {
  const variant = c.req.param('variant') as Variant;
  const column = VARIANTS[variant];
  if (!column) return c.json({ error: 'unknown variant' }, 404);

  const photo = await c.env.DB.prepare(
    `SELECT ${column} AS key, mime FROM photos WHERE id = ?`,
  )
    .bind(c.req.param('id'))
    .first<{ key: string; mime: PhotoRow['mime'] }>();
  if (!photo) return c.json({ error: 'not found' }, 404);

  const object = await c.env.BUCKET.get(photo.key);
  if (!object) return c.json({ error: 'object missing' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // 個人の写真なので共有キャッシュには載せない（SPEC の public から private に変更）。
  // photo_id は不変で中身も差し替えないため、ブラウザ側は永続キャッシュしてよい。
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', variant === 'original' ? photo.mime : 'image/jpeg');
  }
  return new Response(object.body, { headers });
});
