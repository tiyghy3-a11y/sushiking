import type { AppData } from '../types';
import { supabase, isSyncEnabled, GROUPS_TABLE } from './supabase';

/**
 * Supabase の `groups` テーブルに保存する形。
 *   id         uuid        primary key default gen_random_uuid()
 *   data       jsonb       グループ本体（groupName / currency / members / expenses）
 *   updated_at timestamptz default now()
 */
interface GroupRow {
  id: string;
  data: SyncPayload;
  updated_at?: string;
}

/** クラウドに保存する中身。syncId は行のidと重複するので含めない。 */
type SyncPayload = Pick<AppData, 'groupName' | 'currency' | 'members' | 'expenses'>;

function toPayload(data: AppData): SyncPayload {
  return {
    groupName: data.groupName,
    currency: data.currency,
    members: data.members,
    expenses: data.expenses,
  };
}

/**
 * グループをクラウドに新規作成し、割り当てられた同期ID（行のid）を返す。
 * 同期が無効な場合は null。
 */
export async function createSyncGroup(data: AppData): Promise<string | null> {
  if (!isSyncEnabled || !supabase) return null;
  const { data: row, error } = await supabase
    .from(GROUPS_TABLE)
    .insert({ data: toPayload(data) })
    .select('id')
    .single();
  if (error || !row) {
    console.error('createSyncGroup failed', error);
    return null;
  }
  return (row as Pick<GroupRow, 'id'>).id;
}

/**
 * 既存グループの最新状態をクラウドへ書き込む（上書き）。
 * 成功で true。
 */
export async function pushSyncGroup(data: AppData): Promise<boolean> {
  if (!isSyncEnabled || !supabase || !data.syncId) return false;
  const { error } = await supabase
    .from(GROUPS_TABLE)
    .update({ data: toPayload(data), updated_at: new Date().toISOString() })
    .eq('id', data.syncId);
  if (error) {
    console.error('pushSyncGroup failed', error);
    return false;
  }
  return true;
}

/**
 * 同期IDで最新のグループをクラウドから取得する。
 * 見つからない／同期無効なら null。
 */
export async function fetchSyncGroup(syncId: string): Promise<AppData | null> {
  if (!isSyncEnabled || !supabase) return null;
  const { data: row, error } = await supabase
    .from(GROUPS_TABLE)
    .select('id, data')
    .eq('id', syncId)
    .single();
  if (error || !row) {
    if (error && error.code !== 'PGRST116') console.error('fetchSyncGroup failed', error);
    return null;
  }
  const { id, data } = row as GroupRow;
  // data は DB 由来の jsonb なので、欠損に備えて安全に組み立てる
  const payload = (data ?? {}) as Partial<SyncPayload>;
  return {
    groupName: payload.groupName ?? '',
    currency: payload.currency ?? 'USD',
    members: payload.members ?? [],
    expenses: payload.expenses ?? [],
    syncId: id,
  };
}
