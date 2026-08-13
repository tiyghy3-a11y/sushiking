/**
 * 本番へのデプロイを1コマンドで通す（DEPLOY.md の手順1〜3をまとめたもの）。
 *
 *   npx wrangler login                       # 先にこれだけ手で済ませる
 *   npm run deploy:bootstrap                 # 実行
 *   npm run deploy:bootstrap -- --dry-run    # 何をするか表示するだけ
 *
 * やること（何度実行しても壊れないようにしてある）:
 *   1. D1 `yamalog` を作る（あれば作らない）
 *   2. その database_id を wrangler.toml に書き込む
 *   3. R2 `yamalog-photos` を作る（あれば作らない）
 *   4. マイグレーションを適用する
 *   5. 百名山マスタを投入する（既に入っていればスキップ。--force-seed で上書き）
 *   6. ビルドしてデプロイする
 *
 * このあとは手作業が2つ残る（ダッシュボードが必要なため）:
 *   - workers.dev に Cloudflare Access をかける
 *   - ACCESS_TEAM_DOMAIN / ACCESS_AUD / ALLOWED_EMAILS を secret に入れる
 * それまで Worker は全リクエストに 503 を返すので、中身は誰にも見えない。
 */
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  extractCreatedDatabaseId,
  findDatabase,
  hasBucket,
  patchDatabaseId,
  PLACEHOLDER_DATABASE_ID,
  readCount,
} from './lib/bootstrap';

const DB_NAME = 'yamalog';
const BUCKET_NAME = 'yamalog-photos';
const TOML_PATH = resolve(process.cwd(), 'wrangler.toml');

const dryRun = process.argv.includes('--dry-run');
const forceSeed = process.argv.includes('--force-seed');
const skipDeploy = process.argv.includes('--skip-deploy');

let step = 0;
const heading = (text: string) => console.log(`\n[${++step}] ${text}`);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** wrangler などを実行する。--dry-run のときはコマンドを表示するだけ */
function run(command: string, args: string[], options: { capture?: boolean; allowFail?: boolean } = {}): RunResult {
  const printable = `${command} ${args.join(' ')}`;
  if (dryRun) {
    console.log(`  （dry-run）$ ${printable}`);
    return { code: 0, stdout: '', stderr: '' };
  }
  console.log(`  $ ${printable}`);
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
  const out = { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  if (options.capture && out.stdout) process.stdout.write(indent(out.stdout));
  if (out.code !== 0 && !options.allowFail) {
    if (options.capture && out.stderr) process.stderr.write(indent(out.stderr));
    throw new Error(`失敗しました: ${printable}`);
  }
  return out;
}

const indent = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => `    ${l}`)
    .join('\n') + '\n';

const wrangler = (args: string[], options?: { capture?: boolean; allowFail?: boolean }) =>
  run('npx', ['wrangler', ...args], options);

