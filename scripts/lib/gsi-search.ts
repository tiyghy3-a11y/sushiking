/**
 * 国土地理院の地名検索API（AddressSearch）の結果から、目的の山を選ぶ。
 *
 * このAPIは「山頂」を返してくれるわけではなく、地名の代表点を単純な部分一致で
 * 並べて返す。「富士山」で引くと、山梨県鳴沢村の代表点（山頂から約10km）、
 * 長野県上田市の同名地、各地の「小富士山」、富士山駅や富士山郵便局まで混ざる。
 * 先頭の候補をそのまま採ると山頂から大きく外れる。
 *
 * そこで以下で絞る。
 *   1. 名前が完全一致するものだけを候補にする（「小富士山」を弾く）
 *   2. すでに座標があるなら、そこから離れすぎている候補を捨てる
 *   3. 残った中で最も近いものを採る
 *
 * それでも山頂ではなく代表点であることに変わりはないので、座標の確定には
 * 標高データを見る verify-coords.ts のほうを使うこと。ここは空欄を埋める用途。
 */

export interface GsiFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { title?: string; addressCode?: string; dataSource?: string };
}

export interface Candidate {
  lat: number;
  lng: number;
  title: string;
  distance_m: number | null;
}

export interface PickOptions {
  /** 問い合わせた名前（例: 富士山 / 雌阿寒岳） */
  query: string;
  /** すでに分かっている座標。あれば距離で絞り込む */
  near?: { lat: number; lng: number } | null;
  /** near からこれ以上離れた候補は捨てる（m） */
  maxDistanceM?: number;
}

export interface PickResult {
  best: Candidate | null;
  /** 完全一致した候補（best の判断根拠を見るため） */
  candidates: Candidate[];
  reason: string;
}

const EARTH_RADIUS_M = 6371008.8;

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 全角・旧字のゆれを吸収する（冨士山 → 富士山、駒ケ岳/駒ヶ岳 の混在など）。
 *
 * 大文字の「カ」は畳み込まない。「ヶ/ケ/ヵ」は同じ助詞の表記ゆれだが、カ は
 * 語の一部として使われるため、畳み込むと別名を同一視して誤った地点を拾いうる。
 * 取り違えるより「見つからず」で手動確認に回すほうが安全。
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/冨/g, '富')
    .replace(/嶽/g, '岳')
    .replace(/[ヶヵケ]/g, 'ヶ')
    .replace(/\s+/g, '');
}

export function pickBestFeature(features: GsiFeature[], options: PickOptions): PickResult {
  const { query, near = null, maxDistanceM = 30_000 } = options;
  const wanted = normalizeName(query);

  const candidates: Candidate[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const title = f.properties?.title ?? '';
    if (normalizeName(title) !== wanted) continue; // 部分一致は採らない
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    candidates.push({
      lat,
      lng,
      title,
      distance_m: near ? haversine(near, { lat, lng }) : null,
    });
  }

  if (candidates.length === 0) {
    return { best: null, candidates, reason: `「${query}」に完全一致する地名がありません` };
  }

  if (!near) {
    if (candidates.length > 1) {
      return {
        best: null,
        candidates,
        reason: `「${query}」が${candidates.length}件あり、既存座標が無いので絞れません`,
      };
    }
    return { best: candidates[0], candidates, reason: '完全一致1件' };
  }

  const inRange = candidates.filter((c) => (c.distance_m ?? Infinity) <= maxDistanceM);
  if (inRange.length === 0) {
    const nearest = Math.min(...candidates.map((c) => c.distance_m ?? Infinity));
    return {
      best: null,
      candidates,
      reason: `完全一致${candidates.length}件はどれも既存座標から遠い（最短 ${(nearest / 1000).toFixed(1)}km）`,
    };
  }

  inRange.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
  return {
    best: inRange[0],
    candidates,
    reason: `完全一致${candidates.length}件のうち既存座標に最も近いもの（${(inRange[0].distance_m ?? 0).toFixed(0)}m）`,
  };
}
