export const CATEGORIES = {
  food: { label: '食事', emoji: '🍽️' },
  transport: { label: '交通', emoji: '🚗' },
  accommodation: { label: '宿泊', emoji: '🏨' },
  sightseeing: { label: '観光', emoji: '🗽' },
  shopping: { label: '買い物', emoji: '🛍️' },
  other: { label: 'その他', emoji: '💡' },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const MEMBER_COLORS = [
  '#E63946', '#457B9D', '#2A9D8F', '#E9C46A',
  '#F4A261', '#A8DADC', '#8338EC', '#06D6A0',
];

export interface Member {
  id: string;
  name: string;
  color: string;
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  paidBy: string;
  splitAmong: string[];
  date: string;
  category: CategoryKey;
}

export interface Payment {
  from: string;
  to: string;
  amount: number;
}

export interface AppData {
  groupName: string;
  currency: string;
  members: Member[];
  expenses: Expense[];
}
