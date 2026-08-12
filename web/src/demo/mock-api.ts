/**
 * デモ用のインメモリAPI。window.fetch を差し替えて Worker の代わりに応答する。
 *
 * 距離計算・座標補間・統計は本番と同じ src/lib のロジックを呼ぶので、
 * 画面に出る数値やピンの挙動は実装そのままになる。データはページ内だけに
 * 存在し、どこにも送信されない（リロードで初期状態に戻る）。
 */
import { suggestMountains } from '../../../src/lib/geo';
import { interpolateCoords } from '../../../src/lib/interpolate';
import { computeStats, type StatPoint } from '../../../src/lib/stats';
import { localDateKey } from '../../../src/lib/time';
import type { Contributor, Mountain, Photo } from '../lib/types';
import { buildDemoStore, demoImages, type DemoStore } from './dataset';

const store: DemoStore = buildDemoStore();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const photosOf = (activityId: string) =>
  store.photos
    .filter((p) => p.activity_id === activityId)
    .sort((a, b) => (a.taken_at ?? '') .localeCompare(b.taken_at ?? ''));

/** activity 内の座標補間を引き直す（本番の reinterpolateActivity と同じ手順） */
function reinterpolate(activityId: string) {
  const target = store.photos.filter((p) => p.activity_id === activityId);
  for (const p of target) {
    if (p.coord_source === 'interpolated') {
      p.lat = null;
      p.lng = null;
      p.altitude = null;
      p.coord_source = 'none';
    }
  }
  for (const filled of interpolateCoords(target)) {
    const photo = target.find((p) => p.id === filled.id);
    if (!photo) continue;
    photo.lat = filled.lat;
    photo.lng = filled.lng;
    photo.altitude = filled.altitude;
    photo.coord_source = 'interpolated';
  }
}

function linkedMountains(activityId: string) {
  return store.activityMountains
    .filter((l) => l.activity_id === activityId)
    .map((l) => {
      const m = store.mountains.find((x) => x.id === l.mountain_id)!;
      return {
        id: m.id,
        name: m.name,
        name_kana: m.name_kana,
        elevation: m.elevation,
        area: m.area,
        lat: m.lat,
        lng: m.lng,
        is_primary: l.is_primary,
        summited_at: l.summited_at,
      };
    })
    .sort((a, b) => b.is_primary - a.is_primary || b.elevation - a.elevation);
}

const statsFor = (activityId: string) =>
  computeStats(
    photosOf(activityId)
      .filter((p): p is Photo & StatPoint => p.coord_source === 'exif' && p.lat != null && p.lng != null && p.taken_at != null)
      .map((p) => ({ taken_at: p.taken_at, lat: p.lat, lng: p.lng, altitude: p.altitude })),
  );

const withProgress = (m: Mountain) => {
  const activityIds = store.activityMountains.filter((l) => l.mountain_id === m.id).map((l) => l.activity_id);
  const dates = store.activities.filter((a) => activityIds.includes(a.id)).map((a) => a.start_date).sort();
  return {
    ...m,
    visit_count: activityIds.length,
    climbed: activityIds.length > 0,
    first_climbed_on: dates[0] ?? null,
    last_climbed_on: dates[dates.length - 1] ?? null,
  };
};

const suggestFor = (photoIds: string[]) => {
  const points = store.photos
    .filter((p) => photoIds.includes(p.id) && p.coord_source === 'exif' && p.lat != null && p.lng != null)
    .map((p) => ({ lat: p.lat as number, lng: p.lng as number, taken_at: p.taken_at }));
  return { ...suggestMountains(points, store.mountains), exif_photo_count: points.length };
};

