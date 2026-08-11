import { describe, expect, it } from 'vitest';
import { haversineMeters, nearestMountain, suggestMountains, type MountainLike } from './geo';

const fuji: MountainLike = { id: 72, name: '富士山', lat: 35.3606, lng: 138.7274, match_radius_m: 3000 };
const yari: MountainLike = { id: 54, name: '槍ヶ岳', lat: 36.3419, lng: 137.6475, match_radius_m: 1500 };
const hotaka: MountainLike = { id: 55, name: '穂高岳', lat: 36.2892, lng: 137.6481, match_radius_m: 1500 };
const mountains = [fuji, yari, hotaka];

describe('haversineMeters', () => {
  it('同一点は0m', () => {
    expect(haversineMeters(fuji, { lat: fuji.lat, lng: fuji.lng })).toBe(0);
  });

  it('槍ヶ岳〜穂高岳は約5.9km', () => {
    const d = haversineMeters(yari, hotaka);
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(6300);
  });

  it('緯度1分は約1.85km', () => {
    const d = haversineMeters({ lat: 35, lng: 138 }, { lat: 35 + 1 / 60, lng: 138 });
    expect(d).toBeGreaterThan(1800);
    expect(d).toBeLessThan(1900);
  });
});

describe('nearestMountain', () => {
  it('半径内なら最も近い山を返す', () => {
    const hit = nearestMountain({ lat: 35.3612, lng: 138.7281 }, mountains);
    expect(hit?.mountain.id).toBe(72);
    expect(hit?.distance_m).toBeLessThan(200);
  });

  it('半径外なら null', () => {
    // 槍ヶ岳から約5.9km。match_radius_m は 1500 なので候補にならない
    expect(nearestMountain({ lat: yari.lat, lng: yari.lng }, [hotaka])).toBeNull();
  });

  it('隣接ピークが両方半径内なら近い方を選ぶ', () => {
    const mid = { lat: (yari.lat + hotaka.lat) / 2, lng: 137.648 };
    const wide = mountains.map((m) => ({ ...m, match_radius_m: 5000 }));
    const hit = nearestMountain({ ...mid, lat: mid.lat + 0.01 }, wide);
    expect(hit?.mountain.id).toBe(yari.id);
  });
});

describe('suggestMountains', () => {
  it('最頻の山が主峰候補、他は通過候補になる', () => {
    const points = [
      { lat: yari.lat, lng: yari.lng, taken_at: '2024-08-10T05:00:00.000Z' },
      { lat: yari.lat + 0.001, lng: yari.lng, taken_at: '2024-08-10T05:10:00.000Z' },
      { lat: yari.lat, lng: yari.lng + 0.001, taken_at: '2024-08-10T05:20:00.000Z' },
      { lat: hotaka.lat, lng: hotaka.lng, taken_at: '2024-08-11T02:00:00.000Z' },
      { lat: 0, lng: 0, taken_at: '2024-08-11T03:00:00.000Z' },
    ];
    const { primary, candidates } = suggestMountains(points, mountains);
    expect(primary?.mountain_id).toBe(yari.id);
    expect(primary?.hit_count).toBe(3);
    expect(candidates.map((c) => c.mountain_id)).toEqual([yari.id, hotaka.id]);
    expect(candidates[1].closest_at).toBe('2024-08-11T02:00:00.000Z');
  });

  it('候補ゼロなら primary は null', () => {
    expect(suggestMountains([{ lat: 0, lng: 0 }], mountains).primary).toBeNull();
  });
});
