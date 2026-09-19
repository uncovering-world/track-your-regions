/**
 * Tests for where publishing leaves the object: nowhere new, except in the one publish that
 * changes where it is — a moved point whose withdrawal was waiting on its arrival.
 *
 * Every assertion is anchored to the one statement it is about, as
 * `publishController.test.ts` explains: `only()` fails when a fragment matches more than one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  // Mirrors the real one, returning the rollback's own failure — which is what
  // `client.release()` needs to destroy a client carrying an open transaction.
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

// Mocked as a module rather than through the pool: placement opens its own
// transaction on its own connection, so driving it through the fake client would
// prove nothing about whether it ran off this one.
vi.mock('../../services/sync/regionAssignmentService.js', () => ({
  worldViewsWithGeometry: vi.fn(async () => [1, 4]),
  assignRegionsForExperiences: vi.fn(async () => 3),
}));

import {
  grantScope, makeClient, mockedPlace, mockedQuery, mockedWorldViews, none, only, publish,
  resetPublishMocks,
} from './publishController.fixtures.js';

beforeEach(resetPublishMocks);

describe('publishing does not re-place the object', () => {
  it('touches no region assignment', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'pending' } });

    await publish({}, client);

    // Placement's insert predicate is the `offeredLocationSql` pair — the withdrawal
    // flag and the `lost` verdict — and nothing else, so a `pending` location was
    // already placed by the run that wrote it
    // and flipping it to `verified` moves nothing. This guards an addition
    // rather than a deletion: "publish places" reads as the obvious symmetry,
    // and doing it would delete and reinsert region rows across every world view
    // with geometry for no change at all.
    expect(none(queries, 'experience_location_regions')).toBe(true);
    expect(none(queries, 'experience_regions')).toBe(true);
    expect(mockedQuery).toHaveBeenCalledTimes(1);   // the existence check, nothing after
    // The one exception is a released withdrawal, and this publish released
    // none. Asserted on the service rather than on the SQL, because placement
    // runs off its own connection and issues no statement on this client.
    expect(mockedPlace).not.toHaveBeenCalled();
  });
});

/**
 * The one publish that changes where an object is.
 *
 * A moved point under a gated source is a withdrawal the run held back and an
 * arrival nobody can see (`locationWriter.ts`). Publishing the arrival is the
 * moment the two swap, and it has to happen in one transaction or the point
 * exists twice or not at all.
 */
