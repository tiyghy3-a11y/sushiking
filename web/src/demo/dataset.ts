/**
 * Artifact（単一HTML）で配るデモ用のデータセット。
 *
 * 写真は外部リソースを一切使えないので、山のシルエットを描いたSVGを
 * data URI にして「写真」として使う。scripts/demo-seed.ts と同じコース生成を
 * ブラウザ内で行うため、補間や統計の挙動は本番と同じロジックを通る。
 */
import type { Activity, Contributor, Mountain, Photo } from '../lib/types';
import mountainsJson from './mountains.json';

export const demoMountains = mountainsJson as Mountain[];

const byName = (name: string): Mountain => {
  const m = demoMountains.find((x) => x.name === name);
  if (!m) throw new Error(`demo: mountain not found: ${name}`);
  return m;
};

/** 写真の代わりに使う軽量SVG。data URI にしても1枚1KB未満 */
function photoSvg(hue: number, label: string, width: number): string {
  const height = Math.round((width * 3) / 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 960 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="hsl(${hue},55%,72%)"/><stop offset="55%" stop-color="hsl(${(hue + 20) % 360},45%,52%)"/>
<stop offset="100%" stop-color="hsl(${(hue + 40) % 360},35%,28%)"/></linearGradient></defs>
<rect width="960" height="720" fill="url(#g)"/>
<circle cx="770" cy="130" r="52" fill="rgba(255,255,255,0.35)"/>
<polygon points="0,720 260,330 430,520 620,240 960,720" fill="rgba(0,0,0,0.3)"/>
<polygon points="330,720 620,240 780,430 960,300 960,720" fill="rgba(0,0,0,0.16)"/>
<text x="40" y="676" font-family="sans-serif" font-size="40" fill="rgba(255,255,255,0.85)">${label}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface DemoImage {
  thumb: string;
  display: string;
}

/** photo_id → 画像の data URI。api.ts の thumbUrl / displayUrl がここを見る */
export const demoImages: Record<string, DemoImage> = {};

let photoSeq = 0;
const nextId = (prefix: string) => `${prefix}-${String(++photoSeq).padStart(3, '0')}`;

interface RouteOptions {
  startIso: string;
  hours: number;
  count: number;
  baseElevation: number;
  dropCoordAt?: number[];
  labelPrefix: string;
  hue: number;
  contributorRotation: string[];
}

function buildRoutePhotos(summit: Mountain, opts: RouteOptions): Photo[] {
  const start = new Date(opts.startIso).getTime();
  const stepMs = (opts.hours * 3600 * 1000) / (opts.count - 1);
  const originLat = summit.lat - 0.028;
  const originLng = summit.lng - 0.022;

  return Array.from({ length: opts.count }, (_, i) => {
    const t = i / (opts.count - 1);
    const progress = t <= 0.55 ? t / 0.55 : (1 - t) / 0.45;
    const lat = originLat + (summit.lat - originLat) * progress;
    const lng = originLng + (summit.lng - originLng) * progress;
    const altitude =
      opts.baseElevation + (summit.elevation - opts.baseElevation) * progress + (i % 3) * 4 - 4;
    const drop = opts.dropCoordAt?.includes(i) ?? false;
    const id = nextId(opts.labelPrefix);
    const label = `${opts.labelPrefix}-${String(i + 1).padStart(2, '0')}`;
    const hue = (opts.hue + i * 4) % 360;
    demoImages[id] = { thumb: photoSvg(hue, label, 400), display: photoSvg(hue, label, 1200) };

    const takenAt = new Date(start + stepMs * i).toISOString();
    return {
      id,
      activity_id: null,
      contributor_id: opts.contributorRotation[i % opts.contributorRotation.length],
      taken_at: takenAt,
      taken_at_raw: takenAt,
      time_source: 'exif',
      lat: drop ? null : Number(lat.toFixed(6)),
      lng: drop ? null : Number(lng.toFixed(6)),
      altitude: drop ? null : Math.round(altitude),
      coord_source: drop ? 'none' : 'exif',
      width: 960,
      height: 720,
      mime: 'image/jpeg',
      byte_size: 2_400_000,
      content_hash: id,
      camera_model: 'YamaLog Demo',
      caption: null,
      is_favorite: 0,
      created_at: takenAt,
    } satisfies Photo;
  });
}

export interface DemoStore {
  mountains: Mountain[];
  contributors: Contributor[];
  activities: Activity[];
  activityMountains: { activity_id: string; mountain_id: number; is_primary: number; summited_at: string | null }[];
  photos: Photo[];
}

export function buildDemoStore(): DemoStore {
  const me: Contributor = {
    id: 'contrib-self',
    name: '自分',
    is_self: 1,
    default_time_offset_sec: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    photo_count: 0,
  };
  const friend: Contributor = {
    id: 'contrib-friend',
    name: '同行者A',
    is_self: 0,
    default_time_offset_sec: -300,
    created_at: '2024-01-01T00:00:00.000Z',
    photo_count: 0,
  };
  const rotation = [me.id, me.id, me.id, friend.id];

  const photos: Photo[] = [];
  const activities: Activity[] = [];
  const activityMountains: DemoStore['activityMountains'] = [];

  const addActivity = (
    id: string,
    title: string,
    members: string,
    note: string,
    routePhotos: Photo[],
    links: { mountain_id: number; is_primary: boolean }[],
  ) => {
    const times = routePhotos.map((p) => p.taken_at).filter((t): t is string => !!t).sort();
    const dateOf = (iso: string) =>
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(iso));
    activities.push({
      id,
      title,
      start_date: dateOf(times[0]),
      end_date: dateOf(times[times.length - 1]),
      note,
      members,
      cover_photo_id: routePhotos[Math.floor(routePhotos.length / 2)].id,
      created_at: times[0],
      updated_at: times[0],
    });
    for (const l of links) {
      activityMountains.push({
        activity_id: id,
        mountain_id: l.mountain_id,
        is_primary: l.is_primary ? 1 : 0,
        summited_at: null,
      });
    }
    for (const p of routePhotos) p.activity_id = id;
    photos.push(...routePhotos);
  };

  // 1泊2日の縦走（槍ヶ岳 → 穂高岳）
  const yari = byName('槍ヶ岳');
  const hotaka = byName('穂高岳');
  addActivity(
    'demo-yari',
    '槍ヶ岳〜穂高岳 縦走',
    '自分・同行者A',
    '1日目は槍沢から。2日目に大キレット。行動食が足りなかったので次はもう少し多めに。',
    [
      ...buildRoutePhotos(yari, {
        startIso: '2024-08-10T21:00:00.000Z',
        hours: 7,
        count: 14,
        baseElevation: 1500,
        dropCoordAt: [4, 9],
        labelPrefix: 'yari',
        hue: 205,
        contributorRotation: rotation,
      }),
      ...buildRoutePhotos(hotaka, {
        startIso: '2024-08-11T22:00:00.000Z',
        hours: 6,
        count: 11,
        baseElevation: 2600,
        dropCoordAt: [7],
        labelPrefix: 'hotaka',
        hue: 25,
        contributorRotation: rotation,
      }),
    ],
    [
      { mountain_id: yari.id, is_primary: true },
      { mountain_id: hotaka.id, is_primary: false },
    ],
  );

  const fuji = byName('富士山');
  addActivity(
    'demo-fuji',
    '富士山 吉田ルート',
    '自分',
    '八合目で仮眠。ご来光は雲の上。',
    buildRoutePhotos(fuji, {
      startIso: '2023-09-02T20:00:00.000Z',
      hours: 9,
      count: 12,
      baseElevation: 2300,
      dropCoordAt: [3],
      labelPrefix: 'fuji',
      hue: 280,
      contributorRotation: [me.id],
    }),
    [{ mountain_id: fuji.id, is_primary: true }],
  );

  const tanzawa = byName('丹沢山');
  addActivity(
    'demo-tanzawa',
    '丹沢山 日帰り',
    '自分・同行者A',
    '大倉尾根。トレーニングのつもりが普通にきつい。',
    buildRoutePhotos(tanzawa, {
      startIso: '2025-03-15T22:30:00.000Z',
      hours: 6,
      count: 9,
      baseElevation: 300,
      labelPrefix: 'tanzawa',
      hue: 130,
      contributorRotation: rotation,
    }),
    [{ mountain_id: tanzawa.id, is_primary: true }],
  );

  // 未分類トレイ用（活動未割り当て）
  const daisen = byName('大山');
  const unassigned = buildRoutePhotos(daisen, {
    startIso: '2025-05-04T23:00:00.000Z',
    hours: 5,
    count: 6,
    baseElevation: 800,
    labelPrefix: 'daisen',
    hue: 340,
    contributorRotation: [me.id],
  });
  // 撮影時刻が取れなかった写真（「日付不明」ブロックの確認用）
  const unknownId = nextId('unknown');
  demoImages[unknownId] = { thumb: photoSvg(60, 'unknown', 400), display: photoSvg(60, 'unknown', 1200) };
  unassigned.push({
    id: unknownId,
    activity_id: null,
    contributor_id: friend.id,
    taken_at: null,
    taken_at_raw: null,
    time_source: 'none',
    lat: null,
    lng: null,
    altitude: null,
    coord_source: 'none',
    width: 960,
    height: 720,
    mime: 'image/jpeg',
    byte_size: 1_800_000,
    content_hash: unknownId,
    camera_model: null,
    caption: null,
    is_favorite: 0,
    created_at: '2025-05-05T00:00:00.000Z',
  });
  photos.push(...unassigned);

  me.photo_count = photos.filter((p) => p.contributor_id === me.id).length;
  friend.photo_count = photos.filter((p) => p.contributor_id === friend.id).length;

  return {
    mountains: demoMountains.map((m) => ({ ...m })),
    contributors: [me, friend],
    activities,
    activityMountains,
    photos,
  };
}
