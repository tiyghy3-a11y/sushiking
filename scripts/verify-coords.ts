/**
 * seeds/hyakumeizan.csv の座標を国土地理院の標高タイル（DEM）で検証・補正する。
 *
 *   npm run verify:coords                  # 検証だけ。CSV は書き換えない
 *   npm run verify:coords -- --write       # 山頂に合わせて書き換え、verified=1 にする
 *   npm run verify:coords -- --only 54,55  # 特定の山だけ
 *   npm run verify:coords -- --radius 2500 --tolerance 40
 *
 * やっていること: 各山の現在座標のまわり（既定 1500m）の標高を DEM から読み、
 * 「CSV の標高値と一致する局所最高点」を探して、そこへ座標を寄せる。
 *
 * 地名検索API（scripts/fetch-coords.ts）を使わないのは、あちらが山頂ではなく
 * 地名の代表点を返すため。「富士山」で引くと山梨県鳴沢村の点（山頂から約10km）が
 * 候補の先頭に来る。標高を直接見るほうが確実に山頂へ寄る。
 *
 * 「範囲内の最高点」ではなく「標高が一致する局所最高点」を採るのは、隣接ピークへの
 * 誤吸着を避けるため（前穂高岳3090mの1500m圏内には奥穂高岳3190mがある）。
 *
 * 判定できなかった山は verified を触らずに一覧へ出す。/settings の百名山マスタ編集で
 * 地図のピンをドラッグして直すこと。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { toCsv, toRecords } from './lib/csv';
import {
  findSummit,
  makeElevationLookup,
  parseDemTile,
  tileKey,
  tilesForRadius,
  type TileRef,
} from './lib/dem';

const CSV_PATH = resolve(process.cwd(), 'seeds/hyakumeizan.csv');
const CACHE_DIR = resolve(process.cwd(), '.cache/dem');

/** DEM10B（10mメッシュ）。全国をほぼ覆う。z=14 で1セル約7.7m */
const DEM_SOURCE = { name: 'dem', zoom: 14 } as const;

const HEADER = [
  'id',
  'name',
  'name_kana',
  'elevation',
  'lat',
  'lng',
  'area',
  'prefectures',
  'match_radius_m',
  'peak_alias',
  'verified',
];

/** 補正距離がこれを超えたら、書き換えても目視確認を促す */
const LARGE_MOVE_M = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

const memCache = new Map<string, (number | null)[][] | null>();

/** タイルを1枚取る。ディスクにも残すので再実行が速い */
async function fetchTile(t: TileRef): Promise<(number | null)[][] | null> {
  const key = tileKey(t);
  const cached = memCache.get(key);
  if (cached !== undefined) return cached;

  const cachePath = resolve(CACHE_DIR, `${t.z}/${t.x}/${t.y}.txt`);
  try {
    const text = await readFile(cachePath, 'utf8');
    const grid = text === '' ? null : parseDemTile(text);
    memCache.set(key, grid);
    return grid;
  } catch {
    // キャッシュ無し。取りに行く
  }

  const url = `https://cyberjapandata.gsi.go.jp/xyz/${DEM_SOURCE.name}/${t.z}/${t.x}/${t.y}.txt`;
  let grid: (number | null)[][] | null = null;
  let body = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'yamalog-verify-coords' } });
      if (res.status === 404) {
        // 海上など、そもそもタイルが無い場所
        body = '';
        grid = null;
        break;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      body = await res.text();
      grid = parseDemTile(body);
      break;
    } catch (e) {
      if (attempt === 2) throw new Error(`タイル取得に失敗 ${url}: ${(e as Error).message}`);
      await sleep(500 * (attempt + 1));
    }
  }

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, body, 'utf8');
  memCache.set(key, grid);
  await sleep(120); // 地理院サーバへの負荷を抑える
  return grid;
}

interface Row {
  id: string;
  name: string;
  status: 'ok' | 'moved' | 'far' | 'unmatched' | 'skipped';
  message: string;
}

