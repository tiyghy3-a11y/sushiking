/**
 * 国土地理院の標高タイル（DEM）を読むための純粋関数。
 *
 * 地名検索API（fetch-coords.ts）は「山頂」ではなく地名の代表点を返すため、
 * 座標の確定には使えない（「富士山」の候補には山頂から約10km離れた
 * 山梨県鳴沢村の点が並ぶ）。こちらは標高そのものを見て山頂を特定する。
 *
 * タイルの中身は 256×256 の標高値をカンマ区切りにしたテキストで、
 * データが無いセルは `e` で表される。
 *   https://cyberjapandata.gsi.go.jp/xyz/dem/{z}/{x}/{y}.txt      DEM10B (z=14, 10mメッシュ)
 *   https://cyberjapandata.gsi.go.jp/xyz/dem5a/{z}/{x}/{y}.txt    DEM5A  (z=15, 5mメッシュ・範囲限定)
 *
 * ネットワークに触る処理は verify-coords.ts 側に置き、ここは計算だけにする
 * （テストが実データ無しで回るように）。
 */

export const TILE_SIZE = 256;

export interface GlobalPixel {
  /** ズーム z における世界全体のピクセル座標 */
  gx: number;
  gy: number;
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

/** ズーム z の世界全体の幅（ピクセル） */
export const worldSize = (z: number): number => TILE_SIZE * 2 ** z;

/** 緯度経度 → グローバルピクセル座標（Webメルカトル） */
export function lngLatToGlobalPixel(lat: number, lng: number, z: number): GlobalPixel {
  const size = worldSize(z);
  const phi = (lat * Math.PI) / 180;
  const gx = ((lng + 180) / 360) * size;
  const gy = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size;
  return { gx, gy };
}

/** グローバルピクセル座標 → 緯度経度（セル中心を見たいときは +0.5 して渡す） */
export function globalPixelToLngLat(gx: number, gy: number, z: number): { lat: number; lng: number } {
  const size = worldSize(z);
  const lng = (gx / size) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (gy / size);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/** そのズーム・緯度における1ピクセルの地上距離（m） */
export function metersPerPixel(lat: number, z: number): number {
  return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** 中心と半径（m）から、必要なタイルの範囲を出す */
export function tilesForRadius(lat: number, lng: number, z: number, radiusM: number): TileRef[] {
  const mpp = metersPerPixel(lat, z);
  const radiusPx = radiusM / mpp;
  const { gx, gy } = lngLatToGlobalPixel(lat, lng, z);
  const minX = Math.floor((gx - radiusPx) / TILE_SIZE);
  const maxX = Math.floor((gx + radiusPx) / TILE_SIZE);
  const minY = Math.floor((gy - radiusPx) / TILE_SIZE);
  const maxY = Math.floor((gy + radiusPx) / TILE_SIZE);
  const tiles: TileRef[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

export const tileKey = (t: TileRef): string => `${t.z}/${t.x}/${t.y}`;

/**
 * タイル本文（256行 × 256列のカンマ区切り）を数値の二次元配列にする。
 * `e`（データ無し）と欠損は null。
 *
 * 行数・列数が 256 に満たないタイルも返ってくることがあるので、
 * 呼び出し側は範囲外を null として扱えるようにしておくこと。
 */
export function parseDemTile(text: string): (number | null)[][] {
  return text
    .trim()
    .split('\n')
    .map((line) =>
      line.split(',').map((cell) => {
        const v = cell.trim();
        if (v === '' || v === 'e') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }),
    );
}

/** グローバルピクセル座標から標高を引く関数を組み立てる */
export function makeElevationLookup(
  tiles: Map<string, (number | null)[][]>,
  z: number,
): (gx: number, gy: number) => number | null {
  return (gx, gy) => {
    const tx = Math.floor(gx / TILE_SIZE);
    const ty = Math.floor(gy / TILE_SIZE);
    const grid = tiles.get(`${z}/${tx}/${ty}`);
    if (!grid) return null;
    const row = grid[gy - ty * TILE_SIZE];
    if (!row) return null;
    const v = row[gx - tx * TILE_SIZE];
    return v === undefined ? null : v;
  };
}

export interface SummitCandidate {
  lat: number;
  lng: number;
  elevation: number;
  /** 元の座標からの距離（m） */
  distance_m: number;
  /** 目標標高との差（m。正なら DEM のほうが高い） */
  elevation_diff_m: number;
}

export interface FindSummitResult {
  /** 標高が一致する局所最高点のうち、元の座標に最も近いもの */
  match: SummitCandidate | null;
  /** 検索範囲内の最高点（一致しなかったときの手がかり） */
  highest: SummitCandidate | null;
  /** 標高が取れたセルの数。0 ならタイルが空 */
  sampled: number;
}

/**
 * 中心の周囲から「目標標高に一致する局所最高点」を探す。
 *
 * 単純に範囲内の最高点を採ると、隣に高い峰があるときにそちらへ飛ぶ
 * （前穂高岳3090mの周囲1500mには奥穂高岳3190mがある）。
 * 目標標高との一致を条件に入れることで、隣接ピークへの誤吸着を避ける。
 *
 * @param elevAt      グローバルピクセル座標 → 標高
 * @param center      元の座標
 * @param z           ズーム
 * @param radiusM     探索半径（m）
 * @param targetElev  CSV が持っている山頂標高（m）
 * @param toleranceM  標高の許容差（m）
 */
export function findSummit(
  elevAt: (gx: number, gy: number) => number | null,
  center: { lat: number; lng: number },
  z: number,
  radiusM: number,
  targetElev: number,
  toleranceM: number,
): FindSummitResult {
  const mpp = metersPerPixel(center.lat, z);
  const radiusPx = Math.ceil(radiusM / mpp);
  const origin = lngLatToGlobalPixel(center.lat, center.lng, z);
  const cx = Math.floor(origin.gx);
  const cy = Math.floor(origin.gy);

  let sampled = 0;
  let match: SummitCandidate | null = null;
  let highest: SummitCandidate | null = null;

  const toCandidate = (gx: number, gy: number, elevation: number): SummitCandidate => {
    const p = globalPixelToLngLat(gx + 0.5, gy + 0.5, z);
    return {
      lat: p.lat,
      lng: p.lng,
      elevation,
      distance_m: haversine(center, p),
      elevation_diff_m: elevation - targetElev,
    };
  };

  for (let gy = cy - radiusPx; gy <= cy + radiusPx; gy++) {
    for (let gx = cx - radiusPx; gx <= cx + radiusPx; gx++) {
      const v = elevAt(gx, gy);
      if (v === null) continue;

      const p = globalPixelToLngLat(gx + 0.5, gy + 0.5, z);
      const d = haversine(center, p);
      if (d > radiusM) continue;
      sampled++;

      if (highest === null || v > highest.elevation) highest = toCandidate(gx, gy, v);

      if (Math.abs(v - targetElev) > toleranceM) continue;

      // 8近傍より低ければ山頂ではない（尾根の途中を拾わないための条件）
      let isLocalMax = true;
      for (let dy = -1; dy <= 1 && isLocalMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = elevAt(gx + dx, gy + dy);
          if (n !== null && n > v) {
            isLocalMax = false;
            break;
          }
        }
      }
      if (!isLocalMax) continue;

      const cand = toCandidate(gx, gy, v);
      if (
        match === null ||
        cand.distance_m < match.distance_m ||
        (cand.distance_m === match.distance_m &&
          Math.abs(cand.elevation_diff_m) < Math.abs(match.elevation_diff_m))
      ) {
        match = cand;
      }
    }
  }

  return { match, highest, sampled };
}

const EARTH_RADIUS_M = 6371008.8;

/** src/lib/geo.ts と同じ式（スクリプト側から Worker のコードを引かないため再掲） */
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
