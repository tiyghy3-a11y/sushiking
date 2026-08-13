/**
 * Cloudflare Access のトークン検証。
 *
 * Access はエッジで認証を行うが、それだけに頼ると設定を外したときや別の
 * ホスト名（Preview URL など）から入られたときに素通りしうる。Cloudflare 自身も
 * workers.dev で Access を使う場合は Worker 側で aud と JWKS を検証するよう
 * 案内している。そこで Worker 自身でも以下を必ず検証する。
 *
 *   1. 署名（Access の公開鍵。チームドメインの JWKS から取得）
 *   2. aud（Access アプリケーションの Audience Tag と一致するか）
 *   3. 有効期限
 *   4. メールアドレスが許可リストに含まれるか
 *
 * 設定が無い場合は「拒否」に倒す。開発時だけ ACCESS_DISABLED=1 で外す。
 */

export interface AccessConfig {
  /** 例: your-team.cloudflareaccess.com */
  teamDomain: string;
  /** Access アプリケーションの Audience (aud) Tag */
  aud: string;
  /** 許可するメールアドレス（小文字で比較する） */
  allowedEmails: string[];
}

export interface AccessIdentity {
  email: string;
  sub: string;
  expiresAt: number;
}

export type VerifyResult =
  | { ok: true; identity: AccessIdentity }
  | { ok: false; status: 401 | 403; reason: string };

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtPayload {
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  iss?: string;
  email?: string;
  sub?: string;
}

const decoder = new TextDecoder();

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const decodeJson = <T>(segment: string): T => JSON.parse(decoder.decode(base64UrlToBytes(segment))) as T;

/** WebCrypto に渡すため、ちょうどの大きさの ArrayBuffer に写す */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/** JWKS は isolate 内でキャッシュする（毎リクエスト取得すると遅い） */
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function loadJwks(
  teamDomain: string,
  fetchImpl: typeof fetch,
  now: number,
): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`failed to fetch Access certs: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(teamDomain, { keys, fetchedAt: now });
  return keys;
}

/** テスト用にキャッシュを空にする */
export function resetJwksCache(): void {
  jwksCache.clear();
}

/**
 * Access が付与した JWT を検証する。
 * トークンは `Cf-Access-Jwt-Assertion` ヘッダか `CF_Authorization` クッキーに入る。
 */
export async function verifyAccessToken(
  token: string | null,
  config: AccessConfig,
  options: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<VerifyResult> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!token) return { ok: false, status: 401, reason: 'Access トークンがありません' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, status: 401, reason: 'トークンの形式が不正です' };

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodeJson<JwtHeader>(parts[0]);
    payload = decodeJson<JwtPayload>(parts[1]);
  } catch {
    return { ok: false, status: 401, reason: 'トークンを解釈できません' };
  }

  if (header.alg !== 'RS256') return { ok: false, status: 401, reason: `未対応の alg: ${header.alg}` };

  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(config.aud)) return { ok: false, status: 401, reason: 'aud が一致しません' };

  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) {
    return { ok: false, status: 401, reason: 'トークンの有効期限が切れています' };
  }
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now) {
    return { ok: false, status: 401, reason: 'トークンがまだ有効ではありません' };
  }

  let keys: Jwk[];
  try {
    keys = await loadJwks(config.teamDomain, fetchImpl, now);
  } catch (e) {
    return { ok: false, status: 401, reason: (e as Error).message };
  }

  const candidates = header.kid ? keys.filter((k) => k.kid === header.kid) : keys;
  if (candidates.length === 0) return { ok: false, status: 401, reason: '署名鍵が見つかりません' };

  const signature = toArrayBuffer(base64UrlToBytes(parts[2]));
  const signed = toArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  let verified = false;
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)) {
        verified = true;
        break;
      }
    } catch {
      // 鍵が壊れていても他の候補で試す
    }
  }
  if (!verified) return { ok: false, status: 401, reason: '署名を検証できません' };

  const email = payload.email?.toLowerCase() ?? '';
  if (!email) return { ok: false, status: 403, reason: 'トークンにメールアドレスがありません' };
  if (!config.allowedEmails.includes(email)) {
    return { ok: false, status: 403, reason: `許可されていないユーザーです: ${email}` };
  }

  return {
    ok: true,
    identity: { email, sub: payload.sub ?? '', expiresAt: payload.exp * 1000 },
  };
}

/** カンマ区切りの環境変数を小文字のメールアドレス配列にする */
export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** ヘッダとクッキーの両方からトークンを探す */
export function extractAccessToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('Cookie') ?? '';
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return match ? match[1] : null;
}
