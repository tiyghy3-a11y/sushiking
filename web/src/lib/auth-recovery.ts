/**
 * Cloudflare Access のセッションが切れたときの扱い。
 *
 * セッションが切れると API 呼び出しは Access のログイン画面へのリダイレクトになる。
 * リダイレクト先は別オリジン（`<team>.cloudflareaccess.com`）なので、fetch から見ると
 * 例外になったり HTML が返ったりする。何もしないと画面には「取得できませんでした」と
 * 出るだけなので、再読み込みしてブラウザ遷移に乗せ、Access のログインを表示させる。
 *
 * ここは判定だけを行う純粋関数にしてテストできるようにし、実際の再読み込みは api.ts で行う。
 */

export type AuthAction =
  /** 正常。そのまま処理する */
  | 'ok'
  /** サインインが必要。再読み込みして Access のログインに乗せる */
  | 'reauth'
  /** 許可されていないユーザー。再読み込みしても解決しない */
  | 'forbidden'
  /** APIがエラーを返した。呼び出し側でメッセージを出す */
  | 'error';

export interface ResponseShape {
  status: number;
  ok: boolean;
  /** 別オリジンへのリダイレクトを経たか */
  redirected: boolean;
  contentType: string | null;
}

const isJson = (contentType: string | null): boolean =>
  (contentType ?? '').toLowerCase().includes('application/json');

/**
 * レスポンスから次の動作を決める。
 *
 * JSON を返すはずの API から HTML が返ってきたら、それは Access のログイン画面
 * （またはその中間ページ）なので再サインインに回す。403 は「Access は通ったが
 * 許可リストに無い」なので、再読み込みしても直らない。
 */
export function classifyResponse(res: ResponseShape): AuthAction {
  if (res.ok) {
    if (isJson(res.contentType)) return 'ok';
    // 200 でも HTML ならサインイン画面を掴んでいる
    return 'reauth';
  }
  if (res.status === 401) return 'reauth';
  if (res.status === 403) return 'forbidden';
  if (res.redirected && !isJson(res.contentType)) return 'reauth';
  return 'error';
}

/**
 * fetch が例外になった場合。別オリジンへのリダイレクトが CORS で落ちるとここに来る。
 * オフラインと区別できないので、オンラインのときだけ再サインインに回す。
 */
export const classifyNetworkFailure = (online: boolean): AuthAction => (online ? 'reauth' : 'error');
