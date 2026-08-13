import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatOffset } from '../lib/format';
import { MapView, type MapMarker } from '../components/MapView';
import type { Contributor, Mountain } from '../lib/types';

export function Settings() {
  return (
    <>
      <div className="sub-nav">
        <span className="t-tagline">設定</span>
      </div>
      <ContributorSettings />
      <StorageSettings />
      <MountainSettings />
    </>
  );
}

function ContributorSettings() {
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [name, setName] = useState('');
  const [isSelf, setIsSelf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .contributors()
      .then((r) => setContributors(r.contributors))
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="section-tight canvas-light">
      <div className="wrap-narrow">
        <h2 className="t-section">撮影者</h2>
        <p className="t-caption muted">
          カメラ時計のずれは撮影者ごとの既定オフセットとして保存され、取り込み時に適用されます。
        </p>
        {error && <p className="notice">{error}</p>}

        <div className="stack" style={{ marginTop: 'var(--space-lg)' }}>
          {contributors.map((c) => (
            <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="t-caption">
                {c.name}
                {c.is_self === 1 ? '（自分）' : ''}
                <span className="muted"> · 写真 {c.photo_count ?? 0}枚</span>
              </span>
              <span className="row">
                <span className="t-caption muted">{formatOffset(c.default_time_offset_sec)}</span>
                <input
                  type="number"
                  defaultValue={c.default_time_offset_sec}
                  style={{ width: 120 }}
                  onBlur={(e) =>
                    api
                      .updateContributor(c.id, { default_time_offset_sec: Number(e.target.value) || 0 })
                      .then(load)
                      .catch((err: Error) => setError(err.message))
                  }
                />
              </span>
            </div>
          ))}
        </div>

        <hr className="hairline" />
        <div className="row">
          <input
            type="text"
            placeholder="撮影者名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <label className="row t-caption" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={isSelf}
              onChange={(e) => setIsSelf(e.target.checked)}
            />
            自分
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!name.trim()}
            onClick={() =>
              api
                .createContributor({ name: name.trim(), is_self: isSelf })
                .then(() => {
                  setName('');
                  setIsSelf(false);
                  return load();
                })
                .catch((e: Error) => setError(e.message))
            }
          >
            追加
          </button>
        </div>
      </div>
    </section>
  );
}

