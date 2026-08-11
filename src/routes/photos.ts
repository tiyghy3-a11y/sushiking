import { Hono } from 'hono';
import type { ContributorRow, Env, MountainRow, PhotoRow } from '../db/types';
import { suggestMountains, type MountainLike } from '../lib/geo';
import { applyOffset, localDateKey, type TimeSource } from '../lib/time';
import type { CoordSource } from '../lib/interpolate';
import { deletePhotoObjects, PHOTO_COLUMNS, reinterpolateActivity } from '../db/photos';

export const photos = new Hono<{ Bindings: Env }>();

interface UploadMeta {
  content_hash: string;
  mime: string;
  byte_size?: number;
  ext?: string;
  width?: number | null;
  height?: number | null;
  taken_at_raw?: string | null;
  time_source?: TimeSource;
  lat?: number | null;
  lng?: number | null;
  altitude?: number | null;
  coord_source?: CoordSource;
  camera_model?: string | null;
  contributor_id?: string | null;
  batch_id?: string | null;
  /** バッチ指定のオフセット。未指定なら contributor の既定値を使う */
  time_offset_sec?: number | null;
}

const isFile = (v: unknown): v is File =>
  typeof v === 'object' && v !== null && typeof (v as File).arrayBuffer === 'function';

/** hash配列を投げて既存判定（重複スキップ用） */
photos.post('/check-hashes', async (c) => {
  const { hashes } = await c.req.json<{ hashes?: string[] }>();
  if (!Array.isArray(hashes) || hashes.length === 0) return c.json({ existing: [] });

  const existing: string[] = [];
  // D1 のバインド上限を避けるため分割して問い合わせる
  for (let i = 0; i < hashes.length; i += 100) {
    const chunk = hashes.slice(i, i + 100).map(String);
    const { results } = await c.env.DB.prepare(
      `SELECT content_hash FROM photos WHERE content_hash IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<{ content_hash: string }>();
    existing.push(...(results ?? []).map((r) => r.content_hash));
  }
  return c.json({ existing });
});

/**
 * 写真1枚のアップロード。
 * EXIF抽出・HEIC変換・リサイズはすべてクライアント側で済ませ、
 * Worker は「確定した値とバイナリを R2 と D1 に置く」だけに徹する。
 */
photos.post('/upload', async (c) => {
  const form = await c.req.formData();
  let meta: UploadMeta;
  try {
    meta = JSON.parse(String(form.get('meta') ?? '')) as UploadMeta;
  } catch {
    return c.json({ error: 'meta must be a JSON string' }, 400);
  }
  if (!meta?.content_hash) return c.json({ error: 'meta.content_hash is required' }, 400);

  const original = form.get('original');
  const display = form.get('display');
  const thumb = form.get('thumb');
  if (!isFile(original) || !isFile(display) || !isFile(thumb)) {
    return c.json({ error: 'original / display / thumb files are required' }, 400);
  }

  const duplicate = await c.env.DB.prepare(`SELECT id FROM photos WHERE content_hash = ?`)
    .bind(meta.content_hash)
    .first<{ id: string }>();
  if (duplicate) {
    if (meta.batch_id) {
      await c.env.DB.prepare(
        `UPDATE import_batches SET skipped_count = skipped_count + 1 WHERE id = ?`,
      )
        .bind(meta.batch_id)
        .run();
    }
    return c.json({ skipped: true, reason: 'duplicate', photo_id: duplicate.id }, 200);
  }

  // 時計オフセット: バッチ指定 > 撮影者の既定値
  let offsetSec = meta.time_offset_sec ?? null;
  if (offsetSec === null && meta.contributor_id) {
    const contributor = await c.env.DB.prepare(
      `SELECT default_time_offset_sec FROM contributors WHERE id = ?`,
    )
      .bind(meta.contributor_id)
      .first<Pick<ContributorRow, 'default_time_offset_sec'>>();
    offsetSec = contributor?.default_time_offset_sec ?? 0;
  }
  offsetSec = offsetSec ?? 0;

  const timeSource: TimeSource = meta.time_source ?? 'none';
  const takenAtRaw = timeSource === 'none' ? null : (meta.taken_at_raw ?? null);
  const takenAt = takenAtRaw ? applyOffset(takenAtRaw, offsetSec) : null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const basis = takenAt ?? now;
  const yyyy = basis.slice(0, 4);
  const mm = basis.slice(5, 7);
  const ext = (meta.ext ?? original.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');

  const keys = {
    original: `original/${yyyy}/${mm}/${id}.${ext || 'jpg'}`,
    display: `display/${id}.jpg`,
    thumb: `thumb/${id}.jpg`,
  };

  await Promise.all([
    c.env.BUCKET.put(keys.original, original.stream(), {
      httpMetadata: { contentType: meta.mime || original.type || 'application/octet-stream' },
    }),
    c.env.BUCKET.put(keys.display, display.stream(), { httpMetadata: { contentType: 'image/jpeg' } }),
    c.env.BUCKET.put(keys.thumb, thumb.stream(), { httpMetadata: { contentType: 'image/jpeg' } }),
  ]);

  const hasCoord = typeof meta.lat === 'number' && typeof meta.lng === 'number';
  const coordSource: CoordSource = hasCoord ? (meta.coord_source ?? 'exif') : 'none';

  try {
    await c.env.DB.prepare(
      `INSERT INTO photos (
         id, activity_id, contributor_id, r2_key_original, r2_key_display, r2_key_thumb,
         taken_at, taken_at_raw, time_source, lat, lng, altitude, coord_source,
         width, height, mime, byte_size, content_hash, camera_model, caption, is_favorite, created_at
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
    )
      .bind(
        id,
        meta.contributor_id ?? null,
        keys.original,
        keys.display,
        keys.thumb,
        takenAt,
        takenAtRaw,
        timeSource,
        hasCoord ? meta.lat : null,
        hasCoord ? meta.lng : null,
        hasCoord ? (meta.altitude ?? null) : null,
        coordSource,
        meta.width ?? null,
        meta.height ?? null,
        meta.mime || 'image/jpeg',
        meta.byte_size ?? original.size,
        meta.content_hash,
        meta.camera_model ?? null,
        now,
      )
      .run();
  } catch (e) {
    // D1 への INSERT が落ちたら R2 に孤児を残さない
    await c.env.BUCKET.delete([keys.original, keys.display, keys.thumb]);
    throw e;
  }

  if (meta.batch_id) {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT OR IGNORE INTO photo_batch_map (photo_id, batch_id) VALUES (?, ?)`).bind(
        id,
        meta.batch_id,
      ),
      c.env.DB.prepare(`UPDATE import_batches SET photo_count = photo_count + 1 WHERE id = ?`).bind(
        meta.batch_id,
      ),
    ]);
  }

  return c.json({ skipped: false, photo_id: id, taken_at: takenAt, coord_source: coordSource }, 201);
});

/** 未分類トレイ用。撮影日（JST）でグルーピングして返す */
photos.get('/unassigned', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${PHOTO_COLUMNS} FROM photos WHERE activity_id IS NULL ORDER BY taken_at, created_at`,
  ).all<PhotoRow>();

  const groups = new Map<string, PhotoRow[]>();
  for (const p of results ?? []) {
    const key = localDateKey(p.taken_at) ?? 'unknown';
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }

  const dated = [...groups.entries()]
    .filter(([date]) => date !== 'unknown')
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({ date, count: list.length, photos: list }));

  const unknown = groups.get('unknown');
  if (unknown) dated.push({ date: null as unknown as string, count: unknown.length, photos: unknown });

  return c.json({ total: results?.length ?? 0, groups: dated });
});

