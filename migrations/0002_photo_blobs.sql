-- 画像の保存先を D1 にも置けるようにする。
--
-- R2 はアカウント側での有効化（支払い方法の登録）が必要なため、
-- 「原本はクラウドに保存せず、表示用とサムネイルだけ D1 に入れる」構成を選べるようにした。
-- EXIF の抽出はブラウザ側で完結しているので、原本が無くても
-- 山の自動判定・地図・統計・進捗マップはこれまでどおり動く。
--
-- R2 を使う場合は wrangler.toml で r2_buckets を有効にし、
-- PHOTO_STORAGE = "r2" にすれば従来どおり原本まで保存される。

CREATE TABLE photo_blobs (
  photo_id  TEXT NOT NULL,
  variant   TEXT NOT NULL,               -- display | thumb | original
  bytes     BLOB NOT NULL,
  byte_size INTEGER NOT NULL,
  mime      TEXT NOT NULL DEFAULT 'image/jpeg',
  PRIMARY KEY (photo_id, variant)
);

-- r2_key_* を nullable にし、どこに置いたか（storage）と原本の有無を持たせる。
-- SQLite は NOT NULL を後から外せないので、作り直して移し替える。
ALTER TABLE photos RENAME TO photos_old;

CREATE TABLE photos (
  id             TEXT PRIMARY KEY,
  activity_id    TEXT,
  contributor_id TEXT,

  -- 保存先。'd1' なら photo_blobs、'r2' なら r2_key_* を見る
  storage        TEXT NOT NULL DEFAULT 'd1',
  -- 原本を保存しているか（d1 モードでは 0）
  has_original   INTEGER NOT NULL DEFAULT 0,

  r2_key_original TEXT,
  r2_key_display  TEXT,
  r2_key_thumb    TEXT,

  taken_at       TEXT,
  taken_at_raw   TEXT,
  time_source    TEXT NOT NULL,

  lat            REAL,
  lng            REAL,
  altitude       REAL,
  coord_source   TEXT NOT NULL,

  width          INTEGER,
  height         INTEGER,
  mime           TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  content_hash   TEXT NOT NULL,
  camera_model   TEXT,
  caption        TEXT,
  is_favorite    INTEGER NOT NULL DEFAULT 0,

  created_at     TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);

INSERT INTO photos (
  id, activity_id, contributor_id, storage, has_original,
  r2_key_original, r2_key_display, r2_key_thumb,
  taken_at, taken_at_raw, time_source, lat, lng, altitude, coord_source,
  width, height, mime, byte_size, content_hash, camera_model, caption, is_favorite, created_at
)
SELECT
  id, activity_id, contributor_id, 'r2', 1,
  r2_key_original, r2_key_display, r2_key_thumb,
  taken_at, taken_at_raw, time_source, lat, lng, altitude, coord_source,
  width, height, mime, byte_size, content_hash, camera_model, caption, is_favorite, created_at
FROM photos_old;

DROP TABLE photos_old;

CREATE INDEX idx_photos_activity ON photos(activity_id, taken_at);
CREATE INDEX idx_photos_unassigned ON photos(activity_id, taken_at) WHERE activity_id IS NULL;
CREATE UNIQUE INDEX idx_photos_hash ON photos(content_hash);
