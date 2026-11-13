import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL, apiFetch, setAccessToken, setHeldAccount } from './fetchUtils';

/**
 * A request is sent as the account that made it, and never as another. The
 * refresh cookie is every tab's, so a refresh inside a call can return the
 * session another tab signed in (#2120): traveller A's Undo, tick or trip
 * date would then go out under traveller B. The call fails and nothing more
 * is sent; a refresh that returns the same account retries as before.
 */
const part = (value: object) => btoa(JSON.stringify(value)).replaceAll('=', '');
/** A token naming account `sub`, valid for `seconds` more. */
const token = (sub: number, seconds = 900) => {
  const payload = part({ sub, uuid: 'u' + sub, role: 'user', iat: 0, exp: Math.floor(Date.now() / 1000) + seconds });
  return `${part({ alg: 'HS256' })}.${payload}.sig`;
};
const session = (sub: number) => ({ accessToken: token(sub, 1800), user: { id: sub, uuid: 'u' + sub, email: null, displayName: 'T', role: 'user' } });

const RESTORE = '/api/users/me/visits/restore';
let fetchSpy: ReturnType<typeof vi.fn>;
/** The requests sent to the restore, as distinct from the refresh. */
const restoresSent = () => fetchSpy.mock.calls.filter(([url]) => url === `${API_URL}${RESTORE}`);

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  setAccessToken(null);
  setHeldAccount(null);
  vi.unstubAllGlobals();
});

/** The restore answers 401 to no token or an old one and 200 to a fresh one; the refresh answers `refreshedAs`. */
function server(refreshedAs: number, stale: string) {
  fetchSpy.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith('/api/auth/refresh')) return { ok: true, status: 200, json: async () => session(refreshedAs) };
    const sent = new Headers(init.headers).get('Authorization');
    return sent === null || sent === `Bearer ${stale}`
      ? { ok: false, status: 401, json: async () => ({ error: 'Invalid or expired token' }) }
      : { ok: true, status: 200, json: async () => ({ restored: 1 }) };
  });
}

describe('a request and the account it was made by', () => {
  it('is not retried when the refresh after its 401 returns another account', async () => {
    const asTraveller7 = token(7);
    setAccessToken(asTraveller7);
    server(8, asTraveller7);
    await expect(apiFetch(RESTORE, { method: 'POST', body: '{}' })).rejects.toThrow('Nothing was sent.');
    expect(restoresSent()).toHaveLength(1);
  });

  it('is not sent at all when the refresh before it returns another account', async () => {
    const expiring = token(7, 30);
    setAccessToken(expiring);
    server(8, expiring);
    await expect(apiFetch(RESTORE, { method: 'POST', body: '{}' })).rejects.toThrow('Nothing was sent.');
    expect(restoresSent()).toHaveLength(0);
  });

  it('is not sent under the strict policy when its refresh returns another account', async () => {
    const expiring = token(7, 30);
    setAccessToken(expiring);
    server(8, expiring);
    await expect(apiFetch(RESTORE, { method: 'POST', body: '{}', tokenPolicy: 'strict' })).rejects.toThrow('Nothing was sent.');
    expect(restoresSent()).toHaveLength(0);
  });

  it('is retried as before when the refresh returns the same account', async () => {
    const asTraveller7 = token(7);
    setAccessToken(asTraveller7);
    server(7, asTraveller7);
    await expect(apiFetch(RESTORE, { method: 'POST', body: '{}' })).resolves.toEqual({ restored: 1 });
    expect(restoresSent()).toHaveLength(2);
  });

  it("is not retried as another account when the tab's traveller made it with no token in hand", async () => {
    // A failed refresh leaves the tab signed in as traveller 7 with no token.
    setHeldAccount(7);
    server(8, 'none');
    await expect(apiFetch(RESTORE, { method: 'POST', body: '{}' })).rejects.toThrow('Nothing was sent.');
    expect(restoresSent()).toHaveLength(1);
  });

  it("is retried when the tab's traveller made it with no token and the refresh returns them", async () => {
    setHeldAccount(7);
    server(7, 'none');
    await expect(apiFetch(RESTORE, { method: 'POST', body: '{}' })).resolves.toEqual({ restored: 1 });
    expect(restoresSent()).toHaveLength(2);
  });

  it('is retried as whoever the refresh returns in a tab that has held no account', async () => {
    server(8, 'none');
    await expect(apiFetch(RESTORE, { method: 'POST', body: '{}' })).resolves.toEqual({ restored: 1 });
    expect(restoresSent()).toHaveLength(2);
  });
});
