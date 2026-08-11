/**
 * seeds/hyakumeizan.csv の lat / lng を国土地理院の地名検索APIで補完する。
 *
 *   npx tsx scripts/fetch-coords.ts            # 空欄のみ補完
 *   npx tsx scripts/fetch-coords.ts --force    # 既存値も上書き
 *   npx tsx scripts/fetch-coords.ts --dry-run  # 書き込まず結果だけ表示
 *
 * 注意: 地名検索は山頂ではなく代表点を返す場合があり、数百m〜1kmずれることがある。
 * 取得後は必ず /settings の山マスタ編集画面で目視確認し、verified を 1 にすること。
 * 北アルプス・南アルプスは match_radius_m が 1500m なので、このズレが誤判定に直結する。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { toCsv, toRecords } from './lib/csv';

const CSV_PATH = resolve(process.cwd(), 'seeds/hyakumeizan.csv');
const ENDPOINT = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

interface GsiFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { title?: string; addressCode?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function search(query: string): Promise<{ lat: number; lng: number; title: string } | null> {
  const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'yamalog-seed-script' },
  });
  if (!res.ok) throw new Error(`GSI search failed: ${res.status} ${res.statusText}`);
  const features = (await res.json()) as GsiFeature[];
  const hit = features.find((f) => Array.isArray(f.geometry?.coordinates));
  if (!hit?.geometry?.coordinates) return null;
  const [lng, lat] = hit.geometry.coordinates;
  return { lat, lng, title: hit.properties?.title ?? query };
}

async function main() {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');

  const records = toRecords(await readFile(CSV_PATH, 'utf8'));
  const header = [
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

  let filled = 0;
  let missed = 0;

  for (const rec of records) {
    const hasCoord = rec.lat.trim() !== '' && rec.lng.trim() !== '';
    if (hasCoord && !force) continue;

    // peak_alias（実際の最高峰名）があればそちらを優先して問い合わせる
    const queries = [rec.peak_alias, rec.name].filter((q): q is string => !!q && q.trim() !== '');
    let found: { lat: number; lng: number; title: string } | null = null;
    for (const q of queries) {
      try {
        found = await search(q);
      } catch (e) {
        console.error(`  ! ${rec.name}: ${(e as Error).message}`);
      }
      if (found) break;
      await sleep(200);
    }

    if (found) {
      rec.lat = found.lat.toFixed(6);
      rec.lng = found.lng.toFixed(6);
      rec.verified = '0'; // 取得しただけ。目視確認はこれから
      filled++;
      console.log(`  ✓ ${rec.id.padStart(3)} ${rec.name} → ${rec.lat},${rec.lng} (${found.title})`);
    } else {
      missed++;
      console.log(`  × ${rec.id.padStart(3)} ${rec.name} → 見つからず。手動で入力してください`);
    }
    await sleep(300); // 地理院APIへの負荷を抑える
  }

  console.log(`\n補完: ${filled}件 / 失敗: ${missed}件 / 全${records.length}件`);
  if (dryRun) {
    console.log('--dry-run のため書き込みませんでした');
    return;
  }
  await writeFile(CSV_PATH, toCsv(header, records), 'utf8');
  console.log(`${CSV_PATH} を更新しました。座標は必ず地理院地図で目視確認してください。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
