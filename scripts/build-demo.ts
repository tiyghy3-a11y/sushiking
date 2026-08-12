/**
 * デモを単一HTMLに固める。
 *
 *   npx tsx scripts/build-demo.ts
 *   → dist/demo/yamalog-demo.html
 *
 * Artifact など「外部リクエストが遮断される場所」に置いても動くよう、
 * CSS と JS をインラインにし、画像は data URI（デモデータ生成時に作る）にする。
 */
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'dist/demo');

async function main() {
  const build = spawnSync('npx', ['vite', 'build', '--config', 'vite.demo.config.ts'], {
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const js = await readFile(resolve(OUT_DIR, 'demo.js'), 'utf8');
  const css = await readFile(resolve(OUT_DIR, 'demo.css'), 'utf8');

  // Artifact 側で <!doctype>〜<body> は付与されるため、中身だけを書き出す
  const html = `<title>YamaLog</title>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

  const outPath = resolve(OUT_DIR, 'yamalog-demo.html');
  await writeFile(outPath, html, 'utf8');
  console.log(`${outPath} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
