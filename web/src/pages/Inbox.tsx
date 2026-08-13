import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { Modal } from '../components/Modal';
import { MountainSelect, type MountainLink } from '../components/MountainPicker';
import { PhotoGrid } from '../components/PhotoGrid';
import { runPool } from '../lib/photo-pipeline';
import type { ActivityListItem, Contributor, SuggestResult, UnassignedGroup } from '../lib/types';

/**
 * 未分類トレイ。Phase 0 で最も重要な画面で、過去数年分の投入がここを通る。
 * 作業画面なのでライトキャンバスで密度高め。
 */
export function Inbox() {
  const [groups, setGroups] = useState<UnassignedGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [creatingFor, setCreatingFor] = useState<{ key: string; date: string | null; photoIds: string[] } | null>(null);
  const [addingFor, setAddingFor] = useState<{ photoIds: string[] } | null>(null);
  const [deletingFor, setDeletingFor] = useState<{ photoIds: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [u, c, a] = await Promise.all([api.unassigned(), api.contributors(), api.activities(200, 0)]);
    setGroups(u.groups);
    setTotal(u.total);
    setContributors(c.contributors);
    setActivities(a.activities);
    setSelected({});
  }, []);

  useEffect(() => {
    load()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  const keyOf = (g: UnassignedGroup) => g.date ?? 'unknown';

  const selectionOf = (g: UnassignedGroup): string[] => {
    const set = selected[keyOf(g)];
    return set && set.size > 0 ? [...set] : g.photos.map((p) => p.id);
  };

  const toggle = (g: UnassignedGroup, photoId: string) => {
    const key = keyOf(g);
    setSelected((prev) => {
      const next = new Set(prev[key] ?? []);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return { ...prev, [key]: next };
    });
  };

  const toggleAll = (g: UnassignedGroup) => {
    const key = keyOf(g);
    setSelected((prev) => {
      const current = prev[key];
      const all = current && current.size === g.photos.length;
      return { ...prev, [key]: all ? new Set<string>() : new Set(g.photos.map((p) => p.id)) };
    });
  };

  // 選択は日付ごとに持つが、操作は日付をまたいでまとめて行える
  const allSelected = Object.values(selected).flatMap((s) => [...s]);

  if (loading) return <section className="section canvas-light"><p className="empty">読み込み中…</p></section>;

  return (
    <>
      <div className="sub-nav">
        <span className="t-tagline">未分類トレイ</span>
        <span className="t-caption muted">{total}枚</span>
        <span className="spacer" />
        <Link className="btn btn-sm" to="/import">
          写真を取り込む
        </Link>
      </div>

      <section className="section-tight canvas-light">
        <div className="wrap">
          {error && <p className="notice">{error}</p>}
          {groups.length === 0 && (
            <p className="empty">
              未分類の写真はありません。<Link className="link" to="/import">取り込み</Link>から追加できます。
            </p>
          )}

          {groups.map((g) => {
            const key = keyOf(g);
            const chosen = selected[key];
            return (
              <div key={key} style={{ marginBottom: 'var(--space-xxl)' }}>
                <div className="section-head">
                  <div>
                    <h2 className="t-section">{g.date ? formatDate(g.date) : '日付不明'}</h2>
                    <p className="t-caption muted">
                      {g.count}枚
                      {chosen && chosen.size > 0 ? ` · ${chosen.size}枚を選択中` : ''}
                    </p>
                  </div>
                  <div className="row" style={{ gap: 'var(--s2)' }}>
                    <button type="button" className="btn-quiet btn-sm" onClick={() => toggleAll(g)}>
                      {chosen && chosen.size === g.photos.length ? '選択を解除' : 'すべて選択'}
                    </button>
                    {g.date && (
                      <button
                        type="button"
                        className="btn-quiet btn-sm"
                        onClick={() => setCreatingFor({ key, date: g.date, photoIds: selectionOf(g) })}
                      >
                        この日で山行を作成
                      </button>
                    )}
                  </div>
                </div>

                {!g.date && (
                  <p className="notice" style={{ marginBottom: 'var(--space-sm)' }}>
                    撮影時刻が取れなかった写真です。日付が決まらないため、既存の山行への手動割り当てのみ行えます。
                  </p>
                )}

                <PhotoGrid
                  photos={g.photos}
                  contributors={contributors}
                  dense
                  selectable
                  selected={chosen}
                  onToggle={(photoId) => toggle(g, photoId)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {creatingFor && (
        <CreateActivityModal
          date={creatingFor.date}
          photoIds={creatingFor.photoIds}
          onClose={() => setCreatingFor(null)}
          onCreated={async () => {
            setCreatingFor(null);
            await load();
          }}
        />
      )}

      {/* 選択中だけ出る操作の帯。削除は必ずここから（未選択のまま日付ごと消す事故を防ぐ） */}
      {allSelected.length > 0 && (
        <div className="selection-bar">
          <span className="t-caption-strong tabular">{allSelected.length}枚</span>
          <button type="button" className="btn btn-sm" onClick={() => setAddingFor({ photoIds: allSelected })}>
            山行に追加
          </button>
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => setDeletingFor({ photoIds: allSelected })}
          >
            削除
          </button>
          <span className="spacer" />
          <button type="button" className="link t-caption" onClick={() => setSelected({})}>
            解除
          </button>
        </div>
      )}

      {deletingFor && (
        <DeletePhotosModal
          photoIds={deletingFor.photoIds}
          onClose={() => setDeletingFor(null)}
          onDeleted={async () => {
            setDeletingFor(null);
            await load();
          }}
        />
      )}

      {addingFor && (
        <Modal title="既存の山行に追加" onClose={() => setAddingFor(null)}>
          <p className="t-caption muted">{addingFor.photoIds.length}枚を追加します。</p>
          <div className="stack" style={{ marginTop: 'var(--space-md)' }}>
            {activities.length === 0 && <p className="empty t-caption">山行がまだありません。</p>}
            {activities.map((a) => (
              <button
                key={a.id}
                type="button"
                className="btn-pearl"
                style={{ justifyContent: 'flex-start' }}
                onClick={async () => {
                  try {
                    await api.assignPhotos(a.id, addingFor.photoIds);
                    setAddingFor(null);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {a.title}（{a.start_date}）
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * 写真の削除。間違えて取り込んだ分をここで取り除く。
 * サーバ側は1枚ずつの DELETE なので、少しだけ並列にして進捗を出す。
 */
function DeletePhotosModal({
  photoIds,
  onClose,
  onDeleted,
}: {
  photoIds: string[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  // 失敗した分だけ残す。消えた写真を再度 DELETE すると 404 になるため、やり直しは残りだけを対象にする
  const [pending, setPending] = useState<string[]>(photoIds);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [deleted, setDeleted] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    setDone(0);
    const failures: string[] = [];
    await runPool(pending, 4, async (id) => {
      try {
        await api.deletePhoto(id);
      } catch (e) {
        failures.push(id);
        console.error(id, e);
      }
      setDone((n) => n + 1);
    });

    setDeleted((n) => n + (pending.length - failures.length));
    setPending(failures);
    if (failures.length > 0) {
      setError(`${failures.length}枚を削除できませんでした。通信を確認してもう一度お試しください。`);
      setBusy(false);
      return;
    }
    onDeleted();
  };

  // 一部だけ消して閉じた場合も一覧を取り直す（消えた写真が残って見えないように）
  const close = () => (deleted > 0 ? onDeleted() : onClose());

  return (
    <Modal
      title="写真を削除"
      onClose={busy ? () => {} : close}
      footer={
        <>
          <button type="button" className="btn-pearl" disabled={busy} onClick={close}>
            {deleted > 0 ? '閉じる' : 'キャンセル'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={remove}>
            {busy ? `削除中… ${done} / ${pending.length}` : `${pending.length}枚を削除する`}
          </button>
        </>
      }
    >
      {error && <p className="notice">{error}</p>}
      <p className="t-caption">
        選択した{pending.length}枚をこのアプリから削除します。<strong>元に戻せません。</strong>
      </p>
      <p className="t-caption muted" style={{ marginTop: 'var(--space-xs)' }}>
        端末の写真ライブラリにある写真は消えません。必要になったら取り込み直せます。
      </p>
      {deleted > 0 && !busy && (
        <p className="t-caption muted">{deleted}枚は削除済みです。残りだけをもう一度試せます。</p>
      )}
    </Modal>
  );
}

function CreateActivityModal({
  date,
  photoIds,
  onClose,
  onCreated,
}: {
  date: string | null;
  photoIds: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [suggestion, setSuggestion] = useState<SuggestResult | null>(null);
  const [links, setLinks] = useState<MountainLink[]>([]);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(date ?? '');
  const [endDate, setEndDate] = useState(date ?? '');
  const [members, setMembers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .suggestForPhotos(photoIds)
      .then((s) => {
        setSuggestion(s);
        // 自動判定はプリセットするだけ。確定させるのはユーザー
        setLinks(
          s.candidates.map((c) => ({
            mountain_id: c.mountain_id,
            is_primary: c.mountain_id === s.primary?.mountain_id,
            summited_at: c.closest_at,
          })),
        );
        if (s.primary) setTitle(`${s.primary.name}`);
      })
      .catch(() => setSuggestion(null));
    // 対象写真は固定なので初回のみ
  }, []);

  const defaultTitle = useMemo(() => title || (date ? `${date} の山行` : '山行'), [title, date]);

  return (
    <Modal
      title="新しい山行を作成"
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
                await api.createActivity({
                  title: defaultTitle,
                  start_date: startDate || undefined,
                  end_date: endDate || startDate || undefined,
                  members: members || null,
                  photo_ids: photoIds,
                  mountains: links,
                });
                onCreated();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '作成中…' : `${photoIds.length}枚で作成`}
          </button>
        </>
      }
    >
      {error && <p className="notice">{error}</p>}
      <label className="field">
        <span>タイトル</span>
        <input type="text" value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          <span>開始日</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>終了日</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>メンバー</span>
        <input type="text" value={members} onChange={(e) => setMembers(e.target.value)} />
      </label>

      <hr className="hairline" />
      <MountainSelect links={links} onChange={setLinks} suggestion={suggestion} />
    </Modal>
  );
}
