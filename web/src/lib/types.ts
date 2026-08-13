export type CoordSource = 'exif' | 'interpolated' | 'manual' | 'none';
export type TimeSource = 'exif' | 'file' | 'manual' | 'none';

export interface Mountain {
  id: number;
  name: string;
  name_kana: string | null;
  elevation: number;
  lat: number;
  lng: number;
  area: string | null;
  prefectures: string[];
  match_radius_m: number;
  peak_alias: string | null;
  verified: boolean;
  visit_count?: number;
  climbed?: boolean;
  first_climbed_on?: string | null;
  last_climbed_on?: string | null;
}

export interface LinkedMountain {
  id: number;
  name: string;
  name_kana: string | null;
  elevation: number;
  area: string | null;
  lat: number;
  lng: number;
  is_primary: number;
  summited_at: string | null;
}

export interface Activity {
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

export interface ActivityListItem extends Activity {
  photo_count: number;
  thumb_photo_id: string | null;
  mountains: LinkedMountain[];
}

export interface Photo {
  id: string;
  activity_id: string | null;
  contributor_id: string | null;
  storage?: 'd1' | 'r2';
  /** 原本を保存しているか（0 なら端末側にしかない） */
  has_original?: number;
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

export interface Contributor {
  id: string;
  name: string;
  is_self: number;
  default_time_offset_sec: number;
  created_at: string;
  photo_count?: number;
}

export interface PaceSegment {
  from_at: string;
  to_at: string;
  distance_m: number;
  duration_sec: number;
  pace_m_per_h: number | null;
}

export interface ActivityStats {
  sample_count: number;
  start_at: string | null;
  end_at: string | null;
  duration_sec: number;
  distance_m: number;
  elevation_gain_m: number;
  max_elevation_m: number | null;
  avg_pace_m_per_h: number | null;
  segments: PaceSegment[];
  elevation_profile: { at: string; elevation_m: number; raw_elevation_m: number }[];
}

export interface MountainSuggestion {
  mountain_id: number;
  name: string;
  hit_count: number;
  min_distance_m: number;
  closest_at: string | null;
}

export interface SuggestResult {
  primary: MountainSuggestion | null;
  candidates: MountainSuggestion[];
  exif_photo_count: number;
}

export interface UnassignedGroup {
  date: string | null;
  count: number;
  photos: Photo[];
}

export interface AppConfig {
  photo_storage: 'd1' | 'r2';
  /** 原本を保存する構成かどうか。false なら原本はアップロードしない */
  keeps_original: boolean;
}

export interface ProgressSummary {
  total: number;
  climbed: number;
  by_area: { area: string; total: number; climbed: number }[];
  activity_count: number;
  photo_count: number;
  unassigned_photo_count: number;
  stored_image_bytes: number;
}
