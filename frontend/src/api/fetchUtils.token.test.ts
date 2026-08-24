import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Where the two token helpers part company, which is narrower than it looks.
 *
 * Both refuse nothing while the token is comfortably fresh, and both keep a
 * token that is merely *expiring* when the refresh behind it fails — a refresh
 * runs a minute early, and `refreshSession()` answers `null` for a rejected
 * refresh, a 429 and a network blip alike, so a failure proves nothing about
 * the session. They differ on a token that is actually *spent*:
 * `ensureFreshToken` hands it over anyway, because its SSE callers fail the
 * same way with or without it, while `requireFreshToken` answers `null` so
 * `changePassword` can say "your session is over" instead of sending a dead
 * token and collecting a 401 indistinguishable from "wrong current password".
 *
 * Pinned because the difference is invisible at the call site and reads like
 * duplication: unifying the two would silently break whichever caller lost.
 */

import { setAccessToken, ensureFreshToken, requireFreshToken } from './fetchUtils';

/** A structurally valid JWT expiring `secondsFromNow` from now. */
function makeToken(secondsFromNow: number): string {
  // `/=/g` rather than `/=+$/`: base64 padding only ever trails, so the two are
  // equivalent here, and the anchored one-or-more form trips sonarjs/slow-regex.
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })}.sig`;
}

describe('token helpers when a refresh fails', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  /** Still valid, but inside the 60s margin — so a refresh is attempted. */
  let expiring = '';

  beforeEach(() => {
    expiring = makeToken(30);
    setAccessToken(expiring);
    fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('ensureFreshToken keeps the still-usable token', async () => {
    expect(await ensureFreshToken()).toBe(expiring);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('requireFreshToken keeps it too — expiring is not spent', async () => {
    // A 429 is not proof the session ended, and 30 seconds of life still
    // reaches the endpoint for its real answer. Refusing here would sign
    // someone out of a live session over a rate limit.
    expect(await requireFreshToken()).toBe(expiring);
    // Asserted alongside the value: keeping the token is only right *because*
    // the refresh was tried and failed. A version that skipped the refresh and
    // returned the same token would pass on the value alone.
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('requireFreshToken refuses a token that is actually spent', async () => {
    const spent = makeToken(-60);
    setAccessToken(spent);

    expect(await requireFreshToken()).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
    // The lenient one still hands it over: its callers open a stream that fails
    // either way, and that difference is the whole reason for two functions.
    expect(await ensureFreshToken()).toBe(spent);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('requireFreshToken refuses a token nobody can read', async () => {
    setAccessToken('not-a-jwt');

    expect(await requireFreshToken()).toBeNull();
    // Undecodable is a reason to try the refresh, not a reason to skip it.
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('neither asks for a refresh while the token is comfortably fresh', async () => {
    const fresh = makeToken(3600);
    setAccessToken(fresh);

    expect(await ensureFreshToken()).toBe(fresh);
    expect(await requireFreshToken()).toBe(fresh);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('both answer null when there is no token at all', async () => {
    setAccessToken(null);

    expect(await ensureFreshToken()).toBeNull();
    expect(await requireFreshToken()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
