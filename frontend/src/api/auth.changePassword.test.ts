import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The two readings of 401 on the change-password endpoint.
 *
 * A wrong *current password* answers 401 and so does an expired access token,
 * and the right response to each is the opposite of the other: the first must
 * leave the session alone, the second must end it. That is the whole reason
 * this one function builds its request by hand instead of going through
 * `authFetchJson`, whose 401 handling assumes the second reading — and it is a
 * property nothing else records, so "simplifying" it back would pass every
 * other test in the repository.
 *
 * The dead-session case is not hypothetical here: changing the password on one
 * device revokes every refresh token the account has, which is precisely what
 * leaves a second device's open form submitting into a session that is over.
 */

import { setAccessToken } from './fetchUtils';
import { changePassword } from './auth';

/** A structurally valid JWT — `requireFreshToken()` decodes it before anything else. */
function makeToken(secondsFromNow: number): string {
  // `/=/g` rather than `/=+$/`: base64 padding only ever trails, so the two are
  // equivalent here, and the anchored one-or-more form trips sonarjs/slow-regex.
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })}.sig`;
}

/** Which endpoints a run actually asked for, in order. */
function pathsOf(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls.map((call) => new URL(String(call[0])).pathname);
}

describe('changePassword', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let token = '';

  beforeEach(() => {
    token = makeToken(3600);
    setAccessToken(token);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('carries the token and the cookie, and returns the server’s answer', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'fresh', message: 'Password changed successfully.' }),
    });

    const result = await changePassword({ currentPassword: 'old', newPassword: 'new-passphrase' });

    expect(result).toEqual({ accessToken: 'fresh', message: 'Password changed successfully.' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/auth/change-password');
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`);
    // Without this the browser drops the replacement refresh cookie and the
    // session dies at the next refresh — a successful change reading as a logout.
    expect(init.credentials).toBe('include');
  });

  it('reads a 401 as the endpoint means it: wrong password, session untouched', async () => {
    const expired = vi.fn();
    window.addEventListener('auth:session-expired', expired);
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Current password is incorrect' }),
    });

    await expect(
      changePassword({ currentPassword: 'wrong', newPassword: 'new-passphrase' }),
    ).rejects.toThrow('Current password is incorrect');

    // One request, to the endpoint itself: no refresh, so no token rotation and
    // nothing that could meet refreshLimiter after a few wrong attempts.
    expect(pathsOf(fetchSpy)).toEqual(['/api/auth/change-password']);
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', expired);
  });

  it('ends the session when there is no usable token, without spending a request', async () => {
    const expired = vi.fn();
    window.addEventListener('auth:session-expired', expired);
    // Expired token, and the refresh behind it refused — the second device after
    // the first one changed the password.
    setAccessToken(makeToken(-60));
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Invalid refresh token' }) });

    await expect(
      changePassword({ currentPassword: 'old', newPassword: 'new-passphrase' }),
    ).rejects.toThrow(/session has expired/i);

    // The refresh was attempted; the change-password request was not.
    expect(pathsOf(fetchSpy)).toEqual(['/api/auth/refresh']);
    expect(expired).toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', expired);
  });
});
