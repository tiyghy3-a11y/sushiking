import { Hono } from 'hono';
import type { ActivityRow, Env, MountainRow, PhotoRow } from '../db/types';
import { computeStats, type StatPoint } from '../lib/stats';
import { suggestMountains, type MountainLike } from '../lib/geo';
import { detachPhotos, PHOTO_COLUMNS, reinterpolateActivity } from '../db/photos';
import { localDateKey } from '../lib/time';

export const activities = new Hono<{ Bindings: Env }>();

interface MountainLink {
  mountain_id: number;
  is_primary?: boolean;
  summited_at?: string | null;
}

async function linkedMountains(db: D1Database, activityId: string) {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.name, m.name_kana, m.elevation, m.area, m.lat, m.lng,
              am.is_primary, am.summited_at
         FROM activity_mountains am
         JOIN mountains m ON m.id = am.mountain_id
        WHERE am.activity_id = ?
        ORDER BY am.is_primary DESC, m.elevation DESC`,
    )
    .bind(activityId)
    .all();
  return results ?? [];
}

async function replaceMountains(db: D1Database, activityId: string, links: MountainLink[]) {
  const stmts = [db.prepare(`DELETE FROM activity_mountains WHERE activity_id = ?`).bind(activityId)];
  const insert = db.prepare(
    `INSERT INTO activity_mountains (activity_id, mountain_id, summited_at, is_primary)
     VALUES (?, ?, ?, ?)`,
  );
  for (const l of links) {
    if (!Number.isInteger(l.mountain_id)) continue;
    stmts.push(insert.bind(activityId, l.mountain_id, l.summited_at ?? null, l.is_primary ? 1 : 0));
  }
  await db.batch(stmts);
}

async function assignPhotos(db: D1Database, activityId: string, photoIds: string[]) {
  if (photoIds.length === 0) return;
  const stmt = db.prepare(`UPDATE photos SET activity_id = ? WHERE id = ?`);
  await db.batch(photoIds.map((pid) => stmt.bind(activityId, pid)));
  await reinterpolateActivity(db, activityId);
}

async function statsFor(db: D1Database, activityId: string) {
  // 統計は必ず coord_source = 'exif' の写真だけで計算する
  const { results } = await db
    .prepare(
      `SELECT taken_at, lat, lng, altitude FROM photos
        WHERE activity_id = ? AND coord_source = 'exif'
          AND lat IS NOT NULL AND lng IS NOT NULL AND taken_at IS NOT NULL
        ORDER BY taken_at`,
    )
    .bind(activityId)
    .all<StatPoint>();
  return computeStats(results ?? []);
}

/** 一覧（ページング）。カバー写真・山名・枚数付き */
activities.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);

  const { results } = await c.env.DB.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM photos p WHERE p.activity_id = a.id) AS photo_count,
            COALESCE(a.cover_photo_id,
              (SELECT p.id FROM photos p WHERE p.activity_id = a.id
                ORDER BY p.is_favorite DESC, p.taken_at LIMIT 1)) AS thumb_photo_id
       FROM activities a
      ORDER BY a.start_date DESC, a.created_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<ActivityRow & { photo_count: number; thumb_photo_id: string | null }>();

  const list = results ?? [];
  const withMountains = await Promise.all(
    list.map(async (a) => ({ ...a, mountains: await linkedMountains(c.env.DB, a.id) })),
  );

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM activities`).first<{ n: number }>();
  return c.json({ activities: withMountains, total: total?.n ?? 0, limit, offset });
});

