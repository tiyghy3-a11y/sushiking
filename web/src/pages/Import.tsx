import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import exifr from 'exifr';
import { api } from '../lib/api';
import { formatOffset } from '../lib/format';
import { buildUploadForm, preparePhoto, runPool, type PreparedPhoto } from '../lib/photo-pipeline';
import type { AppConfig, Contributor } from '../lib/types';

type Phase = 'idle' | 'running' | 'done';

interface Tally {
  uploaded: number;
  duplicated: number;
  failed: number;
  readFailed: number;
  noExifTime: number;
  noCoord: number;
}

const PREPARE_CONCURRENCY = 2;
/* 1リクエストで画像をデータベースに書くので、同時に走らせすぎない */
const UPLOAD_CONCURRENCY = 2;
/**
 * 解析結果（表示用＋サムネイル）を同時にメモリへ載せる枚数。
 * 全部まとめて解析してから送ると iPhone ではタブごと落ちるので、
 * この単位で「解析 → 送信 → 解放」を繰り返す。枚数の上限ではない。
 */
const CHUNK_SIZE = 6;
/** 1回の取り込みで扱う上限。これを超える初回投入は scripts/bulk-import.ts の領分 */
const MAX_FILES = 500;
/** 解析済みプレビューを画面に残す枚数（残りは即座に解放する） */
const PREVIEW_LIMIT = 12;

const emptyTally = (): Tally => ({
  uploaded: 0,
  duplicated: 0,
  failed: 0,
  readFailed: 0,
  noExifTime: 0,
  noCoord: 0,
});

/**
 * 電波が切れがちな山間部や、iPhone の省電力による一時的な失敗を拾い直す。
 * 認証切れだけは再試行しても無駄なので即座に投げ直す（api 側が再読み込みに乗せる）。
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if ((e as Error).message.includes('サインイン')) throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 600 * 2 ** i));
    }
  }
  throw lastError;
}

/** 取り込み中に画面が消えると処理が止まるので、可能なら画面の点灯を維持する */
async function acquireWakeLock(): Promise<{ release: () => void }> {
  try {
    const sentinel = await navigator.wakeLock?.request('screen');
    return { release: () => void sentinel?.release().catch(() => {}) };
  } catch {
    return { release: () => {} };
  }
}

