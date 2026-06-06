import { useState } from 'react';
import type { AppData, Member } from '../types';
import { MEMBER_COLORS } from '../types';

interface Props {
  onComplete: (data: Pick<AppData, 'groupName' | 'currency' | 'members'>) => void;
}

export default function Setup({ onComplete }: Props) {
  const [step, setStep] = useState<'group' | 'members'>('group');
  const [groupName, setGroupName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberInput, setMemberInput] = useState('');

  function addMember() {
    const name = memberInput.trim();
    if (!name || members.some(m => m.name === name)) return;
    const color = MEMBER_COLORS[members.length % MEMBER_COLORS.length];
    setMembers(prev => [...prev, { id: crypto.randomUUID(), name, color }]);
    setMemberInput('');
  }

  function removeMember(id: string) {
    setMembers(prev => prev.filter(m => m.id !== id));
  }

  function handleGroupNext() {
    if (!groupName.trim()) return;
    setStep('members');
  }

  function handleComplete() {
    if (members.length < 2) return;
    onComplete({ groupName: groupName.trim(), currency, members });
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-primary-500 to-primary-700 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🍣</div>
          <h1 className="text-3xl font-bold text-white tracking-tight">SushiKing</h1>
          <p className="text-white/70 mt-1 text-sm">旅行の割り勘を簡単に</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-xl">
          {step === 'group' ? (
            <>
              <h2 className="text-xl font-bold text-ink mb-1">グループを作成</h2>
              <p className="text-ink-muted text-sm mb-6">旅行のグループ名を入力してください</p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-ink mb-1.5">グループ名</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGroupNext()}
                  placeholder="例：サンフランシスコ旅行"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink placeholder-gray-300"
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-ink mb-1.5">通貨</label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink bg-white"
                >
                  <option value="USD">USD（ドル）</option>
                  <option value="JPY">JPY（円）</option>
                  <option value="EUR">EUR（ユーロ）</option>
                </select>
              </div>

              <button
                onClick={handleGroupNext}
                disabled={!groupName.trim()}
                className="w-full py-3.5 bg-primary text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
              >
                次へ →
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('group')}
                className="text-ink-muted text-sm mb-4 flex items-center gap-1 active:opacity-70"
              >
                ← 戻る
              </button>
              <h2 className="text-xl font-bold text-ink mb-1">メンバーを追加</h2>
              <p className="text-ink-muted text-sm mb-5">2人以上追加してください</p>

              {/* Member input */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={memberInput}
                  onChange={e => setMemberInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addMember()}
                  placeholder="名前を入力"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-ink placeholder-gray-300"
                />
                <button
                  onClick={addMember}
                  disabled={!memberInput.trim()}
                  className="px-4 py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-40 active:scale-95 transition-transform"
                >
                  追加
                </button>
              </div>

              {/* Member list */}
              <div className="space-y-2 mb-6 min-h-[80px]">
                {members.length === 0 && (
                  <p className="text-center text-ink-muted text-sm py-4">メンバーがいません</p>
                )}
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ backgroundColor: m.color }}
                    >
                      {m.name[0]}
                    </div>
                    <span className="flex-1 font-medium text-ink">{m.name}</span>
                    <button
                      onClick={() => removeMember(m.id)}
                      className="text-ink-muted hover:text-red-500 text-lg leading-none active:scale-95 transition-all"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={handleComplete}
                disabled={members.length < 2}
                className="w-full py-3.5 bg-primary text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
              >
                始める 🎉
              </button>
              {members.length < 2 && members.length > 0 && (
                <p className="text-center text-ink-muted text-xs mt-2">あと{2 - members.length}人追加してください</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
