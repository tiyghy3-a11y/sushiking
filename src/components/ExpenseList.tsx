import { useState } from 'react';
import type { Member, Expense, AppData } from '../types';
import { CATEGORIES } from '../types';
import { formatCurrency } from '../utils/calculator';
import AddExpenseModal from './AddExpenseModal';
import ShareModal from './ShareModal';

interface Props {
  data: AppData;
  members: Member[];
  expenses: Expense[];
  onAddExpense: (expense: Omit<Expense, 'id'>) => void;
  onUpdateExpense: (id: string, expense: Omit<Expense, 'id'>) => void;
  onDeleteExpense: (id: string) => void;
}

export default function ExpenseList({
  data,
  members,
  expenses,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
}: Props) {
  const { groupName, currency } = data;
  const [showAdd, setShowAdd] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date));

  function getMember(id: string) {
    return members.find(m => m.id === id);
  }

  return (
    <div className="flex flex-col min-h-dvh">
      {/* Header */}
      <div className="bg-primary px-5 pt-12 pb-6 pt-safe">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-white/70 text-xs font-medium uppercase tracking-wider">グループ</p>
            <h1 className="text-white text-xl font-bold mt-0.5">{groupName}</h1>
          </div>
          <button
            onClick={() => setShowShare(true)}
            className="bg-white/20 active:bg-white/30 transition-colors rounded-xl px-3 py-2 flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <span className="text-white text-base">↗</span>
            <span className="text-white text-sm font-medium">共有</span>
          </button>
        </div>
        <div className="bg-white/10 rounded-2xl p-4">
          <p className="text-white/70 text-sm">合計支出</p>
          <p className="text-white text-3xl font-bold mt-1">{formatCurrency(total, currency)}</p>
          <p className="text-white/60 text-xs mt-1">{expenses.length}件の支払い</p>
        </div>
      </div>

      {/* Expense list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        {expenses.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">📝</div>
            <p className="text-ink-muted font-medium">支払いがまだありません</p>
            <p className="text-ink-muted text-sm mt-1">下の＋ボタンから追加してください</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map(expense => {
              const payer = getMember(expense.paidBy);
              const cat = CATEGORIES[expense.category];
              return (
                <button
                  key={expense.id}
                  onClick={() => setEditingExpense(expense)}
                  className="w-full bg-white rounded-2xl p-4 shadow-sm active:scale-98 transition-transform text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-xl flex-shrink-0">
                      {cat.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-ink truncate">{expense.title}</p>
                        <p className="font-bold text-ink flex-shrink-0">{formatCurrency(expense.amount, currency)}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {payer && (
                          <div className="flex items-center gap-1">
                            <div
                              className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                              style={{ backgroundColor: payer.color }}
                            >
                              {payer.name[0]}
                            </div>
                            <span className="text-xs text-ink-muted">{payer.name}が支払い</span>
                          </div>
                        )}
                        <span className="text-gray-200 text-xs">·</span>
                        <span className="text-xs text-ink-muted">{expense.splitAmong.length}人で割り勘</span>
                        <span className="text-gray-200 text-xs">·</span>
                        <span className="text-xs text-ink-muted">
                          {formatCurrency(expense.amount / expense.splitAmong.length, currency)}/人
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-xs px-2 py-0.5 bg-gray-50 text-ink-muted rounded-full">{cat.label}</span>
                        <span className="text-xs text-ink-muted">{expense.date}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-24 right-4 w-14 h-14 bg-primary text-white rounded-full shadow-lg text-3xl flex items-center justify-center active:scale-90 transition-transform z-30"
        style={{ bottom: 'max(calc(env(safe-area-inset-bottom) + 80px), 96px)' }}
      >
        +
      </button>

      {/* Modals */}
      {showShare && (
        <ShareModal data={data} onClose={() => setShowShare(false)} />
      )}
      {showAdd && (
        <AddExpenseModal
          members={members}
          onSave={expense => { onAddExpense(expense); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editingExpense && (
        <AddExpenseModal
          members={members}
          expense={editingExpense}
          onSave={expense => { onUpdateExpense(editingExpense.id, expense); setEditingExpense(null); }}
          onDelete={() => { onDeleteExpense(editingExpense.id); setEditingExpense(null); }}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </div>
  );
}
