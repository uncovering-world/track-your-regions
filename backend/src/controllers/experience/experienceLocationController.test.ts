/**
 * What a reader is shown once a point can be missing without being deleted, and
 * once a category can refuse the experience that holds it.
 *
 * Two rules, on two columns, and they are not the same rule:
 *
 * - `missing_since` on a *location* — a point the source stopped offering leaves
 *   every list, marker batch and count, exactly as it used to when the row was
 *   deleted, but a visit to it survives, because a person who stood there stood
 *   there. That is the same asymmetry `lost` already has one level up.
 * - `admission` on the *experience* — a row this category turned down gives
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
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import {
  getExperienceLocations,
  getRegionExperienceLocations,
  getExperienceVisitedStatus,
  markAllLocationsVisited,
  markLocationVisited,
  getVisitedLocationIds,
  unmarkAllLocationsVisited,
  unmarkLocationVisited,
} from './experienceLocationController.js';
import { offeredToReaderSql } from './experienceLifecycle.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

/** Every statement the handler sent, in order. */
function sentSql(): string[] {
  return mockedQuery.mock.calls.map(call => String(call[0]));
}

/** The one statement that reads the location table. */
function locationRead(): string {
  const reads = sentSql().filter(sql => /FROM experience_locations/i.test(sql));
  expect(reads).toHaveLength(1);
  return reads[0];
}

