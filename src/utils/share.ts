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

function baseURL(): string {
  return window.location.origin + window.location.pathname;
}

/**
 * クラウド同期用の共有URL。リンクにはグループIDだけが入り、
 * 開くたびにクラウドから最新の状態を取得する。
 */
export function generateSyncURL(syncId: string): string {
  return `${baseURL()}?group=${syncId}`;
}

/**
 * 同期を使わない場合のスナップショットURL（従来方式）。
 * 開いた時点のデータがURLに丸ごと含まれる。
 */
export function generateShareURL(data: AppData): string {
  const encoded = encodeGroupData(data);
  return `${baseURL()}?g=${encoded}`;
}

/** URLに含まれる同期グループID（?group=...）。なければ null。 */
export function getSyncIdFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('group');
  return id && id.trim() ? id.trim() : null;
}

/** 従来方式のスナップショット（?g=...）。なければ null。 */
export function getSharedGroupFromURL(): AppData | null {
  const params = new URLSearchParams(window.location.search);
  const g = params.get('g');
  if (!g) return null;
  return decodeGroupData(g);
}

export function clearURLParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete('g');
  url.searchParams.delete('group');
  window.history.replaceState({}, '', url.toString());
}
