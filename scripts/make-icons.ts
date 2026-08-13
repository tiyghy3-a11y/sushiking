/**
 * ホーム画面用のアイコンを生成する。
 *
 *   npx tsx scripts/make-icons.ts
 *
 * DESIGN.md のトークンだけで描く（ink の地・白の稜線・Action Blue の山頂）。
 * iOS の apple-touch-icon は SVG を受け付けないので PNG を書き出す。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const OUT_DIR = resolve(process.cwd(), 'web/public');

const INK = '#1d1d1f';
const CANVAS = '#ffffff';
const ACTION_BLUE = '#0066cc';

/** inset: マスカブルアイコン用の余白率（0〜0.3） */
function iconSvg(inset = 0): string {
  const pad = Math.round(512 * inset);
  const size = 512 - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${INK}"/>
  <g transform="translate(${pad} ${pad}) scale(${size / 512})">
    <path d="M56 400 L200 168 L280 296 L332 216 L456 400 Z" fill="${CANVAS}"/>
    <!-- 主峰の雪冠だけを Action Blue に。稜線とぴったり合わせる -->
    <path d="M200 168 L241 234 L159 234 Z" fill="${ACTION_BLUE}"/>
  </g>
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const targets = [
    { file: 'apple-touch-icon.png', size: 180, inset: 0 },
    { file: 'icon-192.png', size: 192, inset: 0 },
    { file: 'icon-512.png', size: 512, inset: 0 },
    { file: 'icon-maskable-512.png', size: 512, inset: 0.16 },
  ];

  for (const t of targets) {
    const buf = await sharp(Buffer.from(iconSvg(t.inset))).resize(t.size, t.size).png().toBuffer();
    await writeFile(resolve(OUT_DIR, t.file), buf);
    console.log(`  ${t.file} (${t.size}x${t.size})`);
  }

  await writeFile(resolve(OUT_DIR, 'favicon.svg'), iconSvg(), 'utf8');
  console.log('  favicon.svg');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