describe('publishing releases the withdrawal that was waiting on it', () => {
  /** A publish that made an unread point visible, and released one withdrawal. */
  const releasing = () => makeClient({
    row: { curation_state: 'pending' },
    rowCounts: {
      'UPDATE experience_locations SET curation_state': 1,
      'SET missing_since = NOW()': 1,
    },
  });

  it('withdraws the old point the published one was holding', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    const release = only(queries, 'SET missing_since = NOW()');
    // Read off the arrival rather than searched for: the column is on the new
    // row and names the old one, so publishing reads the pairing from the row it
    // is publishing.
    expect(release.sql).toContain('arrived.withdrawal_deferred_for_location_id = old.id');
    // Only a pairing whose arrival a reader can now see. Before the statement
    // above ran, this one would match nothing.
    expect(release.sql).toContain(`arrived.curation_state <> 'pending'`);
    // Never a second time, and never over a point some other path already
    // withdrew.
    expect(release.sql).toContain('old.missing_since IS NULL');
    // Both sides scoped to this experience. The writer never pairs across
    // objects, and the foreign key does not say so, so this is the one statement
    // here that could otherwise reach a row the caller's scope was not checked
    // against.
    expect(release.sql).toContain('arrived.experience_id = $1');
    expect(release.sql).toContain('old.experience_id = $1');
    expect(release.params[0]).toBe(5);
  });

  it('does it inside the transaction that published the point', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // The whole reason this was deferred out of the writer's own sub-branch: on
    // either side of a COMMIT the map shows the place twice or not at all.
    const publishing = queries.findIndex(q => q.sql.includes('UPDATE experience_locations SET curation_state'));
    const release = queries.findIndex(q => q.sql.includes('SET missing_since = NOW()'));
    expect(publishing).toBeLessThan(release);
    expect(release).toBeLessThan(queries.findIndex(q => q.sql === 'COMMIT'));
  });

  it('leaves no waiter on the point it withdraws', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // The floor under `locationWriter`'s prevention, and it belongs in the same
    // `SET` list as the withdrawal rather than in the clear two statements below:
    // that one skips rows still `pending`, which is exactly what a released
    // intermediate is. Without this, a chain P <- A1 <- A2 survives publishing A2 —
    // A1 is withdrawn but keeps naming P, A1 can never be published
    // (`missing_since IS NULL`), nothing deletes a location so the foreign key
    // never fires, and P stays visible beside A2 for ever.
    expect(only(queries, 'SET missing_since = NOW()').sql)
      .toContain('withdrawal_deferred_for_location_id = NULL');
  });

  it('lets go of the pairing it has just released', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // A pairing left standing outlives its purpose and turns harmful: a run that
    // offers the old point again clears `missing_since`, and the next run to
    // withdraw it would find the stale pointer and hold it for ever, with no
    // arrival left to publish.
    //
    // Keyed on `IS NOT NULL`, which only this statement carries: the release's own
    // `SET` clears the column too, so a fragment naming the assignment alone now
    // depends on where the line happens to wrap.
    const clear = only(queries, 'withdrawal_deferred_for_location_id IS NOT NULL');
    expect(clear.sql).toContain('SET withdrawal_deferred_for_location_id = NULL');
    expect(clear.sql).toContain(`curation_state <> 'pending'`);
    const release = queries.findIndex(q => q.sql.includes('SET missing_since = NOW()'));
    expect(queries.indexOf(clear)).toBeGreaterThan(release);
  });

  it('places the object again, because a point stopped being offered', async () => {
    grantScope();
    const { client } = releasing();

    const res = await publish({}, client);

    // The one publish that genuinely moves geometry. Placement's insert carries
    // the `offeredLocationSql` pair while its clear does not, so the released
    // point's region rows have to go — and only a full re-place can recompute
    // the experience-level union they fed.
    expect(mockedPlace).toHaveBeenCalledWith([5], 1);
    expect(mockedPlace).toHaveBeenCalledWith([5], 4);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ withdrawalsReleased: 1 }));
  });

  it('places after the commit, on a connection of its own', async () => {
    grantScope();
    const { client, queries } = releasing();
    let committed = false;
    const inner = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'COMMIT') committed = true;
      return inner(sql, params);
    });
    // Recorded and asserted afterwards, never `expect`ed inside the mock: this
    // call is wrapped in the try/catch that turns a placement failure into a
    // reported one, so a failed assertion in here is swallowed and the test
    // passes. Proved by mutation — moving the COMMIT after the placement killed
    // no test until this was recorded instead of asserted.
    let placedBeforeCommit = false;
    mockedPlace.mockImplementation(async () => {
      if (!committed) placedBeforeCommit = true;
      return 3;
    });

    await publish({}, client);

    // `assignRegionsForExperiences` opens a transaction of its own, so calling it
    // from inside this one would have it wait on rows this transaction holds.
    expect(mockedPlace).toHaveBeenCalled();
    expect(placedBeforeCommit).toBe(false);
    expect(queries.some(q => q.sql.includes('experience_location_regions'))).toBe(false);
  });

  it('tries every world view, even after one of them fails', async () => {
    grantScope();
    const { client } = releasing();
    mockedPlace.mockImplementation(async (_ids: number[], worldViewId: number) => {
      if (worldViewId === 1) throw new Error('world view 1 is busy');
      return 3;
    });

    const res = await publish({}, client);

    // Each world view is its own transaction over its own regions, so one failing
    // says nothing about the next. Stopping at the first would leave the rest
    // stale with nothing naming them.
    expect(mockedPlace).toHaveBeenCalledWith([5], 1);
    expect(mockedPlace).toHaveBeenCalledWith([5], 4);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ placementFailed: true }));
  });

  it('names the world views left stale, because the curator cannot re-place them', async () => {
    grantScope();
    const { client } = releasing();
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: 'GADM' }] });
    mockedPlace.mockImplementation(async (_ids: number[], worldViewId: number) => {
      if (worldViewId === 1) throw new Error('world view 1 is busy');
      return 3;
    });

    const res = await publish({}, client);

    // Re-assignment is admin-only, and this endpoint's caller is usually a scoped
    // curator. A boolean plus a line in this process's log leaves them telling an
    // admin "something about regions failed on the Prado", so the answer names
    // each one: the name for the person reading it, the id for the admin they
    // take it to. Only the failures — world view 4 placed and is not in here.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailed: true,
      placementFailedWorldViews: [{ id: 1, name: 'GADM' }],
    }));
  });

  it('answers with the ids when the world views cannot be named', async () => {
    grantScope();
    const { client } = releasing();
    mockedQuery.mockRejectedValueOnce(new Error('name lookup failed'));
    mockedPlace.mockRejectedValue(new Error('regions are busy'));

    const res = await publish({}, client);

    // The name is cosmetic and the id is the answer. Failing the whole call over
    // the lookup would report a publication that landed as an error.
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailedWorldViews: [{ id: 1, name: null }, { id: 4, name: null }],
    }));
  });

  it('says nothing failed when the world views cannot even be listed', async () => {
    grantScope();
    const { client } = releasing();
    mockedWorldViews.mockRejectedValue(new Error('no connection'));

    const res = await publish({}, client);

    // A different sentence from a named world view refusing: nothing was placed at
    // all. It must still not throw, and must still not claim success — and it is
    // the one failure with no world view to name, which the page says in those
    // words rather than printing "world view null".
    expect(mockedPlace).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      placementFailed: true,
      placementFailedWorldViews: [{ id: null, name: null }],
    }));
  });

  it('does not undo the publication when placing afterwards fails', async () => {
    grantScope();
    const { client, queries } = releasing();
    mockedPlace.mockRejectedValue(new Error('regions are busy'));

    const res = await publish({}, client);

    // The publication is committed by then. Throwing here would answer 500 to a
    // curator whose click did land, and the catch above would run ROLLBACK on a
    // transaction that no longer exists.
    expect(queries.at(-1)?.sql).toBe('COMMIT');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      withdrawalsReleased: 1, placementFailed: true,
    }));
  });

  it('says in the audit row how many withdrawals it released', async () => {
    grantScope();
    const { client, queries } = releasing();

    await publish({}, client);

    // The publication's own record. A reader looking at why a pin moved has the
    // audit row and nothing else — the run that proposed the move is a different
    // row in a different table, and says nothing about when it took effect.
    expect(JSON.parse(String(only(queries, 'INSERT INTO experience_curation_log').params[3])))
      .toMatchObject({ withdrawalsReleased: 1 });
  });

  it('asks nothing and places nothing when it published no point', async () => {
    grantScope();
    const { client, queries } = makeClient({ row: { curation_state: 'auto' } });

    await publish({ treasureIds: [900] }, client);

    // A pairing only ever sits on a `pending` point, so a publish that moved no
    // point cannot have released one. Two statements and two placement
    // transactions per treasures-only publish, for nothing.
    expect(none(queries, 'SET missing_since = NOW()')).toBe(true);
    expect(none(queries, 'SET withdrawal_deferred_for_location_id = NULL')).toBe(true);
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it('leaves a withdrawn point unread even when the caller names it', async () => {
    grantScope();
    const { client, queries } = makeClient({
      row: { curation_state: 'auto' },
      rowCounts: { 'UPDATE experience_locations SET curation_state': 1 },
    });

    await publish({ locationIds: [11] }, client);

    // The named path needs the guard as much as the "all" path does, and it is
    // the same statement — asserted separately because a `($2 IS NULL OR …)`
    // rewrite, or a named-only branch, is exactly how the two would come apart.
    // A point published while withdrawn reappears on the map already `verified`
    // the next time a run offers it, having been on no card at any point.
    const locations = only(queries, 'UPDATE experience_locations SET curation_state');
    // Both terms of the fragment, for the reason the "all" path's assertion gives:
    // one of them is satisfied by the narrower predicate this replaced, so pinning it
    // alone would leave a revert green on both paths.
    expect(locations.sql).toContain('missing_since IS NULL');
    expect(locations.sql).toContain("existence <> 'lost'");
    expect(locations.sql).toContain('AND id = ANY($2::int[])');
    expect(locations.params[1]).toEqual([11]);
  });
});
