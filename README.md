# SushiKing 割り勘アプリ

## クラウド同期（Supabase）

「リンクを踏むと常に最新の状態が表示される」同期機能は Supabase を使います。
環境変数を設定すると有効になり、未設定の場合は従来どおり URL にデータを埋め込む
スナップショット共有にフォールバックします。

### セットアップ手順

1. [supabase.com](https://supabase.com) で無料プロジェクトを作成する。
2. 「SQL Editor」で以下を実行してテーブルとポリシーを作成する。

   ```sql
   create table public.groups (
     id uuid primary key default gen_random_uuid(),
     data jsonb not null,
     updated_at timestamptz not null default now()
   );

   alter table public.groups enable row level security;

   -- リンク（=ID）を知っている人だけが読み書きできるシンプルな共有モデル
   create policy "anon read"   on public.groups for select using (true);
   create policy "anon insert" on public.groups for insert with check (true);
   create policy "anon update" on public.groups for update using (true) with check (true);
   ```

3. 「Project Settings > API」から `Project URL` と `anon public` キーを取得し、
   プロジェクト直下に `.env` を作成して設定する（`.env.example` を参照）。

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

4. `npm run dev` で起動。共有モーダルを開くとクラウドにグループが作成され、
   `?group=<id>` 形式の同期リンクが発行されます。リンクを開く／アプリを開くたびに
   クラウドから最新の支払い状況を取得します。

> GitHub Pages 等にデプロイする場合は、ビルド時に上記の環境変数を渡してください
> （anon キーはクライアントに埋め込まれる公開キーで、RLS で保護される前提です）。

---

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
