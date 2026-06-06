import { useState, useEffect, useRef } from 'react';
import type { Member, Expense, CategoryKey } from '../types';
import { CATEGORIES } from '../types';
import { scanReceipt } from '../utils/receipt';

interface Props {
  members: Member[];
  expense?: Expense | null;
  onSave: (expense: Omit<Expense, 'id'>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function AddExpenseModal({ members, expense, onSave, onDelete, onClose }: Props) {
  const today = new Date().toISOString().split('T')[0];

  const [title, setTitle] = useState(expense?.title ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? (members[0]?.id ?? ''));
  const [splitAmong, setSplitAmong] = useState<string[]>(
    expense?.splitAmong ?? members.map(m => m.id)
  );
  const [date, setDate] = useState(expense?.date ?? today);
  const [category, setCategory] = useState<CategoryKey>(expense?.category ?? 'food');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) {
      setSplitAmong(members.map(m => m.id));
    }
  }, [members, expense]);

  async function handleReceiptSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 同じファイルを再選択しても発火するようにリセット
    e.target.value = '';
    if (!file) return;

    setScanning(true);
    setScanProgress(0);
    setScanMessage(null);
    setScanError(null);

    try {
      const result = await scanReceipt(file, p => setScanProgress(p));

      const filled: string[] = [];
      if (result.amount !== null) {
        setAmount(String(result.amount));
        filled.push('金額');
      }
      if (result.date) {
        setDate(result.date);
        filled.push('日付');
      }
      // 内容が未入力の場合のみ、読み取った店名などで補完
      if (result.title && !title.trim()) {
        setTitle(result.title);
        filled.push('内容');
      }

      if (filled.length > 0) {
        setScanMessage(`${filled.join('・')}を読み取りました。内容をご確認ください。`);
      } else {
        setScanError('うまく読み取れませんでした。手動で入力してください。');
      }
    } catch (err) {
      console.error('レシートの読み取りに失敗しました', err);
      setScanError('読み取りに失敗しました。もう一度お試しください。');
    } finally {
      setScanning(false);
    }
  }

  function toggleSplit(id: string) {
    setSplitAmong(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!title.trim() || isNaN(parsed) || parsed <= 0 || !paidBy || splitAmong.length === 0) return;
    onSave({ title: title.trim(), amount: parsed, paidBy, splitAmong, date, category });
  }

  const isValid = title.trim() && parseFloat(amount) > 0 && paidBy && splitAmong.length > 0;
  const perPerson = parseFloat(amount) > 0 && splitAmong.length > 0
    ? (parseFloat(amount) / splitAmong.length).toFixed(2)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ maxWidth: 430, margin: '0 auto', left: 0, right: 0 }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-3xl shadow-2xl max-h-[92dvh] overflow-y-auto overflow-x-hidden" style={{ touchAction: 'pan-y' }}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        <div className="px-5 pb-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-ink">
              {expense ? '支払いを編集' : '支払いを追加'}
            </h2>
            <button onClick={onClose} className="text-ink-muted text-2xl leading-none active:opacity-70 w-8 h-8 flex items-center justify-center">
              ×
            </button>
          </div>

          {/* Receipt scan */}
          <div className="mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleReceiptSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={scanning}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary-50 text-primary font-semibold active:scale-95 transition-transform disabled:opacity-60"
            >
              {scanning ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <span>読み取り中… {Math.round(scanProgress * 100)}%</span>
                </>
              ) : (
                <>
                  <span className="text-lg">📷</span>
                  <span>レシートを撮影して読み取り</span>
                </>
              )}
            </button>
            {scanMessage && (
              <p className="text-xs text-green-600 mt-2 flex items-start gap-1">
                <span>✓</span>
                <span>{scanMessage}</span>
              </p>
            )}
            {scanError && (
              <p className="text-xs text-red-500 mt-2">{scanError}</p>
            )}
          </div>

          {/* Category */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink mb-2">カテゴリ</label>
            <div className="flex gap-2 flex-wrap">
              {(Object.entries(CATEGORIES) as [CategoryKey, { label: string; emoji: string }][]).map(
                ([key, cat]) => (
                  <button
                    key={key}
                    onClick={() => setCategory(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all active:scale-95 ${
                      category === key
                        ? 'border-primary bg-primary-50 text-primary'
                        : 'border-gray-100 bg-gray-50 text-ink-muted'
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    <span>{cat.label}</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* Title */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink mb-1.5">内容</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例：ランチ代"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink placeholder-gray-300"
            />
          </div>

          {/* Amount */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink mb-1.5">金額</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted font-medium">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full pl-8 pr-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink placeholder-gray-300 text-lg font-semibold"
              />
            </div>
          </div>

          {/* Date */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink mb-1.5">日付</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink"
            />
          </div>

          {/* Paid by */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink mb-2">支払った人</label>
            <div className="flex gap-2 flex-wrap">
              {members.map(m => (
                <button
                  key={m.id}
                  onClick={() => setPaidBy(m.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all active:scale-95 ${
                    paidBy === m.id
                      ? 'border-transparent text-white'
                      : 'border-gray-100 bg-gray-50 text-ink'
                  }`}
                  style={paidBy === m.id ? { backgroundColor: m.color, borderColor: m.color } : {}}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: paidBy === m.id ? 'rgba(255,255,255,0.3)' : m.color }}
                  >
                    {m.name[0]}
                  </div>
                  <span className="text-sm font-medium">{m.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Split among */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-ink">割り勘する人</label>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSplitAmong(members.map(m => m.id))}
                  className="text-primary font-medium active:opacity-70"
                >
                  全員
                </button>
                <span className="text-gray-200">|</span>
                <button
                  onClick={() => setSplitAmong([])}
                  className="text-ink-muted active:opacity-70"
                >
                  クリア
                </button>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {members.map(m => {
                const selected = splitAmong.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleSplit(m.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all active:scale-95 ${
                      selected ? 'border-transparent text-white' : 'border-gray-100 bg-gray-50 text-ink'
                    }`}
                    style={selected ? { backgroundColor: m.color, borderColor: m.color } : {}}
                  >
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: selected ? 'rgba(255,255,255,0.3)' : m.color }}
                    >
                      {selected ? '✓' : m.name[0]}
                    </div>
                    <span className="text-sm font-medium">{m.name}</span>
                  </button>
                );
              })}
            </div>
            {perPerson && (
              <p className="text-xs text-ink-muted mt-2">
                1人あたり：${perPerson} × {splitAmong.length}人
              </p>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            {expense && onDelete && (
              <button
                onClick={onDelete}
                className="flex-1 py-3.5 bg-red-50 text-red-500 rounded-xl font-semibold active:scale-95 transition-transform"
              >
                削除
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={!isValid}
              className="flex-1 py-3.5 bg-primary text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              {expense ? '保存' : '追加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
