import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ActivityCard } from '../components/ActivityCard';
import type { ActivityListItem } from '../lib/types';

export function Activities() {
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .activities(200, 0)
      .then((r) => setActivities(r.activities))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // 年でグルーピングする
  const byYear = useMemo(() => {
    const map = new Map<string, ActivityListItem[]>();
    for (const a of activities) {
      const year = a.start_date.slice(0, 4);
      const list = map.get(year);
      if (list) list.push(a);
      else map.set(year, [a]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [activities]);

  return (
    <>
      <div className="sub-nav">
        <span className="t-tagline">山行</span>
        <span className="spacer" />
        <Link className="btn btn-sm" to="/inbox">
          未分類から作成
        </Link>
      </div>

      <section className="section-tight canvas-light">
        <div className="wrap">
          {loading && <p className="empty">読み込み中…</p>}
          {error && <p className="notice">取得できませんでした: {error}</p>}
          {!loading && activities.length === 0 && (
            <p className="empty">
              山行がまだありません。<Link className="link" to="/inbox">未分類トレイ</Link>から作成できます。
            </p>
          )}

          {byYear.map(([year, list]) => (
            <div key={year} style={{ marginBottom: 'var(--space-xxl)' }}>
              <h2 className="t-section">{year}年</h2>
              <p className="t-caption muted">{list.length}件</p>
              <div className="grid-cards" style={{ marginTop: 'var(--space-lg)' }}>
                {list.map((a) => (
                  <ActivityCard key={a.id} activity={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