describe('reads that show a point', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ id: 1, name: 'Site' }], rowCount: 1 });
  });

  it('leaves a withdrawn point out of an experience own list', async () => {
    await getExperienceLocations({ params: { id: '42' }, query: {} } as never, makeRes() as never);

    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });

  it('leaves an unread point out of an experience own list, for an anonymous caller', async () => {
    await getExperienceLocations({ params: { id: '42' }, query: {} } as never, makeRes() as never);

    // ADR-0025: a content row is gated on its own state, so a location can be
    // pending while its experience is not.
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('leaves a withdrawn point out of the markers a region asks for', async () => {
    await getRegionExperienceLocations(
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    // The marker batch feeds the map. A pin at a point the source withdrew is
    // an invitation to go somewhere that is no longer being offered.
    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
  });

  it('leaves an unread point out of the markers a region asks for, with no relaxation', async () => {
    await getRegionExperienceLocations(
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    // The map feed is a set, not a by-id read, so ADR-0025's curator
    // relaxation never reaches it: the fragment appears unconditionally,
    // with no `$N::boolean OR` wrapped around it.
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
    expect(locationRead()).not.toMatch(/::boolean OR el\.curation_state/);
  });

  it('leaves an unread museum off the map too, not just its own unread point', async () => {
    await getRegionExperienceLocations(
      { params: { regionId: '7' }, query: {} } as never, makeRes() as never);

    // The two predicates guard different rows and neither stands in for the
    // other: `publishedContentSql('el')` above is the location's own state,
    // and `curation_state` is the column default (ADR-0025 decision 3) —
    // `auto` — precisely so an unaware writer publishes what it writes
    // (`db/seed/e2eFixture.ts` is one such writer). An `auto` location under
    // a `pending` experience is reachable by every column on the location
    // row itself, so only this container predicate, from `lifecycleFilter`'s
    // `hidePendingSql()`, keeps that pin off the map.
    expect(locationRead()).toMatch(/e\.curation_state <> 'pending'/);
  });

  it('leaves it out whether or not the region asks for its children', async () => {
    await getRegionExperienceLocations(
      { params: { regionId: '7' }, query: { includeChildren: 'false' } } as never,
      makeRes() as never);

    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });
});

describe('a visit outlives the point', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ location_id: 1, visit_id: 3 }], rowCount: 1 });
  });

  it('counts a reader progress over the points still on offer', async () => {
    await getExperienceVisitedStatus(
      { params: { id: '42' }, user: { id: 5 } } as never, makeRes() as never);

    // Returning a withdrawn point because this reader had visited it puts the
    // same place on screen twice whenever the source replaces one — identity is
    // the point together with its reference, so editing either is a withdrawal
    // plus an insert — and makes
    // this endpoint's denominator disagree with `location_count` everywhere
    // else. The visit row itself is never touched; what it means for a place
    // nobody offers any more is a curator's question, not this endpoint's.
    expect(locationRead()).toMatch(/el\.missing_since IS NULL/);
    expect(locationRead()).not.toMatch(/uvl\.id IS NOT NULL/);
  });

  it('marks only the points still on offer when asked to mark them all', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await markAllLocationsVisited(
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    expect(locationRead()).toMatch(/missing_since IS NULL/);
  });

  it('does not manufacture a visit to a point nobody has read yet, "mark all" — #520', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await markAllLocationsVisited(
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    // #520 argued this endpoint needed no gate because a `pending` location
    // "cannot have been visited" — true only if nothing can create that
    // visit. This query is the thing that does, for every location it
    // selects at once, so both the container's state and the location's own
    // have to be checked before any of them is written.
    expect(locationRead()).toMatch(/e\.curation_state <> 'pending'/);
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('does not manufacture a visit to a point nobody has read yet, "mark all" in a region', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    await markAllLocationsVisited(
      { params: { experienceId: '42' }, query: { regionId: '7' }, user: { id: 5 } } as never,
      makeRes() as never);

    // Two branches build this query; one being right proves nothing about
    // the other; see the note on the unregioned branch just above.
    expect(locationRead()).toMatch(/e\.curation_state <> 'pending'/);
    expect(locationRead()).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('still lets a user take back a visit to a point that was withdrawn', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 });

    await unmarkAllLocationsVisited(
      { params: { experienceId: '42' }, query: {}, user: { id: 5 } } as never,
      makeRes() as never);

    // Filtering here would strand the record: the point is invisible, so
    // nothing else could ever clear it.
    const deletes = sentSql().filter(sql => /DELETE FROM user_visited_locations/i.test(sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).not.toMatch(/missing_since/);

    // The count beside it is the half that matters on the region-scoped
    // branch, which clears one region's visits and can leave a withdrawn
    // point's visit standing elsewhere. Unfiltered, unticking the last region
    // a reader can see keeps a `user_visited_experiences` row the progress
    // view contradicts.
    const counts = sentSql().filter(sql => /COUNT\(\*\) as count/i.test(sql));
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatch(/el\.missing_since IS NULL/);
  });

  it('lets the experience-level record reach zero when the last visible tick goes', async () => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ experience_id: 42, count: '0' }], rowCount: 1 });

    await unmarkLocationVisited(
      { params: { locationId: '7' }, user: { id: 5 } } as never, makeRes() as never);

    // A visit surviving on a withdrawn point would otherwise hold the count at
    // one for ever: the list would keep its check, the progress view would
    // report none visited, and there would be no tick on screen to remove.
    // Before locations were kept, the withdrawn row and its visit went together
    // and this count reached zero on its own.
    const counts = sentSql().filter(sql => /COUNT\(\*\) as count/i.test(sql));
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatch(/el\.missing_since IS NULL/);
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

    await markLocationVisited(
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
    expect(sql).toMatch(/e\.curation_state <> 'pending'/);
    expect(sql).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('lists only visited locations a reader may still see', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ location_id: 1, experience_id: 42 }] });

    await getVisitedLocationIds(
      { query: {}, user: { id: 5 } } as never, makeRes() as never);

    // All four, named one at a time rather than as "the lifecycle predicates":
    // this read supplies the ticks a client draws while
    // `getExperienceVisitedStatus` supplies the "n of m" beside them, so a
    // predicate on one and not the other makes the two disagree about one
    // traveller's own record. Three of them were missing when the gate was
    // added, which is how that disagreement arrived (#520).
    const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql, 'a refused experience keeps its ticks').toMatch(/e\.admission <> 'refused'/);
    expect(sql, 'an unread experience keeps its ticks').toMatch(/e\.curation_state <> 'pending'/);
    expect(sql, 'a withdrawn point keeps its tick').toMatch(/el\.missing_since IS NULL/);
    expect(sql, 'an unread point keeps its tick').toMatch(/el\.curation_state <> 'pending'/);
  });

  it('asks for exactly what its sibling asks, so a badge cannot read 3 of 2', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ location_id: 1, experience_id: 42 }] });
    await getVisitedLocationIds(
      { query: {}, user: { id: 5 } } as never, makeRes() as never);
    const [idsSql] = mockedQuery.mock.calls[0] as [string, unknown[]];

    mockedQuery.mockReset();
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await getExperienceVisitedStatus(
      { params: { id: '42' }, user: { id: 5 } } as never, makeRes() as never);
    const statusSql = (mockedQuery.mock.calls.at(-1) as [string, unknown[]])[0];

    // The comparison is the assertion: whichever four fragments the denominator
    // uses, the numerator uses too. A predicate added to one and forgotten on
    // the other fails here rather than in someone's progress bar.
    for (const fragment of [
      "e.admission <> 'refused'",
      "e.curation_state <> 'pending'",
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
      return markLocationVisited(
        { params: { locationId: '1' }, body: {}, user: { id: 5 } } as never, makeRes() as never);
    }],
    ['markAllLocationsVisited, whole object', () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] });
      return markAllLocationsVisited(
        { params: { id: '42' }, query: {}, body: {}, user: { id: 5 } } as never, makeRes() as never);
    }],
    ['markAllLocationsVisited, one region', () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] });
      return markAllLocationsVisited(
        { params: { id: '42' }, query: { regionId: '7' }, body: {}, user: { id: 5 } } as never,
        makeRes() as never);
    }],
  ];

  for (const [name, run] of cases) {
    it(`${name} asks exactly what showable means`, async () => {
      await run();
      const [sql] = mockedQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain(offeredToReaderSql());
    });
  }
});

