import { describe, expect, it } from 'vitest';
import {
  findSummit,
  globalPixelToLngLat,
  lngLatToGlobalPixel,
  makeElevationLookup,
  metersPerPixel,
  parseDemTile,
  tilesForRadius,
} from './dem';

describe('タイル座標', () => {
  it('緯度経度とピクセル座標を往復できる', () => {
    const z = 14;
    const p = lngLatToGlobalPixel(35.360625, 138.727363, z);
    const back = globalPixelToLngLat(p.gx, p.gy, z);
    expect(back.lat).toBeCloseTo(35.360625, 6);
    expect(back.lng).toBeCloseTo(138.727363, 6);
  });

  it('富士山のDEMタイルは z=14 で 14505/6469', () => {
    const { gx, gy } = lngLatToGlobalPixel(35.360625, 138.727363, 14);
    expect(Math.floor(gx / 256)).toBe(14505);
    expect(Math.floor(gy / 256)).toBe(6469);
  });

  it('z=14・緯度36度なら1ピクセルは約7.7m', () => {
    const mpp = metersPerPixel(36, 14);
    expect(mpp).toBeGreaterThan(7.5);
    expect(mpp).toBeLessThan(8.0);
  });

  it('半径1500mなら2×2〜3×3枚に収まる', () => {
    const tiles = tilesForRadius(36.3419, 137.6475, 14, 1500);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.length).toBeLessThanOrEqual(9);
  });
});

describe('parseDemTile', () => {
  it('数値と e（データ無し）を読み分ける', () => {
    const grid = parseDemTile('1.5,e,3\n4,5,e\n');
    expect(grid).toEqual([
      [1.5, null, 3],
      [4, 5, null],
    ]);
  });

  it('負の標高も読める', () => {
    expect(parseDemTile('-4.2,0')).toEqual([[-4.2, 0]]);
  });
});

/**
 * 合成タイルでの山頂探索。
 * 中心付近に目標標高のピーク、少し離れた場所にもっと高いピークを置き、
 * 「範囲内の最高点」ではなく「標高が一致する局所最高点」を選ぶことを確かめる。
 */
describe('findSummit', () => {
  const z = 14;
  const center = { lat: 36.2892, lng: 137.6481 };
  const origin = lngLatToGlobalPixel(center.lat, center.lng, z);
  const cx = Math.floor(origin.gx);
  const cy = Math.floor(origin.gy);

  /** 2つの円錐を重ねた地形を返す（ピーク位置はセルのオフセットで指定） */
  const terrain =
    (peaks: { dx: number; dy: number; height: number }[]) =>
    (gx: number, gy: number): number | null => {
      let best = 0;
      for (const p of peaks) {
        const d = Math.hypot(gx - (cx + p.dx), gy - (cy + p.dy));
        best = Math.max(best, p.height - d * 2);
      }
      return best;
    };

  it('標高が一致する局所最高点を拾う', () => {
    const elevAt = terrain([{ dx: 6, dy: -4, height: 3090 }]);
    const res = findSummit(elevAt, center, z, 1500, 3090, 25);
    expect(res.match).not.toBeNull();
    expect(res.match!.elevation).toBe(3090);
    expect(res.match!.distance_m).toBeLessThan(100);
  });

  it('近くにより高い峰があっても、標高が一致するほうを選ぶ', () => {
    // 前穂高岳(3090m)を探すとき、範囲内の奥穂高岳(3190m)に吸着しない
    const elevAt = terrain([
      { dx: 5, dy: 5, height: 3090 },
      { dx: -60, dy: -40, height: 3190 },
    ]);
    const res = findSummit(elevAt, center, z, 1500, 3090, 25);
    expect(res.match!.elevation).toBe(3090);
    expect(res.highest!.elevation).toBe(3190);
    expect(res.match!.distance_m).toBeLessThan(res.highest!.distance_m);
  });

  it('許容差を超える山しか無ければ match は null（手動確認に回す）', () => {
    const elevAt = terrain([{ dx: 3, dy: 3, height: 2500 }]);
    const res = findSummit(elevAt, center, z, 1500, 3090, 25);
    expect(res.match).toBeNull();
    expect(res.highest!.elevation).toBe(2500);
  });

  it('探索範囲は円で切る（角のセルを拾わない）', () => {
    const elevAt = terrain([{ dx: 0, dy: 0, height: 3090 }]);
    const res = findSummit(elevAt, center, z, 300, 3090, 25);
    const mpp = metersPerPixel(center.lat, z);
    // 半径300m ≒ 39セル。対角の 39,39 セル（≒424m）は範囲外なので数えない
    expect(res.sampled).toBeLessThan((2 * Math.ceil(300 / mpp) + 1) ** 2);
    expect(res.sampled).toBeGreaterThan(0);
  });

  it('タイルが空なら何も返さない', () => {
    const res = findSummit(() => null, center, z, 1500, 3090, 25);
    expect(res.match).toBeNull();
    expect(res.highest).toBeNull();
    expect(res.sampled).toBe(0);
  });

  it('makeElevationLookup はタイル外を null にする', () => {
    const grid = Array.from({ length: 256 }, () => Array.from({ length: 256 }, () => 100));
    const tiles = new Map([[`${z}/${Math.floor(cx / 256)}/${Math.floor(cy / 256)}`, grid]]);
    const elevAt = makeElevationLookup(tiles, z);
    expect(elevAt(cx, cy)).toBe(100);
    expect(elevAt(cx + 100000, cy)).toBeNull();
  });
});
