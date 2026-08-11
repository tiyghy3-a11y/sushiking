import { thumbUrl } from '../lib/api';
import { formatTime } from '../lib/format';
import type { Contributor, Photo } from '../lib/types';

interface Props {
  photos: Photo[];
  contributors?: Contributor[];
  dense?: boolean;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (photoId: string) => void;
  onOpen?: (index: number) => void;
}

/**
 * 時系列グリッド。写真タイルはエッジトゥエッジで、暗いキャンバスの上に置いて発光させる。
 * 座標なしの写真は薄いチップで区別する（表示自体は全件行う）。
 */
export function PhotoGrid({
  photos,
  contributors = [],
  dense = false,
  selectable = false,
  selected,
  onToggle,
  onOpen,
}: Props) {
  const nameOf = (id: string | null) =>
    id ? (contributors.find((c) => c.id === id)?.name ?? null) : null;

  return (
    <div className={dense ? 'photo-grid dense' : 'photo-grid'}>
      {photos.map((photo, index) => {
        const isSelected = selected?.has(photo.id) ?? false;
        const contributor = nameOf(photo.contributor_id);
        return (
          <button
            key={photo.id}
            type="button"
            className={`photo-cell${isSelected ? ' selected' : ''}`}
            onClick={() => (selectable ? onToggle?.(photo.id) : onOpen?.(index))}
            onDoubleClick={() => onOpen?.(index)}
            title={photo.caption ?? photo.taken_at ?? ''}
          >
            <img src={thumbUrl(photo.id)} alt={photo.caption ?? ''} loading="lazy" />
            {selectable && <span className="select-box">{isSelected ? '✓' : ''}</span>}
            <span className="badges">
              {photo.taken_at && <span className="chip">{formatTime(photo.taken_at)}</span>}
              {contributor && <span className="chip">{contributor}</span>}
              {photo.coord_source === 'none' && <span className="chip chip-dim">座標なし</span>}
              {photo.coord_source === 'interpolated' && <span className="chip chip-dim">補間</span>}
              {photo.is_favorite === 1 && <span className="chip">★</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
