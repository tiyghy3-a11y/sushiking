import { describe, expect, it } from 'vitest';
import { computeStats, movingMedian, type StatPoint } from './stats';

describe('movingMedian', () => {
  it('スパイクを吸収する', () => {
    expect(movingMedian([100, 100, 500, 100, 100], 5)).toEqual([100, 100, 100, 100, 100]);
  });

  it('空配列は空配列', () => {
    expect(movingMedian([])).toEqual([]);
  });

  it('偶数個の窓では中央2値の平均', () => {
    expect(movingMedian([10, 20], 5)).toEqual([15, 15]);
  });
});

describe('computeStats', () => {
  const pts: StatPoint[] = [
    { taken_at: '2024-08-10T00:00:00.000Z', lat: 35.0, lng: 138.0, altitude: 1000 },
    { taken_at: '2024-08-10T01:00:00.000Z', lat: 35.01, lng: 138.0, altitude: 1100 },
    { taken_at: '2024-08-10T02:00:00.000Z', lat: 35.02, lng: 138.0, altitude: 1105 },
    { taken_at: '2024-08-10T03:00:00.000Z', lat: 35.03, lng: 138.0, altitude: 1300 },
  ];

  it('行動時間・距離・区間ペースを算出する', () => {
    const s = computeStats(pts);
    expect(s.sample_count).toBe(4);
    expect(s.duration_sec).toBe(3 * 3600);
    expect(s.distance_m).toBeGreaterThan(3000);
    expect(s.distance_m).toBeLessThan(3500);
    expect(s.segments).toHaveLength(3);
    expect(s.avg_pace_m_per_h).toBeCloseTo(s.distance_m / 3, 5);
  });

  it('入力順が乱れていても時刻昇順で計算する', () => {
    const shuffled = [pts[2], pts[0], pts[3], pts[1]];
    expect(computeStats(shuffled).start_at).toBe(pts[0].taken_at);
    expect(computeStats(shuffled).end_at).toBe(pts[3].taken_at);
  });

  it('+10m未満の上昇は累積標高に加算しない', () => {
    const flat: StatPoint[] = [0, 1, 2, 3, 4].map((i) => ({
      taken_at: `2024-08-10T0${i}:00:00.000Z`,
      lat: 35,
      lng: 138,
      altitude: 1000 + i * 5, // 毎回 +5m
    }));
    expect(computeStats(flat).elevation_gain_m).toBe(0);
  });

  it('標高がない写真があっても落ちない', () => {
    const s = computeStats([
      { taken_at: '2024-08-10T00:00:00.000Z', lat: 35, lng: 138 },
      { taken_at: '2024-08-10T01:00:00.000Z', lat: 35.01, lng: 138, altitude: 1200 },
    ]);
    expect(s.elevation_profile).toHaveLength(1);
    expect(s.max_elevation_m).toBe(1200);
  });

  it('空入力ではゼロ値を返す', () => {
    const s = computeStats([]);
    expect(s.sample_count).toBe(0);
    expect(s.max_elevation_m).toBeNull();
    expect(s.avg_pace_m_per_h).toBeNull();
  });
});
