/**
 * 山行統計。入力は必ず coord_source = 'exif' の写真だけに絞ること。
 * interpolated を混ぜると距離・累積標高が汚れる。
 */
import { haversineMeters } from './geo';

export interface StatPoint {
  taken_at: string;
  lat: number;
  lng: number;
  altitude?: number | null;
}

export interface PaceSegment {
  from_at: string;
  to_at: string;
  distance_m: number;
  duration_sec: number;
  /** m/h。時間差0の場合は null */
  pace_m_per_h: number | null;
}

export interface ElevationSample {
  at: string;
  /** 移動中央値（window=5）で平滑化した後の標高 */
  elevation_m: number;
  raw_elevation_m: number;
}

export interface ActivityStats {
  /** 統計の元になった写真枚数（exif 座標を持つもの） */
  sample_count: number;
  start_at: string | null;
  end_at: string | null;
  duration_sec: number;
  distance_m: number;
  elevation_gain_m: number;
  max_elevation_m: number | null;
  /** m/h */
  avg_pace_m_per_h: number | null;
  segments: PaceSegment[];
  elevation_profile: ElevationSample[];
}

/** 累積標高に加算する最小上昇量（GPS ノイズの切り捨て） */
export const ELEVATION_GAIN_THRESHOLD_M = 10;
/** 標高平滑化の窓幅 */
export const ELEVATION_SMOOTHING_WINDOW = 5;

/** 移動中央値。端は窓を切り詰めて計算する */
export function movingMedian(values: readonly number[], window = ELEVATION_SMOOTHING_WINDOW): number[] {
  if (values.length === 0) return [];
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
    const sorted = [...slice].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  });
}

export const emptyStats = (): ActivityStats => ({
  sample_count: 0,
  start_at: null,
  end_at: null,
  duration_sec: 0,
  distance_m: 0,
  elevation_gain_m: 0,
  max_elevation_m: null,
  avg_pace_m_per_h: null,
  segments: [],
  elevation_profile: [],
});

/**
 * GPS標高は誤差±20m程度あり、写真は連続的に撮るものではないため、
 * ここで出る値は実際より小さく出る傾向がある。UI 側で必ず「推定値」と注記すること。
 */
export function computeStats(points: readonly StatPoint[]): ActivityStats {
  const pts = [...points]
    .filter((p) => Number.isFinite(new Date(p.taken_at).getTime()))
    .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());

  if (pts.length === 0) return emptyStats();

  const start = pts[0].taken_at;
  const end = pts[pts.length - 1].taken_at;
  const durationSec = Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 1000,
  );

  let distance = 0;
  const segments: PaceSegment[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = haversineMeters(a, b);
    const dt = (new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime()) / 1000;
    distance += d;
    segments.push({
      from_at: a.taken_at,
      to_at: b.taken_at,
      distance_m: d,
      duration_sec: dt,
      pace_m_per_h: dt > 0 ? (d / dt) * 3600 : null,
    });
  }

  // 標高は値を持つ点だけで平滑化する
  const elevPts = pts.filter((p): p is StatPoint & { altitude: number } => p.altitude != null);
  const smoothed = movingMedian(elevPts.map((p) => p.altitude));
  const profile: ElevationSample[] = elevPts.map((p, i) => ({
    at: p.taken_at,
    elevation_m: smoothed[i],
    raw_elevation_m: p.altitude,
  }));

  let gain = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const diff = smoothed[i] - smoothed[i - 1];
    if (diff >= ELEVATION_GAIN_THRESHOLD_M) gain += diff;
  }

  return {
    sample_count: pts.length,
    start_at: start,
    end_at: end,
    duration_sec: durationSec,
    distance_m: distance,
    elevation_gain_m: gain,
    max_elevation_m: smoothed.length ? Math.max(...smoothed) : null,
    avg_pace_m_per_h: durationSec > 0 ? (distance / durationSec) * 3600 : null,
    segments,
    elevation_profile: profile,
  };
}
