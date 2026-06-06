import { useState } from 'react';
import type { AppData, Expense } from './types';
import { useStorage } from './hooks/useStorage';
import Setup from './components/Setup';
import Navigation from './components/Navigation';
import ExpenseList from './components/ExpenseList';
import Settlement from './components/Settlement';
import MembersSettings from './components/MembersSettings';

type Tab = 'expenses' | 'settlement' | 'settings';

export default function App() {
  const { data, setData } = useStorage();
  const [activeTab, setActiveTab] = useState<Tab>('expenses');

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

  if (!isSetupComplete) {
    return <Setup onComplete={handleSetupComplete} />;
  }

  return (
    <div className="relative">
      {activeTab === 'expenses' && (
        <ExpenseList
          groupName={data.groupName}
          currency={data.currency}
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
  );
}
