/**
 * 写真に対する横断的な処理。ルート間で共有する。
 */
import { interpolateCoords, type PhotoCoordInput } from '../lib/interpolate';
import type { PhotoRow } from './types';

/**
 * activity に属する写真の座標を補間し直す。
 *
 * 呼び出しタイミングは「activityへの割り当て時」と「割り当て済み写真の追加時」。
 * 既存の interpolated は一度 none に戻してから引き直す。そうしないと、
 * 元になった exif 写真が外れても古い補間値が残ってしまう。
 */
export async function reinterpolateActivity(db: D1Database, activityId: string): Promise<number> {
  await db
    .prepare(
      `UPDATE photos SET lat = NULL, lng = NULL, altitude = NULL, coord_source = 'none'
       WHERE activity_id = ? AND coord_source = 'interpolated'`,
    )
    .bind(activityId)
    .run();

  const { results } = await db
    .prepare(
      `SELECT id, taken_at, lat, lng, altitude, coord_source FROM photos
       WHERE activity_id = ? ORDER BY taken_at`,
    )
    .bind(activityId)
    .all<PhotoCoordInput>();

  const filled = interpolateCoords(results ?? []);
  if (filled.length === 0) return 0;

  const stmt = db.prepare(
    `UPDATE photos SET lat = ?, lng = ?, altitude = ?, coord_source = 'interpolated' WHERE id = ?`,
  );
  await db.batch(filled.map((f) => stmt.bind(f.lat, f.lng, f.altitude, f.id)));
  return filled.length;
}

/** activity から外す写真は補間値も破棄する（別の山行では意味を持たないため） */
export async function detachPhotos(db: D1Database, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const placeholders = photoIds.map(() => '?').join(',');
  await db
    .prepare(
      `UPDATE photos
       SET activity_id = NULL,
           lat = CASE WHEN coord_source = 'interpolated' THEN NULL ELSE lat END,
           lng = CASE WHEN coord_source = 'interpolated' THEN NULL ELSE lng END,
           altitude = CASE WHEN coord_source = 'interpolated' THEN NULL ELSE altitude END,
           coord_source = CASE WHEN coord_source = 'interpolated' THEN 'none' ELSE coord_source END
       WHERE id IN (${placeholders})`,
    )
    .bind(...photoIds)
    .run();
}

/** R2 の3キーをまとめて削除する */
export async function deletePhotoObjects(bucket: R2Bucket, photo: PhotoRow): Promise<void> {
  await bucket.delete([photo.r2_key_original, photo.r2_key_display, photo.r2_key_thumb]);
}

export const PHOTO_COLUMNS = `id, activity_id, contributor_id, r2_key_original, r2_key_display,
  r2_key_thumb, taken_at, taken_at_raw, time_source, lat, lng, altitude, coord_source,
  width, height, mime, byte_size, content_hash, camera_model, caption, is_favorite, created_at`;
