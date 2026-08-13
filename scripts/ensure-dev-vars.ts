/**
 * ローカル開発用の .dev.vars を用意する。
 *
 * Worker は Cloudflare Access の検証を通らないリクエストを拒否する（設定漏れでも
 * 開けっ放しにしない）。ローカルでは Access が前段にいないため、
 * ACCESS_DISABLED=1 で明示的に外す。このファイルはコミットされないので、
 * 本番には存在せず、結果として本番は常に認証必須になる。
 */
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PATH = resolve(process.cwd(), '.dev.vars');

const CONTENT = `# ローカル開発専用。コミットしない（.gitignore 済み）
# 本番では Cloudflare Access + Worker 側の検証が必須になる
ACCESS_DISABLED="1"
`;

async function main() {
  try {
    await access(PATH);
    console.log('.dev.vars は既にあります（そのまま使います）');
  } catch {
    await writeFile(PATH, CONTENT, 'utf8');
    console.log('.dev.vars を作成しました（ローカルでは認証を外します）');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
