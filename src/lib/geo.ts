/**
 * 距離計算と百名山マスタとの最近傍マッチ。
 * Worker / ブラウザ / Node スクリプトのすべてから import されるため、
 * このファイルはランタイム固有の API に依存しない。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MountainLike extends LatLng {
  id: number;
  name: string;
  match_radius_m: number;
}

const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 2点間の大円距離（m） */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface NearestHit<M extends MountainLike = MountainLike> {
  mountain: M;
  distance_m: number;
}

/**
 * その点の match_radius_m 以内にある山のうち最も近いものを返す。
 * 半径は山ごとに違う（独立峰は広く、連峰の隣接ピークは狭く）ので山側の値を使う。
 */
export function nearestMountain<M extends MountainLike>(
  point: LatLng,
  mountains: readonly M[],
): NearestHit<M> | null {
  let best: NearestHit<M> | null = null;
  for (const m of mountains) {
    const d = haversineMeters(point, m);
    if (d > m.match_radius_m) continue;
    if (best === null || d < best.distance_m) best = { mountain: m, distance_m: d };
  }
  return best;
}

export interface SuggestPoint extends LatLng {
  taken_at?: string | null;
}

export interface MountainSuggestion {
  mountain_id: number;
  name: string;
  hit_count: number;
  min_distance_m: number;
  /** そのピークに最も近づいた写真の撮影時刻（summited_at の初期値に使う） */
  closest_at: string | null;
}

export interface SuggestResult {
  /** 最頻の山 = 主峰候補 */
  primary: MountainSuggestion | null;
  /** 主峰を含む全候補（ヒット数降順）。縦走では複数座がここに並ぶ */
  candidates: MountainSuggestion[];
}

/**
 * 写真群（coord_source = 'exif' のみを渡すこと）から登った山を推定する。
 * 自動確定はしない。あくまでユーザーに提示する「提案」。
 */
export function suggestMountains<M extends MountainLike>(
  points: readonly SuggestPoint[],
  mountains: readonly M[],
): SuggestResult {
  const acc = new Map<number, MountainSuggestion>();

  for (const p of points) {
    const hit = nearestMountain(p, mountains);
    if (!hit) continue;
    const prev = acc.get(hit.mountain.id);
    if (!prev) {
      acc.set(hit.mountain.id, {
        mountain_id: hit.mountain.id,
        name: hit.mountain.name,
        hit_count: 1,
        min_distance_m: hit.distance_m,
        closest_at: p.taken_at ?? null,
      });
    } else {
      prev.hit_count += 1;
      if (hit.distance_m < prev.min_distance_m) {
        prev.min_distance_m = hit.distance_m;
        prev.closest_at = p.taken_at ?? null;
      }
    }
  }

  const candidates = [...acc.values()].sort(
    (a, b) => b.hit_count - a.hit_count || a.min_distance_m - b.min_distance_m,
  );
  return { primary: candidates[0] ?? null, candidates };
}
