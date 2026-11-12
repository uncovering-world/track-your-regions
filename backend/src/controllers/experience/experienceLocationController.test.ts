/**
 * What a reader is shown once a point can be missing without being deleted, and
 * once a kind can refuse the experience that holds it.
 *
 * Two rules, on two columns, and they are not the same rule:
 *
 * - `missing_since` on a *location* — a point the source stopped offering leaves
 *   every list, marker batch and count, but a visit to it survives, because a person who stood there stood
 *   there. That is the same asymmetry `lost` already has one level up.
 * - `admission` on the *experience* — a row its kind turned down gives
 *   nothing back at its own address, so every by-id read whose answer *is* the
 *   row answers 404, instead of one of them describing a row the others withhold
 *   (ADR-0024). The shape of the refusal follows what the answer is: where the
 *   answer is other objects that merely live in the row, it is an empty list
 *   instead — `/:id/treasures`, which is not covered here. Two of the 404 reads
 *   live under `/api/experiences/:id`; the per-user visited status lives under
 *   `/api/users/me/experiences/:id` and is covered here too, since it reads the
 *   same table. `existence` is deliberately left alone on all of them, matching
 *   `getExperience`.
 *
 * Asserted on the SQL each handler sends, which is where the predicate either
 * is or is not. The behaviour behind it was checked against the live database;
 * a mocked query cannot tell a correct predicate from a wrong one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

import { pool } from '../../db/index.js';
import { claimablePlaceSql, claimableToReaderSql, experienceOfferedToReaderSql, experienceShownToReaderSql, readableByIdSql } from '../../db/readerPredicates.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { experienceReadRoutes } from '../../routes/experienceRoutes.js';
import { userRoutes } from '../../routes/userRoutes.js';

/** The user routes these specs answer through (ADR-0071). */
const getVisitedLocationIdsRoute = routeAt(userRoutes, '/me/visited-locations/ids', 'get');
const postVisitedLocation = routeAt(userRoutes, '/me/visited-locations/:locationId', 'post');
const deleteVisitedLocation = routeAt(userRoutes, '/me/visited-locations/:locationId', 'delete');
const postMarkAllLocations = routeAt(userRoutes, '/me/experiences/:experienceId/mark-all-locations', 'post');
const deleteMarkAllLocations = routeAt(userRoutes, '/me/experiences/:experienceId/mark-all-locations', 'delete');
const getVisitedStatus = routeAt(userRoutes, '/me/experiences/:id/visited-status', 'get');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
/** The same mock, in its callable shape: `vi.fn()`'s own type is not callable. */
const answer = mockedQuery as unknown as (sql: string, params?: unknown[]) => Promise<unknown>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/**
 * A point as the driver hands it to either location read: float8 as a number, a
 * timestamp as a `Date`, the claims as an array.
 *
 * It carries the columns of both reads. Each read maps only its own, and
 * `respond()` holds the answer to its schema in this lane, so a fixture that
 * drifts from the driver's shapes fails here rather than passing on strings.
 */
function placeRow(over: Record<string, unknown> = {}) {
  return {
    id: 9, experience_id: 42, name: 'See', external_ref: '1363-061', ordinal: 0,
    longitude: 9.4, latitude: 47.5, created_at: new Date('2026-08-04T15:01:24.341Z'),
    curated_fields: [], in_region: true, region_path: null, curation_state: 'auto', refused_at: null,
    image_url: null, image_credit: null, description: null, wikidata_item: null, is_part: false,
    // The part place a point is the point of, which "mark all" visits instead (ADR-0100).
    part_id: null,
    ...over,
  };
}

/** Answers the location read with a point, and every other statement with the object's own row. */
function answerPointsAndObject() {
  mockedQuery.mockImplementation(async (sql: string) => (/FROM experience_locations/i.test(sql)
    ? { rows: [placeRow()], rowCount: 1 }
    : { rows: [{ id: 1, name: 'Site' }], rowCount: 1 }));
}

/**
 * The client a handler pins for its transaction (#532).
 *
 * Its statements are answered by the pool's mock, so a test that stubs a row
 * stubs it for both and `sentSql()` below still sees everything the handler
 * sent. What separates them is the client's own call list, which is what
 * `clientSql()` reads: a statement is there only if it was addressed to this
 * one connection.
 */
