import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, apiFetch, setAccessToken } from './fetchUtils';
import { AuthError, login } from './auth';
import {
  getExperiencesReviewQueue, postExperiencesReviewAnswer, putExperiencesReviewSetAsideBySyncLogId,
} from './client.generated';

/**
 * `apiFetch` is the one fetch the generated client calls (ADR-0073). A call
 * moved to it behaves as it did through `authFetchJson`: the origin in front of
 * the document's path, the session's token, one refresh and retry on a 401.
 * Only a 204 reads differently, as `undefined`, which is what the generated
 * types say such a route may answer.
 */
describe('apiFetch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAccessToken(null);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('puts the origin in front of the path and sends the session token', async () => {
    // A token that decodes to no expiry would be refreshed first; this one is
    // not a JWT at all, and the refresh it triggers answers 401, so the call
    // still goes out with the token in hand.
    setAccessToken('the-session-token');
    fetchSpy.mockImplementation(async (url: string) => (url.endsWith('/api/auth/refresh')
      ? { ok: false, status: 401, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ answered: 1 }) }));

    await expect(apiFetch('/api/experiences/review/answer', { method: 'POST' })).resolves.toEqual({ answered: 1 });

    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/experiences/review/answer`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer the-session-token');
  });

  it('reads a 204 as undefined', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });

    await expect(apiFetch('/api/world-views/regions/6737/geometry')).resolves.toBeUndefined();
  });

  it('throws the server’s error sentence', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'A submitted number is outside the range this field allows.' }) });

    await expect(apiFetch('/api/experiences/review/queue')).rejects.toThrow('A submitted number is outside the range this field allows.');
  });
});

/**
 * What the generated client buys: a request the document does not describe
 * does not compile. The lines below are type-checked by `tsc` with the rest of
 * `src/`, never run; each `@ts-expect-error` fails the typecheck if its line
 * ever starts compiling.
 */
describe('the generated client', () => {
  it('refuses at compile time a request the document does not describe', () => {
    const neverCalled = () => {
      // @ts-expect-error `answers` is not a field of the answer body
      void postExperiencesReviewAnswer({ rows: [], answers: 'accept' });
      // @ts-expect-error `defer` is not one of the answers the route takes
      void postExperiencesReviewAnswer({ rows: [], answer: 'defer' });
      // @ts-expect-error a run id is a number
      void putExperiencesReviewSetAsideBySyncLogId('98');
      // @ts-expect-error `question` is the only order besides the default
      void getExperiencesReviewQueue({ sort: 'newest' });
    };
    expect(neverCalled).toBeTypeOf('function');
  });
});

/** A structurally valid JWT, fresh for an hour, so no policy refreshes it first. */
function freshToken(): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

/**
 * The token policies (ADR-0073 decision 2). `session` refreshes before a call
 * and once more on a 401; the other two never refresh, because their 401 means
 * something else or their refresh would rotate the cookie they are ending.
 */
describe('apiFetch token policies', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const paths = () => fetchSpy.mock.calls.map((call) => new URL(String(call[0])).pathname);
  const authOf = (i: number) => new Headers((fetchSpy.mock.calls[i][1] as RequestInit).headers).get('Authorization');

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('strict: a spent session sends nothing, and says so to the app', async () => {
    // No token at all: nothing to send, and the session is over.
    const expired = vi.fn();
    window.addEventListener('auth:session-expired', expired);
    await expect(apiFetch('/api/auth/change-password', { method: 'POST', tokenPolicy: 'strict' }))
      .rejects.toThrow('Your session has expired');
    window.removeEventListener('auth:session-expired', expired);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('strict: a 401 is the endpoint’s own answer, and nothing is refreshed', async () => {
    const token = freshToken();
    setAccessToken(token);
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Current password is incorrect' }) });

    await expect(apiFetch('/api/auth/change-password', { method: 'POST', tokenPolicy: 'strict' }))
      .rejects.toThrow('Current password is incorrect');
    expect(paths()).toEqual(['/api/auth/change-password']);
    expect(authOf(0)).toBe(`Bearer ${token}`);
  });

  it('as-held: the token in hand goes as it stands, with no refresh before or after', async () => {
    // Not a JWT, so `session` would refresh it first.
    setAccessToken('the-session-token');
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Invalid token' }) });

    await expect(apiFetch('/api/auth/logout', { method: 'POST', tokenPolicy: 'as-held' })).rejects.toThrow('Invalid token');
    expect(paths()).toEqual(['/api/auth/logout']);
    expect(authOf(0)).toBe('Bearer the-session-token');
  });

  it('a caller’s own Authorization wins over the token held', async () => {
    setAccessToken(freshToken());
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 7 }) });

    await apiFetch('/api/auth/me', { tokenPolicy: 'as-held', headers: { Authorization: 'Bearer the-new-token' } });
    expect(authOf(0)).toBe('Bearer the-new-token');
  });

  it('carries the server’s code with its sentence, which login turns into an AuthError', async () => {
    fetchSpy.mockResolvedValue({
      ok: false, status: 403, json: async () => ({ error: 'Please verify your email first', code: 'EMAIL_NOT_VERIFIED' }),
    });

    const refused = await login({ email: 'a@b.test', password: 'x' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AuthError);
    expect(refused).toMatchObject({ message: 'Please verify your email first', code: 'EMAIL_NOT_VERIFIED' });
  });
});
