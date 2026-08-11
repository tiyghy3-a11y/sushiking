import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    // `wrangler dev`（:8787）に API と画像配信をプロキシする
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/img': 'http://127.0.0.1:8787',
    },
  },
});
