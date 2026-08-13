/**
 * デモを単一HTMLに固める。
 *
 *   npx tsx scripts/build-demo.ts               → dist/demo/yamalog-demo.html（Artifact 用の断片）
 *   npx tsx scripts/build-demo.ts --standalone  → dist/demo/index.html ほか（静的ホスティング用）
 *
 * Artifact など「外部リクエストが遮断される場所」に置いても動くよう、
 * CSS と JS をインラインにし、画像は data URI（デモデータ生成時に作る）にする。
 *
 * --standalone は GitHub Pages のようなサブパス配信でも動くよう、
 * 参照をすべて相対パスにした完全なHTML文書とアイコン・manifest を書き出す。
 * デモなのでデータはページ内だけに存在し、リロードで初期状態に戻る。
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'dist/demo');
/** 静的ホスティングにそのまま上げるディレクトリ（ビルド中間物を混ぜない） */
const PAGES_DIR = resolve(process.cwd(), 'dist/demo-pages');
const PUBLIC_DIR = resolve(process.cwd(), 'web/public');

/** 静的ホスティング用に、サブパスでも動く完全なHTML文書を書き出す */
async function writeStandalone(css: string, js: string) {
  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <title>YamaLog デモ</title>
    <meta
      name="description"
      content="写真のEXIFから山行を復元する百名山アーカイブのデモ。データはページ内だけで動きます。"
    />
    <meta name="robots" content="noindex" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <meta name="theme-color" content="#000000" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="YamaLog" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <!-- 静的ホスティングは外部通信できるので、地図タイル（国土地理院）を読む -->
    <script>
      window.__yamalogDemoTiles__ = true;
    </script>
    <script type="module">
${js}
    </script>
  </body>
</html>
`;
  await mkdir(PAGES_DIR, { recursive: true });
  await writeFile(resolve(PAGES_DIR, 'index.html'), html, 'utf8');

  // start_url / scope を相対にしないと、サブパス配信でホーム画面追加が壊れる
  await writeFile(
    resolve(PAGES_DIR, 'manifest.webmanifest'),
    `${JSON.stringify(
      {
        name: 'YamaLog デモ',
        short_name: 'YamaLog',
        description: '写真のEXIFから山行を復元する百名山アーカイブのデモ',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#000000',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  for (const file of [
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'favicon.svg',
  ]) {
    await copyFile(resolve(PUBLIC_DIR, file), resolve(PAGES_DIR, file));
  }

  // GitHub Pages の Jekyll 処理を止める
  await writeFile(resolve(PAGES_DIR, '.nojekyll'), '', 'utf8');

  const bytes = Buffer.byteLength(html);
  console.log(`${resolve(PAGES_DIR, 'index.html')} (${(bytes / 1024 / 1024).toFixed(2)} MB) + アイコン・manifest`);
}

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

  if (process.argv.includes('--standalone')) await writeStandalone(css, js);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
