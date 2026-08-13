import { Link } from 'react-router-dom';
import { thumbUrl } from '../lib/api';
import { formatDateRange } from '../lib/format';
import type { ActivityListItem } from '../lib/types';

/**
 * 山行1件のカード。ホームと山行一覧で同じ見た目を使う。
 * 写真はカードの縁まで届かせ、内側の余白は文字にだけ与える（DESIGN.md「写真が主役」）。
 */
export function ActivityCard({ activity }: { activity: ActivityListItem }) {
  const mountains = activity.mountains.map((m) => m.name).join('・');

  return (
    <Link to={`/activities/${activity.id}`} className="media-card">
      {activity.thumb_photo_id ? (
        <img className="media" src={thumbUrl(activity.thumb_photo_id)} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="media" />
      )}
      <div className="body">
        <p className="t-lead">{activity.title}</p>
        <p className="t-caption muted" style={{ marginTop: 2 }}>
          {formatDateRange(activity.start_date, activity.end_date)}
        </p>
        <p className="t-caption muted" style={{ marginTop: 2 }}>
          {mountains || '山未設定'} · {activity.photo_count}枚
        </p>
      </div>
    </Link>
  );
}