async function main() {
  console.log(dryRun ? 'dry-run: 実際には何も変更しません' : '本番へのデプロイを開始します');

  // 認証確認。ここで落としておかないと後段が分かりにくい失敗になる
  heading('Cloudflare の認証を確認');
  if (!dryRun) {
    const who = wrangler(['whoami'], { capture: true, allowFail: true });
    if (who.code !== 0 || /not authenticated/i.test(who.stdout + who.stderr)) {
      console.error('\n未認証です。先に `npx wrangler login` を実行してください。');
      console.error('（CI から実行する場合は CLOUDFLARE_API_TOKEN を環境変数に入れてください）');
      process.exit(1);
    }
  }

  // 1. D1
  heading(`D1 データベース ${DB_NAME}`);
  let databaseId: string | null = null;
  if (!dryRun) {
    const list = wrangler(['d1', 'list', '--json'], { capture: true, allowFail: true });
    const existing = findDatabase(list.stdout, DB_NAME);
    if (existing) {
      databaseId = existing.uuid;
      console.log(`  既にあります: ${databaseId}`);
    } else {
      const created = wrangler(['d1', 'create', DB_NAME], { capture: true });
      databaseId = extractCreatedDatabaseId(created.stdout);
      if (!databaseId) {
        const relist = wrangler(['d1', 'list', '--json'], { capture: true, allowFail: true });
        databaseId = findDatabase(relist.stdout, DB_NAME)?.uuid ?? null;
      }
      if (!databaseId) throw new Error('database_id を取得できませんでした。wrangler の出力を確認してください');
      console.log(`  作成しました: ${databaseId}`);
    }
  } else {
    wrangler(['d1', 'create', DB_NAME]);
  }

  // 2. wrangler.toml へ書き込む
  heading('wrangler.toml の database_id を更新');
  if (!dryRun && databaseId) {
    const toml = await readFile(TOML_PATH, 'utf8');
    const patched = patchDatabaseId(toml, databaseId);
    if (patched.changed) {
      await writeFile(TOML_PATH, patched.toml, 'utf8');
      console.log(`  ${patched.previous === PLACEHOLDER_DATABASE_ID ? 'プレースホルダを' : `${patched.previous} を`}置き換えました`);
      console.log('  → このファイルの変更はコミットしてください');
    } else {
      console.log('  変更は不要でした');
    }
  }

  // 3. R2
  heading(`R2 バケット ${BUCKET_NAME}`);
  if (!dryRun) {
    const buckets = wrangler(['r2', 'bucket', 'list'], { capture: true, allowFail: true });
    if (buckets.code !== 0) {
      // 原因の切り分けに必要なので、wrangler の出力をそのまま見せる
      console.error('  --- wrangler の出力 ---');
      if (buckets.stdout.trim()) console.error(indent(buckets.stdout));
      if (buckets.stderr.trim()) console.error(indent(buckets.stderr));
      console.error('  -----------------------');
      console.error('  R2 の一覧を取得できませんでした。よくある原因は2つです:');
      console.error('   (a) アカウントで R2 がまだ有効化されていない');
      console.error('       → ダッシュボード左メニューの R2 を開いて有効化する');
      console.error('   (b) APIトークンに R2 の権限が無い');
      console.error('       → トークンに Account / Workers R2 Storage / Edit を追加する');
      throw new Error('R2 が使えません');
    }
    if (hasBucket(buckets.stdout, BUCKET_NAME)) console.log('  既にあります');
    else wrangler(['r2', 'bucket', 'create', BUCKET_NAME], { capture: true });
  } else {
    wrangler(['r2', 'bucket', 'create', BUCKET_NAME]);
  }

  // 4. マイグレーション
  heading('スキーマを適用');
  wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote', '-y']);

  // 5. 百名山マスタ
  heading('百名山マスタを投入');
  let seeded = 0;
  if (!dryRun) {
    const count = wrangler(
      ['d1', 'execute', DB_NAME, '--remote', '--json', '--command', 'select count(*) as n from mountains'],
      { capture: true, allowFail: true },
    );
    seeded = readCount(count.stdout) ?? 0;
  }
  if (!dryRun && seeded > 0 && !forceSeed) {
    console.log(`  既に ${seeded} 件入っています。スキップします（上書きするなら --force-seed）`);
    console.log('  ※ /settings で直した座標を CSV の値で上書きしないための保護です');
  } else {
    run('npx', ['tsx', 'scripts/seed.ts', '--remote']);
  }

  // 6. ビルドとデプロイ
  if (skipDeploy) {
    console.log('\n--skip-deploy が指定されたのでここで終了します');
    return;
  }
  heading('ビルド');
  run('npm', ['run', 'build']);

  heading('デプロイ');
  const deployed = wrangler(['deploy'], { capture: true });
  const url = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i.exec(deployed.stdout)?.[0];

  console.log('\n=== デプロイ完了 ===');
  if (url) console.log(`URL: ${url}`);
  console.log(`
この時点では認証が未設定なので、開いても 503「認証が未設定です」が返ります（意図通り）。
残りはダッシュボードでの作業です。DEPLOY.md の手順4〜5を見ながら:

  1. Workers & Pages → ${DB_NAME} → Settings → Domains & Routes
     workers.dev の「Enable Cloudflare Access」を押す
     （Preview URLs が Disabled になっていることも確認）
  2. Access アプリの Policy に自分のメールを入れる（One-time PIN、Session Duration は 1 month）
  3. Overview の Application Audience (AUD) Tag をコピーして、以下を登録:

     npx wrangler secret put ACCESS_TEAM_DOMAIN
     npx wrangler secret put ACCESS_AUD
     npx wrangler secret put ALLOWED_EMAILS

secret を入れた時点で反映されます（再デプロイ不要）。`);
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
});
