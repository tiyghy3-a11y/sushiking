import { Hono } from 'hono';
import type { ContributorRow, Env } from '../db/types';

export const contributors = new Hono<{ Bindings: Env }>();

contributors.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM photos p WHERE p.contributor_id = c.id) AS photo_count
       FROM contributors c ORDER BY c.is_self DESC, c.created_at`,
  ).all<ContributorRow & { photo_count: number }>();
  return c.json({ contributors: results ?? [] });
});

contributors.post('/', async (c) => {
  const body = await c.req.json<{ name?: string; is_self?: boolean; default_time_offset_sec?: number }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const row: ContributorRow = {
    id: crypto.randomUUID(),
    name,
    is_self: body.is_self ? 1 : 0,
    default_time_offset_sec: Math.round(body.default_time_offset_sec ?? 0),
    created_at: new Date().toISOString(),
  };
  await c.env.DB.prepare(
    `INSERT INTO contributors (id, name, is_self, default_time_offset_sec, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.name, row.is_self, row.default_time_offset_sec, row.created_at)
    .run();

  return c.json({ contributor: row }, 201);
});

contributors.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; is_self?: boolean; default_time_offset_sec?: number }>();

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?');
    binds.push(body.name.trim());
  }
  if (typeof body.is_self === 'boolean') {
    sets.push('is_self = ?');
    binds.push(body.is_self ? 1 : 0);
  }
  if (typeof body.default_time_offset_sec === 'number') {
    sets.push('default_time_offset_sec = ?');
    binds.push(Math.round(body.default_time_offset_sec));
  }
  if (sets.length === 0) return c.json({ error: 'no updatable field' }, 400);

  binds.push(id);
  await c.env.DB.prepare(`UPDATE contributors SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM contributors WHERE id = ?`)
    .bind(id)
    .first<ContributorRow>();
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json({ contributor: updated });
});
