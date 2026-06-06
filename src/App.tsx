import { useEffect, useRef, useState } from 'react';
import type { AppData, Expense } from './types';
import { useStorage } from './hooks/useStorage';
import {
  getSharedGroupFromURL,
  getSyncIdFromURL,
  clearURLParam,
} from './utils/share';
import { isSyncEnabled } from './utils/supabase';
import { fetchSyncGroup, pushSyncGroup } from './utils/sync';
import Setup from './components/Setup';
import Navigation from './components/Navigation';
import ExpenseList from './components/ExpenseList';
import Settlement from './components/Settlement';
import MembersSettings from './components/MembersSettings';
import ImportGroupModal from './components/ImportGroupModal';

type Tab = 'expenses' | 'settlement' | 'settings';

export default function App() {
  const { data, setData } = useStorage();
  const [activeTab, setActiveTab] = useState<Tab>('expenses');

  // 同期リンク(?group=)がなければ従来方式のスナップショット(?g=)を初期表示
  const [sharedGroup, setSharedGroup] = useState<AppData | null>(
    () => (getSyncIdFromURL() ? null : getSharedGroupFromURL()),
  );
  const [showImport, setShowImport] = useState(
    () => !getSyncIdFromURL() && getSharedGroupFromURL() !== null,
  );

  // 起動時：同期リンクの取得 or 自分のグループの最新化を一度だけ行う（非同期）
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const urlSyncId = getSyncIdFromURL();

    if (urlSyncId) {
      // 同期リンク：クラウドから最新を取得して取り込み確認を表示
      fetchSyncGroup(urlSyncId).then(remote => {
        if (remote) {
          setSharedGroup(remote);
          setShowImport(true);
        } else {
          clearURLParam();
        }
      });
    } else if (isSyncEnabled && data.syncId) {
      // 自分のグループを開いたとき：クラウドの最新で更新
      fetchSyncGroup(data.syncId).then(remote => {
        if (remote) setData(remote);
      });
    }
    // 起動時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 変更があればクラウドへ反映（デバウンス）
  useEffect(() => {
    if (!isSyncEnabled || !data.syncId) return;
    const t = setTimeout(() => { void pushSyncGroup(data); }, 600);
    return () => clearTimeout(t);
  }, [data]);

  const isSetupComplete = data.groupName && data.members.length >= 2;

  function handleSetupComplete(setup: Pick<AppData, 'groupName' | 'currency' | 'members'>) {
    setData(prev => ({ ...prev, ...setup }));
  }

  function addExpense(expense: Omit<Expense, 'id'>) {
    const newExpense: Expense = { ...expense, id: crypto.randomUUID() };
    setData(prev => ({ ...prev, expenses: [newExpense, ...prev.expenses] }));
  }

  function updateExpense(id: string, expense: Omit<Expense, 'id'>) {
    setData(prev => ({
      ...prev,
      expenses: prev.expenses.map(e => e.id === id ? { ...expense, id } : e),
    }));
  }

  function deleteExpense(id: string) {
    setData(prev => ({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }));
  }

  function handleDataUpdate(updates: Partial<AppData>) {
    setData(prev => ({ ...prev, ...updates }));
  }

  function handleReset() {
    setData({ groupName: '', currency: 'USD', members: [], expenses: [] });
    setActiveTab('expenses');
  }

  function handleImport() {
    if (!sharedGroup) return;
    setData(sharedGroup);
    clearURLParam();
    setShowImport(false);
  }

  function handleDismissImport() {
    clearURLParam();
    setShowImport(false);
  }

  return (
    <>
      {showImport && sharedGroup && (
        <ImportGroupModal
          sharedData={sharedGroup}
          hasExistingGroup={!!isSetupComplete}
          onImport={handleImport}
          onDismiss={handleDismissImport}
        />
      )}

      {!isSetupComplete ? (
        <Setup onComplete={handleSetupComplete} />
      ) : (
        <div className="relative">
          {activeTab === 'expenses' && (
            <ExpenseList
              data={data}
              members={data.members}
              expenses={data.expenses}
              onAddExpense={addExpense}
              onUpdateExpense={updateExpense}
              onDeleteExpense={deleteExpense}
              onAssignSyncId={syncId => handleDataUpdate({ syncId })}
            />
          )}
          {activeTab === 'settlement' && (
            <Settlement
              currency={data.currency}
              members={data.members}
              expenses={data.expenses}
            />
          )}
          {activeTab === 'settings' && (
            <MembersSettings
              data={data}
              onUpdate={handleDataUpdate}
              onReset={handleReset}
            />
          )}
          <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      )}
    </>
  );
}