/** 作成。未分類トレイからは photo_ids と mountains を渡してここで確定させる */
activities.post('/', async (c) => {
  const body = await c.req.json<{
    title?: string;
    start_date?: string;
    end_date?: string;
    note?: string | null;
    members?: string | null;
    cover_photo_id?: string | null;
    photo_ids?: string[];
    mountains?: MountainLink[];
  }>();

  const photoIds = (body.photo_ids ?? []).map(String);
  let startDate = body.start_date;
  let endDate = body.end_date;

  // 日付未指定なら写真の撮影日から埋める
  if ((!startDate || !endDate) && photoIds.length > 0) {
    const { results } = await c.env.DB.prepare(
      `SELECT MIN(taken_at) AS min_at, MAX(taken_at) AS max_at FROM photos
        WHERE id IN (${photoIds.map(() => '?').join(',')}) AND taken_at IS NOT NULL`,
    )
      .bind(...photoIds)
      .all<{ min_at: string | null; max_at: string | null }>();
    const range = results?.[0];
    startDate = startDate || localDateKey(range?.min_at ?? null) || undefined;
    endDate = endDate || localDateKey(range?.max_at ?? null) || startDate;
  }

  if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400);
  if (!startDate) return c.json({ error: 'start_date is required' }, 400);

  const now = new Date().toISOString();
  const row: ActivityRow = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    start_date: startDate,
    end_date: endDate || startDate,
    note: body.note ?? null,
    members: body.members ?? null,
    cover_photo_id: body.cover_photo_id ?? null,
    created_at: now,
    updated_at: now,
  };

  await c.env.DB.prepare(
    `INSERT INTO activities (id, title, start_date, end_date, note, members, cover_photo_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.title,
      row.start_date,
      row.end_date,
      row.note,
      row.members,
      row.cover_photo_id,
      row.created_at,
      row.updated_at,
    )
    .run();

  if (body.mountains?.length) await replaceMountains(c.env.DB, row.id, body.mountains);
  await assignPhotos(c.env.DB, row.id, photoIds);

  return c.json({ activity: row, assigned_photo_count: photoIds.length }, 201);
});

/** 詳細（写真・山・統計込み） */
activities.get('/:id', async (c) => {
  const id = c.req.param('id');
  const activity = await c.env.DB.prepare(`SELECT * FROM activities WHERE id = ?`)
    .bind(id)
    .first<ActivityRow>();
  if (!activity) return c.json({ error: 'not found' }, 404);

  const { results: photoRows } = await c.env.DB.prepare(
    `SELECT ${PHOTO_COLUMNS} FROM photos WHERE activity_id = ? ORDER BY taken_at, created_at`,
  )
    .bind(id)
    .all<PhotoRow>();

  const { results: contributorRows } = await c.env.DB.prepare(
    `SELECT * FROM contributors`,
  ).all();

  return c.json({
    activity,
    mountains: await linkedMountains(c.env.DB, id),
    photos: photoRows ?? [],
    contributors: contributorRows ?? [],
    stats: await statsFor(c.env.DB, id),
  });
});

activities.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<
    Partial<{
      title: string;
      start_date: string;
      end_date: string;
      note: string | null;
      members: string | null;
      cover_photo_id: string | null;
    }>
  >();

  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };

  if (typeof body.title === 'string' && body.title.trim()) push('title', body.title.trim());
  if (typeof body.start_date === 'string') push('start_date', body.start_date);
  if (typeof body.end_date === 'string') push('end_date', body.end_date);
  if ('note' in body) push('note', body.note ?? null);
  if ('members' in body) push('members', body.members ?? null);
  if ('cover_photo_id' in body) push('cover_photo_id', body.cover_photo_id ?? null);
  if (sets.length === 0) return c.json({ error: 'no updatable field' }, 400);

  push('updated_at', new Date().toISOString());
  binds.push(id);
  await c.env.DB.prepare(`UPDATE activities SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM activities WHERE id = ?`)
    .bind(id)
    .first<ActivityRow>();
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json({ activity: updated });
});

/** 削除。写真は消さず未分類に戻す */
activities.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(`SELECT id FROM photos WHERE activity_id = ?`)
    .bind(id)
    .all<{ id: string }>();

  await detachPhotos(
    c.env.DB,
    (results ?? []).map((r) => r.id),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM activity_mountains WHERE activity_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM activities WHERE id = ?`).bind(id),
  ]);

  return c.json({ deleted: true, released_photo_count: results?.length ?? 0 });
});

/** 紐付け山の一括更新 */
activities.put('/:id/mountains', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ mountains?: MountainLink[] }>();
  await replaceMountains(c.env.DB, id, body.mountains ?? []);
  return c.json({ mountains: await linkedMountains(c.env.DB, id) });
});

/** 写真をこの activity に割り当て（付け替えもここ） */
activities.post('/:id/photos', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ photo_ids?: string[] }>();
  const photoIds = (body.photo_ids ?? []).map(String);
  if (photoIds.length === 0) return c.json({ error: 'photo_ids is required' }, 400);

  const activity = await c.env.DB.prepare(`SELECT id FROM activities WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  if (!activity) return c.json({ error: 'not found' }, 404);

  // 付け替え元の activity も補間を引き直す必要がある
  const { results: previous } = await c.env.DB.prepare(
    `SELECT DISTINCT activity_id FROM photos
      WHERE activity_id IS NOT NULL AND activity_id != ?
        AND id IN (${photoIds.map(() => '?').join(',')})`,
  )
    .bind(id, ...photoIds)
    .all<{ activity_id: string }>();

  await assignPhotos(c.env.DB, id, photoIds);
  for (const p of previous ?? []) await reinterpolateActivity(c.env.DB, p.activity_id);

  return c.json({ assigned: photoIds.length });
});

/** 写真をこの activity から外して未分類に戻す */
activities.delete('/:id/photos', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ photo_ids?: string[] }>();
  const photoIds = (body.photo_ids ?? []).map(String);
  if (photoIds.length === 0) return c.json({ error: 'photo_ids is required' }, 400);

  await detachPhotos(c.env.DB, photoIds);
  await reinterpolateActivity(c.env.DB, id);
  return c.json({ detached: photoIds.length });
});

/** 統計値（算出はサーバー側） */
activities.get('/:id/stats', async (c) => {
  return c.json({ stats: await statsFor(c.env.DB, c.req.param('id')) });
});

/** この山行の写真から山を推定して提案する */
activities.get('/:id/suggest-mountains', async (c) => {
  const id = c.req.param('id');
  const { results: points } = await c.env.DB.prepare(
    `SELECT lat, lng, taken_at FROM photos
      WHERE activity_id = ? AND coord_source = 'exif' AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY taken_at`,
  )
    .bind(id)
    .all<{ lat: number; lng: number; taken_at: string | null }>();

  const { results: mountainRows } = await c.env.DB.prepare(
    `SELECT id, name, lat, lng, match_radius_m FROM mountains`,
  ).all<MountainLike & Pick<MountainRow, 'name'>>();

  return c.json({
    ...suggestMountains(points ?? [], mountainRows ?? []),
    exif_photo_count: points?.length ?? 0,
  });
});
