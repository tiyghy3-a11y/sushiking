import { Hono } from 'hono';
import type { Env } from '../db/types';

export const progress = new Hono<{ Bindings: Env }>();

/** 百名山進捗サマリ（完登カウンタと山域別の内訳） */
progress.get('/', async (c) => {
  const totals = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN climbed > 0 THEN 1 ELSE 0 END) AS climbed
       FROM (
         SELECT m.id, COUNT(am.activity_id) AS climbed
           FROM mountains m
           LEFT JOIN activity_mountains am ON am.mountain_id = m.id
          WHERE m.is_hyakumeizan = 1
          GROUP BY m.id
       )`,
  ).first<{ total: number; climbed: number | null }>();

  const { results: byArea } = await c.env.DB.prepare(
    `SELECT area,
            COUNT(*) AS total,
            SUM(CASE WHEN climbed > 0 THEN 1 ELSE 0 END) AS climbed
       FROM (
         SELECT m.id, m.area, COUNT(am.activity_id) AS climbed
           FROM mountains m
           LEFT JOIN activity_mountains am ON am.mountain_id = m.id
          WHERE m.is_hyakumeizan = 1
          GROUP BY m.id
       )
      GROUP BY area
      ORDER BY total DESC, area`,
  ).all<{ area: string | null; total: number; climbed: number | null }>();

  const activityCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM activities`,
  ).first<{ n: number }>();
  const photoCount = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM photos`).first<{ n: number }>();
  const unassignedCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM photos WHERE activity_id IS NULL`,
  ).first<{ n: number }>();

  // D1 に画像を置く構成では無料枠の残りが気になるので、合計サイズも返す
  const storedBytes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(byte_size), 0) AS n FROM photo_blobs`,
  ).first<{ n: number }>();

  return c.json({
    total: totals?.total ?? 0,
    climbed: totals?.climbed ?? 0,
    by_area: (byArea ?? []).map((a) => ({
      area: a.area ?? '未設定',
      total: a.total,
      climbed: a.climbed ?? 0,
    })),
    activity_count: activityCount?.n ?? 0,
    photo_count: photoCount?.n ?? 0,
    unassigned_photo_count: unassignedCount?.n ?? 0,
    stored_image_bytes: storedBytes?.n ?? 0,
  });
});