/** 写真群から登った山を推定する（提案のみ。確定はユーザーが行う） */
photos.post('/suggest-mountains', async (c) => {
  const { photo_ids } = await c.req.json<{ photo_ids?: string[] }>();
  if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
    return c.json({ primary: null, candidates: [] });
  }

  const points: { lat: number; lng: number; taken_at: string | null }[] = [];
  for (let i = 0; i < photo_ids.length; i += 100) {
    const chunk = photo_ids.slice(i, i + 100).map(String);
    const { results } = await c.env.DB.prepare(
      `SELECT lat, lng, taken_at FROM photos
        WHERE coord_source = 'exif' AND lat IS NOT NULL AND lng IS NOT NULL
          AND id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<{ lat: number; lng: number; taken_at: string | null }>();
    points.push(...(results ?? []));
  }

  const { results: mountainRows } = await c.env.DB.prepare(
    `SELECT id, name, lat, lng, match_radius_m FROM mountains`,
  ).all<MountainLike & Pick<MountainRow, 'name'>>();

  return c.json({
    ...suggestMountains(points, mountainRows ?? []),
    exif_photo_count: points.length,
  });
});

/** caption / 座標手動指定 / favorite / 撮影者 / 時刻手入力 */
photos.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<
    Partial<{
      caption: string | null;
      is_favorite: boolean;
      lat: number | null;
      lng: number | null;
      taken_at: string | null;
      contributor_id: string | null;
    }>
  >();

  const current = await c.env.DB.prepare(`SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = ?`)
    .bind(id)
    .first<PhotoRow>();
  if (!current) return c.json({ error: 'not found' }, 404);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };

  let coordChanged = false;
  if ('caption' in body) push('caption', body.caption ?? null);
  if (typeof body.is_favorite === 'boolean') push('is_favorite', body.is_favorite ? 1 : 0);
  if ('contributor_id' in body) push('contributor_id', body.contributor_id ?? null);

  if (typeof body.lat === 'number' && typeof body.lng === 'number') {
    push('lat', body.lat);
    push('lng', body.lng);
    push('coord_source', 'manual');
    coordChanged = true;
  } else if (body.lat === null && body.lng === null && 'lat' in body) {
    push('lat', null);
    push('lng', null);
    push('coord_source', 'none');
    coordChanged = true;
  }

  if ('taken_at' in body) {
    push('taken_at', body.taken_at ?? null);
    push('time_source', body.taken_at ? 'manual' : 'none');
    coordChanged = true; // 時刻が変われば補間結果も変わる
  }

  if (sets.length === 0) return c.json({ error: 'no updatable field' }, 400);

  binds.push(id);
  await c.env.DB.prepare(`UPDATE photos SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  if (coordChanged && current.activity_id) {
    await reinterpolateActivity(c.env.DB, current.activity_id);
  }

  const updated = await c.env.DB.prepare(`SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = ?`)
    .bind(id)
    .first<PhotoRow>();
  return c.json({ photo: updated });
});

/** 削除（R2からも削除） */
photos.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const photo = await c.env.DB.prepare(`SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = ?`)
    .bind(id)
    .first<PhotoRow>();
  if (!photo) return c.json({ error: 'not found' }, 404);

  await deletePhotoObjects(c.env.BUCKET, photo);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM photo_batch_map WHERE photo_id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE activities SET cover_photo_id = NULL WHERE cover_photo_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(id),
  ]);

  if (photo.activity_id) await reinterpolateActivity(c.env.DB, photo.activity_id);
  return c.json({ deleted: true });
});
