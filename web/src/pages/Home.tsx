import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, thumbUrl } from '../lib/api';
import { formatDateRange } from '../lib/format';
import { MapView, type MapMarker } from '../components/MapView';
import type { ActivityListItem, Mountain, ProgressSummary } from '../lib/types';

export function Home() {
  const navigate = useNavigate();
  const [mountains, setMountains] = useState<Mountain[]>([]);
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [recent, setRecent] = useState<ActivityListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.mountains(), api.progress(), api.activities(3, 0)])
      .then(([m, p, a]) => {
        setMountains(m.mountains);
        setSummary(p);
        setRecent(a.activities);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const markers: MapMarker[] = useMemo(
    () =>
      mountains.map((m) => ({
        id: String(m.id),
        lat: m.lat,
        lng: m.lng,
        className: m.climbed ? 'mountain-pin climbed' : 'mountain-pin',
        title: `${m.name}（${m.elevation}m）`,
        popupHtml: `<strong>${m.name}</strong><br>${m.elevation}m · ${m.area ?? ''}<br>${
          m.climbed ? `登頂 ${m.visit_count}回` : '未踏'
        }`,
        onClick: () => navigate(`/mountains/${m.id}`),
      })),
    [mountains, navigate],
  );

  return (
    <>
      <section className="section canvas-light">
        <div className="wrap-narrow">
          <p className="t-tagline muted">日本百名山</p>
          <h1 className="t-hero" style={{ marginTop: 'var(--space-xs)' }}>
            {summary ? `${summary.climbed} / ${summary.total}` : '— / 100'}
          </h1>
          <p className="t-lead" style={{ marginTop: 'var(--space-md)' }}>
            写真のEXIFだけで、登った山が埋まっていく。
          </p>
          {error && (
            <p className="notice" style={{ marginTop: 'var(--space-lg)' }}>
              データを取得できませんでした: {error}
            </p>
          )}
          {summary && (
            <div className="row" style={{ marginTop: 'var(--space-lg)', gap: 'var(--space-lg)' }}>
              <span className="t-caption muted">山行 {summary.activity_count}件</span>
              <span className="t-caption muted">写真 {summary.photo_count.toLocaleString('ja-JP')}枚</span>
              {summary.unassigned_photo_count > 0 && (
                <Link className="link t-caption" to="/inbox">
                  未分類 {summary.unassigned_photo_count}枚を整理する →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="section-tight canvas-parchment">
        <div className="wrap">
          <MapView markers={markers} tall defaultLayer="pale" />
        </div>
      </section>

      {summary && summary.by_area.length > 0 && (
        <section className="section-tight canvas-light">
          <div className="wrap-narrow">
            <h2 className="t-section">山域別</h2>
            <div className="grid-cards" style={{ marginTop: 'var(--space-lg)' }}>
              {summary.by_area.map((a) => (
                <div key={a.area} className="stack" style={{ gap: 'var(--space-xs)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="t-caption-strong">{a.area}</span>
                    <span className="t-caption muted">
                      {a.climbed} / {a.total}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <span style={{ width: `${(a.climbed / Math.max(1, a.total)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section-tight canvas-parchment">
        <div className="wrap">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="t-section">直近の山行</h2>
            <Link className="link t-caption" to="/activities">
              すべて見る →
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="empty">
              まだ山行がありません。<Link className="link" to="/import">写真を取り込む</Link>ところから始めます。
            </p>
          ) : (
            <div className="grid-cards" style={{ marginTop: 'var(--space-lg)' }}>
              {recent.map((a) => (
                <Link key={a.id} to={`/activities/${a.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <article className="card-flat">
                    {a.thumb_photo_id ? (
                      <img
                        src={thumbUrl(a.thumb_photo_id)}
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
                        {a.mountains.map((m) => m.name).join('・') || '山未設定'} · {a.photo_count}枚
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
