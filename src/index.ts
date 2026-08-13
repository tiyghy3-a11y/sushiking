import { Hono } from 'hono';
import type { Env } from './db/types';
import { extractAccessToken, parseAllowedEmails, verifyAccessToken } from './lib/access';
import { activities } from './routes/activities';
import { batches } from './routes/batches';
import { contributors } from './routes/contributors';
import { images } from './routes/images';
import { mountains } from './routes/mountains';
import { photos } from './routes/photos';
import { progress } from './routes/progress';

type AppEnv = { Bindings: Env; Variables: { userEmail: string } };

const app = new Hono<AppEnv>();

/**
 * 死活監視用。Worker 側では認証を通さない（内容も持たない）。
 * ただし Access をホスト名全体にかけている場合はエッジで止まる。
 * 外形監視を入れるなら Access 側でこのパスに Bypass ポリシーを当てる。
 */
app.get('/api/health', (c) => c.json({ ok: true }));

/**
 * Cloudflare Access の検証。
 *
 * Access はエッジで認証するが、設定変更や別ホスト名からの流入で迂回されうるので、
 * Worker 側でも署名・aud・有効期限・メール許可リストを必ず検証する。
 * 設定が欠けている場合は開けっ放しにせず 503 で閉じる。
 */
app.use('*', async (c, next) => {
  if (c.env.ACCESS_DISABLED === '1') {
    // ローカル開発のみ（.dev.vars で指定。本番には存在しない）
    c.set('userEmail', 'local@dev');
    return next();
  }

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;
  const allowedEmails = parseAllowedEmails(c.env.ALLOWED_EMAILS);

  if (!teamDomain || !aud || allowedEmails.length === 0) {
    return c.json(
      {
        error:
          '認証が未設定です。ACCESS_TEAM_DOMAIN / ACCESS_AUD / ALLOWED_EMAILS を設定してください（DEPLOY.md 参照）',
      },
      503,
    );
  }

  const result = await verifyAccessToken(extractAccessToken(c.req.raw), {
    teamDomain,
    aud,
    allowedEmails,
  });

  if (!result.ok) {
    // ブラウザからの直アクセスには読める形で返す
    const wantsHtml = (c.req.header('Accept') ?? '').includes('text/html');
    if (wantsHtml) {
      return c.html(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YamaLog</title>
<div style="font:400 17px/1.47 system-ui,-apple-system,sans-serif;color:#1d1d1f;max-width:34em;margin:18vh auto;padding:0 24px">
  <h1 style="font-size:28px;font-weight:600;letter-spacing:-.374px;margin:0 0 8px">サインインが必要です</h1>
  <p style="color:#7a7a7a;font-size:14px">${result.reason}</p>
  <p style="color:#7a7a7a;font-size:14px">許可されたアカウントで、Cloudflare Access を設定した URL からアクセスしてください。</p>
</div>`,
        result.status,
      );
    }
    return c.json({ error: result.reason }, result.status);
  }

  c.set('userEmail', result.identity.email);
  await next();
});

app.route('/api/mountains', mountains);
app.route('/api/activities', activities);
app.route('/api/photos', photos);
app.route('/api/contributors', contributors);
app.route('/api/import-batches', batches);
app.route('/api/progress', progress);
app.route('/img', images);

/** ログイン中のユーザー（UIの表示確認用） */
app.get('/api/me', (c) => c.json({ email: c.get('userEmail') }));

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.env.ASSETS.fetch(c.req.raw),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || 'internal error' }, 500);
});

export default app;
