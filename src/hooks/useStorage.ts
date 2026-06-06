import { useState, useEffect } from 'react';
import type { AppData } from '../types';

const STORAGE_KEY = 'sushiking-data';

const defaultData: AppData = {
  groupName: '',
  currency: 'USD',
  members: [],
  expenses: [],
};

export function useStorage() {
  const [data, setData] = useState<AppData>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...defaultData, ...JSON.parse(stored) } : defaultData;
    } catch {
      return defaultData;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  return { data, setData };
}
