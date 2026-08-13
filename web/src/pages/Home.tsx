import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ActivityCard } from '../components/ActivityCard';
import type { ActivityListItem, ProgressSummary } from '../lib/types';

/**
 * ホーム。進捗・直近の山行・山域別の3つだけ。
 *
 * 以前は日本全図に百名山のピンを打っていたが、スマホの画面幅では列島全体を
 * 入れるとピンが重なって読めず、場所を確かめる用途にもならなかったため外した。
 * 地図は「実際の軌跡が出る場面」（山行詳細・山ページ）に残している。
 */
export function Home() {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [recent, setRecent] = useState<ActivityListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.progress(), api.activities(3, 0)])
      .then(([p, a]) => {
        setSummary(p);
        setRecent(a.activities);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

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
