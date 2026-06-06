import { useState } from 'react';
import type { AppData, Member } from '../types';
import { MEMBER_COLORS } from '../types';
import { formatCurrency } from '../utils/calculator';

interface Props {
  data: AppData;
  onUpdate: (updates: Partial<AppData>) => void;
  onReset: () => void;
}

export default function MembersSettings({ data, onUpdate, onReset }: Props) {
  const [memberInput, setMemberInput] = useState('');
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState(data.groupName);
  const [confirmReset, setConfirmReset] = useState(false);

  function addMember() {
    const name = memberInput.trim();
    if (!name || data.members.some(m => m.name === name)) return;
    const color = MEMBER_COLORS[data.members.length % MEMBER_COLORS.length];
    onUpdate({
      members: [...data.members, { id: crypto.randomUUID(), name, color }],
    });
    setMemberInput('');
  }

  function removeMember(id: string) {
    const usedInExpenses = data.expenses.some(
      e => e.paidBy === id || e.splitAmong.includes(id)
    );
    if (usedInExpenses) {
      alert('このメンバーは支払いに含まれているため削除できません');
      return;
    }
    onUpdate({ members: data.members.filter(m => m.id !== id) });
  }

  function saveGroupName() {
    if (groupNameInput.trim()) {
      onUpdate({ groupName: groupNameInput.trim() });
    }
    setEditingGroupName(false);
  }

  function getMemberTotal(m: Member) {
    let paid = 0;
    data.expenses.forEach(e => {
      if (e.paidBy === m.id) paid += e.amount;
    });
    return paid;
  }

  const total = data.expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="flex flex-col min-h-dvh">
      {/* Header */}
      <div className="bg-ink-light px-5 pt-12 pb-6 pt-safe">
        <p className="text-white/60 text-xs font-medium uppercase tracking-wider">設定</p>
        <h1 className="text-white text-xl font-bold mt-0.5">グループ設定</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32 space-y-4">
        {/* Group name */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">グループ名</p>
          {editingGroupName ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={groupNameInput}
                onChange={e => setGroupNameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveGroupName()}
                autoFocus
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink"
              />
              <button
                onClick={saveGroupName}
                className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold active:scale-95"
              >
                保存
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink text-lg">{data.groupName}</span>
              <button
                onClick={() => { setGroupNameInput(data.groupName); setEditingGroupName(true); }}
                className="text-sm text-primary font-medium active:opacity-70"
              >
                編集
              </button>
            </div>
          )}
        </div>

        {/* Currency */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">通貨</p>
          <select
            value={data.currency}
            onChange={e => onUpdate({ currency: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-primary focus:outline-none text-ink bg-white"
          >
            <option value="USD">USD（ドル）</option>
            <option value="JPY">JPY（円）</option>
            <option value="EUR">EUR（ユーロ）</option>
          </select>
        </div>

        {/* Stats */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">統計</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-ink">{data.members.length}</p>
              <p className="text-xs text-ink-muted">メンバー</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-ink">{data.expenses.length}</p>
              <p className="text-xs text-ink-muted">支払い</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-ink">{formatCurrency(total, data.currency)}</p>
              <p className="text-xs text-ink-muted">合計</p>
            </div>
          </div>
        </div>

        {/* Members */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
            メンバー ({data.members.length}人)
          </p>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={memberInput}
              onChange={e => setMemberInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMember()}
              placeholder="名前を入力"
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink placeholder-gray-300 text-sm"
            />
            <button
              onClick={addMember}
              disabled={!memberInput.trim()}
              className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 active:scale-95 transition-transform"
            >
              追加
            </button>
          </div>

          <div className="space-y-2">
            {data.members.map(m => {
              const paid = getMemberTotal(m);
              const usedInExpenses = data.expenses.some(
                e => e.paidBy === m.id || e.splitAmong.includes(m.id)
              );
              return (
                <div key={m.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink text-sm">{m.name}</p>
                    <p className="text-xs text-ink-muted">{formatCurrency(paid, data.currency)} 支払い</p>
                  </div>
                  {!usedInExpenses && (
                    <button
                      onClick={() => removeMember(m.id)}
                      className="text-ink-muted hover:text-red-500 text-lg leading-none active:scale-95 transition-all w-8 h-8 flex items-center justify-center"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Danger zone */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-red-100">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">危険ゾーン</p>
          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="w-full py-3 bg-red-50 text-red-500 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
            >
              全データをリセット
            </button>
          ) : (
            <div>
              <p className="text-sm text-ink mb-3">本当にリセットしますか？この操作は取り消せません。</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 py-3 bg-gray-100 text-ink rounded-xl font-semibold text-sm active:scale-95"
                >
                  キャンセル
                </button>
                <button
                  onClick={onReset}
                  className="flex-1 py-3 bg-red-500 text-white rounded-xl font-semibold text-sm active:scale-95"
                >
                  リセット
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
