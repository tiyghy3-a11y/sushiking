import { describe, expect, it } from 'vitest';
import {
  extractCreatedDatabaseId,
  findDatabase,
  hasBucket,
  patchDatabaseId,
  PLACEHOLDER_DATABASE_ID,
  readCount,
} from './bootstrap';

const UUID = '2f1c9a34-5b6d-4e7f-8a90-1b2c3d4e5f60';

describe('findDatabase', () => {
  it('uuid キーの出力から見つける', () => {
    const out = `[{"uuid":"${UUID}","name":"yamalog","version":"production"}]`;
    expect(findDatabase(out, 'yamalog')).toEqual({ name: 'yamalog', uuid: UUID });
  });

  it('database_id キーの版でも見つける', () => {
    const out = `[{"database_id":"${UUID}","name":"yamalog"}]`;
    expect(findDatabase(out, 'yamalog')?.uuid).toBe(UUID);
  });

  it('警告文が前後に混ざっていても読める', () => {
    const out = `▲ [WARNING] The version of Wrangler you are using is now out-of-date.\n[{"uuid":"${UUID}","name":"yamalog"}]\nDone.`;
    expect(findDatabase(out, 'yamalog')?.uuid).toBe(UUID);
  });

  it('別名のDBは拾わない', () => {
    const out = `[{"uuid":"${UUID}","name":"other-app"}]`;
    expect(findDatabase(out, 'yamalog')).toBeNull();
  });

  it('空リストやJSONでない出力では null', () => {
    expect(findDatabase('[]', 'yamalog')).toBeNull();
    expect(findDatabase('You are not authenticated.', 'yamalog')).toBeNull();
  });
});

describe('extractCreatedDatabaseId', () => {
  it('JSON出力から拾う', () => {
    expect(extractCreatedDatabaseId(`{"uuid":"${UUID}","name":"yamalog"}`)).toBe(UUID);
  });

  it('toml断片を表示する版でも拾う', () => {
    const out = `✅ Successfully created DB 'yamalog'\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "yamalog"\ndatabase_id = "${UUID}"\n`;
    expect(extractCreatedDatabaseId(out)).toBe(UUID);
  });

  it('見つからなければ null', () => {
    expect(extractCreatedDatabaseId('created something')).toBeNull();
  });
});

describe('hasBucket', () => {
  it('JSON配列から判定する', () => {
    expect(hasBucket('[{"name":"yamalog-photos"}]', 'yamalog-photos')).toBe(true);
    expect(hasBucket('[{"name":"other"}]', 'yamalog-photos')).toBe(false);
  });

  it('buckets キーで包まれた形も読む', () => {
    expect(hasBucket('{"buckets":[{"name":"yamalog-photos"}]}', 'yamalog-photos')).toBe(true);
  });

  it('表形式の出力でも判定する', () => {
    const out = 'name                creation_date\nyamalog-photos      2026-08-13\n';
    expect(hasBucket(out, 'yamalog-photos')).toBe(true);
  });

  it('部分一致では誤判定しない', () => {
    expect(hasBucket('[{"name":"yamalog-photos-backup"}]', 'yamalog-photos')).toBe(false);
  });
});

describe('patchDatabaseId', () => {
  const toml = `name = "yamalog"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "yamalog"\n# \`wrangler d1 create yamalog\` の出力で置き換える\ndatabase_id = "${PLACEHOLDER_DATABASE_ID}"\nmigrations_dir = "migrations"\n`;

  it('プレースホルダを実IDに差し替える', () => {
    const r = patchDatabaseId(toml, UUID);
    expect(r.changed).toBe(true);
    expect(r.previous).toBe(PLACEHOLDER_DATABASE_ID);
    expect(r.toml).toContain(`database_id = "${UUID}"`);
    expect(r.toml).not.toContain(PLACEHOLDER_DATABASE_ID);
  });

  it('他の行は壊さない', () => {
    const r = patchDatabaseId(toml, UUID);
    expect(r.toml).toContain('migrations_dir = "migrations"');
    expect(r.toml).toContain('database_name = "yamalog"');
    expect(r.toml.split('\n').length).toBe(toml.split('\n').length);
  });

  it('既に同じIDなら変更しない', () => {
    const already = patchDatabaseId(toml, UUID).toml;
    expect(patchDatabaseId(already, UUID).changed).toBe(false);
  });

  it('database_id が無いtomlは触らない', () => {
    const r = patchDatabaseId('name = "yamalog"\n', UUID);
    expect(r.changed).toBe(false);
    expect(r.toml).toBe('name = "yamalog"\n');
  });
});

describe('readCount', () => {
  it('D1のクエリ結果から件数を読む', () => {
    const out = `[{"results":[{"n":100}],"success":true,"meta":{"duration":1}}]`;
    expect(readCount(out)).toBe(100);
  });

  it('0件も読める', () => {
    expect(readCount(`[{"results":[{"n":0}],"success":true}]`)).toBe(0);
  });

  it('形が違えば null', () => {
    expect(readCount('no json here')).toBeNull();
  });
});
