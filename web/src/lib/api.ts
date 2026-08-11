import type {
  Activity,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? init.headers
        : { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
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

export const thumbUrl = (photoId: string) => `/img/thumb/${photoId}`;
export const displayUrl = (photoId: string) => `/img/display/${photoId}`;
export const originalUrl = (photoId: string) => `/img/original/${photoId}`;
