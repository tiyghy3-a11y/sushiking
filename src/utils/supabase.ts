import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Secret に紛れ込みやすい前後の空白・改行・引用符を除去しておく
function clean(v: string | undefined): string {
  return (v ?? '').trim().replace(/^["']|["']$/g, '');
}

const url = clean(import.meta.env.VITE_SUPABASE_URL);
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

/** Supabase に保存するグループ用テーブル名。 */
export const GROUPS_TABLE = 'groups';

// 環境変数が不正でも createClient で例外を投げてアプリ全体が落ちないようにする
function init(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  try {
    return createClient(url, anonKey);
  } catch (e) {
    console.error('Supabase の初期化に失敗しました。クラウド同期は無効になります。', e);
    return null;
  }
}

export const supabase: SupabaseClient | null = init();

/** Supabase が使える状態かどうか。 */
export const isSyncEnabled = supabase !== null;