/** D1 に画像を置く構成では無料枠の残りが気になるので、合計サイズを出す */
function StorageSettings() {
  const [info, setInfo] = useState<{ bytes: number; photos: number; mode: string; keepsOriginal: boolean } | null>(
    null,
  );

  useEffect(() => {
    Promise.all([api.progress(), api.config()])
      .then(([p, c]) =>
        setInfo({
          bytes: p.stored_image_bytes,
          photos: p.photo_count,
          mode: c.photo_storage,
          keepsOriginal: c.keeps_original,
        }),
      )
      .catch(() => setInfo(null));
  }, []);

  if (!info) return null;
  const mb = info.bytes / 1024 / 1024;

  return (
    <section className="section-tight canvas-light">
      <div className="wrap-narrow">
        <h2 className="t-section">保存状況</h2>
        <div className="stat-grid" style={{ marginTop: 'var(--space-lg)' }}>
          <div>
            <p className="t-caption muted">写真</p>
            <p className="stat-value">{info.photos.toLocaleString('ja-JP')}枚</p>
          </div>
          <div>
            <p className="t-caption muted">画像の合計サイズ</p>
            <p className="stat-value">{mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`}</p>
          </div>
        </div>
        <p className="t-caption muted" style={{ marginTop: 'var(--space-md)' }}>
          {info.keepsOriginal
            ? '原本・表示用・サムネイルを R2 に保存しています。'
            : '表示用（長辺1600px）とサムネイルをデータベースに保存しています。原本は端末の写真ライブラリに残ります。'}
        </p>
      </div>
    </section>
  );
}

/**
 * 百名山マスタの座標・判定半径の編集。
 * 地名検索は山頂ではなく代表点を返すことがあるので、ここで地図上のピンをドラッグして補正し、
 * 確認できたら「確認済み」にする。
 */
function MountainSettings() {
  const [mountains, setMountains] = useState<Mountain[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ lat: number; lng: number; match_radius_m: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api
      .mountains()
      .then((r) => {
        setMountains(r.mountains);
        setSelectedId((prev) => prev ?? r.mountains[0]?.id ?? null);
      })
      .catch(() => setMountains([]));
  }, []);

  const selected = useMemo(
    () => mountains.find((m) => m.id === selectedId) ?? null,
    [mountains, selectedId],
  );

  useEffect(() => {
    if (selected) {
      setDraft({ lat: selected.lat, lng: selected.lng, match_radius_m: selected.match_radius_m });
      setStatus(null);
    }
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return mountains;
    return mountains.filter(
      (m) => m.name.includes(q) || (m.name_kana ?? '').includes(q) || (m.area ?? '').includes(q),
    );
  }, [mountains, query]);

  const markers: MapMarker[] =
    selected && draft
      ? [
          {
            id: String(selected.id),
            lat: draft.lat,
            lng: draft.lng,
            className: 'mountain-pin climbed',
            title: selected.name,
            draggable: true,
            onDragEnd: ({ lat, lng }) => setDraft((d) => (d ? { ...d, lat, lng } : d)),
          },
        ]
      : [];

  const save = async (verified: boolean) => {
    if (!selected || !draft) return;
    try {
      const r = await api.updateMountain(selected.id, { ...draft, verified });
      setMountains((prev) => prev.map((m) => (m.id === r.mountain.id ? { ...m, ...r.mountain } : m)));
      setStatus('保存しました');
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <section className="section-tight canvas-light">
      <div className="wrap">
        <h2 className="t-section">百名山マスタ</h2>
        <p className="t-caption muted">
          未確認の座標は数百m〜1kmずれていることがあります。北アルプス・南アルプスは判定半径が1500mなので、
          ずれがそのまま誤判定になります。地図のピンをドラッグして山頂に合わせ、確認済みにしてください。
        </p>

        <div className="row" style={{ marginTop: 'var(--space-lg)', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 280px', minWidth: 260 }}>
            <input
              type="search"
              placeholder="山名で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="stack" style={{ marginTop: 'var(--space-sm)', maxHeight: 480, overflow: 'auto', gap: 2 }}>
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="link t-caption"
                  style={{
                    textAlign: 'left',
                    padding: '12px 0',
                    minHeight: 44,
                    color: m.id === selectedId ? 'var(--primary)' : 'var(--ink)',
                    fontWeight: m.id === selectedId ? 600 : 400,
                  }}
                  onClick={() => setSelectedId(m.id)}
                >
                  {m.name}
                  <span className="muted">
                    {' '}
                    {m.elevation}m · {m.match_radius_m}m
                    {m.verified ? ' · 確認済' : ' · 未確認'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: '2 1 520px', minWidth: 320 }}>
            {selected && draft && (
              <>
                <MapView
                  markers={markers}
                  center={[draft.lng, draft.lat]}
                  zoom={13}
                  defaultLayer="std"
                  onMapClick={({ lat, lng }) => setDraft((d) => (d ? { ...d, lat, lng } : d))}
                />
                <div className="row" style={{ marginTop: 'var(--space-sm)' }}>
                  <label className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <span>緯度</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={draft.lat}
                      onChange={(e) => setDraft({ ...draft, lat: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <span>経度</span>
                    <input
                      type="number"
                      step="0.000001"
                      value={draft.lng}
                      onChange={(e) => setDraft({ ...draft, lng: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <span>判定半径 (m)</span>
                    <input
                      type="number"
                      step="100"
                      value={draft.match_radius_m}
                      onChange={(e) => setDraft({ ...draft, match_radius_m: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="row" style={{ marginTop: 'var(--space-md)' }}>
                  <button type="button" className="btn btn-sm" onClick={() => save(true)}>
                    保存して確認済みにする
                  </button>
                  <button type="button" className="btn-pearl" onClick={() => save(false)}>
                    保存のみ
                  </button>
                  {status && <span className="t-caption muted">{status}</span>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
