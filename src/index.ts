import { Hono } from 'hono';
import type { Env } from './db/types';
import { extractAccessToken, parseAllowedEmails, verifyAccessToken } from './lib/access';
import { getStorage } from './db/storage';
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
/**
 * 認証に失敗したときの画面。
 * ブラウザから直接開かれることが前提なので、JSON ではなく読める HTML を返す。
 * DESIGN.md のタイポグラフィ（17px本文・28pxタイトル・-0.374pxトラッキング）に合わせている。
 */
const errorPage = (title: string, lines: string[]) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YamaLog</title>
<div style="font:400 17px/1.47 system-ui,-apple-system,sans-serif;color:#1d1d1f;max-width:34em;margin:12vh auto;padding:0 24px">
  <h1 style="font-size:28px;font-weight:600;letter-spacing:-.374px;margin:0 0 12px">${title}</h1>
  ${lines.map((l) => `<p style="color:#7a7a7a;font-size:14px;margin:0 0 8px">${l}</p>`).join('\n  ')}
</div>`;

const wantsHtml = (req: Request) => (req.headers.get('Accept') ?? '').includes('text/html');

/** 失敗理由ごとに、次に何を直せばよいかを添える（設定作業を1往復で終わらせるため） */
function hintsFor(reason: string): string[] {
  if (reason.includes('aud')) {
    return [
      'ACCESS_AUD の値が Access アプリの Application Audience (AUD) Tag と一致していません。コピーし直して登録し、Deploy を押してください。',
    ];
  }
  if (reason.includes('許可されていないユーザー')) {
    return ['ALLOWED_EMAILS にこのメールアドレスを追加して、Deploy を押してください。'];
  }
  if (reason.includes('Access certs') || reason.includes('署名鍵')) {
    return [
      'ACCESS_TEAM_DOMAIN が違う可能性があります。<code>◯◯◯.cloudflareaccess.com</code> の形（https:// やスラッシュを付けない）で登録してください。',
    ];
  }
  if (reason.includes('トークンがありません')) {
    return [
      'この URL に Cloudflare Access がかかっていないか、Preview URL など別の入口から開いています。Worker の Domains で Production を Private にしてください。',
    ];
  }
  if (reason.includes('有効期限')) {
    return ['ページを再読み込みすると、サインイン画面に戻ります。'];
  }
  return ['許可されたアカウントで、Cloudflare Access を設定した URL からアクセスしてください。'];
}

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
    // どれが欠けているかだけ示す（値は出さない）。設定漏れの切り分けがこれで済む
    const missing = [
      !teamDomain && 'ACCESS_TEAM_DOMAIN',
      !aud && 'ACCESS_AUD',
      allowedEmails.length === 0 && 'ALLOWED_EMAILS',
    ].filter(Boolean) as string[];
    const detail = `未設定: ${missing.join(' / ')}`;

    if (wantsHtml(c.req.raw)) {
      return c.html(
        errorPage('認証が未設定です', [
          detail,
          'Cloudflare の Worker 設定 → Variables and Secrets に Secret として登録し、<strong>Deploy を押す</strong>と反映されます（DEPLOY.md 手順5）。',
          '設定が済むまで、この Worker は誰に対しても中身を返しません。',
        ]),
        503,
      );
    }
    return c.json(
      {
        error: `認証が未設定です（${detail}）。ACCESS_TEAM_DOMAIN / ACCESS_AUD / ALLOWED_EMAILS を設定してください（DEPLOY.md 参照）`,
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
    if (wantsHtml(c.req.raw)) {
      return c.html(
        errorPage('サインインが必要です', [result.reason, ...hintsFor(result.reason)]),
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

/**
 * クライアントに渡す構成情報。
 * 原本を保存しない構成では、送っても捨てられるので最初からアップロードしない
 * （スマホからの通信量が3分の1程度になる）。
 */
app.get('/api/config', (c) => {
  const storage = getStorage(c.env);
  return c.json({ photo_storage: storage.mode, keeps_original: storage.keepsOriginal });
});

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.env.ASSETS.fetch(c.req.raw),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || 'internal error' }, 500);
});

export default app;
