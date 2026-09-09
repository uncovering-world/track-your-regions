/**
 * Tests for the way back from a curator's no to an unread part (#859).
 *
 * Three rules carry this writer. **It clears the mark and writes nothing else**
 * — a refused part kept `curation_state = 'pending'` and stayed hidden, so the
 * take-back restores the question and nothing a reader sees; in particular a
 * link stays `pending`, because the refusal set it so to say nobody had passed
 * the work *here*. **It reaches only rows the list showed**: the mark, and
 * offered rows, through the same fragments the refusal used. **A restored point
 * counts toward its regions again**, so the object is re-placed after the
 * commit, exactly as turning it down re-placed it.
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
import { unrefuseContents } from './unrefuseContentsController.js';
import { contentsAnswerableSql } from './waitingCounts.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveExperienceScope as unknown as ReturnType<typeof vi.fn>;
const mockedPlace = placeAfterRelease as unknown as ReturnType<typeof vi.fn>;

const CURATOR = { id: 7, role: 'curator' as const };

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/**
 * A client whose locked read answers the object and whose membership read
 * answers `membership`.
 *
 * Both UPDATEs carry `RETURNING`, so unlike the refusal's harness this one
 * answers *rows* rather than a count — which is the point of the shape: what
 * came back is read off the statement rather than counted, and the log names it.
 */
function makeClient(
  membership: Record<string, unknown> | null,
  { missingSince = null as Date | null, points = [{ id: 31 }], links = [{ treasure_id: 88 }] } = {},
) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    queries,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (sql.includes(OBJECT_LOCK)) return { rows: [{ missing_since: missingSince }], rowCount: 1 };
      if (sql.includes('AS membership_id')) {
        // The database evaluates the precondition now, so the harness answers it
        // the way Postgres would for the membership it is standing in for.
        const answerable = membership !== null
          && membership.admission === 'admitted'
          && membership.curation_state !== 'pending'
          && missingSince === null;
        return { rows: [{ ...(membership ?? {}), answerable }], rowCount: 1 };
      }
      if (sql.includes('UPDATE experience_locations')) return { rows: points, rowCount: points.length };
      if (sql.includes('UPDATE experience_treasures')) return { rows: links, rowCount: links.length };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  mockedConnect.mockResolvedValue(client);
  return client;
}

const ARRIVAL = { membership_id: 40, admission: 'admitted', curation_state: 'pending' };
const VISIBLE = { membership_id: 40, admission: 'admitted', curation_state: 'auto' };

beforeEach(() => {
  mockedQuery.mockReset();
  mockedConnect.mockReset();
  mockedScope.mockReset();
  mockedPlace.mockClear();
  mockedQuery.mockResolvedValue({ rows: [{ id: 5, category_id: 4 }] });
  mockedScope.mockResolvedValue({ permitted: true, logRegionId: 12 });
});

