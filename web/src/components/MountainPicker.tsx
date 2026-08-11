import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';
import type { Mountain, SuggestResult } from '../lib/types';

export interface MountainLink {
  mountain_id: number;
  is_primary?: boolean;
  summited_at?: string | null;
}

interface SelectProps {
  links: MountainLink[];
  onChange: (links: MountainLink[]) => void;
  suggestion: SuggestResult | null;
}

/**
 * 山の選択UI。自動判定はあくまで「提案」として出し、確定はユーザーが行う。
 * 縦走では複数座がヒットするのでチェックボックスで複数選択できるようにする。
 */
export function MountainSelect({ links, onChange, suggestion }: SelectProps) {
  const [all, setAll] = useState<Mountain[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .mountains()
      .then((r) => setAll(r.mountains))
      .catch(() => setAll([]));
  }, []);

  const selectedIds = useMemo(() => new Set(links.map((l) => l.mountain_id)), [links]);

  const toggle = (mountainId: number) => {
    if (selectedIds.has(mountainId)) {
      onChange(links.filter((l) => l.mountain_id !== mountainId));
    } else {
      onChange([...links, { mountain_id: mountainId, is_primary: links.length === 0, summited_at: null }]);
    }
  };

  const setPrimary = (mountainId: number) =>
    onChange(links.map((l) => ({ ...l, is_primary: l.mountain_id === mountainId })));

  const applySuggestion = () => {
    if (!suggestion) return;
    onChange(
      suggestion.candidates.map((cand) => ({
        mountain_id: cand.mountain_id,
        is_primary: cand.mountain_id === suggestion.primary?.mountain_id,
        summited_at: cand.closest_at,
      })),
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim();
    if (q) {
      return all
        .filter(
          (m) =>
            m.name.includes(q) ||
            (m.name_kana ?? '').includes(q) ||
            (m.area ?? '').includes(q) ||
            (m.peak_alias ?? '').includes(q),
        )
        .slice(0, 40);
    }
    // 未検索時は選択中 → 提案候補 → 残りの順で並べる
    const suggested = new Set((suggestion?.candidates ?? []).map((c) => c.mountain_id));
    const rank = (m: Mountain) => (selectedIds.has(m.id) ? 0 : suggested.has(m.id) ? 1 : 2);
    return [...all].sort((a, b) => rank(a) - rank(b) || a.id - b.id).slice(0, 30);
  }, [all, query, selectedIds, suggestion]);

  return (
    <div>
      {suggestion && (
        <div className="notice" style={{ marginBottom: 'var(--space-md)' }}>
          {suggestion.candidates.length === 0 ? (
            <>
              座標を持つ写真（EXIF {suggestion.exif_photo_count}枚）から山を特定できませんでした。
              手動で選んでください。
            </>
          ) : (
            <div className="stack" style={{ gap: 'var(--space-xxs)' }}>
              <span className="t-caption-strong">自動判定の提案</span>
              {suggestion.candidates.map((cand) => (
                <span key={cand.mountain_id} className="t-caption">
                  {cand.mountain_id === suggestion.primary?.mountain_id ? '主峰候補' : '通過候補'}:{' '}
                  {cand.name}（{cand.hit_count}枚 / 最短 {Math.round(cand.min_distance_m)}m）
                </span>
              ))}
              <button type="button" className="link t-caption" onClick={applySuggestion}>
                提案をそのまま反映する
              </button>
            </div>
          )}
        </div>
      )}

      <input
        type="search"
        placeholder="山名・かな・山域で検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="stack" style={{ marginTop: 'var(--space-md)', gap: 'var(--space-xs)' }}>
        {filtered.map((m) => {
          const checked = selectedIds.has(m.id);
          const link = links.find((l) => l.mountain_id === m.id);
          return (
            <div key={m.id} className="row" style={{ justifyContent: 'space-between' }}>
              <label className="row" style={{ gap: 'var(--space-xs)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={checked}
                  onChange={() => toggle(m.id)}
                />
                <span className="t-caption">
                  {m.name}
                  <span className="muted">
                    {' '}
                    {m.elevation}m · {m.area ?? ''}
                    {m.climbed ? ' · 登頂済' : ''}
                  </span>
                </span>
              </label>
              {checked && (
                <label className="row t-fine muted" style={{ gap: 4, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="primary-mountain"
                    style={{ width: 'auto' }}
                    checked={link?.is_primary ?? false}
                    onChange={() => setPrimary(m.id)}
                  />
                  主峰
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PickerProps {
  initial: MountainLink[];
  loadSuggestion?: () => Promise<SuggestResult>;
  onSubmit: (links: MountainLink[]) => Promise<void> | void;
  onClose: () => void;
}

export function MountainPicker({ initial, loadSuggestion, onSubmit, onClose }: PickerProps) {
  const [links, setLinks] = useState<MountainLink[]>(initial);
  const [suggestion, setSuggestion] = useState<SuggestResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSuggestion?.()
      .then(setSuggestion)
      .catch(() => setSuggestion(null));
    // 提案の取得は open 時に一度だけ
  }, []);

  return (
    <Modal
      title="登った山を選ぶ"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-pearl" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(links);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '保存中…' : '確定する'}
          </button>
        </>
      }
    >
      <MountainSelect links={links} onChange={setLinks} suggestion={suggestion} />
    </Modal>
  );
}