export function Import() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [contributorId, setContributorId] = useState<string>('');
  const [newContributor, setNewContributor] = useState('');
  const [offsetSec, setOffsetSec] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<'解析中' | 'アップロード中'>('解析中');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [previews, setPreviews] = useState<string[]>([]);
  const [tally, setTally] = useState<Tally | null>(null);
  /** 失敗した写真そのもの。ファイル名では端末の写真と結び付かないので、画像と再試行ボタンで示す */
  const [failures, setFailures] = useState<{ file: File; url: string; reason: string }[]>([]);
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

  const handleFiles = (selected: File[]) => {
    if (selected.length === 0) return;
    setError(
      selected.length > MAX_FILES
        ? `一度に扱えるのは${MAX_FILES}枚までです。分けて取り込むか、数千枚の初回投入は scripts/bulk-import.ts を使ってください。`
        : null,
    );
    if (selected.length > MAX_FILES) return;

    previews.forEach((url) => URL.revokeObjectURL(url));
    failures.forEach((f) => URL.revokeObjectURL(f.url));
    setPreviews([]);
    setFailures([]);
    setFiles(selected);
    setTally(null);
    setPhase('idle');
    setProgress({ done: 0, total: selected.length });
  };

  /** 失敗した分だけをもう一度流す */
  const retryFailed = () => {
    const again = failures.map((f) => f.file);
    failures.forEach((f) => URL.revokeObjectURL(f.url));
    setFailures([]);
    setFiles(again);
    void run(again);
  };

  /**
   * 解析と送信を CHUNK_SIZE 枚ずつ交互に回す。
   * 全部解析してから送る作りだと、枚数に比例してメモリを食い、iPhone では
   * 途中でタブが落ちて「何も起きない」状態になる。少しずつ解放しながら進める。
   */
  const run = async (targets: File[] = files) => {
    setPhase('running');
    setError(null);
    const wakeLock = await acquireWakeLock();
    const totals = emptyTally();
    const failed: { file: File; url: string; reason: string }[] = [];
    let kept = 0; // 画面に残しているプレビューの数

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

      const batch = await api.createBatch({
        contributor_id: contributor || null,
        time_offset_sec: offsetSec,
      });

      setProgress({ done: 0, total: targets.length });

      for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE);

        // 1. 解析（EXIF抽出・HEIC変換・リサイズ。すべてブラウザ側）
        setStep('解析中');
        const prepared: PreparedPhoto[] = [];
        await runPool(chunk, PREPARE_CONCURRENCY, async (file) => {
          try {
            prepared.push(await preparePhoto(file));
          } catch (e) {
            totals.readFailed++;
            failed.push({
              file,
              url: URL.createObjectURL(file),
              reason: `読み込めませんでした（${(e as Error).message}）`,
            });
            console.error(file.name, e);
          }
        });

        for (const p of prepared) {
          if (p.meta.time_source !== 'exif') totals.noExifTime++;
          if (p.meta.coord_source !== 'exif') totals.noCoord++;
        }

        // 2. 取り込み済みは投げる前に除外する
        let toUpload = prepared;
        try {
          const { existing } = await api.checkHashes(prepared.map((p) => p.hash));
          const existingSet = new Set(existing);
          totals.duplicated += existingSet.size;
          toUpload = prepared.filter((p) => !existingSet.has(p.hash));
        } catch {
          // 重複チェックに失敗しても送信は続ける（Worker 側でも hash で弾かれる）
        }

        // 3. 送信
        setStep('アップロード中');
        const succeeded = new Set<PreparedPhoto>();
        await runPool(toUpload, UPLOAD_CONCURRENCY, async (item) => {
          try {
            const res = await withRetry(() =>
              api.upload(
                buildUploadForm(item, {
                  contributor_id: contributor || null,
                  batch_id: batch.batch.id,
                  time_offset_sec: offsetSec,
                  keepsOriginal: config?.keeps_original ?? true,
                }),
              ),
            );
            if (res.skipped) totals.duplicated++;
            else {
              totals.uploaded++;
              succeeded.add(item);
            }
          } catch (e) {
            totals.failed++;
            // サムネイルは生成済みなので、それを見せて「この写真」と分かるようにする
            failed.push({
              file: item.file,
              url: URL.createObjectURL(item.thumbBlob),
              reason: (e as Error).message,
            });
            console.error(item.name, e);
          }
        });

        // 4. このかたまりで確保したメモリを手放す。
        //    取り込めた写真だけをプレビューに残す（失敗した写真は下の別枠で出す）
        const keepUrls: string[] = [];
        for (const p of prepared) {
          if (succeeded.has(p) && kept < PREVIEW_LIMIT) {
            keepUrls.push(p.previewUrl);
            kept++;
          } else {
            URL.revokeObjectURL(p.previewUrl);
          }
        }
        if (keepUrls.length) setPreviews((prev) => [...prev, ...keepUrls]);

        setTally({ ...totals });
        setFailures([...failed]);
        setProgress({ done: Math.min(i + chunk.length, targets.length), total: targets.length });
      }

      setPhase('done');
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
      setTally({ ...totals });
      setPhase('idle');
    } finally {
      wakeLock.release();
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
            枚数が多いときは{CHUNK_SIZE}枚ずつ自動で解析・送信するので、そのまま待っていれば進みます。
            数千枚の初回投入は <code>scripts/bulk-import.ts</code> を使ってください。
            取り込んだ写真は必ず未分類トレイに入り、山行への割り当ては後段で行います。
          </p>
          {error && <p className="notice">{error}</p>}

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
              JPEG / HEIC / PNG · 一度に{MAX_FILES}枚まで（PCではドラッグ&ドロップも可）
            </p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 'var(--space-md)' }}
              disabled={phase === 'running'}
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
              onChange={(e) => {
                handleFiles([...(e.target.files ?? [])]);
                // 同じ写真を選び直せるようにする（iOS では値が残ると再選択が効かない）
                e.target.value = '';
              }}
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

          {phase === 'idle' && files.length > 0 && !tally && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <p className="t-caption muted">{files.length}枚を選択しました。</p>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 'var(--space-md)' }}
                onClick={() => void run()}
              >
                {files.length}枚を取り込む
              </button>
            </div>
          )}

          {phase === 'running' && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <p className="t-caption muted">
                {step} {progress.done} / {progress.total}
              </p>
              <div className="progress-bar">
                <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <p className="t-fine muted" style={{ marginTop: 'var(--space-xs)' }}>
                この画面を開いたままにしてください。他のアプリに切り替えると止まることがあります。
              </p>
            </div>
          )}

          {tally && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <h2 className="t-section">{phase === 'done' ? '取り込み完了' : '取り込み状況'}</h2>
              <p className="t-caption">
                成功 {tally.uploaded}枚 / 取り込み済みのためスキップ {tally.duplicated}枚 / 失敗{' '}
                {tally.failed + tally.readFailed}枚
              </p>
              <p className="t-caption muted">
                EXIF時刻なし {tally.noExifTime}枚 · EXIF座標なし {tally.noCoord}枚
              </p>
              {failures.length > 0 && phase !== 'running' && (
                <div style={{ marginTop: 'var(--space-lg)' }}>
                  <h3 className="t-tagline">入らなかった写真</h3>
                  <p className="t-caption muted">{failures[0].reason}</p>
                  <div className="photo-grid dense" style={{ marginTop: 'var(--space-sm)' }}>
                    {failures.map((f) => (
                      <div key={f.url} className="photo-cell">
                        <img src={f.url} alt="" />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 'var(--space-md)' }}
                    onClick={retryFailed}
                  >
                    この{failures.length}枚をもう一度試す
                  </button>
                </div>
              )}
              {previews.length > 0 && (
                <div style={{ marginTop: 'var(--space-lg)' }}>
                  {failures.length > 0 && <h3 className="t-tagline">取り込んだ写真</h3>}
                  <div className="photo-grid dense" style={{ marginTop: 'var(--space-sm)' }}>
                    {previews.map((url) => (
                      <div key={url} className="photo-cell">
                        <img src={url} alt="" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {phase === 'done' && (
                <Link className="btn" style={{ marginTop: 'var(--space-md)' }} to="/inbox">
                  未分類トレイで整理する
                </Link>
              )}
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
