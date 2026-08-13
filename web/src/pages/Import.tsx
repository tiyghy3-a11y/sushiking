import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import exifr from 'exifr';
import { api } from '../lib/api';
import { formatOffset } from '../lib/format';
import { buildUploadForm, preparePhoto, runPool, type PreparedPhoto } from '../lib/photo-pipeline';
import type { AppConfig, Contributor } from '../lib/types';

type Phase = 'idle' | 'preparing' | 'ready' | 'uploading' | 'done';

interface Result {
  uploaded: number;
  duplicated: number;
  failed: number;
  noExifTime: number;
  noCoord: number;
}

const UPLOAD_CONCURRENCY = 4;
/** スマホのメモリで安全に扱える上限。超える分はCLIか分割で入れる */
const MAX_FILES_PER_BATCH = 60;

export function Import() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [contributorId, setContributorId] = useState<string>('');
  const [newContributor, setNewContributor] = useState('');
  const [offsetSec, setOffsetSec] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [prepared, setPrepared] = useState<PreparedPhoto[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig(null));
    api
      .contributors()
      .then((r) => {
        setContributors(r.contributors);
        const self = r.contributors.find((c) => c.is_self === 1) ?? r.contributors[0];
        if (self) {
          setContributorId(self.id);
          setOffsetSec(self.default_time_offset_sec);
        }
      })
      .catch(() => setContributors([]));
  }, []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    // 解析結果（原本＋表示用＋サムネ）をメモリに抱えるので、
    // スマホで大量に選ぶとタブごと落ちる。分割を促す。
    if (files.length > MAX_FILES_PER_BATCH) {
      setError(
        `一度に扱えるのは${MAX_FILES_PER_BATCH}枚までです（メモリの都合）。` +
          `分けて取り込むか、数千枚の初回投入は scripts/bulk-import.ts を使ってください。`,
      );
      return;
    }
    setPhase('preparing');
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: files.length });

    const out: PreparedPhoto[] = [];
    let failed = 0;
    // EXIF抽出・HEIC変換・リサイズはすべてブラウザ側で行う
    await runPool(files, 2, async (file) => {
      try {
        out.push(await preparePhoto(file));
      } catch (e) {
        failed++;
        console.error(file.name, e);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    });

    setPrepared(out);
    setResult({
      uploaded: 0,
      duplicated: 0,
      failed,
      noExifTime: out.filter((p) => p.meta.time_source !== 'exif').length,
      noCoord: out.filter((p) => p.meta.coord_source !== 'exif').length,
    });
    setPhase('ready');
  };

  const upload = async () => {
    setPhase('uploading');
    setError(null);
    try {
      let contributor = contributorId;
      if (!contributor && newContributor.trim()) {
        const r = await api.createContributor({
          name: newContributor.trim(),
          default_time_offset_sec: offsetSec,
        });
        contributor = r.contributor.id;
        setContributorId(contributor);
        setContributors((prev) => [...prev, r.contributor]);
      }

      // 既に取り込み済みの hash は投げる前に除外する
      const { existing } = await api.checkHashes(prepared.map((p) => p.hash));
      const existingSet = new Set(existing);
      const targets = prepared.filter((p) => !existingSet.has(p.hash));

      const batch = await api.createBatch({
        contributor_id: contributor || null,
        time_offset_sec: offsetSec,
      });

      let uploaded = 0;
      let duplicated = existingSet.size;
      let failed = 0;
      setProgress({ done: 0, total: targets.length });

      await runPool(targets, UPLOAD_CONCURRENCY, async (item) => {
        try {
          const res = await api.upload(
            buildUploadForm(item, {
              contributor_id: contributor || null,
              batch_id: batch.batch.id,
              time_offset_sec: offsetSec,
              keepsOriginal: config?.keeps_original ?? true,
            }),
          );
          if (res.skipped) duplicated++;
          else uploaded++;
        } catch (e) {
          failed++;
          console.error(item.name, e);
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      });

      setResult({
        uploaded,
        duplicated,
        failed,
        noExifTime: prepared.filter((p) => p.meta.time_source !== 'exif').length,
        noCoord: prepared.filter((p) => p.meta.coord_source !== 'exif').length,
      });
      setPhase('done');
      prepared.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPrepared([]);
    } catch (e) {
      setError((e as Error).message);
      setPhase('ready');
    }
  };

  return (
    <>
      <div className="sub-nav">
        <span className="t-tagline">取り込み</span>
        <span className="spacer" />
        <Link className="link t-caption" to="/inbox">
          未分類トレイへ →
        </Link>
      </div>

      <section className="section-tight canvas-light">
        <div className="wrap-narrow">
          {config && !config.keeps_original && (
            <p className="notice">
              この環境では<strong>原本を保存しません</strong>。表示用（長辺1600px）とサムネイルだけを保存し、
              原本は端末の写真ライブラリに残ります。アップロードもその2枚だけなので通信量は3分の1程度です。
            </p>
          )}
          <p className="notice">
            画像処理はすべてブラウザ側で行います（EXIF抽出・HEIC変換・長辺1600px/400pxの生成）。
            数千枚の初回投入は <code>scripts/bulk-import.ts</code> を使ってください。
            取り込んだ写真は必ず未分類トレイに入り、山行への割り当ては後段で行います。
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles([...e.dataTransfer.files]);
            }}
            style={{
              marginTop: 'var(--space-lg)',
              border: `1px ${dragging ? 'solid var(--primary)' : 'dashed var(--hairline)'}`,
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-xxl)',
              textAlign: 'center',
              background: dragging ? 'var(--canvas-parchment)' : 'var(--canvas)',
            }}
          >
            <p className="t-lead">写真を選ぶ</p>
            <p className="t-caption muted">
              JPEG / HEIC / PNG · 一度に{MAX_FILES_PER_BATCH}枚まで（PCではドラッグ&ドロップも可）
            </p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 'var(--space-md)' }}
              onClick={() => inputRef.current?.click()}
            >
              写真を選択
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,.heic,.heif"
              style={{ display: 'none' }}
              onChange={(e) => void handleFiles([...(e.target.files ?? [])])}
            />
          </div>

          <hr className="hairline" />

          <h2 className="t-section">撮影者</h2>
          <div className="row" style={{ marginTop: 'var(--space-sm)' }}>
            <select
              value={contributorId}
              onChange={(e) => {
                setContributorId(e.target.value);
                const c = contributors.find((x) => x.id === e.target.value);
                if (c) setOffsetSec(c.default_time_offset_sec);
              }}
              style={{ flex: 1 }}
            >
              <option value="">（新規作成）</option>
              {contributors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_self === 1 ? '（自分）' : ''}
                </option>
              ))}
            </select>
            {!contributorId && (
              <input
                type="text"
                placeholder="撮影者名"
                value={newContributor}
                onChange={(e) => setNewContributor(e.target.value)}
                style={{ flex: 1 }}
              />
            )}
          </div>

          <OffsetHelper offsetSec={offsetSec} onChange={setOffsetSec} />

          {(phase === 'preparing' || phase === 'uploading') && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <p className="t-caption muted">
                {phase === 'preparing' ? '解析中' : 'アップロード中'} {progress.done} / {progress.total}
              </p>
              <div className="progress-bar">
                <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            </div>
          )}

          {phase === 'ready' && result && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <h2 className="t-section">解析結果</h2>
              <p className="t-caption muted">
                {prepared.length}枚を解析しました（EXIF時刻なし {result.noExifTime}枚 / EXIF座標なし{' '}
                {result.noCoord}枚 / 読み込み失敗 {result.failed}枚）。
              </p>
              <div className="photo-grid dense" style={{ marginTop: 'var(--space-sm)' }}>
                {prepared.slice(0, 24).map((p) => (
                  <div key={p.hash} className="photo-cell">
                    <img src={p.previewUrl} alt="" />
                    {p.meta.coord_source !== 'exif' && (
                      <span className="badges">
                        <span className="chip chip-dim">座標なし</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {error && <p className="notice" style={{ marginTop: 'var(--space-sm)' }}>{error}</p>}
              <button type="button" className="btn" style={{ marginTop: 'var(--space-lg)' }} onClick={upload}>
                {prepared.length}枚をアップロード
              </button>
            </div>
          )}

          {phase === 'done' && result && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <h2 className="t-section">取り込み完了</h2>
              <p className="t-caption">
                成功 {result.uploaded}枚 / 取り込み済みのためスキップ {result.duplicated}枚 / 失敗{' '}
                {result.failed}枚
              </p>
              <p className="t-caption muted">
                EXIF時刻なし {result.noExifTime}枚 · EXIF座標なし {result.noCoord}枚
              </p>
              <Link className="btn" style={{ marginTop: 'var(--space-md)' }} to="/inbox">
                未分類トレイで整理する
              </Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * 時計オフセットの算出。
 * 「基準にする自分の写真」と「同じ瞬間を写した相手の写真」を1組選ばせ、
 * EXIF時刻の差分をオフセット候補として提示する（山頂標識の写真で十分な精度が出る）。
 */
function OffsetHelper({ offsetSec, onChange }: { offsetSec: number; onChange: (sec: number) => void }) {
  const [refAt, setRefAt] = useState<string | null>(null);
  const [targetAt, setTargetAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const readTime = async (file: File): Promise<string | null> => {
    try {
      const exif = (await exifr.parse(await file.arrayBuffer(), { exif: true })) as
        | { DateTimeOriginal?: Date; CreateDate?: Date }
        | undefined;
      const d = exif?.DateTimeOriginal ?? exif?.CreateDate;
      return d instanceof Date ? d.toISOString() : null;
    } catch {
      return null;
    }
  };

  const candidate =
    refAt && targetAt ? Math.round((new Date(refAt).getTime() - new Date(targetAt).getTime()) / 1000) : null;

  return (
    <div style={{ marginTop: 'var(--space-lg)' }}>
      <h2 className="t-section">時計オフセット</h2>
      <p className="t-caption muted">
        カメラ時計のずれを秒で補正します。補正前の値は監査用に残ります。
      </p>

      <label className="field" style={{ marginTop: 'var(--space-sm)' }}>
        <span>オフセット（秒）— 現在 {formatOffset(offsetSec)}</span>
        <input
          type="number"
          value={offsetSec}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      </label>

      <div className="row">
        <label className="btn-pearl" style={{ cursor: 'pointer' }}>
          基準（自分）の写真
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              setRefAt(await readTime(f));
              setBusy(false);
            }}
          />
        </label>
        <label className="btn-pearl" style={{ cursor: 'pointer' }}>
          同じ瞬間の相手の写真
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              setTargetAt(await readTime(f));
              setBusy(false);
            }}
          />
        </label>
        {busy && <span className="t-caption muted">読み込み中…</span>}
        {candidate !== null && (
          <button type="button" className="link t-caption" onClick={() => onChange(candidate)}>
            差分 {formatOffset(candidate)} を採用
          </button>
        )}
        {(refAt || targetAt) && candidate === null && (
          <span className="t-caption muted">どちらかの写真にEXIF時刻がありません</span>
        )}
      </div>
    </div>
  );
}