function pinClient() {
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => answer(sql, params)),
    release: vi.fn(),
  };
  mockedConnect.mockReset();
  mockedConnect.mockResolvedValue(client);
  return client;
}

/** Every statement the handler sent, in order. */
function sentSql(): string[] {
  return mockedQuery.mock.calls.map(call => String(call[0]));
}

/** What the pinned client was asked, in order. */
function clientSql(client: ReturnType<typeof pinClient>): string[] {
  return client.query.mock.calls.map(call => String(call[0]));
}

/** The one statement that reads the location table. */
function locationRead(): string {
  // The read that finds the points, not the write that reads each point's place again.
  const reads = sentSql().filter(sql => /FROM experience_locations/i.test(sql) && !/INSERT INTO/i.test(sql));
  expect(reads).toHaveLength(1);
  return reads[0];
}

describe('reads that show a point', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    answerPointsAndObject();
  });

  it('leaves a withdrawn point out of an experience own list', async () => {
    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'), { params: { id: '42' }, query: {} } as never, makeRes() as never);

    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });

  it('leaves an unread point out of an experience own list, for an anonymous caller', async () => {
    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'), { params: { id: '42' }, query: {} } as never, makeRes() as never);

    // ADR-0025: a content row is gated on its own state, so a location can be
    // pending while its experience is not.
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('orders a place\'s points the same way on every request, on the object read and on both shapes of the batch', async () => {
    // Two sources' lists on one place both number from 1 (ADR-0084), so the
    // ordinal alone ties; the id decides between them.
    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'), { params: { id: '42' }, query: {} } as never, makeRes() as never);
    expect(locationRead()).toMatch(/ORDER BY el\.ordinal, el\.id/);

    for (const query of [{}, { includeChildren: 'false' }]) {
      mockedQuery.mockClear();
      await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'), { params: { regionId: '7' }, query } as never, makeRes() as never);
      // Over the union of a place's own points and its parts' (ADR-0100), by the union's columns.
      expect(locationRead()).toMatch(/ORDER BY experience_id, ordinal, id/);
    }
  });

  it('carries each place\'s claims, on the object read and on both shapes of the batch', async () => {
    // A corrected place can be corrected from every row that shows it (#583), and
    // the row has to say when one stands (migration 027) — the object screen reads
    // the first, the map's places list reads the batch, and the batch has two
    // query shapes that must not disagree. Asserted on the *response*, not on the
    // SQL: the batch rebuilds each row by hand, and its first version selected the
    // column and dropped it right there, which a match on the query text passed.
    mockedQuery.mockResolvedValue({ rows: [placeRow({ curated_fields: ['location'] })], rowCount: 1 });

    let res = makeRes();
    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'), { params: { id: '42' }, query: {} } as never, res as never);
    expect(locationRead()).toMatch(/el\.curated_fields/);
    // And whether a reader sees it yet, for the screen that corrects an unread one.
    expect(locationRead()).toMatch(/el\.curation_state/);
    expect(res.json.mock.calls[0][0].locations[0].curated_fields).toEqual(['location']);

    for (const query of [{}, { includeChildren: 'false' }]) {
      mockedQuery.mockClear();
      res = makeRes();
      await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'), { params: { regionId: '7' }, query } as never, res as never);
      expect(locationRead()).toMatch(/el\.curated_fields/);
      expect(res.json.mock.calls[0][0].locationsByExperience[42][0].curated_fields).toEqual(['location']);
    }
  });

  it('carries how roughly the source placed each point, on the object read and on both shapes of the batch (#1912)', async () => {
    // The Longmen Grottoes' point, given to the whole minute: the map draws it as
    // a ring and the row says so, so every read a reader's surface takes carries it.
    mockedQuery.mockResolvedValue({ rows: [placeRow({ approximate: 'whole-minute' })], rowCount: 1 });

    let res = makeRes();
    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'), { params: { id: '42' }, query: {} } as never, res as never);
    expect(res.json.mock.calls[0][0].locations[0].approximate).toBe('whole-minute');

    for (const query of [{}, { includeChildren: 'false' }]) {
      mockedQuery.mockClear();
      res = makeRes();
      await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'), { params: { regionId: '7' }, query } as never, res as never);
      expect(locationRead()).toMatch(/el\.approximate/);
      expect(res.json.mock.calls[0][0].locationsByExperience[42][0].approximate).toBe('whole-minute');
    }
  });

  it('leaves a withdrawn point out of the markers a region asks for', async () => {
    await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'),
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    // The marker batch feeds the map. A pin at a point the source withdrew is
    // an invitation to go somewhere that is no longer being offered.
    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });

  it('leaves an unread point out of the markers a region asks for, with no relaxation', async () => {
    await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'),
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    // The map feed is a set, not a by-id read, so ADR-0025's curator
    // relaxation never reaches it: the fragment appears unconditionally,
    // with no `$N::boolean OR` wrapped around it.
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
    expect(locationRead()).not.toMatch(/::boolean OR el\.curation_state/);
  });

  it('leaves an unread museum off the map too, not just its own unread point', async () => {
    await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'),
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    // The two predicates guard different rows and neither stands in for the
    // other: `publishedContentSql('el')` above is the location's own state,
    // and `curation_state` is the column default (ADR-0025 decision 3) —
    // `auto` — precisely so an unaware writer publishes what it writes
    // (`db/seed/e2eFixture.ts` is one such writer). An `auto` location under
    // a `pending` experience is reachable by every column on the location
    // row itself, so only this container predicate, from `lifecycleFilter`'s
    // `experienceShownToReaderSql()`, keeps that pin off the map (#1275).
    expect(locationRead()).toContain(experienceShownToReaderSql('e'));
  });

  it('leaves it out whether or not the region asks for its children', async () => {
    await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'),
      { params: { regionId: '7' }, query: { includeChildren: 'false' } } as never,
      makeRes() as never);

    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('answers for the objects the region list is showing, not for the roll-up', async () => {
    // #521: placement puts an unread point in a region on purpose (ADR-0025
    // decision 5), so `experience_regions` can hold an object whose only point
    // here is one nobody may see. This batch answers for the rows the list
    // shows — a feed carrying an object the list dropped is the same
    // disagreement from the other side, markers with no row to hang on.
    await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'),
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    expect(locationRead()).toMatch(/er\.listing = 'offered'/);
  });

  it('answers for them in the other branch too', async () => {
    // Two independently built statements, as everywhere else in this pair of
    // controllers: one being right says nothing about the other.
    await answerRoute(routeAt(experienceReadRoutes, '/by-region/:regionId/locations'),
      { params: { regionId: '7' }, query: { includeChildren: 'false' } } as never,
      makeRes() as never);

    expect(locationRead()).toMatch(/er\.listing = 'offered'/);
  });
});

/**
 * A row of the visited-status read, as the driver hands it over: `respond()`
 * holds the answer to its schema in this lane, and each test names only the
 * columns it is about.
 */
function visitStatusRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    name: null, ordinal: 0, longitude: 9.4, latitude: 47.5, visited_at: null, notes: null, cast_points: false, ...over,
  };
}

