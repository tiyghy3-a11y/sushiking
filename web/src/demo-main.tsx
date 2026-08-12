/**
 * デモビルドのエントリ。単一HTMLに固めて Artifact として配るためのもの。
 *
 * - API は installMockApi() がページ内で応答する（どこにも送信されない）
 * - 画像は data URI（取り込んだ写真だけ blob URL）
 * - ルーティングは MemoryRouter（配信先のパスに依存しないように）
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { demoImages } from './demo/dataset';
import { installMockApi } from './demo/mock-api';
import './styles/app.css';

window.__yamalogDemo__ = true;
window.__yamalogDemoImages__ = demoImages;
installMockApi();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MemoryRouter>
      <div className="demo-banner">
        デモ版 — データはこのページ内だけに存在し、リロードで初期状態に戻ります。写真は合成画像です。
      </div>
      <App />
    </MemoryRouter>
  </StrictMode>,
);
