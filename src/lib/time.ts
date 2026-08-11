/** 時刻・オフセット補正まわりの小物 */

export type TimeSource = 'exif' | 'file' | 'manual' | 'none';

/** ISO8601 に秒単位のオフセットを加算する */
export function applyOffset(iso: string, offsetSec: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  return new Date(t + offsetSec * 1000).toISOString();
}

/**
 * 「同じ瞬間を写した2枚」から時計オフセットを求める。
 * 戻り値は相手の時刻に加算すべき秒数（基準 - 相手）。
 */
export function offsetBetween(referenceIso: string, targetIso: string): number {
  return Math.round(
    (new Date(referenceIso).getTime() - new Date(targetIso).getTime()) / 1000,
  );
}

/** activity のローカル日付キー（YYYY-MM-DD）。未分類トレイの日付グルーピングに使う */
export function localDateKey(iso: string | null, timeZone = 'Asia/Tokyo'): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  // ja-JP + timeZone で YYYY/MM/DD を得て整形する
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
