-- YamaLog Phase 0 初期スキーマ
-- 適用: npx wrangler d1 migrations apply yamalog --local / --remote

-- 百名山マスタ
CREATE TABLE mountains (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  name_kana     TEXT,
  elevation     INTEGER NOT NULL,      -- m
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  area          TEXT,                  -- 山域（例: 南アルプス）
  prefectures   TEXT,                  -- JSON配列 ["山梨県","長野県"]
  is_hyakumeizan INTEGER NOT NULL DEFAULT 1,
  match_radius_m INTEGER NOT NULL DEFAULT 3000, -- 自動判定の許容半径
  peak_alias    TEXT,                  -- 実際の最高峰名（阿寒岳→雌阿寒岳 等）
  verified      INTEGER NOT NULL DEFAULT 0     -- 座標を地理院地図で目視確認済みか
);
CREATE INDEX idx_mountains_latlng ON mountains(lat, lng);

-- 撮影者（自分 + 同行者）
CREATE TABLE contributors (
  id                     TEXT PRIMARY KEY,   -- uuid
  name                   TEXT NOT NULL,
  is_self                INTEGER NOT NULL DEFAULT 0,
  default_time_offset_sec INTEGER NOT NULL DEFAULT 0, -- カメラ時計のずれ補正
  created_at             TEXT NOT NULL
);

-- 山行
CREATE TABLE activities (
  id          TEXT PRIMARY KEY,        -- uuid
  title       TEXT NOT NULL,
  start_date  TEXT NOT NULL,           -- YYYY-MM-DD
  end_date    TEXT NOT NULL,
  note        TEXT,                    -- 自由記述（装備・行動食・反省など）
  members     TEXT,                    -- 自由記述
  cover_photo_id TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_activities_date ON activities(start_date DESC);

-- 山行と山の多対多（縦走で複数座を踏むため）
CREATE TABLE activity_mountains (
  activity_id TEXT NOT NULL,
  mountain_id INTEGER NOT NULL,
  summited_at TEXT,                    -- ISO8601, nullable
  is_primary  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_id, mountain_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (mountain_id) REFERENCES mountains(id)
);

-- 写真
CREATE TABLE photos (
  id             TEXT PRIMARY KEY,     -- uuid
  activity_id    TEXT,                 -- NULL = 未分類トレイ
  contributor_id TEXT,

  r2_key_original TEXT NOT NULL,
  r2_key_display  TEXT NOT NULL,       -- 長辺1600px
  r2_key_thumb    TEXT NOT NULL,       -- 長辺400px

  taken_at       TEXT,                 -- ISO8601, オフセット補正適用後
  taken_at_raw   TEXT,                 -- 補正前の生値（監査用）
  time_source    TEXT NOT NULL,        -- exif | file | manual | none

  lat            REAL,
  lng            REAL,
  altitude       REAL,                 -- m, GPS標高
  coord_source   TEXT NOT NULL,        -- exif | interpolated | manual | none

  width          INTEGER,
  height         INTEGER,
  mime           TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  content_hash   TEXT NOT NULL,        -- SHA-256（完全一致の重複検出用）
  camera_model   TEXT,
  caption        TEXT,
  is_favorite    INTEGER NOT NULL DEFAULT 0,

  created_at     TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);
CREATE INDEX idx_photos_activity ON photos(activity_id, taken_at);
CREATE INDEX idx_photos_unassigned ON photos(activity_id, taken_at) WHERE activity_id IS NULL;
CREATE UNIQUE INDEX idx_photos_hash ON photos(content_hash);

-- 取り込みバッチ（やり直し・一括削除のため）
CREATE TABLE import_batches (
  id             TEXT PRIMARY KEY,
  contributor_id TEXT,
  time_offset_sec INTEGER NOT NULL DEFAULT 0,
  photo_count    INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE photo_batch_map (
  photo_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  PRIMARY KEY (photo_id, batch_id)
);
