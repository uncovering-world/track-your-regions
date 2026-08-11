/**
 * `GET /:id/treasures` is one of the three by-id reads ADR-0025 relaxes the
 * pending gate for. `maySeeUnreadExperience` (`experienceScope.ts`) resolves
 * the boolean; these tests pin how `getExperienceTreasures` wires it into the
 * three predicates it needs — the experience, the link and the treasure — not
 * `maySeeUnreadExperience`'s own scope logic (covered where it is exercised
 * for `getExperience`, in `experienceQueryController.test.ts`).
 *
 * Before this slice, the query filtered only the container (`hideRefusedSql`
 * on `e`). ADR-0025 adds three more predicates here, not one: the experience,
 * `experience_treasures` and `treasures` each carry their own `curation_state`
 * (decision 2 — a published museum may hold newly-written, unread paintings
 * the container gate never reaches), so a curator relaxation that widened
 * only the container would open the page onto an empty list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { getExperienceTreasures, markTreasureViewed } from './experienceTreasureController.js';
import { linkedForReaderSql } from './experienceLifecycle.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('getExperienceTreasures gate', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('gates the experience, the link and the treasure, not the container alone', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getExperienceTreasures({ params: { id: '1' } } as never, makeRes() as never);

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toMatch(/e\.admission <> 'refused'/);
    expect(sql).toMatch(/e\.curation_state <> 'pending'/);
    expect(sql).toMatch(/et\.curation_state <> 'pending'/);
    expect(sql).toMatch(/t\.curation_state <> 'pending'/);
  });

  it('binds the gate closed for an anonymous caller, without asking the database about scope', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getExperienceTreasures({ params: { id: '1' } } as never, makeRes() as never);

    // Exactly the one query this read makes — no scope check for a caller who
    // never asked to see anything unread.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([1, false]);
  });

  it('opens the gate for an admin, on all three predicates, without a scope query', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await getExperienceTreasures(
      { params: { id: '1' }, user: { id: 1, role: 'admin' } } as never,
      makeRes() as never,
    );

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([1, true]);
    // All three widen on the one boolean, so an admin who is let past one
    // predicate is let past all three.
    expect(sql.match(/\$2::boolean OR/g)).toHaveLength(3);
  });

  it('opens the gate for a curator whose scope reaches the experience', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ category_id: 1 }] }) // category lookup
      .mockResolvedValueOnce({ rows: [{ unrestricted: true, scoped_region_id: null }] }) // scope check
      .mockResolvedValueOnce({ rows: [] }); // the treasures query itself

    await getExperienceTreasures(
      { params: { id: '1' }, user: { id: 9, role: 'curator' } } as never,
      makeRes() as never,
    );

    const [, params] = mockedQuery.mock.calls[2] as [string, unknown[]];
    expect(params).toEqual([1, true]);
  });

  it('keeps the gate closed for a curator whose scope does not reach the experience', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ category_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ unrestricted: false, scoped_region_id: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await getExperienceTreasures(
      { params: { id: '1' }, user: { id: 9, role: 'curator' } } as never,
      makeRes() as never,
    );

    const [, params] = mockedQuery.mock.calls[2] as [string, unknown[]];
    expect(params).toEqual([1, false]);
  });
});

/**
 * #520 argued no gate was needed here because "a pending location cannot
 * have been visited" — true only if nothing could write that visit. Viewing
 * one treasure auto-marks every location of its venue, unconditionally
 * before this fix, so a curator's own act of viewing one unread painting
 * would have manufactured visits to the venue's other unread points too.
 */
describe('a viewed claim can only be added for a link that was showable', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('asks exactly what showable means of the link', async () => {
    // The lookup that resolves the work comes first and stops the handler, so
    // the link check is reached only once the work itself is showable.
    // Three calls before the one under test: the work's own lookup, the
    // `user_viewed_treasures` insert that follows it, then the link check.
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 9, name: 'Mona Lisa' }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await markTreasureViewed(
      { params: { treasureId: '9' }, body: { experienceId: 42 }, user: { id: 5 } } as never,
      makeRes() as never);

    const linkSql = String((mockedQuery.mock.calls.find(
      (call) => String(call[0]).includes('experience_treasures et')) as [string, unknown[]])[0]);
    expect(linkSql).toContain(linkedForReaderSql());
  });
});

describe('markTreasureViewed auto-mark — #520', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('gates the treasure lookup on its own curation_state', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await markTreasureViewed(
      { params: { treasureId: '3' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/t\.curation_state <> 'pending'/);
  });

  it('404s a pending treasure and writes nothing, before it could echo the name', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await markTreasureViewed(
      { params: { treasureId: '3' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    // One query: the lookup has to fail before the INSERT that would write
    // `user_viewed_treasures`, or a write-then-check order would create the
    // manufactured record this gate exists to prevent.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('gates the link check on the container and the link, not the treasure again', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 3, name: 'Auto Painting' }] }) // treasure lookup
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO user_viewed_treasures
      .mockResolvedValueOnce({ rows: [] }); // linkResult — gated out below

    await markTreasureViewed(
      { params: { treasureId: '3' }, body: { experienceId: 2 }, user: { id: 5 } } as never,
      makeRes() as never,
    );

    const [linkSql] = mockedQuery.mock.calls[2] as [string, unknown[]];
    expect(linkSql).toMatch(/e\.curation_state <> 'pending'/);
    expect(linkSql).toMatch(/et\.curation_state <> 'pending'/);
    // The treasure was already checked at the lookup above; re-checking it
    // here would just repeat that predicate under an alias this statement
    // does not otherwise have a reason to bind. Anchored with a leading
    // boundary so "et.curation_state" — genuinely present, and correct —
    // cannot satisfy a check meant to rule out a bare "t." alias.
    expect(linkSql).not.toMatch(/\bt\.curation_state/);
  });

  it('skips the auto-mark when the link check is gated out, without erroring', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 3, name: 'Auto Painting' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // linkResult empty — pending container or link
    const res = makeRes();

    await markTreasureViewed(
      { params: { treasureId: '3' }, body: { experienceId: 2 }, user: { id: 5 } } as never,
      res as never,
    );

    // The primary action — marking the treasure viewed — still succeeds; the
    // venue auto-mark is a best-effort secondary step that quietly does
    // nothing when its own gate says no, the same as it already did for an
    // experienceId that named no real link at all.
    expect(res.status).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenCalledTimes(3);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ experienceName: null }));
  });

  it('gates the locations it auto-marks visited, both container and content', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 3, name: 'Pending Painting' }] }) // treasure lookup
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO user_viewed_treasures
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // linkResult: the treasure is linked
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO user_visited_experiences
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO user_visited_locations (the one under test)
      .mockResolvedValueOnce({ rows: [{ name: 'Museum' }] }); // SELECT name FROM experiences

    await markTreasureViewed(
      { params: { treasureId: '3' }, body: { experienceId: 2 }, user: { id: 5 } } as never,
      makeRes() as never,
    );

    const insertLocations = mockedQuery.mock.calls
      .map(c => String(c[0]))
      .find(sql => /INSERT INTO user_visited_locations/.test(sql));
    expect(insertLocations).toBeDefined();
    expect(insertLocations).toMatch(/e\.curation_state <> 'pending'/);
    expect(insertLocations).toMatch(/el\.curation_state <> 'pending'/);
  });
});
