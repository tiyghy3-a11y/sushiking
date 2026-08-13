/**
 * seeds/hyakumeizan.csv の lat / lng を国土地理院の地名検索APIで補完する。
 *
 *   npx tsx scripts/fetch-coords.ts            # 空欄のみ補完
 *   npx tsx scripts/fetch-coords.ts --force    # 既存値も上書き
 *   npx tsx scripts/fetch-coords.ts --dry-run  # 書き込まず結果だけ表示
 *
 * **座標の一括確定には scripts/verify-coords.ts のほうを使うこと。**
 * 地名検索は山頂ではなく地名の代表点を返す。「富士山」で引くと山梨県鳴沢村の点
 * （山頂から約10km）や各地の「小富士山」「富士山駅」まで並ぶので、候補の選び方を
 * 誤ると今の値より悪化する。ここでは完全一致 + 既存座標からの距離で絞っているが、
 * それでも代表点であることに変わりはない。
 *
 * こちらは座標が空の山を埋める用途。取得後は verify-coords.ts か
 * /settings の山マスタ編集画面で必ず確認し、verified を 1 にすること。
 * 北アルプス・南アルプスは match_radius_m が 1500m なので、ズレが誤判定に直結する。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { toCsv, toRecords } from './lib/csv';
import { pickBestFeature, type GsiFeature } from './lib/gsi-search';

const CSV_PATH = resolve(process.cwd(), 'seeds/hyakumeizan.csv');
const ENDPOINT = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Found {
  lat: number;
  lng: number;
  title: string;
  reason: string;
}

async function search(
  query: string,
  near: { lat: number; lng: number } | null,
): Promise<{ found: Found | null; reason: string }> {
  const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'yamalog-seed-script' },
  });
  if (!res.ok) throw new Error(`GSI search failed: ${res.status} ${res.statusText}`);
  const features = (await res.json()) as GsiFeature[];
  const picked = pickBestFeature(features, { query, near });
  if (!picked.best) return { found: null, reason: picked.reason };
  return {
    found: { lat: picked.best.lat, lng: picked.best.lng, title: picked.best.title, reason: picked.reason },
    reason: picked.reason,
  };
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

    // 既存座標があれば、同名の別地点を弾くための手がかりに使う
    const near =
      hasCoord && Number.isFinite(Number(rec.lat)) && Number.isFinite(Number(rec.lng))
        ? { lat: Number(rec.lat), lng: Number(rec.lng) }
        : null;

    // peak_alias（実際の最高峰名）があればそちらを優先して問い合わせる
    const queries = [rec.peak_alias, rec.name].filter((q): q is string => !!q && q.trim() !== '');
    let found: Found | null = null;
    let lastReason = '問い合わせていません';
    for (const q of queries) {
      try {
        const r = await search(q, near);
        lastReason = r.reason;
        found = r.found;
      } catch (e) {
        lastReason = (e as Error).message;
        console.error(`  ! ${rec.name}: ${lastReason}`);
      }
      if (found) break;
      await sleep(200);
    }

    if (found) {
      rec.lat = found.lat.toFixed(6);
      rec.lng = found.lng.toFixed(6);
      rec.verified = '0'; // 取得しただけ。山頂かどうかは未確認
      filled++;
      console.log(
        `  ✓ ${rec.id.padStart(3)} ${rec.name} → ${rec.lat},${rec.lng} (${found.title} / ${found.reason})`,
      );
    } else {
      missed++;
      console.log(`  × ${rec.id.padStart(3)} ${rec.name} → ${lastReason}`);
    }
    await sleep(300); // 地理院APIへの負荷を抑える
  }

  console.log(`\n補完: ${filled}件 / 失敗: ${missed}件 / 全${records.length}件`);
  if (dryRun) {
    console.log('--dry-run のため書き込みませんでした');
    return;
  }
  await writeFile(CSV_PATH, toCsv(header, records), 'utf8');
  console.log(`${CSV_PATH} を更新しました。`);
  console.log('地名検索の値は代表点です。npm run verify:coords で山頂に寄せてください。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
