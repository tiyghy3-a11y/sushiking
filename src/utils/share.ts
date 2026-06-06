import LZString from 'lz-string';
import type { AppData } from '../types';

export function encodeGroupData(data: AppData): string {
  const json = JSON.stringify({
    groupName: data.groupName,
    currency: data.currency,
    members: data.members,
    expenses: data.expenses,
  });
  return LZString.compressToEncodedURIComponent(json);
}

export function decodeGroupData(encoded: string): AppData | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (!parsed.groupName || !Array.isArray(parsed.members)) return null;
    return { currency: 'USD', expenses: [], ...parsed };
  } catch {
    return null;
  }
}

export function generateShareURL(data: AppData): string {
  const encoded = encodeGroupData(data);
  const base = window.location.origin + window.location.pathname;
  return `${base}?g=${encoded}`;
}

export function generateGroupSetupURL(data: AppData): string {
  const json = JSON.stringify({
    groupName: data.groupName,
    currency: data.currency,
    members: data.members,
  });
  const encoded = LZString.compressToEncodedURIComponent(json);
  const base = window.location.origin + window.location.pathname;
  return `${base}?g=${encoded}`;
}

export function getSharedGroupFromURL(): AppData | null {
  const params = new URLSearchParams(window.location.search);
  const g = params.get('g');
  if (!g) return null;
  return decodeGroupData(g);
}

export function clearURLParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete('g');
  window.history.replaceState({}, '', url.toString());
}
