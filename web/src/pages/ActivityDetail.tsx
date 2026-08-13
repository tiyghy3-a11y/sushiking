import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, thumbUrl } from '../lib/api';
import {
  formatDateRange,
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
  formatTime,
} from '../lib/format';
import { ElevationChart } from '../components/ElevationChart';
import { Lightbox } from '../components/Lightbox';
import { MapView, type MapMarker } from '../components/MapView';
import { PhotoGrid } from '../components/PhotoGrid';
import { MountainPicker } from '../components/MountainPicker';
import type { ActivityStats, Contributor, LinkedMountain, Activity, Photo } from '../lib/types';

type Tab = '写真' | '地図' | 'データ' | 'メモ';

export function ActivityDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [mountains, setMountains] = useState<LinkedMountain[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [tab, setTab] = useState<Tab>('写真');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [members, setMembers] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const r = await api.activity(id);
    setActivity(r.activity);
    setMountains(r.mountains);
    setPhotos(r.photos);
    setContributors(r.contributors);
    setStats(r.stats);
    setNote(r.activity.note ?? '');
    setMembers(r.activity.members ?? '');
  }, [id]);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  const mappable = useMemo(
    () => photos.filter((p) => p.lat != null && p.lng != null && p.coord_source !== 'none'),
    [photos],
  );

  const markers: MapMarker[] = useMemo(
    () =>
      mappable.map((p) => ({
        id: p.id,
        lat: p.lat as number,
        lng: p.lng as number,
        className: p.coord_source === 'interpolated' ? 'photo-pin interpolated' : 'photo-pin',
        title: `${formatTime(p.taken_at)}`,
        popupHtml: `<img src="${thumbUrl(p.id)}" style="width:160px;display:block;border-radius:8px" />
          <div style="font-size:12px;margin-top:6px">${formatTime(p.taken_at)} · ${p.coord_source}${
            p.altitude != null ? ` · ${Math.round(p.altitude)}m` : ''
          }</div>`,
      })),
    [mappable],
  );

  const line = useMemo<[number, number][]>(
    () =>
      mappable
        .filter((p) => p.taken_at)
        .sort((a, b) => (a.taken_at! < b.taken_at! ? -1 : 1))
        .map((p) => [p.lng as number, p.lat as number]),
    [mappable],
  );

  const toggle = (photoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const withReload = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveNote = async () => {
    await withReload(() => api.updateActivity(id, { note, members }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (error) return <section className="section canvas-light"><p className="notice">{error}</p></section>;
  if (!activity || !stats) return <section className="section canvas-light"><p className="empty">読み込み中…</p></section>;

  return (
    <>
      <div className="sub-nav">
        <span className="t-tagline">{activity.title}</span>
        <span className="spacer" />
        {selecting ? (
          <>
            <span className="t-caption muted">{selected.size}枚選択中</span>
            <button
              type="button"
              className="btn-utility"
              disabled={selected.size !== 1}
              onClick={() => withReload(() => api.updateActivity(id, { cover_photo_id: [...selected][0] }))}
            >
              カバーに設定
            </button>
            <button
              type="button"
              className="btn-utility"
              disabled={selected.size === 0}
              onClick={() => withReload(() => api.detachPhotos(id, [...selected]))}
            >
              未分類に戻す
            </button>
            <button
              type="button"
              className="btn-pearl"
              onClick={() => {
                setSelecting(false);
                setSelected(new Set());
              }}
            >
              選択をやめる
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-utility" onClick={() => setPickerOpen(true)}>
              山の紐付け
            </button>
            <button type="button" className="btn-utility" onClick={() => setSelecting(true)}>
              写真を選択
            </button>
            <Link className="btn btn-sm" to="/inbox">
              写真を追加
            </Link>
          </>
        )}
      </div>

      <section className="section-tight canvas-light">
        <div className="wrap">
          {/* タイトルは上の見出しに出ているので、ここでは日付と山だけを示す */}
          <p className="t-caption muted">{formatDateRange(activity.start_date, activity.end_date)}</p>
          <div className="row" style={{ marginTop: 'var(--space-xs)' }}>
            {mountains.length === 0 && <span className="t-caption muted">山が未設定です</span>}
            {mountains.map((m) => (
              <Link key={m.id} className="link t-caption" to={`/mountains/${m.id}`}>
                {m.name} {m.elevation}m{m.is_primary === 1 ? '（主峰）' : ''}
              </Link>
            ))}
          </div>
          {activity.members && <p className="t-caption muted">メンバー: {activity.members}</p>}

          <div className="stat-grid" style={{ marginTop: 'var(--s5)' }}>
            <Stat label="写真" value={`${photos.length}枚`} />
            <Stat label="行動時間" value={formatDuration(stats.duration_sec)} />
            <Stat label="移動距離" value={formatDistance(stats.distance_m)} />
            <Stat label="累積標高" value={formatElevation(stats.elevation_gain_m)} />
            <Stat label="最高到達点" value={formatElevation(stats.max_elevation_m)} />
          </div>

          <div className="tabs" style={{ marginTop: 'var(--s5)' }}>
            {(['写真', '地図', 'データ', 'メモ'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={t === tab ? 'tab active' : 'tab'}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      {tab === '写真' && (
        <section className="section-tight canvas-light">
          <div className="wrap">
            {photos.length === 0 ? (
              <p className="empty">写真がありません。</p>
            ) : (
              <PhotoGrid
                photos={photos}
                contributors={contributors}
                selectable={selecting}
                selected={selected}
                onToggle={toggle}
                onOpen={(index) => setLightboxIndex(index)}
              />
            )}
          </div>
        </section>
      )}

      {tab === '地図' && (
        <section className="section-tight canvas-parchment">
          <div className="wrap">
            {markers.length === 0 ? (
              <p className="empty">座標を持つ写真がありません。</p>
            ) : (
              <>
                <MapView markers={markers} line={line} fitToMarkers tall defaultLayer="std" />
                <p className="t-caption muted" style={{ marginTop: 'var(--space-sm)' }}>
                  半透明のピンは前後の写真から補間した位置です（{
                    mappable.filter((p) => p.coord_source === 'interpolated').length
                  }枚）。
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {tab === 'データ' && (
        <section className="section-tight canvas-light">
          <div className="wrap-narrow">
            <p className="notice">
              写真のGPS情報から算出した推定値です。GPS標高は誤差が±20m程度あり、写真は連続的に撮るものではないため、
              実際より小さく出る傾向があります。目安として扱ってください（統計に使用した写真 {stats.sample_count}枚 /
              全 {photos.length}枚）。
            </p>

            <h2 className="t-section" style={{ marginTop: 'var(--space-xl)' }}>
              標高プロファイル
            </h2>
            <ElevationChart stats={stats} />

            <h2 className="t-section" style={{ marginTop: 'var(--space-xl)' }}>
              統計
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }} className="t-caption">
              <tbody>
                {[
                  ['行動時間', formatDuration(stats.duration_sec)],
                  ['移動距離', formatDistance(stats.distance_m)],
                  ['累積標高（+10m以上の上昇のみ）', formatElevation(stats.elevation_gain_m)],
                  ['最高到達点', formatElevation(stats.max_elevation_m)],
                  ['平均ペース', formatPace(stats.avg_pace_m_per_h)],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '10px 0',
                        borderBottom: '1px solid var(--hairline)',
                        fontWeight: 400,
                        color: 'var(--ink-muted-48)',
                      }}
                    >
                      {k}
                    </th>
                    <td style={{ textAlign: 'right', padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 className="t-section" style={{ marginTop: 'var(--space-xl)' }}>
              区間ペース
            </h2>
            {stats.segments.length === 0 ? (
              <p className="empty t-caption">区間を算出できる写真がありません。</p>
            ) : (
              <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse' }} className="t-caption">
                <thead>
                  <tr className="muted">
                    <th style={{ textAlign: 'left', padding: '8px 0' }}>区間</th>
                    <th style={{ textAlign: 'right' }}>距離</th>
                    <th style={{ textAlign: 'right' }}>所要</th>
                    <th style={{ textAlign: 'right' }}>ペース</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.segments.map((s) => (
                    <tr key={`${s.from_at}-${s.to_at}`}>
                      <td style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
                        {formatTime(s.from_at)} → {formatTime(s.to_at)}
                      </td>
                      <td style={{ textAlign: 'right', borderBottom: '1px solid var(--hairline)' }}>
                        {formatDistance(s.distance_m)}
                      </td>
                      <td style={{ textAlign: 'right', borderBottom: '1px solid var(--hairline)' }}>
                        {formatDuration(s.duration_sec)}
                      </td>
                      <td style={{ textAlign: 'right', borderBottom: '1px solid var(--hairline)' }}>
                        {formatPace(s.pace_m_per_h)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'メモ' && (
        <section className="section-tight canvas-light">
          <div className="wrap-narrow">
            <label className="field">
              <span>メンバー</span>
              <input type="text" value={members} onChange={(e) => setMembers(e.target.value)} />
            </label>
            <label className="field">
              <span>メモ（装備・行動食・反省点）</span>
              <textarea rows={12} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="row">
              <button type="button" className="btn" onClick={saveNote}>
                保存
              </button>
              {saved && <span className="t-caption muted">保存しました</span>}
              <span className="spacer" style={{ flex: 1 }} />
              <button
                type="button"
                className="link t-caption"
                onClick={() => {
                  if (!confirm('この山行を削除します。写真は未分類に戻ります。よろしいですか？')) return;
                  api
                    .deleteActivity(id)
                    .then(() => navigate('/activities'))
                    .catch((e: Error) => setError(e.message));
                }}
              >
                この山行を削除
              </button>
            </div>
          </div>
        </section>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onToggleFavorite={(p) =>
            withReload(() => api.updatePhoto(p.id, { is_favorite: p.is_favorite !== 1 }))
          }
        />
      )}

      {pickerOpen && (
        <MountainPicker
          initial={mountains.map((m) => ({
            mountain_id: m.id,
            is_primary: m.is_primary === 1,
            summited_at: m.summited_at,
          }))}
          loadSuggestion={() => api.suggestForActivity(id)}
          onClose={() => setPickerOpen(false)}
          onSubmit={async (links) => {
            await withReload(() => api.setActivityMountains(id, links));
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="t-caption muted">{label}</p>
      <p className="stat-value">{value}</p>
    </div>
  );
}
