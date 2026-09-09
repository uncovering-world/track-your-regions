/**
 * Tests for a curator's no to an arrival and to unread contents (#852,
 * ADR-0053).
 *
 * Two rules carry these writers. **A refused arrival is written the way a
 * rule's refusal is** — the verdict, the reason and the pin on the membership
 * — so it leaves the queue for the kept-out list and *Put it back* remains the
 * way back. **A refused part is a mark, never a state**: the statements set
 * `refused_at` and leave `curation_state` alone, and they reach exactly the
 * rows the contents card shows, through the same fragments.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: vi.fn(async () => undefined),
}));

vi.mock('./experienceScope.js', () => ({
  resolveExperienceScope: vi.fn(),
}));

vi.mock('./publishContents.js', () => ({
  placeAfterRelease: vi.fn(async () => []),
}));

import { pool, rollbackQuietly } from '../../db/index.js';
import { placeAfterRelease } from './publishContents.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import { resolveExperienceScope } from './experienceScope.js';
import {
  CURATOR_REFUSAL_REASON, refuseArrival, refuseContents,
} from './curatorRefusalController.js';
import { offeredLinkSql, offeredLocationSql } from './experienceLifecycle.js';
import { unreadLinkSql, unreadPointSql } from './waitingCounts.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;

const CURATOR = { id: 7, role: 'curator' as const };

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/**
 * A client whose locked read answers the object and whose membership read
 * answers `membership`; every UPDATE answers `rowCount`.
 */
function makeClient(
  membership: Record<string, unknown> | null,
  { missingSince = null as Date | null, rowCount = 1 } = {},
) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    queries,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (sql.includes(OBJECT_LOCK)) return { rows: [{ missing_since: missingSince }], rowCount: 1 };
      if (sql.includes('AS membership_id')) return { rows: membership ? [membership] : [{}], rowCount: 1 };
      if (sql.trimStart().startsWith('UPDATE')) return { rows: [], rowCount };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  mockedConnect.mockResolvedValue(client);
  return client;
}

const ARRIVAL = { membership_id: 40, admission: 'admitted', curation_state: 'pending', curated_fields: [] };
const VISIBLE = { membership_id: 40, admission: 'admitted', curation_state: 'auto' };

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
  mockedScope.mockReset();
  (placeAfterRelease as unknown as ReturnType<typeof vi.fn>).mockClear();
  mockedQuery.mockResolvedValue({ rows: [{ id: 5, category_id: 4 }] });
  mockedScope.mockResolvedValue({ permitted: true, logRegionId: 12 });
});

