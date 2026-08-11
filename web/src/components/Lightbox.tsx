import { useEffect } from 'react';
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
    <div className="lightbox" role="dialog" aria-modal="true">
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
          <button
            type="button"
            className="icon-btn"
            onClick={() => onIndexChange(Math.max(0, index - 1))}
            aria-label="前の写真"
          >
            ‹
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onIndexChange(Math.min(photos.length - 1, index + 1))}
            aria-label="次の写真"
          >
            ›
          </button>
          {onToggleFavorite && (
            <button type="button" className="icon-btn" onClick={() => onToggleFavorite(photo)} aria-label="お気に入り">
              {photo.is_favorite ? '★' : '☆'}
            </button>
          )}
          <a className="link link-on-dark t-caption" href={originalUrl(photo.id)} target="_blank" rel="noreferrer">
            原本
          </a>
        </div>
      </div>
    </div>
  );
}
