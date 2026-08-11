import { Hono } from 'hono';
import type { Env, MountainRow } from '../db/types';
import { serializeMountain } from '../db/types';

export const mountains = new Hono<{ Bindings: Env }>();

interface MountainWithProgress extends MountainRow {
  visit_count: number;
  first_climbed_on: string | null;
  last_climbed_on: string | null;
}

/** 山マスタ一覧（進捗フラグ付き） */
mountains.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*,
            COUNT(DISTINCT am.activity_id) AS visit_count,
            MIN(a.start_date) AS first_climbed_on,
            MAX(a.start_date) AS last_climbed_on
       FROM mountains m
       LEFT JOIN activity_mountains am ON am.mountain_id = m.id
       LEFT JOIN activities a ON a.id = am.activity_id
      GROUP BY m.id
      ORDER BY m.id`,
  ).all<MountainWithProgress>();

  return c.json({
    mountains: (results ?? []).map((m) => ({
      ...serializeMountain(m),
      visit_count: m.visit_count,
      climbed: m.visit_count > 0,
      first_climbed_on: m.first_climbed_on,
      last_climbed_on: m.last_climbed_on,
    })),
  });
});

/** 山詳細 + その山を含む全山行 */
mountains.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);

  const mountain = await c.env.DB.prepare(`SELECT * FROM mountains WHERE id = ?`)
    .bind(id)
    .first<MountainRow>();
  if (!mountain) return c.json({ error: 'not found' }, 404);

  const { results: activities } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.start_date, a.end_date, a.cover_photo_id,
            am.summited_at, am.is_primary,
            (SELECT COUNT(*) FROM photos p WHERE p.activity_id = a.id) AS photo_count
       FROM activity_mountains am
       JOIN activities a ON a.id = am.activity_id
      WHERE am.mountain_id = ?
      ORDER BY a.start_date DESC`,
  )
    .bind(id)
    .all();

  return c.json({ mountain: serializeMountain(mountain), activities: activities ?? [] });
});

/** 座標・判定半径の編集（地理院検索の代表点ズレを手で直すため） */
mountains.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);

  const body = await c.req.json<Partial<{
    lat: number;
    lng: number;
    match_radius_m: number;
    verified: boolean;
    elevation: number;
    area: string;
  }>>();

  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };

  if (typeof body.lat === 'number') push('lat', body.lat);
  if (typeof body.lng === 'number') push('lng', body.lng);
  if (typeof body.match_radius_m === 'number') push('match_radius_m', Math.round(body.match_radius_m));
  if (typeof body.verified === 'boolean') push('verified', body.verified ? 1 : 0);
  if (typeof body.elevation === 'number') push('elevation', Math.round(body.elevation));
  if (typeof body.area === 'string') push('area', body.area);
  if (sets.length === 0) return c.json({ error: 'no updatable field' }, 400);

  binds.push(id);
  await c.env.DB.prepare(`UPDATE mountains SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM mountains WHERE id = ?`)
    .bind(id)
    .first<MountainRow>();
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json({ mountain: serializeMountain(updated) });
});