describe('a visit outlives the point', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [visitStatusRow({ location_id: 1, visit_id: 3 })], rowCount: 1 });
    pinClient();
  });

  it('counts a reader progress over the points still on offer', async () => {
    await answerRoute(getVisitedStatus,
      { params: { id: '42' }, user: { id: 5 } } as never, makeRes() as never);

    // Returning a withdrawn point because this reader had visited it puts the
    // same place on screen twice whenever the source replaces one — identity is
    // the point together with its reference, so editing either is a withdrawal
    // plus an insert — and makes
    // this endpoint's denominator disagree with `location_count` everywhere
    // else. The visit row itself is never touched; what it means for a place
    // nobody offers any more is a curator's question, not this endpoint's.
    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });

  it('marks only the points still on offer when asked to mark them all', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await answerRoute(postMarkAllLocations,
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    expect(locationRead()).toMatch(/missing_since IS NULL/);
  });

  it('does not manufacture a visit to a point nobody has read yet, "mark all" — #520', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await answerRoute(postMarkAllLocations,
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    // #520 argued this endpoint needed no gate because a `pending` location
    // "cannot have been visited" — true only if nothing can create that
    // visit. This query is the thing that does, for every location it
    // selects at once, so both the container's state and the location's own
    // have to be checked before any of them is written. The container's two
    // questions are asked of one membership together (#822).
    expect(locationRead()).toContain(experienceOfferedToReaderSql('e'));
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('does not manufacture a visit to a point nobody has read yet, "mark all" in a region', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await answerRoute(postMarkAllLocations,
      { params: { experienceId: '42' }, query: { regionId: '7' }, user: { id: 5 } } as never,
      makeRes() as never);

    // Two branches build this query; one being right proves nothing about
    // the other; see the note on the unregioned branch just above.
    expect(locationRead()).toContain(experienceOfferedToReaderSql('e'));
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('clears only the visits on places whose points the traveller is shown', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ experience_id: 42, count: 0 }], rowCount: 1 });

    await answerRoute(deleteMarkAllLocations,
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    // A click never clears a visit the traveller cannot see (#2120): a part
    // whose points were withdrawn or are unread keeps its visit. The place
    // itself, whose card the click is on, goes with the shown parts.
    const deletes = sentSql().filter(sql => /DELETE FROM user_visited_experiences/i.test(sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain(claimableToReaderSql());
    expect(deletes[0]).toMatch(/SELECT place\.experience_id FROM place UNION SELECT shown\.experience_id FROM shown/);
    expect(deletes[0]).toContain(claimablePlaceSql());
    // Every place and point the delete takes back a visit for is read under a
    // share lock, as every visit write reads what it writes for.
    expect(deletes[0]).toMatch(/FOR SHARE OF el\)/);
    expect(deletes[0]).toMatch(/FOR SHARE OF e\)/);
  });

  it("reads the region's points under a share lock when it takes their visits back", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ experience_id: 42, count: 0 }], rowCount: 1 });

    await answerRoute(deleteMarkAllLocations,
      { params: { experienceId: '42' }, query: { regionId: '7' }, user: { id: 5 } } as never,
      makeRes() as never);

    const deletes = sentSql().filter(sql => /DELETE FROM user_visited_experiences/i.test(sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/FOR SHARE OF el\)/);
    expect(deletes[0]).not.toMatch(/FROM place/);
  });

  it("takes back a tick on a point as its own place's visit, and nothing else", async () => {
    mockedQuery.mockReset();
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ experience_id: 7, shown_by: 7 }, { experience_id: 7, shown_by: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    await answerRoute(deleteVisitedLocation,
      { params: { locationId: '70' }, user: { id: 5 } } as never, makeRes() as never);

    // A whole the point's place is a part of is read through the part
    // (#2120): nothing of the whole's is written or deleted here. The point's
    // place is read in the delete, under the tick's share lock on the point.
    const clears = sentSql().filter(sql => /DELETE FROM user_visited_experiences/i.test(sql));
    expect(clears).toHaveLength(1);
    expect(clears[0]).toMatch(/FROM experience_locations el[\s\S]*FOR SHARE OF el/);
    expect(mockedQuery.mock.calls.at(-1)?.[1]).toEqual([5, 70]);
    // Only a point the traveller is shown, as a tick is gated (#2120).
    expect(String(mockedQuery.mock.calls[0][0])).toContain(claimableToReaderSql());
  });
});