describe('the by-id reads and a refused row', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('stops before reading locations when the check rejects the row', async () => {
    // The existence check finds nothing, because its predicate excludes the row.
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await getExperienceLocations(
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

    await getExperienceLocations(
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

    await getExperienceLocations(
      { params: { id: '1' }, query: {} } as never,
      makeRes() as never,
    );

    // Pinned so this read stays in step with `getExperience`, not because
    // leaving `lost` reachable here is settled — the handler's own comment flags
    // closing it as a separate decision about a different question.
    const existenceRead = sentSql().find(sql => /FROM experiences\b/i.test(sql));
    expect(existenceRead).not.toMatch(/existence <> 'lost'/);
  });

  it('answers 404 when the admission-filtered read returns nothing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await getExperienceVisitedStatus(
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
    mockedQuery.mockResolvedValueOnce({ rows: [{ location_id: 1, visit_id: null }] });

    await getExperienceVisitedStatus(
      { params: { id: '6205' }, user: { id: 5 } } as never, makeRes() as never);

    // This read never joined `experiences` at all, so no admission predicate
    // could reach it: any authenticated account got a refused row's points back
    // — coordinates, ordinals, a `totalLocations` — while `/:id` and
    // `/:id/locations` both answered 404. Anchored on the alias, as the
    // query-controller table is.
    expect(locationRead()).toMatch(/e\.admission <> 'refused'/);
    // Inner, and that word is load-bearing: a LEFT JOIN carrying the same
    // predicate parses, runs, and hands back every row — it would only null out
    // columns nothing here selects.
    expect(locationRead()).toMatch(/JOIN experiences e ON e\.id = el\.experience_id/);
    expect(locationRead()).not.toMatch(/LEFT JOIN experiences/);
  });

  it('filters admission only here too, as the read one segment up does', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ location_id: 1, visit_id: null }] });

    await getExperienceVisitedStatus(
      { params: { id: '6205' }, user: { id: 5 } } as never, makeRes() as never);

    // Same choice as the read one segment up, for the same reason: `existence`
    // predates the admission axis and closing it is a separate decision.
    expect(locationRead()).not.toMatch(/existence <> 'lost'/);
  });

  it('keeps an unread museum out of a progress denominator, with no curator relaxation', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ location_id: 1, visit_id: null }] });

    await getExperienceVisitedStatus(
      { params: { id: '6205' }, user: { id: 5 } } as never, makeRes() as never);

    // This is a reader's own progress read, not one of the three by-id reads
    // ADR-0025 widens — a curator viewing their own visited status gets the
    // same denominator as anyone else, unconditionally, on both the container
    // and the point.
    expect(locationRead()).toMatch(/e\.curation_state <> 'pending'/);
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

    await getExperienceLocations({ params: { id: '1' }, query: {} } as never, makeRes() as never);

    // Exactly the existence check and the location list — no third call for a
    // scope check nobody asked for.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [existenceSql, existenceParams] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(existenceSql).toMatch(/\$2::boolean OR e\.curation_state <> 'pending'/);
    expect(existenceParams).toEqual([1, false]);

    const [listSql, listParams] = mockedQuery.mock.calls[1] as [string, unknown[]];
    expect(listSql).toMatch(/\$2::boolean OR el\.curation_state <> 'pending'/);
    expect(listParams).toEqual([1, false]);
  });

  it('opens the gate for an admin on both queries, without asking the database about scope', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Museo del Prado' }] })
      .mockResolvedValueOnce({ rows: [] });

    await getExperienceLocations(
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
      .mockResolvedValueOnce({ rows: [{ category_id: 1 }] }) // category lookup
      .mockResolvedValueOnce({ rows: [{ unrestricted: true, scoped_region_id: null }] }) // scope check
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Museo del Prado' }] }) // existence
      .mockResolvedValueOnce({ rows: [] }); // list

    await getExperienceLocations(
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

    await getExperienceLocations(
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