describe('refuseArrival', () => {
  it('404s an experience that does not exist and 403s a curator out of scope', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const missing = makeRes();
    await refuseArrival({ params: { id: '5' }, user: CURATOR, body: {} } as never, missing as never);
    expect(missing.status).toHaveBeenCalledWith(404);

    mockedScope.mockResolvedValueOnce({ permitted: false, logRegionId: null });
    const outOfScope = makeRes();
    await refuseArrival({ params: { id: '5' }, user: CURATOR, body: {} } as never, outOfScope as never);
    expect(outOfScope.status).toHaveBeenCalledWith(403);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('writes the verdict, the reason and the pin on the membership, and names the act', async () => {
    const client = makeClient(ARRIVAL);
    const res = makeRes();

    await refuseArrival(
      { params: { id: '5' }, user: CURATOR, body: { note: 'a parish church' } } as never, res as never);

    const membership = client.queries.find(q => q.sql.includes('UPDATE experience_kind_memberships'));
    expect(membership?.sql).toContain("admission = 'refused'");
    expect(membership?.sql).toContain('is_iconic = CASE');
    expect(membership?.params).toEqual([40, CURATOR_REFUSAL_REASON, JSON.stringify(['admission'])]);
    // Nobody passed it: the gate state is left as it is, and both facts are said.
    expect(membership?.sql).not.toContain('curation_state');

    const place = client.queries.find(q => q.sql.includes('UPDATE experiences'));
    expect(place?.params).toEqual([5, 7, 'a parish church']);

    const log = client.queries.find(q => q.sql.includes('experience_curation_log'));
    expect(log?.sql).toContain("'arrival_refused'");
    expect(log?.params?.[2]).toBe(12);
    expect(JSON.parse(log?.params?.[3] as string)).toEqual({ reason: CURATOR_REFUSAL_REASON, note: 'a parish church' });

    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(res.json).toHaveBeenCalledWith({ experienceId: 5, admission: 'refused', reason: CURATOR_REFUSAL_REASON });
  });

  it('keeps an earlier pin beside the admission one', async () => {
    const client = makeClient({ ...ARRIVAL, curated_fields: ['is_iconic'] });
    await refuseArrival({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never);
    const membership = client.queries.find(q => q.sql.includes('UPDATE experience_kind_memberships'));
    expect(JSON.parse(membership?.params?.[2] as string)).toEqual(['is_iconic', 'admission']);
  });

  it.each([
    ['a row a rule already refused', { ...ARRIVAL, admission: 'refused' }, {}],
    ['a row somebody has passed', { ...ARRIVAL, curation_state: 'auto' }, {}],
    ['a row with no membership', null, {}],
    ['a row the source stopped offering', ARRIVAL, { missingSince: new Date('2026-09-01T00:00:00Z') }],
  ])('409s %s and writes nothing', async (_what, membership, opts) => {
    const client = makeClient(membership, opts);
    const res = makeRes();

    await refuseArrival({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.queries.some(q => q.sql.trimStart().startsWith('UPDATE'))).toBe(false);
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });
});

describe('refuseContents', () => {
  it('marks every unread offered point and link, through the fragments the card reads', async () => {
    const client = makeClient(VISIBLE);
    const res = makeRes();

    await refuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    const points = client.queries.find(q => q.sql.includes('UPDATE experience_locations'));
    expect(points?.sql).toContain('SET refused_at = NOW()');
    expect(points?.sql).toContain(unreadPointSql('experience_locations'));
    expect(points?.sql).toContain(offeredLocationSql('experience_locations'));
    expect(points?.sql).not.toContain('SET curation_state');
    expect(points?.params).toEqual([5]);

    const links = client.queries.find(q => q.sql.includes('UPDATE experience_treasures'));
    expect(links?.sql).toContain(unreadLinkSql('et', 't'));
    expect(links?.sql).toContain(offeredLinkSql('et'));
    expect(links?.sql).not.toContain('UPDATE treasures ');
    // The link's own state goes pending with the mark: a link unread only
    // because its work is pending would otherwise surface the day the work is
    // published at another venue, since readers never read the mark.
    expect(links?.sql).toContain("SET refused_at = NOW(), curation_state = 'pending'");

    const log = client.queries.find(q => q.sql.includes('experience_curation_log'));
    expect(log?.sql).toContain("'contents_refused'");
    expect(JSON.parse(log?.params?.[3] as string)).toEqual({
      locations: 1, treasureLinks: 1, withdrawalsReleased: 1, note: null,
    });
    expect(res.json).toHaveBeenCalledWith({
      experienceId: 5, locationsRefused: 1, treasureLinksRefused: 1, withdrawalsReleased: 1,
    });
  });

  it('releases the withdrawal a refused arrival was holding, so the old pin asks its own question', async () => {
    // A moved point: the arrival is pending and names the old row it replaces,
    // and the old row stays on the map until the arrival is answered. Refusing
    // the arrival must withdraw the old row the way publishing it would, or
    // readers keep a pin the source dropped, with no card anywhere about it.
    const client = makeClient(VISIBLE);
    await refuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never);

    const updates = client.queries.filter(q => q.sql.includes('UPDATE experience_locations')).map(q => q.sql);
    const mark = updates.findIndex(sql => sql.includes('SET refused_at = NOW()'));
    const release = updates.findIndex(sql => sql.includes('SET missing_since = NOW(), ordinal = NULL'));
    const clear = updates.findIndex(sql => sql.includes('SET withdrawal_deferred_for_location_id = NULL')
      && !sql.includes('missing_since'));
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(release).toBeGreaterThan(mark);
    expect(clear).toBeGreaterThan(release);
    // Through the refused rows of this object, both sides scoped to it.
    expect(updates[release]).toContain('refused.withdrawal_deferred_for_location_id = old.id');
    expect(updates[release]).toContain('refused.refused_at IS NOT NULL');
    expect(updates[release]).toContain('old.missing_since IS NULL');
    expect(updates[clear]).toContain('refused_at IS NOT NULL');
  });

  it('re-places the object after a released withdrawal, and carries a failed world view', async () => {
    // Placement's insert takes offered points only while its clear is
    // unfiltered, so the old point's region rows have to go and the union be
    // recomputed — after the COMMIT, as every other release does it.
    const mockedPlace = placeAfterRelease as unknown as ReturnType<typeof vi.fn>;
    mockedPlace.mockResolvedValueOnce([{ worldViewId: 5, worldViewName: 'Administrative' }]);
    const client = makeClient(VISIBLE);
    const res = makeRes();

    await refuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    const commitAt = client.queries.findIndex(q => q.sql === 'COMMIT');
    expect(commitAt).toBeGreaterThan(0);
    expect(mockedPlace).toHaveBeenCalledWith(5, expect.stringContaining('turned down'));
    // After this request's client is back in the pool: placement takes its
    // own connections per world view, and holding this one across the sweep
    // would be where a curator's answer could exhaust the pool.
    expect(client.release.mock.invocationCallOrder[0]).toBeLessThan(mockedPlace.mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      withdrawalsReleased: 1,
      placementFailed: true,
      placementFailedWorldViews: [{ id: 5, name: 'Administrative' }],
    }));
  });

  it('releases nothing when no point was refused', async () => {
    const client = makeClient(VISIBLE);
    await refuseContents(
      { params: { id: '5' }, user: CURATOR, body: { treasureIds: [88] } } as never, makeRes() as never);
    expect(client.queries.some(q => q.sql.includes('SET missing_since = NOW()'))).toBe(false);
    // And no re-place: a refused link moves no pin and counts toward no region.
    expect(placeAfterRelease).not.toHaveBeenCalled();
  });

  it('touches no point when only works are named, and records the ids', async () => {
    const client = makeClient(VISIBLE);

    await refuseContents(
      { params: { id: '5' }, user: CURATOR, body: { treasureIds: [88, 89] } } as never, makeRes() as never);

    expect(client.queries.some(q => q.sql.includes('UPDATE experience_locations'))).toBe(false);
    const links = client.queries.find(q => q.sql.includes('UPDATE experience_treasures'));
    expect(links?.sql).toContain('ANY($2::int[])');
    expect(links?.params).toEqual([5, [88, 89]]);
    const log = client.queries.find(q => q.sql.includes('experience_curation_log'));
    expect(JSON.parse(log?.params?.[3] as string)).toMatchObject({ treasureIds: [88, 89], locations: 0 });
  });

  it('sends an arrival back to its own card', async () => {
    const client = makeClient(ARRIVAL);
    const res = makeRes();

    await refuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('answer the arrival'),
    }));
    expect(client.queries.some(q => q.sql.trimStart().startsWith('UPDATE'))).toBe(false);
  });

  it('409s rather than logging a refusal that reached nothing', async () => {
    const client = makeClient(VISIBLE, { rowCount: 0 });
    const res = makeRes();

    await refuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.queries.some(q => q.sql.includes('experience_curation_log'))).toBe(false);
    expect(rollbackQuietly).toHaveBeenCalledWith(client);
  });

  it('rolls back and rethrows when a statement fails', async () => {
    const client = makeClient(VISIBLE);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes(OBJECT_LOCK)) return { rows: [{ missing_since: null }], rowCount: 1 };
      if (sql.includes('AS membership_id')) return { rows: [VISIBLE], rowCount: 1 };
      if (sql.includes('UPDATE experience_locations')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });

    await expect(refuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never))
      .rejects.toThrow('boom');
    expect(client.release).toHaveBeenCalled();
  });
});
