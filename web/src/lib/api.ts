import { classifyNetworkFailure, classifyResponse } from './auth-recovery';
import type {
  Activity,
  AppConfig,
  ActivityListItem,
  ActivityStats,
  Contributor,
  LinkedMountain,
  Mountain,
  Photo,
  ProgressSummary,
  SuggestResult,
  UnassignedGroup,
} from './types';

/** 再読み込みを1回に制限するフラグ（Access のログインに乗れないときのループ防止） */
const REAUTH_FLAG = 'yamalog.reauth';

const session = {
  get(): boolean {
    try {
      return sessionStorage.getItem(REAUTH_FLAG) === '1';
    } catch {
      return false; // sessionStorage が使えない環境では諦める
    }
  },
  set(value: boolean) {
    try {
      if (value) sessionStorage.setItem(REAUTH_FLAG, '1');
      else sessionStorage.removeItem(REAUTH_FLAG);
    } catch {
      // 何もしない
    }
  },
};

/**
 * Access のセッション切れ。ページを再読み込みしてブラウザ遷移に乗せ、
 * Access のログイン画面を出させる（fetch のままでは別オリジンで CORS に落ちる）。
 */
function reauthenticate(): never {
  if (!window.__yamalogDemo__ && !session.get()) {
    session.set(true);
    window.location.reload();
  }
  throw new Error('サインインが必要です。ページを再読み込みしてください。');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers:
        init?.body instanceof FormData
          ? init.headers
          : { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // Access のログインへリダイレクトされると別オリジンになり、ここに落ちる
    if (classifyNetworkFailure(navigator.onLine) === 'reauth') reauthenticate();
    throw new Error('通信できませんでした。接続を確認してもう一度お試しください。');
  }

  const action = classifyResponse({
    status: res.status,
    ok: res.ok,
    redirected: res.redirected,
    contentType: res.headers.get('content-type'),
  });

  if (action === 'reauth') reauthenticate();
  if (action === 'forbidden') {
    throw new Error('このアカウントでは利用できません（403）。許可リストを確認してください。');
  }
  if (action === 'error') {
    // API は {"error": "..."} を返す。そのまま出すと画面に JSON が並ぶので中身だけ取り出す
    const text = await res.text();
    let message = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // JSON でなければ生の本文をそのまま使う
    }
    throw new Error(`${message}（${res.status}）`);
  }

  session.set(false); // 通信できたのでフラグを戻す
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  config: () => request<AppConfig>('/api/config'),
  progress: () => request<ProgressSummary>('/api/progress'),

  mountains: () => request<{ mountains: Mountain[] }>('/api/mountains'),
  mountain: (id: number) =>
    request<{
      mountain: Mountain;
      activities: (Activity & { photo_count: number; summited_at: string | null; is_primary: number })[];
    }>(`/api/mountains/${id}`),
  updateMountain: (id: number, body: Partial<Pick<Mountain, 'lat' | 'lng' | 'match_radius_m'>> & { verified?: boolean }) =>
    request<{ mountain: Mountain }>(`/api/mountains/${id}`, { method: 'PATCH', body: json(body) }),

  activities: (limit = 100, offset = 0) =>
    request<{ activities: ActivityListItem[]; total: number }>(
      `/api/activities?limit=${limit}&offset=${offset}`,
    ),
  activity: (id: string) =>
    request<{
      activity: Activity;
      mountains: LinkedMountain[];
      photos: Photo[];
      contributors: Contributor[];
      stats: ActivityStats;
    }>(`/api/activities/${id}`),
  createActivity: (body: {
    title: string;
    start_date?: string;
    end_date?: string;
    note?: string | null;
    members?: string | null;
    photo_ids?: string[];
    mountains?: { mountain_id: number; is_primary?: boolean; summited_at?: string | null }[];
  }) => request<{ activity: Activity }>('/api/activities', { method: 'POST', body: json(body) }),
  updateActivity: (id: string, body: Partial<Activity>) =>
    request<{ activity: Activity }>(`/api/activities/${id}`, { method: 'PATCH', body: json(body) }),
  deleteActivity: (id: string) =>
    request<{ deleted: boolean }>(`/api/activities/${id}`, { method: 'DELETE' }),
  setActivityMountains: (
    id: string,
    mountains: { mountain_id: number; is_primary?: boolean; summited_at?: string | null }[],
  ) =>
    request<{ mountains: LinkedMountain[] }>(`/api/activities/${id}/mountains`, {
      method: 'PUT',
      body: json({ mountains }),
    }),
  assignPhotos: (id: string, photoIds: string[]) =>
    request<{ assigned: number }>(`/api/activities/${id}/photos`, {
      method: 'POST',
      body: json({ photo_ids: photoIds }),
    }),
  detachPhotos: (id: string, photoIds: string[]) =>
    request<{ detached: number }>(`/api/activities/${id}/photos`, {
      method: 'DELETE',
      body: json({ photo_ids: photoIds }),
    }),
  activityStats: (id: string) => request<{ stats: ActivityStats }>(`/api/activities/${id}/stats`),
  suggestForActivity: (id: string) =>
    request<SuggestResult>(`/api/activities/${id}/suggest-mountains`),

  unassigned: () => request<{ total: number; groups: UnassignedGroup[] }>('/api/photos/unassigned'),
  suggestForPhotos: (photoIds: string[]) =>
    request<SuggestResult>('/api/photos/suggest-mountains', {
      method: 'POST',
      body: json({ photo_ids: photoIds }),
    }),
  updatePhoto: (
    id: string,
    body: Partial<{
      caption: string | null;
      is_favorite: boolean;
      lat: number | null;
      lng: number | null;
      taken_at: string | null;
      contributor_id: string | null;
    }>,
  ) => request<{ photo: Photo }>(`/api/photos/${id}`, { method: 'PATCH', body: json(body) }),
  deletePhoto: (id: string) => request<{ deleted: boolean }>(`/api/photos/${id}`, { method: 'DELETE' }),
  checkHashes: (hashes: string[]) =>
    request<{ existing: string[] }>('/api/photos/check-hashes', {
      method: 'POST',
      body: json({ hashes }),
    }),
  upload: (form: FormData) =>
    request<{ skipped: boolean; photo_id: string }>('/api/photos/upload', {
      method: 'POST',
      body: form,
    }),

  contributors: () => request<{ contributors: Contributor[] }>('/api/contributors'),
  createContributor: (body: { name: string; is_self?: boolean; default_time_offset_sec?: number }) =>
    request<{ contributor: Contributor }>('/api/contributors', { method: 'POST', body: json(body) }),
  updateContributor: (id: string, body: Partial<{ name: string; is_self: boolean; default_time_offset_sec: number }>) =>
    request<{ contributor: Contributor }>(`/api/contributors/${id}`, { method: 'PATCH', body: json(body) }),

  createBatch: (body: { contributor_id: string | null; time_offset_sec: number }) =>
    request<{ batch: { id: string } }>('/api/import-batches', { method: 'POST', body: json(body) }),
};

/**
 * 画像は通常 Worker 経由（/img/...）で配信するが、単一HTMLのデモビルドでは
 * ページ内の data URI / blob URL に差し替える。デモ以外では常に undefined。
 */
declare global {
  interface Window {
    __yamalogDemoImages__?: Record<string, { thumb: string; display: string }>;
    __yamalogDemo__?: boolean;
    /** デモのうち、外部通信できる配信先（GitHub Pages 等）で地図タイルを読む */
    __yamalogDemoTiles__?: boolean;
  }
}

export const thumbUrl = (photoId: string) =>
  window.__yamalogDemoImages__?.[photoId]?.thumb ?? `/img/thumb/${photoId}`;
export const displayUrl = (photoId: string) =>
  window.__yamalogDemoImages__?.[photoId]?.display ?? `/img/display/${photoId}`;
export const originalUrl = (photoId: string) =>
  window.__yamalogDemoImages__?.[photoId]?.display ?? `/img/original/${photoId}`;
