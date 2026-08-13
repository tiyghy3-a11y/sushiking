import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ActivityCard } from '../components/ActivityCard';
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
      <div className="sub-nav">
        <span className="t-tagline">ホーム</span>
      </div>

      <section className="section-tight canvas-light">
        <div className="wrap-narrow">
          {error && <p className="notice">データを取得できませんでした: {error}</p>}

          {/* 進捗。この画面で最初に知りたいのは「何座登ったか」だけ */}
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <p className="t-caption-strong muted">日本百名山</p>
                <p className="stat-value" style={{ fontSize: 34, marginTop: 2 }}>
                  {summary ? summary.climbed : '—'}
                  <span className="t-caption muted" style={{ marginLeft: 6 }}>
                    / {summary?.total ?? 100} 座
                  </span>
                </p>
              </div>
              {summary && summary.unassigned_photo_count > 0 && (
                <Link className="btn btn-sm" to="/inbox">
                  未分類 {summary.unassigned_photo_count}枚
                </Link>
              )}
            </div>
            <div className="progress-bar" style={{ marginTop: 'var(--s3)' }}>
              <span style={{ width: `${((summary?.climbed ?? 0) / (summary?.total || 100)) * 100}%` }} />
            </div>
            <p className="t-caption muted" style={{ marginTop: 'var(--s3)' }}>
              山行 {summary?.activity_count ?? 0}件 · 写真{' '}
              {(summary?.photo_count ?? 0).toLocaleString('ja-JP')}枚
            </p>
          </div>
        </div>
      </section>

      <section className="section-tight canvas-light">
        <div className="wrap">
          <MapView markers={markers} defaultLayer="pale" />
        </div>
      </section>

      <section className="section-tight canvas-light">
        <div className="wrap-narrow">
          <div className="section-head">
            <h2 className="t-section">直近の山行</h2>
            <Link className="link t-caption" to="/activities">
              すべて見る
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="empty">
              まだ山行がありません。<Link className="link" to="/import">写真を取り込む</Link>
              ところから始めます。
            </p>
          ) : (
            <div className="grid-cards">
              {recent.map((a) => (
                <ActivityCard key={a.id} activity={a} />
              ))}
            </div>
          )}
        </div>
      </section>

      {summary && summary.by_area.length > 0 && (
        <section className="section-tight canvas-light">
          <div className="wrap-narrow">
            <h2 className="t-section" style={{ marginBottom: 'var(--s3)' }}>
              山域別
            </h2>
            <div className="card">
              {summary.by_area.map((a) => (
                <div key={a.area} className="meta-row">
                  <span className="t-caption">{a.area}</span>
                  <span className="row" style={{ gap: 'var(--s3)', flex: '0 1 180px' }}>
                    <span className="progress-bar" style={{ flex: 1 }}>
                      <span style={{ width: `${(a.climbed / Math.max(1, a.total)) * 100}%` }} />
                    </span>
                    <span className="t-caption muted tabular" style={{ minWidth: 46, textAlign: 'right' }}>
                      {a.climbed} / {a.total}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