describe('the visits a "mark all" writes and takes back', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ id: 1, experience_id: 42, count: 0 }], rowCount: 1 });
  });

  it("writes the points' places in one statement, each read again as it is written", async () => {
    mockedQuery.mockReset();
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, experience_id: 42 }, { id: 2, experience_id: 43 }, { id: 3, experience_id: 43 }] })
      .mockResolvedValueOnce({ rows: [{ marked: 3 }] });
    const res = makeRes();

    await answerRoute(postMarkAllLocations,
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      res as never);

    // A merge moving a point between the read and the write is waited for,
    // and the visit lands where the point then stands (#2120); the answer
    // counts the points the write read.
    const inserts = mockedQuery.mock.calls.filter(c => /INSERT INTO user_visited_experiences/.test(String(c[0])));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual([5, [1, 2, 3]]);
    expect(String(inserts[0][0])).toMatch(/el\.merged_into_id IS NULL\s+FOR SHARE OF el/);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ locationsMarked: 3 }));
  });

  it('answers 404 where a merge folded every point before the write read them', async () => {
    mockedQuery.mockReset();
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, experience_id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ marked: 0 }] });
    const res = makeRes();

    await answerRoute(postMarkAllLocations,
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      res as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('takes the visits back on the pinned client, BEGIN through COMMIT', async () => {
    const client = pinClient();

    await answerRoute(deleteMarkAllLocations,
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    const onClient = clientSql(client);
    expect(onClient[0]).toBe('BEGIN');
    expect(onClient.at(-1)).toBe('COMMIT');
    expect(onClient.filter(sql => /DELETE FROM user_visited_experiences/i.test(sql))).toHaveLength(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and hands the connection back when a statement fails', async () => {
    const client = pinClient();
    mockedQuery
      .mockReset()
      .mockResolvedValueOnce({ rows: [] })           // BEGIN
      .mockRejectedValueOnce(new Error('delete failed'));

    await expect(answerRoute(deleteMarkAllLocations,
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never)).rejects.toThrow('delete failed');

    expect(clientSql(client)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

/**
 * #520 argued neither of these needed a pending gate: the single-mark write
 * because "a pending location cannot have been visited", and the read
 * because nothing could have written such a visit in the first place. Both
 * halves of that were wrong once `markAllLocationsVisited` and
 * `markTreasureViewed`'s auto-mark are considered — see the tests beside
 * them above — so both the write here and the read that lists what a reader
 * has visited need the same gate.
 */
describe('the single-mark write and the visited-ids read — #520', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('gates the lookup before marking a single location visited', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(postVisitedLocation,
      { params: { locationId: '99' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    // One query, not the three a successful mark would run: the lookup that
    // decides visibility has to run, and fail, before anything is written —
    // a write-then-check order would create the exact manufactured visit
    // this gate exists to prevent.
    expect(mockedQuery).toHaveBeenCalledTimes(1);

    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(experienceOfferedToReaderSql('e'));
    expect(sql).toMatch(/el\.curation_state <> 'pending'/);
  });

  it("writes the tick on the point's place as it stands, and answers 404 for a point folded meanwhile", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 99, name: 'See', experience_id: 42, shown_by: 42, shown_by_name: 'Lake' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(postVisitedLocation,
      { params: { locationId: '99' }, body: {}, user: { id: 5 } } as never,
      res as never,
    );

    // The place is read again with the write, under a share lock on the
    // point: a merge that folded it in between leaves nothing to write (#2120).
    const [write, params] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(write).toMatch(/INSERT INTO user_visited_experiences[\s\S]*FROM experience_locations el[\s\S]*FOR SHARE OF el/);
    expect(params).toEqual([5, 99, null]);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('lists only visited locations a reader may still see', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ location_id: 1, experience_id: 42 }] });

    await answerRoute(getVisitedLocationIdsRoute,
      { query: {}, user: { id: 5 } } as never, makeRes() as never);

    // All four, named one at a time rather than as "the lifecycle predicates":
    // this read supplies the ticks a client draws while
    // `getExperienceVisitedStatus` supplies the "n of m" beside them, so a
    // predicate on one and not the other makes the two disagree about one
    // traveller's own record. Three of them were missing when the gate was
    // added, which is how that disagreement arrived (#520).
    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql, 'a refused or unread experience keeps its ticks').toContain(experienceOfferedToReaderSql('e'));
    expect(sql, 'a withdrawn point keeps its tick').toMatch(/el\.missing_since IS NULL/);
    expect(sql, 'an unread point keeps its tick').toMatch(/el\.curation_state <> 'pending'/);
  });

  it('asks for exactly what its sibling asks, so a badge cannot read 3 of 2', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ location_id: 1, experience_id: 42 }] });
    await answerRoute(getVisitedLocationIdsRoute,
      { query: {}, user: { id: 5 } } as never, makeRes() as never);
    const [idsSql] = mockedQuery.mock.calls[0] as [string, unknown[]];

    mockedQuery.mockReset();
    mockedQuery.mockResolvedValueOnce({ rows: [visitStatusRow({ location_id: 1, visit_id: null })] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await answerRoute(getVisitedStatus,
      { params: { id: '42' }, user: { id: 5 } } as never, makeRes() as never);
    const statusSql = (mockedQuery.mock.calls.at(-1) as [string, unknown[]])[0];

    // The comparison is the assertion: whichever four fragments the denominator
    // uses, the numerator uses too. A predicate added to one and forgotten on
    // the other fails here rather than in someone's progress bar.
    for (const fragment of [
      experienceOfferedToReaderSql('e'),
      'el.missing_since IS NULL',
      "el.curation_state <> 'pending'",
    ]) {
      expect(statusSql, `the sibling stopped asking for ${fragment}`).toContain(fragment);
      expect(idsSql, `this read stopped asking for ${fragment}`).toContain(fragment);
    }
  });
});

