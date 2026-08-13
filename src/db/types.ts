import type { CoordSource } from '../lib/interpolate';
import type { TimeSource } from '../lib/time';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;

  /** Cloudflare Access のチームドメイン（例: your-team.cloudflareaccess.com） */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access アプリケーションの Audience Tag */
  ACCESS_AUD?: string;
  /** 利用を許可するメールアドレス（カンマ区切り） */
  ALLOWED_EMAILS?: string;
  /** ローカル開発でのみ "1"。.dev.vars に置く（本番には存在しない） */
  ACCESS_DISABLED?: string;
}

export interface MountainRow {
  id: number;
  name: string;
  name_kana: string | null;
  elevation: number;
  lat: number;
  lng: number;
  area: string | null;
  prefectures: string | null;
  is_hyakumeizan: number;
  match_radius_m: number;
  peak_alias: string | null;
  verified: number;
}

export interface ActivityRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  note: string | null;
  members: string | null;
  cover_photo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoRow {
  id: string;
  activity_id: string | null;
  contributor_id: string | null;
  r2_key_original: string;
  r2_key_display: string;
  r2_key_thumb: string;
  taken_at: string | null;
  taken_at_raw: string | null;
  time_source: TimeSource;
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  coord_source: CoordSource;
  width: number | null;
  height: number | null;
  mime: string;
  byte_size: number;
  content_hash: string;
  camera_model: string | null;
  caption: string | null;
  is_favorite: number;
  created_at: string;
}

export interface ContributorRow {
  id: string;
  name: string;
  is_self: number;
  default_time_offset_sec: number;
  created_at: string;
}

/** prefectures は JSON 文字列で保存しているのでパースして返す */
export function serializeMountain(m: MountainRow) {
  let prefectures: string[] = [];
  if (m.prefectures) {
    try {
      const parsed: unknown = JSON.parse(m.prefectures);
      if (Array.isArray(parsed)) prefectures = parsed.map(String);
    } catch {
      prefectures = [m.prefectures];
    }
  }
  return { ...m, prefectures, verified: m.verified === 1 };
}
