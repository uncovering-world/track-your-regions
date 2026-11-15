import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The logout request carries the token it ends, as it stands.
 *
 * The server blacklists the access token only when the request carries it,
 * and revokes the refresh token the cookie carries (`authController.ts`
 * `logout`). So the request sends both, and never refreshes first: a refresh
 * would rotate the cookie that is about to be revoked (#1110, ADR-0073).
 */

import { clearLastGoogleEmail, logout } from './auth';

describe('logout', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the access token and the cookie, in one request', async () => {
    await logout('the-session-token');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/auth/logout');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer the-session-token');
    expect(init.credentials).toBe('include');
  });

  it('sends no Authorization header without a token', async () => {
    await logout(null);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('does not throw when the request fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('offline'));

    await expect(logout('the-session-token')).resolves.toBeUndefined();
  });
});

describe('clearLastGoogleEmail', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw where the browser denies storage, so sign-out still reaches the server', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => clearLastGoogleEmail()).not.toThrow();
  });
});
