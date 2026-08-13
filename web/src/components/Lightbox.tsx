import { useEffect, useRef } from 'react';
import { displayUrl, originalUrl } from '../lib/api';
import { coordSourceLabel, formatDate, formatTime } from '../lib/format';
import type { Photo } from '../lib/types';

interface Props {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onToggleFavorite?: (photo: Photo) => void;
}

export function Lightbox({ photos, index, onClose, onIndexChange, onToggleFavorite }: Props) {
  const photo = photos[index];
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const go = (delta: number) =>
    onIndexChange(Math.min(photos.length - 1, Math.max(0, index + delta)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndexChange(Math.min(photos.length - 1, index + 1));
      if (e.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onClose, onIndexChange]);

  if (!photo) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      // 横スワイプで写真送り（縦スワイプは無視してページ操作を邪魔しない）
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
        go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="row" style={{ padding: '0 var(--space-sm)', justifyContent: 'flex-end' }}>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', overflow: 'hidden', padding: '0 8px' }}>
        <img src={displayUrl(photo.id)} alt={photo.caption ?? ''} />
      </div>

      <div
        className="row"
        style={{ padding: 'var(--space-md) var(--space-lg)', justifyContent: 'space-between' }}
      >
        <div className="stack" style={{ gap: 2 }}>
          <span className="t-caption-strong" style={{ color: 'var(--body-on-dark)' }}>
            {formatDate(photo.taken_at)} {photo.taken_at ? formatTime(photo.taken_at) : ''}
          </span>
          <span className="t-fine muted-on-dark">
            {coordSourceLabel[photo.coord_source]}
            {photo.altitude != null && ` · GPS標高 ${Math.round(photo.altitude)}m`}
            {photo.camera_model && ` · ${photo.camera_model}`}
            {photo.caption && ` · ${photo.caption}`}
          </span>
        </div>
        <div className="row">
          <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="前の写真">
            ‹
          </button>
          <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="次の写真">
            ›
          </button>
          {onToggleFavorite && (
            <button type="button" className="icon-btn" onClick={() => onToggleFavorite(photo)} aria-label="お気に入り">
              {photo.is_favorite ? '★' : '☆'}
            </button>
          )}
          {photo.has_original !== 0 && (
            <a
              className="link link-on-dark t-caption"
              href={originalUrl(photo.id)}
              target="_blank"
              rel="noreferrer"
            >
              原本
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
