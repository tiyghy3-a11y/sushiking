/**
 * 動作確認用のデモデータを投入する。実写真は使わず、合成画像に
 * それらしいEXIF相当のメタデータを付けて /api/photos/upload に流し込む。
 *
 *   npx tsx scripts/demo-seed.ts            # 投入
 *   npx tsx scripts/demo-seed.ts --reset    # デモを含む全山行・全写真を削除
 *   npx tsx scripts/demo-seed.ts --endpoint http://127.0.0.1:8787
 *
 * ローカルの D1 / R2（.wrangler/state 配下）にだけ入れる想定。
 * 本番エンドポイントに向けないこと。
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const endpointArg = process.argv.indexOf('--endpoint');
const ENDPOINT = (endpointArg >= 0 ? process.argv[endpointArg + 1] : 'http://127.0.0.1:8787').replace(
  /\/$/,
  '',
);
const RESET = process.argv.includes('--reset');

interface Mountain {
  id: number;
  name: string;
  lat: number;
  lng: number;
  elevation: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(ENDPOINT + path, {
    ...init,
    headers: init?.body instanceof FormData ? undefined : { 'content-type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** 山名と時刻から一意に決まる、それらしい合成画像を作る */
async function makePhoto(label: string, hue: number): Promise<Buffer> {
  const svg = `<svg width="960" height="720" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 55%, 72%)"/>
        <stop offset="55%" stop-color="hsl(${(hue + 20) % 360}, 45%, 52%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 40) % 360}, 35%, 28%)"/>
      </linearGradient>
    </defs>
    <rect width="960" height="720" fill="url(#g)"/>
    <polygon points="0,720 260,340 430,520 620,250 960,720" fill="rgba(0,0,0,0.28)"/>
    <text x="48" y="660" font-family="sans-serif" font-size="44" fill="rgba(255,255,255,0.9)">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

interface PhotoSpec {
  label: string;
  hue: number;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  altitude: number | null;
}

async function upload(spec: PhotoSpec, contributorId: string, batchId: string) {
  const buf = await makePhoto(spec.label, spec.hue);
  const hash = createHash('sha256').update(buf).digest('hex');
  const hasCoord = spec.lat != null && spec.lng != null;

  const form = new FormData();
  form.set(
    'meta',
    JSON.stringify({
      content_hash: hash,
      mime: 'image/jpeg',
      ext: 'jpg',
      byte_size: buf.length,
      width: 960,
      height: 720,
      taken_at_raw: spec.takenAt,
      time_source: spec.takenAt ? 'exif' : 'none',
      lat: spec.lat,
      lng: spec.lng,
      altitude: spec.altitude,
      coord_source: hasCoord ? 'exif' : 'none',
      camera_model: 'YamaLog Demo',
      contributor_id: contributorId,
      batch_id: batchId,
      time_offset_sec: 0,
    }),
  );
  const name = `${spec.label}.jpg`;
  form.set('original', new Blob([buf], { type: 'image/jpeg' }), name);
  form.set('display', new Blob([buf], { type: 'image/jpeg' }), `d-${name}`);
  form.set('thumb', new Blob([buf], { type: 'image/jpeg' }), `t-${name}`);

  const res = await api<{ photo_id: string; skipped: boolean }>('/api/photos/upload', {
    method: 'POST',
    body: form,
  });
  return res.photo_id;
}

/** 登山口から山頂へ登り、往路を戻るコースを合成する */
function buildRoute(
  summit: Mountain,
  opts: {
    startIso: string;
    hours: number;
    count: number;
    baseElevation: number;
    /** 座標を落とす写真のインデックス（EXIF欠損の再現） */
    dropCoordAt?: number[];
    labelPrefix: string;
    hue: number;
  },
): PhotoSpec[] {
  const start = new Date(opts.startIso).getTime();
  const stepMs = (opts.hours * 3600 * 1000) / (opts.count - 1);
  // 登山口は山頂の南西 3.5km 付近に置く
  const originLat = summit.lat - 0.028;
  const originLng = summit.lng - 0.022;

  return Array.from({ length: opts.count }, (_, i) => {
    const t = i / (opts.count - 1);
    // 0→1→0 の三角波（往復）
    const progress = t <= 0.55 ? t / 0.55 : (1 - t) / 0.45;
    const lat = originLat + (summit.lat - originLat) * progress;
    const lng = originLng + (summit.lng - originLng) * progress;
    const altitude =
      opts.baseElevation + (summit.elevation - opts.baseElevation) * progress + (i % 3) * 4 - 4;
    const drop = opts.dropCoordAt?.includes(i) ?? false;

    return {
      label: `${opts.labelPrefix}-${String(i + 1).padStart(2, '0')}`,
      hue: (opts.hue + i * 4) % 360,
      takenAt: new Date(start + stepMs * i).toISOString(),
      lat: drop ? null : Number(lat.toFixed(6)),
      lng: drop ? null : Number(lng.toFixed(6)),
      altitude: drop ? null : Math.round(altitude),
    };
  });
}

async function reset() {
  const { activities } = await api<{ activities: { id: string; title: string }[] }>(
    '/api/activities?limit=200',
  );
  for (const a of activities) {
    await api(`/api/activities/${a.id}`, { method: 'DELETE' });
    console.log(`  削除: 山行「${a.title}」`);
  }
  const { groups } = await api<{ groups: { photos: { id: string }[] }[] }>('/api/photos/unassigned');
  const ids = groups.flatMap((g) => g.photos.map((p) => p.id));
  for (const id of ids) await api(`/api/photos/${id}`, { method: 'DELETE' });
  console.log(`  削除: 写真 ${ids.length}枚（R2からも消えます）`);
  console.log('リセット完了');
}

async function main() {
  console.log(`エンドポイント: ${ENDPOINT}`);
  await api('/api/health'); // 起動確認（落ちていればここで止まる）

  if (RESET) {
    await reset();
    return;
  }

  const { mountains } = await api<{ mountains: Mountain[] }>('/api/mountains');
  const byName = (name: string) => {
    const m = mountains.find((x) => x.name === name);
    if (!m) throw new Error(`山マスタに「${name}」がありません。先に npm run seed:local を実行してください`);
    return m;
  };

  // 撮影者を2人（自分 + 同行者）。同行者は時計が5分進んでいる想定
  const { contributors } = await api<{ contributors: { id: string; name: string }[] }>(
    '/api/contributors',
  );
  const ensureContributor = async (name: string, isSelf: boolean, offset: number) => {
    const found = contributors.find((c) => c.name === name);
    if (found) return found.id;
    const r = await api<{ contributor: { id: string } }>('/api/contributors', {
      method: 'POST',
      body: JSON.stringify({ name, is_self: isSelf, default_time_offset_sec: offset }),
    });
    return r.contributor.id;
  };
  const meId = await ensureContributor('自分', true, 0);
  const friendId = await ensureContributor('同行者A', false, -300);

  const { batch } = await api<{ batch: { id: string } }>('/api/import-batches', {
    method: 'POST',
    body: JSON.stringify({ contributor_id: meId, time_offset_sec: 0 }),
  });

  const plans = [
    {
      title: '槍ヶ岳〜穂高岳 縦走',
      members: '自分・同行者A',
      note: '1日目は槍沢から。2日目に大キレット。行動食が足りなかったので次はもう少し多めに。',
      specs: [
        ...buildRoute(byName('槍ヶ岳'), {
          startIso: '2024-08-10T21:00:00.000Z', // JST 8/11 06:00
          hours: 7,
          count: 14,
          baseElevation: 1500,
          dropCoordAt: [4, 9], // EXIF座標が欠けた写真（補間の対象になる）
          labelPrefix: 'yari',
          hue: 205,
        }),
        ...buildRoute(byName('穂高岳'), {
          startIso: '2024-08-11T22:00:00.000Z', // JST 8/12 07:00
          hours: 6,
          count: 11,
          baseElevation: 2600,
          dropCoordAt: [7],
          labelPrefix: 'hotaka',
          hue: 25,
        }),
      ],
    },
    {
      title: '富士山 吉田ルート',
      members: '自分',
      note: '八合目で仮眠。ご来光は雲の上。',
      specs: buildRoute(byName('富士山'), {
        startIso: '2023-09-02T20:00:00.000Z',
        hours: 9,
        count: 12,
        baseElevation: 2300,
        dropCoordAt: [3],
        labelPrefix: 'fuji',
        hue: 280,
      }),
    },
    {
      title: '丹沢山 日帰り',
      members: '自分・同行者A',
      note: '大倉尾根。トレーニングのつもりが普通にきつい。',
      specs: buildRoute(byName('丹沢山'), {
        startIso: '2025-03-15T22:30:00.000Z',
        hours: 6,
        count: 9,
        baseElevation: 300,
        labelPrefix: 'tanzawa',
        hue: 130,
      }),
    },
  ];

  for (const plan of plans) {
    process.stdout.write(`\n${plan.title}: 写真を投入中`);
    const photoIds: string[] = [];
    for (const [i, spec] of plan.specs.entries()) {
      // 一部を同行者の撮影にして、撮影者バッジと時計オフセットを確認できるようにする
      photoIds.push(await upload(spec, i % 4 === 3 ? friendId : meId, batch.id));
      process.stdout.write('.');
    }

    // 山の自動判定を実際に叩いて、その提案をそのまま採用する
    const suggestion = await api<{
      primary: { mountain_id: number; name: string } | null;
      candidates: { mountain_id: number; name: string; closest_at: string | null }[];
    }>('/api/photos/suggest-mountains', {
      method: 'POST',
      body: JSON.stringify({ photo_ids: photoIds }),
    });

    const { activity } = await api<{ activity: { id: string } }>('/api/activities', {
      method: 'POST',
      body: JSON.stringify({
        title: plan.title,
        members: plan.members,
        note: plan.note,
        photo_ids: photoIds,
        mountains: suggestion.candidates.map((c) => ({
          mountain_id: c.mountain_id,
          is_primary: c.mountain_id === suggestion.primary?.mountain_id,
          summited_at: c.closest_at,
        })),
      }),
    });
    console.log(
      `\n  → ${photoIds.length}枚 / 判定: ${suggestion.candidates.map((c) => c.name).join('・') || 'なし'} / id=${activity.id}`,
    );
  }

  // 未分類トレイの動作確認用に、割り当てない写真を残す
  process.stdout.write('\n未分類トレイ用の写真を投入中');
  const daisen = byName('大山');
  const unassigned = buildRoute(daisen, {
    startIso: '2025-05-04T23:00:00.000Z',
    hours: 5,
    count: 6,
    baseElevation: 800,
    labelPrefix: 'daisen',
    hue: 340,
  });
  // 撮影時刻が取れなかった写真も1枚混ぜる（「日付不明」ブロックの確認用）
  unassigned.push({
    label: 'unknown-01',
    hue: 60,
    takenAt: null,
    lat: null,
    lng: null,
    altitude: null,
  });
  for (const spec of unassigned) {
    await upload(spec, meId, batch.id);
    process.stdout.write('.');
  }

  const progress = await api<{ climbed: number; total: number; photo_count: number }>('/api/progress');
  console.log(
    `\n\n完了: 百名山 ${progress.climbed}/${progress.total} 座、写真 ${progress.photo_count}枚。` +
      `\nブラウザで ${ENDPOINT} を開いてください。消すときは --reset を付けて再実行します。`,
  );
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  console.error('wrangler dev が起動しているか、マイグレーションとシードが済んでいるか確認してください。');
  process.exit(1);
});
