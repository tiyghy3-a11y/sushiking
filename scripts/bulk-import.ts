/**
 * 初回一括投入用CLIスクリプト。数千枚の過去写真はこれで入れる。
 *
 *   npx tsx scripts/bulk-import.ts <ディレクトリ> --contributor "自分" --offset 0
 *   npx tsx scripts/bulk-import.ts <ディレクトリ> --dry-run
 *
 * オプション:
 *   --contributor <name>  撮影者名（未登録なら作成する）
 *   --offset <sec>        カメラ時計のずれ補正（秒）
 *   --endpoint <url>      既定 http://127.0.0.1:8787
 *   --concurrency <n>     既定 3
 *   --dry-run             件数と EXIF 充足率だけ表示して終了
 *   --retry-failed        failed.json に記録された分だけ再実行
 *
 * EXIF抽出・HEIC変換・リサイズはここ（ローカルNode）で完結させ、
 * Worker には確定した値とバイナリだけを渡す。
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';

const TARGET_EXT = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.png']);
const DISPLAY_EDGE = 1600;
const THUMB_EDGE = 400;
const FAILED_PATH = resolve(process.cwd(), 'failed.json');

interface Args {
  dir: string;
  contributor: string | null;
  offset: number;
  endpoint: string;
  concurrency: number;
  dryRun: boolean;
  retryFailed: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const dir = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
  return {
    dir: resolve(process.cwd(), dir ?? '.'),
    contributor: flag('contributor'),
    offset: Number(flag('offset') ?? 0) || 0,
    endpoint: (flag('endpoint') ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
    concurrency: Math.max(1, Number(flag('concurrency') ?? 3) || 3),
    dryRun: argv.includes('--dry-run'),
    retryFailed: argv.includes('--retry-failed'),
  };
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (TARGET_EXT.has(extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

interface Extracted {
  path: string;
  hash: string;
  bytes: Buffer;
  mime: string;
  ext: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  taken_at_raw: string | null;
  time_source: 'exif' | 'file' | 'none';
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  coord_source: 'exif' | 'none';
  camera_model: string | null;
}

const isHeic = (ext: string) => ext === '.heic' || ext === '.heif';

async function extract(path: string): Promise<Extracted> {
  const bytes = await readFile(path);
  const ext = extname(path).toLowerCase();
  const fileStat = await stat(path);
  const hash = createHash('sha256').update(bytes).digest('hex');

  let exif: Record<string, unknown> = {};
  try {
    exif = ((await exifr.parse(bytes, { gps: true, tiff: true, exif: true })) ?? {}) as Record<string, unknown>;
  } catch {
    exif = {};
  }

  const takenExif = exif.DateTimeOriginal ?? exif.CreateDate ?? null;
  const takenIso =
    takenExif instanceof Date && Number.isFinite(takenExif.getTime()) ? takenExif.toISOString() : null;

  const lat = typeof exif.latitude === 'number' ? exif.latitude : null;
  const lng = typeof exif.longitude === 'number' ? exif.longitude : null;
  // GPSAltitudeRef が 1 なら海面下。exifr は GPSAltitude を素の値で返す
  let altitude = typeof exif.GPSAltitude === 'number' ? exif.GPSAltitude : null;
  if (altitude != null && Number(exif.GPSAltitudeRef) === 1) altitude = -altitude;

  const meta = await sharp(bytes).metadata();

  return {
    path,
    hash,
    bytes,
    mime: isHeic(ext) ? 'image/heic' : ext === '.png' ? 'image/png' : 'image/jpeg',
    ext: ext.replace('.', ''),
    byte_size: fileStat.size,
    width: meta.width ?? null,
    height: meta.height ?? null,
    taken_at_raw: takenIso ?? fileStat.mtime.toISOString(),
    time_source: takenIso ? 'exif' : 'file',
    lat,
    lng,
    altitude,
    coord_source: lat != null && lng != null ? 'exif' : 'none',
    camera_model: typeof exif.Model === 'string' ? exif.Model : null,
  };
}

const resize = (bytes: Buffer, edge: number) =>
  sharp(bytes)
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: edge === THUMB_EDGE ? 78 : 86 })
    .toBuffer();

async function api<T>(endpoint: string, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${endpoint}${path}`, init);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function resolveContributor(args: Args): Promise<string | null> {
  if (!args.contributor) return null;
  const { contributors } = await api<{ contributors: { id: string; name: string }[] }>(
    args.endpoint,
    '/api/contributors',
    { method: 'GET' },
  );
  const found = contributors.find((c) => c.name === args.contributor);
  if (found) return found.id;

  const { contributor } = await api<{ contributor: { id: string } }>(args.endpoint, '/api/contributors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: args.contributor, default_time_offset_sec: args.offset }),
  });
  console.log(`撮影者「${args.contributor}」を新規作成しました`);
  return contributor.id;
}

async function uploadOne(args: Args, item: Extracted, contributorId: string | null, batchId: string) {
  const [display, thumb] = await Promise.all([resize(item.bytes, DISPLAY_EDGE), resize(item.bytes, THUMB_EDGE)]);

  const form = new FormData();
  form.set(
    'meta',
    JSON.stringify({
      content_hash: item.hash,
      mime: item.mime,
      ext: item.ext,
      byte_size: item.byte_size,
      width: item.width,
      height: item.height,
      taken_at_raw: item.taken_at_raw,
      time_source: item.time_source,
      lat: item.lat,
      lng: item.lng,
      altitude: item.altitude,
      coord_source: item.coord_source,
      camera_model: item.camera_model,
      contributor_id: contributorId,
      batch_id: batchId,
      time_offset_sec: args.offset,
    }),
  );
  const name = basename(item.path);
  form.set('original', new Blob([item.bytes], { type: item.mime }), name);
  form.set('display', new Blob([display], { type: 'image/jpeg' }), `${name}.display.jpg`);
  form.set('thumb', new Blob([thumb], { type: 'image/jpeg' }), `${name}.thumb.jpg`);

  return api<{ skipped: boolean; photo_id: string }>(args.endpoint, '/api/photos/upload', {
    method: 'POST',
    body: form,
  });
}

/** 並列度を絞って順に流す。Workers のボディサイズ制限があるので1リクエスト1枚 */
async function pool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const args = parseArgs();

  let files: string[];
  if (args.retryFailed) {
    files = JSON.parse(await readFile(FAILED_PATH, 'utf8')) as string[];
    console.log(`failed.json から ${files.length} 件を再実行します`);
  } else {
    files = await walk(args.dir);
    console.log(`${args.dir} から ${files.length} 件見つけました`);
  }
  if (files.length === 0) return;

  const extracted: Extracted[] = [];
  const failed: string[] = [];
  await pool(files, args.concurrency, async (path) => {
    try {
      extracted.push(await extract(path));
    } catch (e) {
      failed.push(path);
      console.error(`  ! 読み込み失敗 ${path}: ${(e as Error).message}`);
    }
  });

  const withExifTime = extracted.filter((e) => e.time_source === 'exif').length;
  const withCoord = extracted.filter((e) => e.coord_source === 'exif').length;
  console.log(
    `EXIF充足率: 時刻 ${withExifTime}/${extracted.length}` +
      ` (${Math.round((withExifTime / Math.max(1, extracted.length)) * 100)}%)、` +
      `座標 ${withCoord}/${extracted.length}` +
      ` (${Math.round((withCoord / Math.max(1, extracted.length)) * 100)}%)`,
  );

  if (args.dryRun) {
    console.log('--dry-run のためアップロードしません');
    return;
  }

  // 既存 hash を除外
  const { existing } = await api<{ existing: string[] }>(args.endpoint, '/api/photos/check-hashes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hashes: extracted.map((e) => e.hash) }),
  });
  const existingSet = new Set(existing);
  const targets = extracted.filter((e) => !existingSet.has(e.hash));
  console.log(`取り込み対象 ${targets.length} 件 / 取り込み済みスキップ ${existingSet.size} 件`);
  if (targets.length === 0) return;

  const contributorId = await resolveContributor(args);
  const { batch } = await api<{ batch: { id: string } }>(args.endpoint, '/api/import-batches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contributor_id: contributorId, time_offset_sec: args.offset }),
  });

  let done = 0;
  let skipped = 0;
  await pool(targets, args.concurrency, async (item) => {
    try {
      const res = await uploadOne(args, item, contributorId, batch.id);
      if (res.skipped) skipped++;
      done++;
      if (done % 10 === 0 || done === targets.length) {
        process.stdout.write(`\r  アップロード ${done}/${targets.length}（重複スキップ ${skipped}）`);
      }
    } catch (e) {
      failed.push(item.path);
      console.error(`\n  ! アップロード失敗 ${item.path}: ${(e as Error).message}`);
    }
  });
  process.stdout.write('\n');

  console.log(`完了: 成功 ${done - skipped} 件 / 重複スキップ ${skipped} 件 / 失敗 ${failed.length} 件`);
  if (failed.length) {
    await writeFile(FAILED_PATH, JSON.stringify(failed, null, 2), 'utf8');
    console.log(`失敗分を ${FAILED_PATH} に書き出しました（--retry-failed で再実行できます）`);
  }
  console.log('取り込んだ写真は未分類トレイ（/inbox）に入っています。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