describe('unrefuseContents', () => {
  it('404s an experience that does not exist and 403s a curator out of scope', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const missing = makeRes();
    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, missing as never);
    expect(missing.status).toHaveBeenCalledWith(404);

    mockedScope.mockResolvedValueOnce({ permitted: false, logRegionId: null });
    const outOfScope = makeRes();
    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, outOfScope as never);
    expect(outOfScope.status).toHaveBeenCalledWith(403);
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('locks the object in a statement of its own before reading the membership', async () => {
    // `db/locks.ts`: under READ COMMITTED a folded sub-select is evaluated
    // against the snapshot the statement opened with, so the row locked and the
    // row read can be two versions of it.
    const client = makeClient(VISIBLE);
    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never);

    const lockAt = client.queries.findIndex(q => q.sql.includes(OBJECT_LOCK));
    const readAt = client.queries.findIndex(q => q.sql.includes('AS membership_id'));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeGreaterThan(lockAt);
    expect(client.queries[lockAt].sql).not.toContain('membership_id');
  });

  it('clears the mark on both kinds and writes nothing else', async () => {
    const client = makeClient(VISIBLE);
    const res = makeRes();

    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    const points = client.queries.find(q => q.sql.includes('UPDATE experience_locations'));
    expect(points?.sql).toContain('SET refused_at = NULL');
    expect(points?.sql).toContain('refused_at IS NOT NULL');
    expect(points?.sql).toContain('RETURNING id');
    // The state is not this act's to write — on either kind.
    expect(points?.sql).not.toContain('curation_state');

    const links = client.queries.find(q => q.sql.includes('UPDATE experience_treasures'));
    expect(links?.sql).toContain('SET refused_at = NULL');
    expect(links?.sql).toContain('RETURNING et.treasure_id');
    // A refused link was set `pending` to say nobody had passed the work *here*.
    // Putting `auto` back would silently pass a work a curator turned down.
    expect(links?.sql).not.toContain('curation_state');
  });

  it('reaches a part the source has stopped offering, which nothing else can', async () => {
    // A refused point is always `pending`, and the withdrawn card asks for
    // `curation_state <> 'pending'` — so one the source then drops raises no card
    // of its own. An offered term here would leave it on no screen at all, with
    // the answer that put it there permanently unanswerable.
    const client = makeClient(VISIBLE);
    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never);

    const points = client.queries.find(q => q.sql.includes('UPDATE experience_locations'));
    expect(points?.sql).not.toContain('missing_since IS NULL');
    const links = client.queries.find(q => q.sql.includes('UPDATE experience_treasures'));
    expect(links?.sql).not.toContain('missing_since IS NULL');
  });

  it('never re-acquires a withdrawal the refusal released', async () => {
    // The old pin is a withdrawn point asking its own question now, on its own
    // card with its own two answers. Re-pairing it here would answer that card
    // from a screen that never mentioned it.
    const client = makeClient(VISIBLE);
    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never);

    expect(client.queries.some(q => q.sql.includes('withdrawal_deferred_for_location_id'))).toBe(false);
    expect(client.queries.some(q => q.sql.includes('missing_since = NULL'))).toBe(false);
  });

  it('names the act and the rows it actually brought back', async () => {
    const client = makeClient(VISIBLE, { points: [{ id: 31 }, { id: 32 }], links: [{ treasure_id: 88 }] });
    await unrefuseContents(
      { params: { id: '5' }, user: CURATOR, body: { note: 'mis-click' } } as never, makeRes() as never);

    const log = client.queries.find(q => q.sql.includes('experience_curation_log'));
    expect(log?.sql).toContain("'contents_unrefused'");
    expect(log?.params?.slice(0, 3)).toEqual([5, 7, 12]);
    // The ids always, where the refusal recorded them only when its caller named
    // them: the statement returns exactly the rows it touched, and this row is
    // the only place a part that has come and gone can be followed.
    expect(JSON.parse(log?.params?.[3] as string)).toEqual({
      locations: 2, treasureLinks: 1, locationIds: [31, 32], treasureIds: [88], note: 'mis-click',
    });
  });

  it('touches no point when only works are named, and no work when only points are', async () => {
    const works = makeClient(VISIBLE);
    await unrefuseContents(
      { params: { id: '5' }, user: CURATOR, body: { treasureIds: [88, 89] } } as never, makeRes() as never);
    expect(works.queries.some(q => q.sql.includes('UPDATE experience_locations'))).toBe(false);
    const links = works.queries.find(q => q.sql.includes('UPDATE experience_treasures'));
    expect(links?.sql).toContain('ANY($2::int[])');
    expect(links?.params).toEqual([5, [88, 89]]);

    const points = makeClient(VISIBLE);
    await unrefuseContents(
      { params: { id: '5' }, user: CURATOR, body: { locationIds: [31] } } as never, makeRes() as never);
    expect(points.queries.some(q => q.sql.includes('UPDATE experience_treasures'))).toBe(false);
  });

  it('re-places the object after a point comes back, and carries a failed world view', async () => {
    // Placement's insert carries `refused_at IS NULL`, so a point asked about
    // again has to be counted toward its regions once more — after the COMMIT
    // and after this client is back in the pool, as its opposite does it.
    mockedPlace.mockResolvedValueOnce([{ worldViewId: 5, worldViewName: 'Administrative' }]);
    const client = makeClient(VISIBLE);
    const res = makeRes();

    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    expect(client.queries.some(q => q.sql === 'COMMIT')).toBe(true);
    expect(mockedPlace).toHaveBeenCalledWith(5, expect.stringContaining('asked again'));
    expect(client.release.mock.invocationCallOrder[0]).toBeLessThan(mockedPlace.mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      locationsRestored: 1,
      treasureLinksRestored: 1,
      locationIds: [31],
      treasureIds: [88],
      placementFailed: true,
      placementFailedWorldViews: [{ id: 5, name: 'Administrative' }],
    }));
  });

  it('does not re-place when only a work came back', async () => {
    // A work link moves no pin and counts toward no region.
    makeClient(VISIBLE);
    await unrefuseContents(
      { params: { id: '5' }, user: CURATOR, body: { treasureIds: [88] } } as never, makeRes() as never);
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it('asks the database for the precondition rather than restating it', async () => {
    // One spelling of "may this object's contents be asked about again", read
    // here under the lock and by the list that draws the button. Two spellings is
    // how a card comes to offer a take-back the writer refuses.
    const client = makeClient(VISIBLE);
    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never);

    const read = client.queries.find(q => q.sql.includes('AS membership_id'));
    expect(read?.sql).toContain(contentsAnswerableSql());
    expect(read?.sql).toContain('AS answerable');
  });

  it('sends an arrival back to its own card', async () => {
    const client = makeClient(ARRIVAL);
    const res = makeRes();

    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('answer the arrival'),
    }));
    expect(client.queries.some(q => q.sql.trimStart().startsWith('UPDATE'))).toBe(false);
  });

  it('409s a withdrawn object rather than restoring a question nobody can answer', async () => {
    const client = makeClient(VISIBLE, { missingSince: new Date() });
    const res = makeRes();

    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.queries.some(q => q.sql.trimStart().startsWith('UPDATE'))).toBe(false);
  });

  it('409s rather than logging a take-back that reached nothing', async () => {
    const client = makeClient(VISIBLE, { points: [], links: [] });
    const res = makeRes();

    await unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('Nothing turned down'),
    }));
    expect(client.queries.some(q => q.sql.includes('experience_curation_log'))).toBe(false);
    expect(rollbackQuietly).toHaveBeenCalledWith(client);
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows when a statement fails', async () => {
    const client = makeClient(VISIBLE);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes(OBJECT_LOCK)) return { rows: [{ missing_since: null }], rowCount: 1 };
      if (sql.includes('AS membership_id')) {
        return { rows: [{ ...VISIBLE, answerable: true }], rowCount: 1 };
      }
      if (sql.includes('UPDATE experience_locations')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });

    await expect(unrefuseContents({ params: { id: '5' }, user: CURATOR, body: {} } as never, makeRes() as never))
      .rejects.toThrow('boom');
    // Named, not merely released: a client handed back to the pool with its
    // transaction still open is the failure this whole shape exists to avoid,
    // and without this the case passes with the rollback deleted.
    expect(rollbackQuietly).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalled();
    expect(mockedPlace).not.toHaveBeenCalled();
  });
});
