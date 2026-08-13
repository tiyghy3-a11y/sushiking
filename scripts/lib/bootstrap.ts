/**
 * デプロイ準備で使う純粋関数。
 *
 * wrangler の出力を読んで既存リソースを見つけたり、wrangler.toml の
 * database_id を差し替えたりする。ここはネットワークに触らないので
 * テストできる（実際のコマンド実行は scripts/bootstrap-deploy.ts）。
 */

export interface D1Database {
  name: string;
  uuid: string;
}

/**
 * `wrangler d1 list --json` の出力から目的のDBを探す。
 *
 * wrangler の版によってキー名が uuid / database_id と揺れるうえ、
 * JSON の前後に警告文が混ざることがあるので、両方を吸収する。
 */
export function findDatabase(output: string, name: string): D1Database | null {
  const parsed = firstArray(output);
  if (!parsed) return null;
  for (const row of parsed) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (r.name !== name) continue;
    const uuid = r.uuid ?? r.database_id ?? r.id;
    if (typeof uuid === 'string' && uuid.length > 0) return { name, uuid };
  }
  return null;
}

/** `wrangler d1 create` の出力から database_id を拾う（JSON でない場合の保険） */
export function extractCreatedDatabaseId(output: string): string | null {
  for (const value of extractJsonValues(output)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const r = value as Record<string, unknown>;
    const uuid = r.uuid ?? r.database_id ?? r.id;
    if (typeof uuid === 'string' && uuid.length > 0) return uuid;
  }
  // database_id = "xxxx-..." の形で出力される版もある
  const m = /database_id\s*=\s*"([0-9a-f-]{36})"/i.exec(output) ?? /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(output);
  return m ? m[1] : null;
}

/** `wrangler r2 bucket list` の出力にバケットがあるか（JSON でも表形式でも見る） */
export function hasBucket(output: string, name: string): boolean {
  const named = (rows: unknown[]) =>
    rows.some(
      (row) => typeof row === 'object' && row !== null && (row as Record<string, unknown>).name === name,
    );
  for (const value of extractJsonValues(output)) {
    if (Array.isArray(value)) {
      if (named(value)) return true;
      continue;
    }
    if (value && typeof value === 'object') {
      const buckets = (value as Record<string, unknown>).buckets;
      if (Array.isArray(buckets) && named(buckets)) return true;
    }
  }
  // 表形式の出力はバケット名の行一致で見る
  return new RegExp(`(^|\\s)${name}(\\s|$)`, 'm').test(output);
}

export const PLACEHOLDER_DATABASE_ID = 'REPLACE_WITH_YOUR_D1_DATABASE_ID';

export interface PatchResult {
  toml: string;
  changed: boolean;
  previous: string | null;
}

/**
 * wrangler.toml の database_id を差し替える。
 * コメント行は触らず、`database_id = "..."` の代入だけを対象にする。
 */
export function patchDatabaseId(toml: string, databaseId: string): PatchResult {
  const pattern = /^(\s*database_id\s*=\s*")([^"]*)(")/m;
  const match = pattern.exec(toml);
  if (!match) return { toml, changed: false, previous: null };
  if (match[2] === databaseId) return { toml, changed: false, previous: match[2] };
  return {
    toml: toml.replace(pattern, `$1${databaseId}$3`),
    changed: true,
    previous: match[2],
  };
}

/** `select count(*) as n from mountains` の結果から件数を読む */
export function readCount(output: string): number | null {
  const walk = (value: unknown): number | null => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item);
        if (found !== null) return found;
      }
      return null;
    }
    if (value && typeof value === 'object') {
      const r = value as Record<string, unknown>;
      if (typeof r.n === 'number') return r.n;
      for (const v of Object.values(r)) {
        const found = walk(v);
        if (found !== null) return found;
      }
    }
    return null;
  };
  for (const value of extractJsonValues(output)) {
    const found = walk(value);
    if (found !== null) return found;
  }
  return null;
}

/**
 * 出力に混ざった JSON をすべて取り出す。
 *
 * wrangler は JSON の前に `▲ [WARNING] ...` のような行を出すことがあり、
 * その `[` を JSON の先頭と誤認しないよう、括弧の対応を数えて切り出す
 * （文字列リテラル内の括弧とエスケープも見る）。
 */
function extractJsonValues(output: string): unknown[] {
  const found: unknown[] = [];
  for (let i = 0; i < output.length; i++) {
    const ch = output[i];
    if (ch !== '[' && ch !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < output.length; j++) {
      const c = output[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) {
          try {
            found.push(JSON.parse(output.slice(i, j + 1)));
            i = j; // 取り出せた範囲は読み飛ばす
          } catch {
            // JSON ではなかった。次の候補へ
          }
          break;
        }
      }
    }
  }
  return found;
}

/** 最初に見つかった配列を返す */
const firstArray = (output: string): unknown[] | null =>
  (extractJsonValues(output).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? null;
