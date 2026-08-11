/**
 * 座標の3段階フォールバックのうち Step 2（時系列補間）。
 *
 * 同一 activity 内の coord_source = 'exif' な写真を時刻順に並べ、
 * 座標を持たない写真の撮影時刻を挟む前後2点から線形補間する。
 * 補間結果は必ず coord_source = 'interpolated' として記録し、
 * 分析系（標高グラフ・距離・自動判定）からは除外できるようにする。
 */

export type CoordSource = 'exif' | 'interpolated' | 'manual' | 'none';

/** 前後2点の時間差がこれを超える場合は補間しない */
export const MAX_INTERPOLATION_GAP_SEC = 2 * 60 * 60;
/** 系列の範囲外は、最近傍点とこの時間差以内なら座標をコピーする */
export const MAX_EDGE_COPY_GAP_SEC = 30 * 60;

export interface PhotoCoordInput {
  id: string;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  altitude?: number | null;
  coord_source: CoordSource;
}

export interface InterpolatedCoord {
  id: string;
  lat: number;
  lng: number;
  altitude: number | null;
}

interface Anchor {
  t: number;
  lat: number;
  lng: number;
  altitude: number | null;
}

const ms = (iso: string) => new Date(iso).getTime();

const lerp = (a: number, b: number, r: number) => a + (b - a) * r;

/**
 * 補間で座標を埋められる写真の一覧を返す（DB への書き戻しは呼び出し側の責務）。
 * manual / exif で既に座標が決まっている写真は絶対に上書きしない。
 */
export function interpolateCoords(photos: readonly PhotoCoordInput[]): InterpolatedCoord[] {
  const anchors: Anchor[] = photos
    .filter(
      (p): p is PhotoCoordInput & { taken_at: string; lat: number; lng: number } =>
        p.coord_source === 'exif' && p.lat != null && p.lng != null && p.taken_at != null,
    )
    .map((p) => ({
      t: ms(p.taken_at),
      lat: p.lat,
      lng: p.lng,
      altitude: p.altitude ?? null,
    }))
    .filter((a) => Number.isFinite(a.t))
    .sort((a, b) => a.t - b.t);

  if (anchors.length === 0) return [];

  const targets = photos.filter(
    (p) =>
      p.taken_at != null &&
      (p.lat == null || p.lng == null) &&
      p.coord_source !== 'manual' &&
      p.coord_source !== 'exif',
  );

  const out: InterpolatedCoord[] = [];

  for (const p of targets) {
    const t = ms(p.taken_at as string);
    if (!Number.isFinite(t)) continue;

    // 範囲外: 最近傍アンカーが 30分以内ならコピー
    if (t <= anchors[0].t || t >= anchors[anchors.length - 1].t) {
      const edge = t <= anchors[0].t ? anchors[0] : anchors[anchors.length - 1];
      if (Math.abs(edge.t - t) / 1000 <= MAX_EDGE_COPY_GAP_SEC) {
        out.push({ id: p.id, lat: edge.lat, lng: edge.lng, altitude: edge.altitude });
      }
      continue;
    }

    // 挟む2点を探す
    let lo = anchors[0];
    let hi = anchors[anchors.length - 1];
    for (let i = 0; i < anchors.length - 1; i++) {
      if (anchors[i].t <= t && t <= anchors[i + 1].t) {
        lo = anchors[i];
        hi = anchors[i + 1];
        break;
      }
    }

    const gapSec = (hi.t - lo.t) / 1000;
    if (gapSec > MAX_INTERPOLATION_GAP_SEC) continue; // 空きすぎ。補間すると嘘になる
    if (gapSec === 0) {
      out.push({ id: p.id, lat: lo.lat, lng: lo.lng, altitude: lo.altitude });
      continue;
    }

    const r = (t - lo.t) / (hi.t - lo.t);
    out.push({
      id: p.id,
      lat: lerp(lo.lat, hi.lat, r),
      lng: lerp(lo.lng, hi.lng, r),
      altitude:
        lo.altitude != null && hi.altitude != null ? lerp(lo.altitude, hi.altitude, r) : null,
    });
  }

  return out;
}
