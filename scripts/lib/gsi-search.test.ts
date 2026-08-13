import { describe, expect, it } from 'vitest';
import { normalizeName, pickBestFeature, type GsiFeature } from './gsi-search';

/**
 * 実際に AddressSearch?q=富士山 が返す並びから抜粋。
 * 先頭は山頂ではなく鳴沢村の代表点で、山頂から約10km離れている。
 */
const fujiResponse: GsiFeature[] = [
  { geometry: { coordinates: [138.738098, 35.452374] }, properties: { title: '山梨県鳴沢村富士山' } },
  { geometry: { coordinates: [138.238495, 36.341774] }, properties: { title: '長野県上田市富士山' } },
  { geometry: { coordinates: [138.150147, 36.313459] }, properties: { title: '富士山' } },
  { geometry: { coordinates: [134.718492, 34.806868] }, properties: { title: '小富士山' } },
  { geometry: { coordinates: [139.313115, 35.910757] }, properties: { title: '富士山' } },
  { geometry: { coordinates: [138.730781, 35.362799] }, properties: { title: '富士山' } },
  { geometry: { coordinates: [132.560547, 33.508924] }, properties: { title: '冨士山' } },
  { geometry: { coordinates: [138.794885, 35.483542] }, properties: { title: '富士山駅' } },
  { geometry: { coordinates: [138.730998, 35.359807] }, properties: { title: '富士山頂郵便局' } },
];

describe('normalizeName', () => {
  it('旧字と表記ゆれを吸収する', () => {
    expect(normalizeName('冨士山')).toBe('富士山');
    expect(normalizeName('鳳凰嶽')).toBe('鳳凰岳');
    expect(normalizeName('槍ケ岳')).toBe(normalizeName('槍ヶ岳'));
  });

  it('大文字のカは畳み込まない（別名を同一視しないため）', () => {
    expect(normalizeName('赤カ岳')).not.toBe(normalizeName('赤ヶ岳'));
  });
});

describe('pickBestFeature', () => {
  it('既存座標に近い完全一致を選ぶ（先頭の候補には引きずられない）', () => {
    const res = pickBestFeature(fujiResponse, {
      query: '富士山',
      near: { lat: 35.3606, lng: 138.7274 },
    });
    expect(res.best).not.toBeNull();
    expect(res.best!.lat).toBeCloseTo(35.362799, 5);
    expect(res.best!.lng).toBeCloseTo(138.730781, 5);
    expect(res.best!.distance_m!).toBeLessThan(500);
  });

  it('「小富士山」や「富士山駅」は候補に入れない', () => {
    const res = pickBestFeature(fujiResponse, {
      query: '富士山',
      near: { lat: 35.3606, lng: 138.7274 },
    });
    for (const c of res.candidates) {
      expect(['富士山', '冨士山']).toContain(c.title);
    }
  });

  it('既存座標が無く同名が複数あるときは決めない', () => {
    const res = pickBestFeature(fujiResponse, { query: '富士山', near: null });
    expect(res.best).toBeNull();
    expect(res.reason).toContain('絞れません');
  });

  it('完全一致が1件だけなら既存座標が無くても採る', () => {
    const only: GsiFeature[] = [
      { geometry: { coordinates: [137.6475, 36.3419] }, properties: { title: '槍ヶ岳' } },
      { geometry: { coordinates: [137.65, 36.35] }, properties: { title: '槍ヶ岳山荘' } },
    ];
    const res = pickBestFeature(only, { query: '槍ヶ岳', near: null });
    expect(res.best!.lat).toBeCloseTo(36.3419, 4);
  });

  it('どの完全一致も遠ければ採らない', () => {
    const res = pickBestFeature(fujiResponse, {
      query: '富士山',
      near: { lat: 43.0, lng: 141.0 },
      maxDistanceM: 30_000,
    });
    expect(res.best).toBeNull();
    expect(res.reason).toContain('遠い');
  });

  it('完全一致が無ければ null', () => {
    const res = pickBestFeature(fujiResponse, { query: '雌阿寒岳', near: null });
    expect(res.best).toBeNull();
    expect(res.candidates).toHaveLength(0);
  });
});