describe('a claim can only be added for a row that was showable', () => {
  beforeEach(() => mockedQuery.mockReset());

  // Bound to the helper's own output rather than to a list of fragments. The
  // four writers that create these rows were each fixed once during ADR-0025's
  // review and three came back carrying three of the four predicates, a
  // different one missing each time — so the assertion is "this site asks
  // exactly what `showable` means", and a predicate added to the helper binds
  // every site here without anyone remembering to update a list.
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['markLocationVisited', () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] });
      return answerRoute(postVisitedLocation,
        { params: { locationId: '1' }, body: {}, user: { id: 5 } } as never, makeRes() as never);
    }],
    ['markAllLocationsVisited, whole object', () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] });
      return answerRoute(postMarkAllLocations,
        { params: { experienceId: '42' }, query: {}, body: {}, user: { id: 5 } } as never, makeRes() as never);
    }],
    ['markAllLocationsVisited, one region', () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] });
      return answerRoute(postMarkAllLocations,
        { params: { experienceId: '42' }, query: { regionId: '7' }, body: {}, user: { id: 5 } } as never,
        makeRes() as never);
    }],
  ];

  for (const [name, run] of cases) {
    it(`${name} asks exactly what showable means`, async () => {
      await run();
      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain(claimableToReaderSql());
    });
  }
});