async function handle(method: string, path: string, request: Request): Promise<Response> {
  const body = async <T>(): Promise<T> => (await request.clone().json()) as T;
  const segments = path.replace(/^\/api\//, '').split('/');

  // --- progress ---
  if (path === '/api/progress') {
    const areas = new Map<string, { total: number; climbed: number }>();
    let climbed = 0;
    for (const m of store.mountains) {
      const p = withProgress(m);
      if (p.climbed) climbed++;
      const key = m.area ?? '未設定';
      const acc = areas.get(key) ?? { total: 0, climbed: 0 };
      acc.total++;
      if (p.climbed) acc.climbed++;
      areas.set(key, acc);
    }
    return json({
      total: store.mountains.length,
      climbed,
      by_area: [...areas.entries()]
        .map(([area, v]) => ({ area, ...v }))
        .sort((a, b) => b.total - a.total || a.area.localeCompare(b.area)),
      activity_count: store.activities.length,
      photo_count: store.photos.length,
      unassigned_photo_count: store.photos.filter((p) => p.activity_id === null).length,
    });
  }

  // --- mountains ---
  if (path === '/api/mountains') return json({ mountains: store.mountains.map(withProgress) });

  if (segments[0] === 'mountains' && segments[1]) {
    const id = Number(segments[1]);
    const mountain = store.mountains.find((m) => m.id === id);
    if (!mountain) return json({ error: 'not found' }, 404);

    if (method === 'PATCH') {
      const patch = await body<Partial<Mountain> & { verified?: boolean }>();
      if (typeof patch.lat === 'number') mountain.lat = patch.lat;
      if (typeof patch.lng === 'number') mountain.lng = patch.lng;
      if (typeof patch.match_radius_m === 'number') mountain.match_radius_m = Math.round(patch.match_radius_m);
      if (typeof patch.verified === 'boolean') mountain.verified = patch.verified;
      return json({ mountain: withProgress(mountain) });
    }

    const ids = store.activityMountains.filter((l) => l.mountain_id === id);
    return json({
      mountain: withProgress(mountain),
      activities: ids
        .map((l) => {
          const a = store.activities.find((x) => x.id === l.activity_id)!;
          return { ...a, photo_count: photosOf(a.id).length, summited_at: l.summited_at, is_primary: l.is_primary };
        })
        .sort((a, b) => b.start_date.localeCompare(a.start_date)),
    });
  }

  // --- activities ---
  if (path.startsWith('/api/activities')) {
    const id = segments[1];
    const sub = segments[2];

    if (!id) {
      if (method === 'POST') {
        const input = await body<{
          title: string;
          start_date?: string;
          end_date?: string;
          note?: string | null;
          members?: string | null;
          photo_ids?: string[];
          mountains?: { mountain_id: number; is_primary?: boolean; summited_at?: string | null }[];
        }>();
        const photoIds = input.photo_ids ?? [];
        const times = store.photos
          .filter((p) => photoIds.includes(p.id) && p.taken_at)
          .map((p) => localDateKey(p.taken_at) as string)
          .sort();
        const newId = `demo-${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        store.activities.push({
          id: newId,
          title: input.title,
          start_date: input.start_date || times[0] || now.slice(0, 10),
          end_date: input.end_date || times[times.length - 1] || input.start_date || now.slice(0, 10),
          note: input.note ?? null,
          members: input.members ?? null,
          cover_photo_id: null,
          created_at: now,
          updated_at: now,
        });
        for (const l of input.mountains ?? []) {
          store.activityMountains.push({
            activity_id: newId,
            mountain_id: l.mountain_id,
            is_primary: l.is_primary ? 1 : 0,
            summited_at: l.summited_at ?? null,
          });
        }
        for (const p of store.photos) if (photoIds.includes(p.id)) p.activity_id = newId;
        reinterpolate(newId);
        return json({ activity: store.activities.find((a) => a.id === newId) }, 201);
      }

      const list = [...store.activities]
        .sort((a, b) => b.start_date.localeCompare(a.start_date))
        .map((a) => {
          const ps = photosOf(a.id);
          return {
            ...a,
            photo_count: ps.length,
            thumb_photo_id: a.cover_photo_id ?? ps[0]?.id ?? null,
            mountains: linkedMountains(a.id),
          };
        });
      return json({ activities: list, total: list.length, limit: list.length, offset: 0 });
    }

    const activity = store.activities.find((a) => a.id === id);
    if (!activity) return json({ error: 'not found' }, 404);

    if (sub === 'stats') return json({ stats: statsFor(id) });
    if (sub === 'suggest-mountains') return json(suggestFor(photosOf(id).map((p) => p.id)));

    if (sub === 'photos') {
      const { photo_ids: photoIds = [] } = await body<{ photo_ids: string[] }>();
      if (method === 'POST') {
        const previous = new Set(
          store.photos.filter((p) => photoIds.includes(p.id) && p.activity_id).map((p) => p.activity_id as string),
        );
        for (const p of store.photos) if (photoIds.includes(p.id)) p.activity_id = id;
        reinterpolate(id);
        for (const prev of previous) if (prev !== id) reinterpolate(prev);
        return json({ assigned: photoIds.length });
      }
      // DELETE: 未分類に戻す。補間値は破棄する
      for (const p of store.photos) {
        if (!photoIds.includes(p.id)) continue;
        p.activity_id = null;
        if (p.coord_source === 'interpolated') {
          p.lat = null;
          p.lng = null;
          p.altitude = null;
          p.coord_source = 'none';
        }
      }
      reinterpolate(id);
      return json({ detached: photoIds.length });
    }

    if (sub === 'mountains' && method === 'PUT') {
      const { mountains: links = [] } = await body<{
        mountains: { mountain_id: number; is_primary?: boolean; summited_at?: string | null }[];
      }>();
      store.activityMountains = store.activityMountains.filter((l) => l.activity_id !== id);
      for (const l of links) {
        store.activityMountains.push({
          activity_id: id,
          mountain_id: l.mountain_id,
          is_primary: l.is_primary ? 1 : 0,
          summited_at: l.summited_at ?? null,
        });
      }
      return json({ mountains: linkedMountains(id) });
    }

    if (method === 'PATCH') {
      const patch = await body<Record<string, unknown>>();
      Object.assign(activity, patch, { updated_at: new Date().toISOString() });
      return json({ activity });
    }

    if (method === 'DELETE') {
      for (const p of store.photos) {
        if (p.activity_id !== id) continue;
        p.activity_id = null;
        if (p.coord_source === 'interpolated') {
          p.lat = null;
          p.lng = null;
          p.altitude = null;
          p.coord_source = 'none';
        }
      }
      store.activityMountains = store.activityMountains.filter((l) => l.activity_id !== id);
      store.activities = store.activities.filter((a) => a.id !== id);
      return json({ deleted: true });
    }

    return json({
      activity,
      mountains: linkedMountains(id),
      photos: photosOf(id),
      contributors: store.contributors,
      stats: statsFor(id),
    });
  }

  // --- photos ---
  if (path === '/api/photos/unassigned') {
    const groups = new Map<string, Photo[]>();
    for (const p of store.photos.filter((x) => x.activity_id === null)) {
      const key = localDateKey(p.taken_at) ?? 'unknown';
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const dated = [...groups.entries()]
      .filter(([d]) => d !== 'unknown')
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({ date, count: list.length, photos: list }));
    const unknown = groups.get('unknown');
    if (unknown) dated.push({ date: null as unknown as string, count: unknown.length, photos: unknown });
    return json({ total: store.photos.filter((p) => p.activity_id === null).length, groups: dated });
  }

  if (path === '/api/photos/suggest-mountains') {
    const { photo_ids: photoIds = [] } = await body<{ photo_ids: string[] }>();
    return json(suggestFor(photoIds));
  }

  if (path === '/api/photos/check-hashes') {
    const { hashes = [] } = await body<{ hashes: string[] }>();
    const existing = store.photos.filter((p) => hashes.includes(p.content_hash)).map((p) => p.content_hash);
    return json({ existing });
  }

  if (path === '/api/photos/upload') {
    // 実際の取り込みパイプライン（EXIF抽出・HEIC変換・リサイズ）はブラウザ側なので
    // デモでもそのまま動く。保存先だけページ内のメモリに差し替える。
    const form = await request.clone().formData();
    const meta = JSON.parse(String(form.get('meta'))) as Record<string, unknown>;
    const hash = String(meta.content_hash);
    if (store.photos.some((p) => p.content_hash === hash)) {
      return json({ skipped: true, reason: 'duplicate', photo_id: '' });
    }
    const id = `local-${hash.slice(0, 10)}`;
    const thumb = form.get('thumb');
    const display = form.get('display');
    demoImages[id] = {
      thumb: thumb instanceof Blob ? URL.createObjectURL(thumb) : '',
      display: display instanceof Blob ? URL.createObjectURL(display) : '',
    };
    const offset = Number(meta.time_offset_sec ?? 0);
    const raw = (meta.taken_at_raw as string | null) ?? null;
    const takenAt = raw ? new Date(new Date(raw).getTime() + offset * 1000).toISOString() : null;
    store.photos.push({
      id,
      activity_id: null,
      contributor_id: (meta.contributor_id as string | null) ?? store.contributors[0].id,
      taken_at: takenAt,
      taken_at_raw: raw,
      time_source: (meta.time_source as Photo['time_source']) ?? 'none',
      lat: (meta.lat as number | null) ?? null,
      lng: (meta.lng as number | null) ?? null,
      altitude: (meta.altitude as number | null) ?? null,
      coord_source: meta.lat != null && meta.lng != null ? 'exif' : 'none',
      width: (meta.width as number | null) ?? null,
      height: (meta.height as number | null) ?? null,
      mime: String(meta.mime ?? 'image/jpeg'),
      byte_size: Number(meta.byte_size ?? 0),
      content_hash: hash,
      camera_model: (meta.camera_model as string | null) ?? null,
      caption: null,
      is_favorite: 0,
      created_at: new Date().toISOString(),
    });
    return json({ skipped: false, photo_id: id, taken_at: takenAt }, 201);
  }

  if (segments[0] === 'photos' && segments[1]) {
    const photo = store.photos.find((p) => p.id === segments[1]);
    if (!photo) return json({ error: 'not found' }, 404);
    if (method === 'DELETE') {
      store.photos = store.photos.filter((p) => p.id !== photo.id);
      if (photo.activity_id) reinterpolate(photo.activity_id);
      return json({ deleted: true });
    }
    const patch = await body<Record<string, unknown>>();
    if ('caption' in patch) photo.caption = (patch.caption as string | null) ?? null;
    if (typeof patch.is_favorite === 'boolean') photo.is_favorite = patch.is_favorite ? 1 : 0;
    if ('contributor_id' in patch) photo.contributor_id = (patch.contributor_id as string | null) ?? null;
    if (typeof patch.lat === 'number' && typeof patch.lng === 'number') {
      photo.lat = patch.lat;
      photo.lng = patch.lng;
      photo.coord_source = 'manual';
    }
    if ('taken_at' in patch) {
      photo.taken_at = (patch.taken_at as string | null) ?? null;
      photo.time_source = photo.taken_at ? 'manual' : 'none';
    }
    if (photo.activity_id) reinterpolate(photo.activity_id);
    return json({ photo });
  }

  // --- contributors / batches ---
  if (path === '/api/contributors') {
    if (method === 'POST') {
      const input = await body<{ name: string; is_self?: boolean; default_time_offset_sec?: number }>();
      const contributor: Contributor = {
        id: `contrib-${Math.random().toString(36).slice(2, 8)}`,
        name: input.name,
        is_self: input.is_self ? 1 : 0,
        default_time_offset_sec: input.default_time_offset_sec ?? 0,
        created_at: new Date().toISOString(),
        photo_count: 0,
      };
      store.contributors.push(contributor);
      return json({ contributor }, 201);
    }
    return json({
      contributors: store.contributors.map((c) => ({
        ...c,
        photo_count: store.photos.filter((p) => p.contributor_id === c.id).length,
      })),
    });
  }

  if (segments[0] === 'contributors' && segments[1] && method === 'PATCH') {
    const contributor = store.contributors.find((c) => c.id === segments[1]);
    if (!contributor) return json({ error: 'not found' }, 404);
    Object.assign(contributor, await body<Record<string, unknown>>());
    return json({ contributor });
  }

  if (path === '/api/import-batches') return json({ batch: { id: 'demo-batch' } }, 201);

  return json({ error: `demo: unhandled ${method} ${path}` }, 404);
}

/** window.fetch を差し替える。/api/ 以外のリクエストは素通しする */
export function installMockApi() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url, window.location.href);
    if (!url.pathname.startsWith('/api/')) return original(input as RequestInfo, init);
    try {
      return await handle(request.method, url.pathname, request);
    } catch (e) {
      return json({ error: `demo error: ${(e as Error).message}` }, 500);
    }
  };
}
