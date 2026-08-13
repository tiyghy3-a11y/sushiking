import { describe, expect, it } from 'vitest';
import { classifyNetworkFailure, classifyResponse, type ResponseShape } from './auth-recovery';

const res = (over: Partial<ResponseShape>): ResponseShape => ({
  status: 200,
  ok: true,
  redirected: false,
  contentType: 'application/json',
  ...over,
});

describe('classifyResponse', () => {
  it('JSONが返る通常のレスポンスはそのまま通す', () => {
    expect(classifyResponse(res({}))).toBe('ok');
    expect(classifyResponse(res({ contentType: 'application/json; charset=utf-8' }))).toBe('ok');
  });

  it('200でもHTMLならサインイン画面と見なす', () => {
    expect(classifyResponse(res({ contentType: 'text/html; charset=utf-8' }))).toBe('reauth');
  });

  it('401は再サインイン', () => {
    expect(classifyResponse(res({ status: 401, ok: false, contentType: 'application/json' }))).toBe(
      'reauth',
    );
  });

  it('403は再読み込みしても直らないので forbidden', () => {
    expect(classifyResponse(res({ status: 403, ok: false }))).toBe('forbidden');
  });

  it('別オリジンへのリダイレクトを経たHTMLは再サインイン', () => {
    expect(
      classifyResponse(res({ status: 200, ok: false, redirected: true, contentType: 'text/html' })),
    ).toBe('reauth');
  });

  it('APIのエラー応答（JSON）は error として呼び出し側に返す', () => {
    expect(classifyResponse(res({ status: 400, ok: false }))).toBe('error');
    expect(classifyResponse(res({ status: 500, ok: false }))).toBe('error');
    expect(classifyResponse(res({ status: 503, ok: false }))).toBe('error');
  });

  it('content-type が無い場合も安全側（reauth / error）に寄せる', () => {
    expect(classifyResponse(res({ contentType: null }))).toBe('reauth');
    expect(classifyResponse(res({ status: 404, ok: false, contentType: null }))).toBe('error');
  });
});

describe('classifyNetworkFailure', () => {
  it('オンラインなら、CORSで落ちたリダイレクトと見て再サインイン', () => {
    expect(classifyNetworkFailure(true)).toBe('reauth');
  });

  it('オフラインなら再読み込みしない（ループを避ける）', () => {
    expect(classifyNetworkFailure(false)).toBe('error');
  });
});
