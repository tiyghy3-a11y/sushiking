import { useEffect, useRef, useState } from 'react';
import type { AppData } from '../types';
import { generateShareURL, generateSyncURL } from '../utils/share';
import { isSyncEnabled } from '../utils/supabase';
import { createSyncGroup } from '../utils/sync';

interface Props {
  data: AppData;
  onAssignSyncId: (syncId: string) => void;
  onClose: () => void;
}

export default function ShareModal({ data, onAssignSyncId, onClose }: Props) {
  const [syncId, setSyncId] = useState<string | null>(data.syncId ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const requested = useRef(false);

  // 同期が使えてまだIDがなければ、共有用にクラウドへグループを作成する
  useEffect(() => {
    if (!isSyncEnabled || syncId || requested.current) return;
    requested.current = true;
    let cancelled = false;
    setCreating(true);
    setError(false);
    createSyncGroup(data).then(id => {
      if (cancelled) return;
      setCreating(false);
      if (id) {
        setSyncId(id);
        onAssignSyncId(id);
      } else {
        setError(true);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const synced = isSyncEnabled && !!syncId;
  const url = synced ? generateSyncURL(syncId as string) : generateShareURL(data);

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleNativeShare() {
    if (navigator.share) {
      await navigator.share({
        title: `${data.groupName} の割り勘`,
        text: `${data.groupName} のグループに参加して割り勘を確認しましょう`,
        url,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ maxWidth: 430, margin: '0 auto', left: 0, right: 0 }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-3xl shadow-2xl overflow-hidden" style={{ touchAction: 'pan-y' }}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        <div className="px-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-ink">グループを共有</h2>
            <button onClick={onClose} className="text-ink-muted text-2xl leading-none w-8 h-8 flex items-center justify-center active:opacity-70">×</button>
          </div>

          {creating ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm text-ink-muted">同期リンクを準備中…</p>
            </div>
          ) : (
            <>
              {/* QR Code */}
              <div className="flex flex-col items-center mb-5">
                <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 mb-2">
                  <img
                    src={qrUrl}
                    alt="QR Code"
                    className="w-40 h-40"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <p className="text-xs text-ink-muted">スキャンしてグループに参加</p>
              </div>

              {/* URL */}
              <div className="bg-gray-50 rounded-xl p-3 mb-4">
                <p className="text-xs text-ink-muted mb-1">共有URL</p>
                <p className="text-xs text-ink break-all font-mono leading-relaxed">{url.slice(0, 80)}…</p>
              </div>

              {/* Info */}
              {synced ? (
                <div className="bg-emerald-50 rounded-xl p-3 mb-4 flex gap-2">
                  <span className="text-base flex-shrink-0">🔄</span>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    このリンクはクラウドと同期されています。誰かが支払いを追加すると、リンクを開くたびに常に最新の状態が表示されます。
                  </p>
                </div>
              ) : (
                <div className="bg-amber-50 rounded-xl p-3 mb-4 flex gap-2">
                  <span className="text-base flex-shrink-0">💡</span>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    {error
                      ? 'クラウド同期に接続できなかったため、現時点のデータを含むリンクを発行しました（自動同期はされません）。'
                      : 'URLを開くとグループのデータ（メンバー・支払い・精算）をインポートできます。データはURLに含まれているためサーバー不要です。'}
                  </p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex flex-col gap-2">
                {typeof navigator.share === 'function' && (
                  <button
                    onClick={handleNativeShare}
                    className="w-full py-3.5 bg-primary text-white rounded-xl font-semibold active:scale-95 transition-transform flex items-center justify-center gap-2"
                  >
                    <span>↗</span> 共有する
                  </button>
                )}
                <button
                  onClick={handleCopy}
                  className={`w-full py-3.5 rounded-xl font-semibold active:scale-95 transition-all flex items-center justify-center gap-2 ${
                    copied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-100 text-ink'
                  }`}
                >
                  {copied ? '✓ コピーしました' : 'URLをコピー'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
