import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Reads on a hidden world view must carry the token.
 *
 * `requireVisibleWorldView` answers 404 — not 401 — when a world view has
 * `is_public = false` and the caller is not an admin. A read sent through the
 * unauthenticated `fetchJson` is therefore indistinguishable from a missing
 * region, and react-query stores the rejection as `data: undefined` rather than
 * surfacing it. The batch that fell into this returned nothing for every
 * experience in the region, and `ExperienceExpandedDetails` reported `0/N in
 * region` for all of them: the count comes from the batch and the total falls
 * back to `experience.location_count`, so an absent answer reads on screen as a
 * confident, wrong zero.
 *
 * Guarding the header rather than the visible symptom, because that is what
 * separates these endpoints from the genuinely public ones.
 *
 * The class is "reads whose response depends on world-view visibility", not
 * "reads carrying `requireVisibleWorldView`". Those are not the same set, and
 * the difference is where this originally stopped one route short:
 * `GET /api/experiences/:id` is public by design and does the filtering inline
 * — it returns every region assignment only to an admin — so it fails the same
 * way while never appearing in a search for the guard. It is also the one most
 * likely to be undone, because dropping `authFetchJson` there reads as a
 * cleanup of a plainly public route, passes, and silently restores an empty
 * `regions[]`.
 */

import { setAccessToken } from './fetchUtils';
import {
  fetchExperience,
  fetchExperiencesByRegion,
  fetchExperienceLocations,
  fetchRegionExperienceLocations,
  fetchExperienceRegionCounts,
} from './experiences';

/**
 * A structurally valid JWT with a far-off `exp`. `authFetchJson` runs
 * `ensureFreshToken()` first, which decodes the token — an opaque string would
 * send it down the refresh path and the assertion would be about the refresh
 * call rather than about the request under test.
 */
function makeToken(): string {
  // `/=/g` rather than `/=+$/`: base64 padding only ever trails, so the two are
  // equivalent here, and the anchored one-or-more form trips sonarjs/slow-regex.
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

/**
 * Returns a literal sentinel rather than null so a failure names what was
 * missing: `expected '(no Authorization header)' to be 'Bearer …'` says the
 * header was absent, where a null would report as `expected null to be
 * 'Bearer …'` and read as an assertion about a value rather than about a
 * request that carried nothing.
 */
function authHeaderOf(call: unknown[] | undefined): string {
  if (!call) return '(no request made)';
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers).get('Authorization') ?? '(no Authorization header)';
}

describe('experience reads whose response depends on world-view visibility', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  // Compared in full rather than by prefix: `/^Bearer /` would also pass for a
  // stale token, a truncated one, or a hard-coded literal, none of which is
  // what "sends the token" means.
  let token = '';

  beforeEach(() => {
    token = makeToken();
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchSpy);
    setAccessToken(token);
  });

  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('sends the token when batch-fetching a region\'s locations', async () => {
    // The one the bug was found through: Europe on the Administrative world
    // view, every row showing 0/N.
    await fetchRegionExperienceLocations(6737, { includeChildren: false });

    expect(fetchSpy).toHaveBeenCalled();
    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe(`Bearer ${token}`);
  });

  it('sends the token when fetching one experience\'s locations for a region', async () => {
    // Guarded by `regionIdQuery`: the guard engages exactly when a regionId is
    // passed and waves the request through when it is absent. No call site
    // passes one today — both go through the unguarded shape — so this fixes
    // the contract before a caller starts rather than covering one that exists.
    await fetchExperienceLocations(552, 6737);

    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe(`Bearer ${token}`);
  });

  it('sends the token when fetching one experience by id', async () => {
    // Public route, no guard — but `regions[]` is filtered by visibility, and
    // the admin branch that returns every assignment is unreachable without a
    // token. Asserted here so removing the header is a failing test rather than
    // a silent return to an empty region list.
    await fetchExperience(552);

    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe(`Bearer ${token}`);
  });

  it('sends the token when fetching a region\'s experiences', async () => {
    // Predates this sweep and was already authenticated; asserted so it stays
    // that way, since nothing else records why.
    await fetchExperiencesByRegion(6737, { includeChildren: false });

    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe(`Bearer ${token}`);
  });

  it('sends the token when fetching region counts for a world view', async () => {
    // `worldViewIdQuery` is mandatory here, so every call on a hidden world view
    // 404s — the Discover tree renders those counts.
    await fetchExperienceRegionCounts(5);

    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe(`Bearer ${token}`);
  });
});

describe('the locations batch follows what the list is showing', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // `makeToken()`, not an opaque string: an undecodable token sends
    // `authFetchJson` down the refresh path, the shared mock answers the
    // refresh with this same body, and the request under test then goes out
    // with no Authorization header at all — inside the one file whose subject
    // is that header.
    setAccessToken(makeToken());
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ locationsByExperience: {} }),
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('asks for lost rows when the list is revealing them', async () => {
    await fetchRegionExperienceLocations(6737, { includeChildren: false, includeLost: true });

    // Without it the revealed row arrives with no markers and a confident
    // "0/N in region": the denominator comes from the experience, the
    // numerator from this batch
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('includeLost=true');
  });

  it('does not ask by default', async () => {
    await fetchRegionExperienceLocations(6737, { includeChildren: false });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('includeLost');
  });
});
