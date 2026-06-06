import { useState } from 'react';
import type { AppData, Expense } from './types';
import { useStorage } from './hooks/useStorage';
import { getSharedGroupFromURL, clearURLParam } from './utils/share';
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

  // Check for shared group in URL on first render
  const [sharedGroup] = useState<AppData | null>(() => getSharedGroupFromURL());
  const [showImport, setShowImport] = useState<boolean>(() => getSharedGroupFromURL() !== null);

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
      {/* Import modal from shared URL — shown before setup or main app */}
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
