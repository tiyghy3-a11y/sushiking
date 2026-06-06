import { useState } from 'react';
import type { Member, Expense } from '../types';
import { calculateSettlement, getMemberBalance, formatCurrency } from '../utils/calculator';

interface Props {
  currency: string;
  members: Member[];
  expenses: Expense[];
}

export default function Settlement({ currency, members, expenses }: Props) {
  const [settled, setSettled] = useState<Set<number>>(new Set());
  const payments = calculateSettlement(members, expenses);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  function getMember(id: string) {
    return members.find(m => m.id === id);
  }

  function toggleSettled(index: number) {
    setSettled(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const allSettled = payments.length > 0 && settled.size === payments.length;

  return (
    <div className="flex flex-col min-h-dvh">
      {/* Header */}
      <div className="bg-ink px-5 pt-12 pb-6 pt-safe">
        <p className="text-white/60 text-xs font-medium uppercase tracking-wider">精算</p>
        <h1 className="text-white text-xl font-bold mt-0.5">誰が誰にいくら払う？</h1>
        <div className="bg-white/10 rounded-2xl p-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/60 text-sm">合計支出</p>
              <p className="text-white text-2xl font-bold">{formatCurrency(total, currency)}</p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-sm">支払い件数</p>
              <p className="text-white text-2xl font-bold">{expenses.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        {/* Per-person balance */}
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-3">各自の収支</h2>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {members.map(m => {
            const balance = getMemberBalance(m.id, expenses);
            const isPositive = balance > 0;
            const isNeutral = Math.abs(balance) < 0.005;
            return (
              <div key={m.id} className="bg-white rounded-2xl p-3 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.name[0]}
                  </div>
                  <span className="font-medium text-ink text-sm truncate">{m.name}</span>
                </div>
                <p
                  className={`text-base font-bold ${
                    isNeutral ? 'text-ink-muted' : isPositive ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {isNeutral ? '±0' : (isPositive ? '+' : '')}{formatCurrency(balance, currency)}
                </p>
                <p className="text-xs text-ink-muted mt-0.5">
                  {isNeutral ? '収支ゼロ' : isPositive ? '受け取り' : '支払い'}
                </p>
              </div>
            );
          })}
        </div>

        {/* Settlement payments */}
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-3">精算方法</h2>

        {payments.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl shadow-sm">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold text-ink">精算不要です</p>
            <p className="text-ink-muted text-sm mt-1">全員の収支がゼロです</p>
          </div>
        ) : (
          <>
            {allSettled && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-3 text-center">
                <p className="text-emerald-700 font-semibold">🎉 全て完了！</p>
              </div>
            )}
            <div className="space-y-3">
              {payments.map((payment, i) => {
                const from = getMember(payment.from);
                const to = getMember(payment.to);
                if (!from || !to) return null;
                const done = settled.has(i);
                return (
                  <div
                    key={i}
                    className={`bg-white rounded-2xl p-4 shadow-sm transition-opacity ${done ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* From */}
                      <div className="flex flex-col items-center gap-1 flex-1">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                          style={{ backgroundColor: from.color }}
                        >
                          {from.name[0]}
                        </div>
                        <span className="text-xs font-medium text-ink truncate max-w-[60px] text-center">{from.name}</span>
                      </div>

                      {/* Arrow + amount */}
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-base font-bold text-ink">{formatCurrency(payment.amount, currency)}</span>
                        <span className="text-xl">→</span>
                        <span className="text-xs text-ink-muted">を支払う</span>
                      </div>

                      {/* To */}
                      <div className="flex flex-col items-center gap-1 flex-1">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                          style={{ backgroundColor: to.color }}
                        >
                          {to.name[0]}
                        </div>
                        <span className="text-xs font-medium text-ink truncate max-w-[60px] text-center">{to.name}</span>
                      </div>

                      {/* Done button */}
                      <button
                        onClick={() => toggleSettled(i)}
                        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all active:scale-90 flex-shrink-0 ${
                          done
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-gray-200 text-transparent'
                        }`}
                      >
                        ✓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-ink-muted text-center mt-3">
              チェックを押して完了をマーク
            </p>
          </>
        )}
      </div>
    </div>
  );
}