describe('the by-id reads and a refused row', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('stops before reading locations when the check rejects the row', async () => {
    // The existence check finds nothing, because its predicate excludes the row.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'),
      { params: { id: '6205' }, query: {} } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    // One query, not two: the short-circuit is the fix. A refactor that ran the
    // location read first and 404ed afterwards would re-open the same leak.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('asks for the experience with the refusal predicate', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Museo del Prado' }] })
      .mockResolvedValueOnce({ rows: [] });

    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'),
      { params: { id: '1' }, query: {} } as never,
      makeRes() as never,
    );

    const existenceRead = sentSql().find(sql => /FROM experiences\b/i.test(sql));
    expect(existenceRead).toBeDefined();
    expect(existenceRead).toMatch(/admission <> 'refused'/);
  });

  it('filters admission only, which is today\'s choice and not a permanent rule', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Palmyra' }] })
      .mockResolvedValueOnce({ rows: [] });

    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'),
      { params: { id: '1' }, query: {} } as never,
      makeRes() as never,
    );

    // Pinned so this read stays in step with `getExperience`, not because
    // leaving `lost` reachable here is settled — the handler's own comment flags
    // closing it as a separate decision about a different question.
    const existenceRead = sentSql().find(sql => /FROM experiences\b/i.test(sql));
    // The place's own, not its part's point, which a part's card asks after (ADR-0100).
    expect(existenceRead).not.toMatch(/\be\.existence <> 'lost'/);
  });

  it('answers 404 when the admission-filtered read returns nothing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(getVisitedStatus,
      { params: { id: '6205' }, user: { id: 5 } } as never, res as never);

    // The one query here carries the admission predicate ANDed with the
    // offered-location filter, so an empty result does not distinguish a
    // refused row from one with no offered locations — the handler's own
    // message says "not found or has no locations" rather than picking one.
    // This only pins that the empty case answers 404 at all, the same gap
    // `/:id` and `/:id/locations` closed for the same row (#503).
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('reaches the visited status through the catalogue, not past it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [visitStatusRow({ location_id: 1, visit_id: null })] });

    await answerRoute(getVisitedStatus,
      { params: { id: '6205' }, user: { id: 5 } } as never, makeRes() as never);

    // This read never joined `experiences` at all, so no admission predicate
    // could reach it: any authenticated account got a refused row's points back
    // — coordinates, ordinals, a `totalLocations` — while `/:id` and
    // `/:id/locations` both answered 404. Anchored on the alias, as the
    // query-controller table is.
    expect(locationRead()).toContain(experienceOfferedToReaderSql('e'));
    // Inner, and that word is load-bearing: a LEFT JOIN carrying the same
    // predicate parses, runs, and hands back every row — it would only null out
    // columns nothing here selects.
    expect(locationRead()).toMatch(/JOIN experiences e ON e\.id = el\.experience_id/);
    expect(locationRead()).not.toMatch(/LEFT JOIN experiences/);
  });

  it('filters admission only here too, as the read one segment up does', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [visitStatusRow({ location_id: 1, visit_id: null })] });

    await answerRoute(getVisitedStatus,
      { params: { id: '6205' }, user: { id: 5 } } as never, makeRes() as never);

    // Same choice as the read one segment up, for the same reason: the
    // *experience's* `existence` predates the admission axis and closing it is a
    // separate decision. Anchored on the alias, like the assertions above it: a
    // point's own `existence` does appear here, and legitimately — `el.existence <>
    // 'lost'` rides in `offeredLocationSql`, so a component a curator declared gone
    // stays out of a progress denominator even while the source keeps offering it
    // (ADR-0026). Unanchored, this assertion would have read that as the container's
    // axis being closed.
    expect(locationRead()).not.toMatch(/e\.existence <> 'lost'/);
    expect(locationRead()).toMatch(/el\.existence <> 'lost'/);
  });

  it('keeps an unread museum out of a progress denominator, with no curator relaxation', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [visitStatusRow({ location_id: 1, visit_id: null })] });

    await answerRoute(getVisitedStatus,
      { params: { id: '6205' }, user: { id: 5 } } as never, makeRes() as never);

    // This is a reader's own progress read, not one of the three by-id reads
    // ADR-0025 widens — a curator viewing their own visited status gets the
    // same denominator as anyone else, unconditionally, on both the container
    // and the point.
    expect(locationRead()).toContain(experienceOfferedToReaderSql('e'));
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
    expect(locationRead()).not.toMatch(/::boolean OR/);
  });
});