async function main() {
  const write = process.argv.includes('--write');
  const radius = Number(arg('radius', '1500'));
  const tolerance = Number(arg('tolerance', '25'));
  const only = arg('only', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const records = toRecords(await readFile(CSV_PATH, 'utf8'));
  const rows: Row[] = [];
  let changed = 0;

  console.log(
    `${records.length}件を検証します（探索半径 ${radius}m / 標高の許容差 ±${tolerance}m / ${DEM_SOURCE.name} z=${DEM_SOURCE.zoom}）`,
  );
  console.log(write ? 'モード: --write（CSVを書き換えます）\n' : 'モード: 検証のみ（--write で書き換え）\n');

  for (const rec of records) {
    if (only.length > 0 && !only.includes(rec.id)) continue;

    const lat = Number(rec.lat);
    const lng = Number(rec.lng);
    const elevation = Number(rec.elevation);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(elevation)) {
      rows.push({ id: rec.id, name: rec.name, status: 'skipped', message: '座標か標高が空' });
      continue;
    }

    const tiles = new Map<string, (number | null)[][]>();
    try {
      for (const t of tilesForRadius(lat, lng, DEM_SOURCE.zoom, radius)) {
        const grid = await fetchTile(t);
        if (grid) tiles.set(tileKey(t), grid);
      }
    } catch (e) {
      rows.push({ id: rec.id, name: rec.name, status: 'skipped', message: (e as Error).message });
      console.log(`  ! ${rec.id.padStart(3)} ${rec.name} → ${(e as Error).message}`);
      continue;
    }

    const res = findSummit(
      makeElevationLookup(tiles, DEM_SOURCE.zoom),
      { lat, lng },
      DEM_SOURCE.zoom,
      radius,
      elevation,
      tolerance,
    );

    if (!res.match) {
      const hint = res.highest
        ? `範囲内の最高点は ${res.highest.elevation.toFixed(0)}m（${res.highest.distance_m.toFixed(0)}m先）`
        : res.sampled === 0
          ? 'DEMにデータがありません'
          : '該当なし';
      rows.push({
        id: rec.id,
        name: rec.name,
        status: 'unmatched',
        message: `${elevation}m の山頂が見つからず。${hint}`,
      });
      console.log(`  × ${rec.id.padStart(3)} ${rec.name} → ${hint}`);
      continue;
    }

    const m = res.match;
    const status: Row['status'] =
      m.distance_m > LARGE_MOVE_M ? 'far' : m.distance_m > 30 ? 'moved' : 'ok';
    const message = `${m.distance_m.toFixed(0)}m 移動 / DEM標高 ${m.elevation.toFixed(0)}m（差 ${m.elevation_diff_m >= 0 ? '+' : ''}${m.elevation_diff_m.toFixed(0)}m）`;
    rows.push({ id: rec.id, name: rec.name, status, message });

    const mark = status === 'far' ? '⚠' : '✓';
    console.log(
      `  ${mark} ${rec.id.padStart(3)} ${rec.name} → ${m.lat.toFixed(6)},${m.lng.toFixed(6)}  ${message}`,
    );

    if (write) {
      rec.lat = m.lat.toFixed(6);
      rec.lng = m.lng.toFixed(6);
      rec.verified = '1';
      changed++;
    }
  }

  const count = (s: Row['status']) => rows.filter((r) => r.status === s).length;
  console.log('\n--- 集計 ---');
  console.log(`一致（30m以内）      : ${count('ok')}`);
  console.log(`一致（30m超の補正）  : ${count('moved')}`);
  console.log(`一致（${LARGE_MOVE_M}m超・要確認）: ${count('far')}`);
  console.log(`不一致（手動で確認） : ${count('unmatched')}`);
  console.log(`スキップ             : ${count('skipped')}`);

  const needsEyes = rows.filter((r) => r.status === 'far' || r.status === 'unmatched');
  if (needsEyes.length > 0) {
    console.log('\n--- 目視確認が必要 ---');
    for (const r of needsEyes) console.log(`  ${r.id.padStart(3)} ${r.name}: ${r.message}`);
    console.log('\n/settings の百名山マスタ編集で、地図のピンを山頂に合わせてください。');
  }

  if (!write) {
    console.log('\n--write を付けると CSV を書き換えます。');
    return;
  }

  await writeFile(CSV_PATH, toCsv(HEADER, records), 'utf8');
  console.log(`\n${CSV_PATH} を更新しました（${changed}件を verified=1 に）。`);
  console.log('D1 に反映するには npm run seed:local / npm run seed を実行してください。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
