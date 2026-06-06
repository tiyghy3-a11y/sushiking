import { useState } from 'react';
import type { AppData } from '../types';
import { generateShareURL } from '../utils/share';

interface Props {
  data: AppData;
  onClose: () => void;
}

export default function ShareModal({ data, onClose }: Props) {
  const url = generateShareURL(data);
  const [copied, setCopied] = useState(false);

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
          <div className="bg-amber-50 rounded-xl p-3 mb-4 flex gap-2">
            <span className="text-base flex-shrink-0">💡</span>
            <p className="text-xs text-amber-800 leading-relaxed">
              URLを開くとグループのデータ（メンバー・支払い・精算）をインポートできます。データはURLに含まれているためサーバー不要です。
            </p>
          </div>

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
        </div>
      </div>
    </div>
  );
}
