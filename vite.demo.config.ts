import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * デモビルド用の設定。JS・CSS・画像をすべて1つにまとめ、
 * scripts/build-demo.ts が単一HTMLに差し込める形にする。
 */
export default defineConfig({
  root: 'web',
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '../dist/demo',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      input: 'web/demo.html',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'demo.js',
        assetFileNames: 'demo.[ext]',
      },
    },
  },
});
