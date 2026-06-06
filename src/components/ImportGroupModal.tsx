import type { AppData } from '../types';
import { formatCurrency } from '../utils/calculator';

interface Props {
  sharedData: AppData;
  hasExistingGroup: boolean;
  onImport: () => void;
  onDismiss: () => void;
}

export default function ImportGroupModal({ sharedData, hasExistingGroup, onImport, onDismiss }: Props) {
  const total = sharedData.expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ maxWidth: 430, margin: '0 auto', left: 0, right: 0 }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full bg-white rounded-3xl shadow-2xl p-6">
        <div className="text-center mb-5">
          <div className="text-5xl mb-3">🔗</div>
          <h2 className="text-xl font-bold text-ink">グループに参加</h2>
          <p className="text-ink-muted text-sm mt-1">共有されたグループが見つかりました</p>
        </div>

        {/* Group info */}
        <div className="bg-gray-50 rounded-2xl p-4 mb-5">
          <p className="text-xs text-ink-muted mb-1">グループ名</p>
          <p className="font-bold text-ink text-lg mb-3">{sharedData.groupName}</p>

          <div className="flex gap-4 mb-3">
            <div>
              <p className="text-xs text-ink-muted">メンバー</p>
              <p className="font-semibold text-ink">{sharedData.members.length}人</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">支払い</p>
              <p className="font-semibold text-ink">{sharedData.expenses.length}件</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">合計</p>
              <p className="font-semibold text-ink">{formatCurrency(total, sharedData.currency)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {sharedData.members.map(m => (
              <div key={m.id} className="flex items-center gap-1 bg-white rounded-full px-2.5 py-1">
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                <span className="text-xs font-medium text-ink">{m.name}</span>
              </div>
            ))}
          </div>
        </div>

        {hasExistingGroup && (
          <div className="bg-amber-50 rounded-xl p-3 mb-4 flex gap-2">
            <span className="text-sm flex-shrink-0">⚠️</span>
            <p className="text-xs text-amber-800">現在のグループのデータは上書きされます</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 py-3 bg-gray-100 text-ink rounded-xl font-semibold text-sm active:scale-95 transition-transform"
          >
            キャンセル
          </button>
          <button
            onClick={onImport}
            className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold text-sm active:scale-95 transition-transform"
          >
            インポート
          </button>
        </div>
      </div>
    </div>
  );
}
