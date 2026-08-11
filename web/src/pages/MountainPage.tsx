import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, thumbUrl } from '../lib/api';
import { formatDate, formatDateRange } from '../lib/format';
import { MapView, type MapMarker } from '../components/MapView';
import type { Activity, Mountain } from '../lib/types';

type RelatedActivity = Activity & { photo_count: number; summited_at: string | null; is_primary: number };

export function MountainPage() {
  const { id = '' } = useParams();
  const [mountain, setMountain] = useState<Mountain | null>(null);
  const [activities, setActivities] = useState<RelatedActivity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .mountain(Number(id))
      .then((r) => {
        setMountain(r.mountain);
        setActivities(r.activities as RelatedActivity[]);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const markers: MapMarker[] = useMemo(
    () =>
      mountain
        ? [
            {
              id: String(mountain.id),
              lat: mountain.lat,
              lng: mountain.lng,
              className: activities.length > 0 ? 'mountain-pin climbed' : 'mountain-pin',
              title: mountain.name,
            },
          ]
        : [],
    [mountain, activities.length],
  );

  if (error) return <section className="section canvas-light"><p className="notice">{error}</p></section>;
  if (!mountain) return <section className="section canvas-light"><p className="empty">読み込み中…</p></section>;

  return (
    <>
      <div className="sub-nav">
        <span className="t-tagline">{mountain.name}</span>
        <span className="spacer" />
        <Link className="link t-caption" to="/">
          進捗マップへ →
        </Link>
      </div>

      <section className="section-tight canvas-light">
        <div className="wrap-narrow">
          <p className="t-caption muted">{mountain.name_kana}</p>
          <h1 className="t-display">{mountain.name}</h1>
          <p className="t-lead muted" style={{ marginTop: 'var(--space-xs)' }}>
            {mountain.elevation.toLocaleString('ja-JP')}m · {mountain.area} ·{' '}
            {mountain.prefectures.join('・')}
          </p>
          {mountain.peak_alias && (
            <p className="t-caption muted">最高峰: {mountain.peak_alias}</p>
          )}
          <p className="t-caption muted">
            判定半径 {mountain.match_radius_m}m ·{' '}
            {mountain.verified ? '座標確認済み' : '座標は未確認（設定画面で確認できます）'}
          </p>

          <div className="row" style={{ marginTop: 'var(--space-lg)' }}>
            <span className="stat-value">{activities.length}</span>
            <span className="t-caption muted">回登頂</span>
          </div>
        </div>
      </section>

      <section className="section-tight canvas-parchment">
        <div className="wrap">
          <MapView markers={markers} center={[mountain.lng, mountain.lat]} zoom={12} defaultLayer="std" />
        </div>
      </section>

      <section className="section-tight canvas-light">
        <div className="wrap">
          <h2 className="t-section">この山の山行</h2>
          {activities.length === 0 ? (
            <p className="empty">まだ登っていません。</p>
          ) : (
            <div className="grid-cards" style={{ marginTop: 'var(--space-lg)' }}>
              {activities.map((a) => (
                <Link key={a.id} to={`/activities/${a.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <article className="card-flat">
                    {a.cover_photo_id ? (
                      <img
                        src={thumbUrl(a.cover_photo_id)}
                        alt=""
                        style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div style={{ aspectRatio: '4 / 3', background: 'var(--surface-tile-3)' }} />
                    )}
                    <div style={{ padding: 'var(--space-md)' }}>
                      <p className="t-strong">{a.title}</p>
                      <p className="t-caption muted">{formatDateRange(a.start_date, a.end_date)}</p>
                      <p className="t-caption muted">
                        {a.photo_count}枚
                        {a.summited_at ? ` · 登頂 ${formatDate(a.summited_at)}` : ''}
                        {a.is_primary === 1 ? ' · 主峰' : ''}
                      </p>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
