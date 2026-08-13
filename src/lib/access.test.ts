import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractAccessToken,
  parseAllowedEmails,
  resetJwksCache,
  verifyAccessToken,
  type AccessConfig,
} from './access';

const CONFIG: AccessConfig = {
  teamDomain: 'example.cloudflareaccess.com',
  aud: 'aud-tag-1234',
  allowedEmails: ['owner@example.com'],
};

const NOW = Date.UTC(2025, 0, 1, 12, 0, 0);

const b64url = (bytes: Uint8Array | string): string => {
  const raw =
    typeof bytes === 'string' ? bytes : String.fromCharCode(...Array.from(bytes));
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function makeKeyPair() {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

async function sign(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'kid-1' },
): Promise<string> {
  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${b64url(new Uint8Array(signature))}`;
}

/** JWKS エンドポイントを差し替える */
function jwksFetch(jwk: JsonWebKey, kid = 'kid-1'): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256' }] }), {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

const validPayload = {
  aud: [CONFIG.aud],
  email: 'owner@example.com',
  sub: 'user-1',
  iat: Math.floor(NOW / 1000) - 60,
  exp: Math.floor(NOW / 1000) + 3600,
};

describe('verifyAccessToken', () => {
  beforeEach(() => resetJwksCache());

  it('正しく署名され許可されたユーザーのトークンを受け入れる', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
    const token = await sign(privateKey, validPayload);

    const result = await verifyAccessToken(token, CONFIG, { now: NOW, fetchImpl: jwksFetch(jwk) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.email).toBe('owner@example.com');
  });

  it('署名が別の鍵なら拒否する（workers.dev 直叩きで偽装できない）', async () => {
    const attacker = await makeKeyPair();
    const legit = await makeKeyPair();
    const legitJwk = (await crypto.subtle.exportKey('jwk', legit.publicKey)) as JsonWebKey;
    const token = await sign(attacker.privateKey, validPayload);

    const result = await verifyAccessToken(token, CONFIG, {
      now: NOW,
      fetchImpl: jwksFetch(legitJwk),
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('aud が別アプリのものなら拒否する', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
    const token = await sign(privateKey, { ...validPayload, aud: ['other-app'] });

    const result = await verifyAccessToken(token, CONFIG, { now: NOW, fetchImpl: jwksFetch(jwk) });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('期限切れのトークンを拒否する', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
    const token = await sign(privateKey, { ...validPayload, exp: Math.floor(NOW / 1000) - 1 });

    const result = await verifyAccessToken(token, CONFIG, { now: NOW, fetchImpl: jwksFetch(jwk) });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('署名は正しくても許可リスト外のメールは403にする', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
    const token = await sign(privateKey, { ...validPayload, email: 'stranger@example.com' });

    const result = await verifyAccessToken(token, CONFIG, { now: NOW, fetchImpl: jwksFetch(jwk) });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('メールの大文字小文字は無視する', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
    const token = await sign(privateKey, { ...validPayload, email: 'Owner@Example.com' });

    const result = await verifyAccessToken(token, CONFIG, { now: NOW, fetchImpl: jwksFetch(jwk) });
    expect(result.ok).toBe(true);
  });

  it('alg=none などの改変を拒否する', async () => {
    const { publicKey } = await makeKeyPair();
    const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
    const forged = `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(validPayload))}.`;

    const result = await verifyAccessToken(forged, CONFIG, { now: NOW, fetchImpl: jwksFetch(jwk) });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('トークンが無い / 壊れている場合は401', async () => {
    const noop = (async () => new Response('{}')) as unknown as typeof fetch;
    expect(await verifyAccessToken(null, CONFIG, { now: NOW, fetchImpl: noop })).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await verifyAccessToken('not-a-jwt', CONFIG, { now: NOW, fetchImpl: noop })).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});

describe('parseAllowedEmails', () => {
  it('カンマ区切りを小文字で配列にする', () => {
    expect(parseAllowedEmails(' A@example.com , b@Example.com ,, ')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('未設定は空配列', () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
  });
});

describe('extractAccessToken', () => {
  it('ヘッダを優先して読む', () => {
    const request = new Request('https://example.com', {
      headers: { 'Cf-Access-Jwt-Assertion': 'from-header', Cookie: 'CF_Authorization=from-cookie' },
    });
    expect(extractAccessToken(request)).toBe('from-header');
  });

  it('クッキーからも読める（ブラウザからの直接アクセス）', () => {
    const request = new Request('https://example.com', {
      headers: { Cookie: 'foo=1; CF_Authorization=from-cookie; bar=2' },
    });
    expect(extractAccessToken(request)).toBe('from-cookie');
  });

  it('どちらも無ければ null', () => {
    expect(extractAccessToken(new Request('https://example.com'))).toBeNull();
  });
});
