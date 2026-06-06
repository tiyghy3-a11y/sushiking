import type { Member, Expense, Payment } from '../types';

export function calculateSettlement(members: Member[], expenses: Expense[]): Payment[] {
  const balance: Record<string, number> = {};
  members.forEach(m => { balance[m.id] = 0; });

  expenses.forEach(expense => {
    if (!expense.splitAmong.length) return;
    const share = expense.amount / expense.splitAmong.length;
    if (balance[expense.paidBy] !== undefined) {
      balance[expense.paidBy] += expense.amount;
    }
    expense.splitAmong.forEach(id => {
      if (balance[id] !== undefined) {
        balance[id] -= share;
      }
    });
  });

  const creditors: { id: string; amount: number }[] = [];
  const debtors: { id: string; amount: number }[] = [];

  members.forEach(m => {
    if (balance[m.id] > 0.005) {
      creditors.push({ id: m.id, amount: balance[m.id] });
    } else if (balance[m.id] < -0.005) {
      debtors.push({ id: m.id, amount: -balance[m.id] });
    }
  });

  const payments: Payment[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const creditor = creditors[0];
    const debtor = debtors[0];
    const amount = Math.min(creditor.amount, debtor.amount);

    payments.push({
      from: debtor.id,
      to: creditor.id,
      amount: Math.round(amount * 100) / 100,
    });

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount < 0.005) creditors.shift();
    if (debtor.amount < 0.005) debtors.shift();
  }

  return payments;
}

export function getMemberBalance(memberId: string, expenses: Expense[]): number {
  let balance = 0;
  expenses.forEach(expense => {
    if (expense.paidBy === memberId) balance += expense.amount;
    if (expense.splitAmong.includes(memberId)) {
      balance -= expense.amount / expense.splitAmong.length;
    }
  });
  return Math.round(balance * 100) / 100;
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
