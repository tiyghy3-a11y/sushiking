import { describe, expect, it } from 'vitest';
import { interpolateCoords, type PhotoCoordInput } from './interpolate';

const exif = (id: string, at: string, lat: number, lng: number, altitude: number | null = null): PhotoCoordInput => ({
  id,
  taken_at: at,
  lat,
  lng,
  altitude,
  coord_source: 'exif',
});

const bare = (id: string, at: string | null): PhotoCoordInput => ({
  id,
  taken_at: at,
  lat: null,
  lng: null,
  altitude: null,
  coord_source: 'none',
});

describe('interpolateCoords', () => {
  it('前後2点の中点を線形補間する', () => {
    const out = interpolateCoords([
      exif('a', '2024-08-10T00:00:00.000Z', 35.0, 138.0, 1000),
      bare('x', '2024-08-10T00:30:00.000Z'),
      exif('b', '2024-08-10T01:00:00.000Z', 35.2, 138.4, 1400),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('x');
    expect(out[0].lat).toBeCloseTo(35.1, 6);
    expect(out[0].lng).toBeCloseTo(138.2, 6);
    expect(out[0].altitude).toBeCloseTo(1200, 6);
  });

  it('前後2点の間隔が2時間を超える場合は補間しない', () => {
    const out = interpolateCoords([
      exif('a', '2024-08-10T00:00:00.000Z', 35.0, 138.0),
      bare('x', '2024-08-10T01:00:00.000Z'),
      exif('b', '2024-08-10T02:00:00.001Z', 35.2, 138.4),
    ]);
    expect(out).toHaveLength(0);
  });

  it('系列の範囲外でも30分以内なら最近傍の座標をコピーする', () => {
    const out = interpolateCoords([
      bare('before', '2024-08-09T23:40:00.000Z'),
      exif('a', '2024-08-10T00:00:00.000Z', 35.0, 138.0, 900),
      exif('b', '2024-08-10T01:00:00.000Z', 35.2, 138.4),
      bare('after', '2024-08-10T02:00:00.000Z'),
    ]);
    expect(out.map((o) => o.id)).toEqual(['before']);
    expect(out[0].lat).toBe(35.0);
    expect(out[0].altitude).toBe(900);
  });

  it('manual / exif の座標は上書きしない', () => {
    const out = interpolateCoords([
      exif('a', '2024-08-10T00:00:00.000Z', 35.0, 138.0),
      { id: 'm', taken_at: '2024-08-10T00:30:00.000Z', lat: null, lng: null, coord_source: 'manual' },
      exif('b', '2024-08-10T01:00:00.000Z', 35.2, 138.4),
    ]);
    expect(out).toHaveLength(0);
  });

  it('時刻がない写真、アンカーがない場合は何もしない', () => {
    expect(interpolateCoords([bare('x', null), exif('a', '2024-08-10T00:00:00.000Z', 35, 138)])).toHaveLength(0);
    expect(interpolateCoords([bare('x', '2024-08-10T00:00:00.000Z')])).toHaveLength(0);
  });

  it('片側だけ標高がない場合、標高は null のままにする', () => {
    const out = interpolateCoords([
      exif('a', '2024-08-10T00:00:00.000Z', 35.0, 138.0, 1000),
      bare('x', '2024-08-10T00:30:00.000Z'),
      exif('b', '2024-08-10T01:00:00.000Z', 35.2, 138.4, null),
    ]);
    expect(out[0].altitude).toBeNull();
  });
});
