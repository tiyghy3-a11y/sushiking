import { Hono } from 'hono';
import type { Env } from '../db/types';

export const batches = new Hono<{ Bindings: Env }>();

/** 取り込みバッチの作成。やり直し・一括削除の単位になる */
batches.post('/', async (c) => {
  const body = await c.req.json<{ contributor_id?: string | null; time_offset_sec?: number }>();
  const row = {
    id: crypto.randomUUID(),
    contributor_id: body.contributor_id ?? null,
    time_offset_sec: Math.round(body.time_offset_sec ?? 0),
    created_at: new Date().toISOString(),
  };
  await c.env.DB.prepare(
    `INSERT INTO import_batches (id, contributor_id, time_offset_sec, photo_count, skipped_count, created_at)
     VALUES (?, ?, ?, 0, 0, ?)`,
  )
    .bind(row.id, row.contributor_id, row.time_offset_sec, row.created_at)
    .run();
  return c.json({ batch: { ...row, photo_count: 0, skipped_count: 0 } }, 201);
});

batches.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.*, c.name AS contributor_name
       FROM import_batches b
       LEFT JOIN contributors c ON c.id = b.contributor_id
      ORDER BY b.created_at DESC LIMIT 50`,
  ).all();
  return c.json({ batches: results ?? [] });
});
