import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Supabase の環境変数が設定されていればクラウド同期が使える。 */
export const isSyncEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSyncEnabled
  ? createClient(url as string, anonKey as string)
  : null;

/** Supabase に保存するグループ用テーブル名。 */
export const GROUPS_TABLE = 'groups';