/**
 * `/:id/locations` is one of the three by-id reads ADR-0025 relaxes the
 * pending gate for. `maySeeUnreadExperience` (`experienceScope.ts`) resolves
 * the boolean; these tests pin how `getExperienceLocations` wires it into
 * both queries it runs, not `maySeeUnreadExperience`'s own scope logic
 * (covered where it is used for `getExperience`, in
 * `experienceQueryController.test.ts`).
 */
describe('the by-id relaxation on /:id/locations', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('binds the gate closed for an anonymous caller on both queries, without a scope check', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Museo del Prado' }] })
      .mockResolvedValueOnce({ rows: [] });

    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'), { params: { id: '1' }, query: {} } as never, makeRes() as never);

    // Exactly the existence check and the location list — no third call for a
    // scope check nobody asked for.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [existenceSql, existenceParams] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(existenceSql).toContain(readableByIdSql('$2::boolean'));
    expect(existenceParams).toEqual([1, false]);

    const [listSql, listParams] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(listSql).toMatch(/\$2::boolean OR el\.curation_state <> 'pending'/);
    expect(listParams).toEqual([1, false]);
  });

  it('opens the gate for an admin on both queries, without asking the database about scope', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Museo del Prado' }] })
      .mockResolvedValueOnce({ rows: [] });

    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'),
      { params: { id: '1' }, query: {}, user: { id: 1, role: 'admin' } } as never,
      makeRes() as never,
    );

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [, existenceParams] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(existenceParams).toEqual([1, true]);
    const [, listParams] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(listParams).toEqual([1, true]);
  });

  it('opens the gate for a curator whose scope reaches the experience, on both queries', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ source_id: 1 }] }) // source lookup
      .mockResolvedValueOnce({ rows: [{ unrestricted: true, scoped_region_id: null }] }) // scope check
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Museo del Prado' }] }) // existence
      .mockResolvedValueOnce({ rows: [] }); // list

    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'),
      { params: { id: '1' }, query: {}, user: { id: 9, role: 'curator' } } as never,
      makeRes() as never,
    );

    const [, existenceParams] = mockedQuery.mock.calls[2] as [string, unknown[]];
    expect(existenceParams).toEqual([1, true]);
    const [, listParams] = mockedQuery.mock.calls[3] as [string, unknown[]];
    expect(listParams).toEqual([1, true]);
  });

  it('binds the boolean on the last parameter of the list query even when regionId is present', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Museo del Prado' }] })
      .mockResolvedValueOnce({ rows: [] });

    await answerRoute(routeAt(experienceReadRoutes, '/:id/locations'),
      { params: { id: '1' }, query: { regionId: '7' } } as never,
      makeRes() as never,
    );

    const [listSql, listParams] = mockedQuery.mock.calls[1] as [string, unknown[]];
    // regionId occupies $2 here (the in_region EXISTS subquery), so the gate
    // has to move to $3 rather than colliding with it.
    expect(listSql).toMatch(/\$3::boolean OR el\.curation_state <> 'pending'/);
    expect(listParams).toEqual([1, 7, false]);
  });
});
