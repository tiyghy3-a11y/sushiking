import { useState, useEffect } from 'react';
import type { Member, Expense, CategoryKey } from '../types';
import { CATEGORIES } from '../types';

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

  useEffect(() => {
    if (!expense) {
      setSplitAmong(members.map(m => m.id));
    }
  }, [members, expense]);

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
