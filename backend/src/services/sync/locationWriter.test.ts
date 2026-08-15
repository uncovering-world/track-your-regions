/**
 * The rule this writer has to keep is "a point that has not moved keeps its
 * row", because `experience_location_regions.location_id` cascades on delete
 * and a lost row is a lost region assignment.
 *
 * What the behaviour actually does was verified against a live PostGIS
 * database — mocked queries cannot tell a correct spatial predicate from a
 * wrong one. These tests hold the line against the regression that shape *can*
 * see: the unconditional delete coming back, and the unchanged case costing
 * writes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { writeExperienceLocations, dedupeByIdentity } from './locationWriter.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

const A = { name: 'A', externalRef: 'r1', lon: 10, lat: 20 };
const B = { name: 'B', externalRef: 'r2', lon: 11, lat: 21 };

/**
 * A client whose every statement is recorded, so the write path can be read
 * back. `answers` lets one statement return rows: the arms are told apart by
 * what they say, which is also how a reader tells them apart.
 */
function fakeClient(answers: Array<[RegExp, { rows?: unknown[]; rowCount?: number }]> = []) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
      const hit = answers.find(([pattern]) => pattern.test(sql));
      return { rows: hit?.[1].rows ?? [], rowCount: hit?.[1].rowCount ?? 0 };
    }),
    release: vi.fn(),
  };
  return { client, statements };
}

/** The arm that gives a point back its place in the source's list. */
const RESURRECT = /missing_since = NULL/;
/** The arm that renumbers a point the source has offered all along. */
const KEEP = /SET ordinal = i\.ordinal/;
/** The arm that records that the source stopped offering a point. */
const MARK = /missing_since = NOW\(\)/;
/** The arm that writes a point the experience did not have. */
const INSERT = /INSERT INTO experience_locations/;
/** The statement that retires the venue's pass because it gained a point. */
const DECAY = /UPDATE experiences e SET curation_state = 'auto'/;
/** The statement that names, on each arrival, the point it replaces. */
const PAIR = /SET withdrawal_deferred_for_location_id = m\.old_id/;
/** The arm that takes a held point out of the list without withdrawing it. */
const HOLD = /el\.ordinal IS NOT NULL/;
/** The statement that lets go of a pairing the source has made pointless. */
const UNPAIR = /n\.withdrawal_deferred_for_location_id = old\.id/;

/** The one statement matching `pattern`, or a failure naming what went wrong. */
function only(statements: string[], pattern: RegExp): string {
  const found = statements.filter(s => pattern.test(s));
  if (found.length === 0) throw new Error(`no statement matched ${String(pattern)}`);
  if (found.length > 1) throw new Error(`${found.length} statements matched ${String(pattern)}`);
  return found[0];
}

describe('writeExperienceLocations', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('writes nothing when the stored rows already say exactly this', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '2', ids: [7, 8] }] });

    const result = await writeExperienceLocations(1, [A, B]);

    // No transaction at all: the common case must not cost writes, or the
    // churn this exists to remove returns in another form.
    expect(mockedConnect).not.toHaveBeenCalled();
    expect(result).toEqual({
      unchanged: [7, 8],
      needsAssignment: [],
      unoffered: 0,
      delta: { added: [], withdrawn: [], returned: [] },
    });
  });

  it('deletes no location at all, whether or not the source still offers it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A, B]);

    // `user_visited_locations.location_id` and
    // `experience_location_regions.location_id` both cascade, so any delete
    // here destroys a user's record of having been somewhere. There is no
    // longer a delete of any shape to get wrong.
    expect(statements.filter(s => /DELETE FROM experience_locations/i.test(s))).toEqual([]);
  });

  it('marks the point the source stopped offering, and only that point', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '1', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    const mark = statements.filter(s => MARK.test(s));
    expect(mark).toHaveLength(1);
    // Keyed the same way the old delete was: everything the source did not
    // offer this time, and nothing it did.
    expect(mark[0]).toMatch(/NOT EXISTS/);
    expect(mark[0]).toMatch(/external_ref IS NOT DISTINCT FROM i\.external_ref/);
    // A row with no position in the source's list has no ordinal either.
    expect(mark[0]).toMatch(/ordinal = NULL/);
  });

  it('does not restamp a point that was already missing', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // `missing_since` answers "when did this first go missing". A run that
    // finds it missing again is not a new observation, and rewriting the row
    // every run would churn the table for nothing.
    expect(statements.find(s => MARK.test(s))).toMatch(/el\.missing_since IS NULL/);
  });

  it('gives a point that came back its place, and sends it for reassignment', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient([[RESURRECT, { rows: [{ id: 7 }] }]]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // Same row, same id, so the visit record and any manual region assignment
    // on it are still the right ones. Its *auto* assignments are not: they were
    // dropped while it was missing, so placement has to run for it.
    expect(statements.filter(s => RESURRECT.test(s))).toHaveLength(1);
    expect(result.needsAssignment).toContain(7);
    expect(result.unchanged).not.toContain(7);
  });

  it('separates the point that came back from the point that never left', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A, B]);

    // Two arms over disjoint sets. Merged into one, a returning point would be
    // reported as unchanged and never placed.
    expect(statements.find(s => RESURRECT.test(s))).toMatch(/el\.missing_since IS NOT NULL/);
    const keep = statements.find(s => KEEP.test(s) && !RESURRECT.test(s));
    expect(keep).toMatch(/el\.missing_since IS NULL/);
  });

  it('renumbers the survivors before it resurrects, or the sets overlap', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A, B]);

    // Predicates alone do not make the two arms disjoint: resurrecting first
    // clears `missing_since`, and the survivors' arm would then match the row
    // it had just brought back — reporting it as unchanged as well as needing
    // assignment. The order is the guarantee, so it is asserted rather than
    // left to whoever edits this next.
    const keep = statements.findIndex(s => KEEP.test(s) && !RESURRECT.test(s));
    const resurrect = statements.findIndex(s => RESURRECT.test(s));
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(keep).toBeLessThan(resurrect);
  });

  it('asks the fast path about offered points only', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '1', ids: [7] }] });

    await writeExperienceLocations(1, [A]);

    // Counting marked rows as stored would fail the comparison on every later
    // run for any experience that ever lost a point — the slow path forever,
    // for an object nothing is changing.
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql.match(/missing_since IS NULL/g) ?? []).toHaveLength(3);
  });

  it('renumbers out of the way before renumbering into place', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [B, A]);

    // `ordinal` is unique per experience, so assigning final ordinals directly
    // collides with a row that has not been renumbered yet.
    const park = statements.findIndex(s => /SET ordinal = -ordinal/.test(s));
    const final = statements.findIndex(s => /SET ordinal = i\.ordinal/.test(s));
    expect(park).toBeGreaterThanOrEqual(0);
    expect(park).toBeLessThan(final);
  });

  it('rolls back and releases the client when a statement fails', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient();
    client.query.mockImplementation(async (sql: string) => {
      if (MARK.test(sql)) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    mockedConnect.mockResolvedValue(client);

    await expect(writeExperienceLocations(1, [A])).rejects.toThrow('boom');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('binds the experience once and four parameters per location', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(42, [A, B]);

    // Parameter numbering is where this file's neighbours have been bitten
    // twice: an unreferenced placeholder has no inferable type and Postgres
    // refuses the whole statement.
    expect(mockedQuery.mock.calls[0][1]).toEqual([42, 'r1', 'A', 10, 20, 'r2', 'B', 11, 21]);
  });

  it('asks a well-typed question even with no locations at all', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });

    const result = await writeExperienceLocations(1, []);

    // An untyped NULL column would leave the join's types uninferable; the
    // empty relation still has to declare them.
    expect(String(mockedQuery.mock.calls[0][0])).toMatch(/NULL::int, NULL::text/);
    expect(result.unchanged).toEqual([]);
  });
});

describe('dedupeByIdentity', () => {
  it('keeps components that share a coordinate but not a reference', () => {
    // UNESCO's own data gives one coordinate to several distinct components:
    // site 874 has seventeen separately named and referenced rock shelters at
    // one point, with ten identical decimals — not a rounding artefact.
    // Collapsing those by point would discard 336 named components.
    const shelters = [
      { name: 'Abric I', externalRef: '874-185', lon: -0.11731, lat: 38.7835 },
      { name: 'Abric II', externalRef: '874-186', lon: -0.11731, lat: 38.7835 },
    ];

    expect(dedupeByIdentity(shelters)).toHaveLength(2);
  });

  it('keeps a reference that appears at more than one point', () => {
    // The mirror case: a component crossing a border is listed once per
    // country under one reference, with a distinct point each time.
    const transboundary = [
      { name: null, externalRef: '749ter-001', lon: 2.0, lat: 12.0 },
      { name: null, externalRef: '749ter-001', lon: 2.5, lat: 12.5 },
    ];

    expect(dedupeByIdentity(transboundary)).toHaveLength(2);
  });

  it('collapses entries that agree on both, which carry nothing to tell apart', () => {
    // Left in, these make the update's join many-to-many: both stored rows can
    // take the same incoming ordinal, and the write dies on the
    // (experience_id, ordinal) unique key — rolling that experience back on
    // every later sync.
    const repeated = [
      { name: 'A', externalRef: 'r1', lon: 5, lat: 5 },
      { name: 'B', externalRef: 'r1', lon: 5, lat: 5 },
    ];

    expect(dedupeByIdentity(repeated)).toHaveLength(1);
    expect(dedupeByIdentity(repeated)[0].name).toBe('A');
  });

  it('does not treat a null reference as an empty one', () => {
    // `IS NOT DISTINCT FROM` calls these two different references, so a key
    // that flattened them would drop one of a pair the SQL keeps apart — and
    // the mark would then take the survivor's row, hiding a point the source
    // still offers.
    const nullAndEmpty = [
      { name: 'A', externalRef: null, lon: 5, lat: 5 },
      { name: 'B', externalRef: '', lon: 5, lat: 5 },
    ];

    expect(dedupeByIdentity(nullAndEmpty)).toHaveLength(2);
  });

  it('does not treat a null reference as matching a present one', () => {
    const mixed = [
      { name: 'A', externalRef: null, lon: 5, lat: 5 },
      { name: 'B', externalRef: 'r1', lon: 5, lat: 5 },
    ];

    expect(dedupeByIdentity(mixed)).toHaveLength(2);
  });
});

describe('the match predicate', () => {
  it('matches on the reference as well as the point, everywhere it matches at all', () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    return writeExperienceLocations(1, [A, B]).then(() => {
      // Point alone would make the mark hide a component that shares a
      // coordinate with a survivor, and the update match two stored rows to
      // one incoming entry. Every query has to carry the reference.
      const spatial = statements.filter(s => /ST_MakePoint/.test(s));
      expect(spatial.length).toBeGreaterThan(0);
      for (const sql of spatial) {
        expect(sql).toMatch(/external_ref IS NOT DISTINCT FROM i\.external_ref/);
      }
    });
  });
});

describe('a new point arrives stamped', () => {
  // What a mocked client can see is the statement: that the insert decides the
  // state from the gate and names both outcomes, and that no statement about a
  // point which already existed touches the column. That the decision comes out
  // `pending` under a gated source and `auto` under a trusted one was proved by
  // executing this statement against a real database, both ways.
  it('decides a new point state from the gate, and leaves an existing point alone', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    const insert = statements.find(s => /INSERT INTO experience_locations/.test(s));
    expect(insert).toBeDefined();
    expect(insert).toMatch(/curation_state/);
    // The gate is reached through the experience, because this writer has an
    // experienceId and no categoryId — one subselect rather than a parameter
    // threaded through three services.
    expect(insert).toMatch(/FROM experiences[\s\S]*JOIN experience_categories/);
    // Both branches named, so an edit that stamped every row 'auto' (or every
    // row 'pending') fails this test instead of passing on column presence alone.
    expect(insert).toMatch(/THEN 'pending' ELSE 'auto' END/);

    // A returning point, a point renumbered in place, a point just marked
    // missing and a point held for its replacement all already had rows before
    // this run started — a curator may already have passed one of them, so none
    // of these four may touch the column at all.
    const returned = statements.find(s => RESURRECT.test(s));
    const kept = statements.find(s => KEEP.test(s) && !RESURRECT.test(s));
    const marked = statements.find(s => MARK.test(s));
    const held = statements.find(s => HOLD.test(s));
    expect(returned).toBeDefined();
    expect(kept).toBeDefined();
    expect(marked).toBeDefined();
    expect(held).toBeDefined();
    expect(returned).not.toMatch(/curation_state/);
    expect(kept).not.toMatch(/curation_state/);
    expect(marked).not.toMatch(/curation_state/);
    expect(held).not.toMatch(/curation_state/);
  });

  it('retires the venue pass when it actually gained a point', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient([[INSERT, { rows: [{ id: 12 }] }]]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A curator's pass covered the venue with the points it had. In the same
    // transaction as the insert, because the two are one fact about the object.
    const decay = statements.find(s => DECAY.test(s));
    expect(decay).toBeDefined();
    expect(decay).toMatch(/e\.curation_state = 'verified'/);
    expect(statements.indexOf(decay!)).toBeLessThan(statements.indexOf('COMMIT'));
  });

  it('leaves the venue pass alone when no point was added', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A point that came back, or one renumbered in place, is not new: the
    // curator saw it, and the row, its id and its assignments are the same ones.
    expect(statements.find(s => DECAY.test(s))).toBeUndefined();
  });
});

/**
 * A moved point is a withdrawal plus an insert, and under a gated source the
 * two halves become visible at different times: the insert lands `pending`, so
 * applying the withdrawal at once leaves the reader watching the old pin vanish
 * while the new one is invisible. Measured on 2026-08-11, that is not a corner
 * case — 1119 of the catalogue's 1604 experiences hold exactly one point, so for
 * seventy per cent of them a move applied at once is an object still in the list
 * with no pin at all.
 *
 * What a mocked client can see is the statement, and each assertion here names
 * the one it is about. That the pairing comes out right against real geometry is
 * proved by executing these statements on a live PostGIS database.
 */
describe('a withdrawal the run replaced waits for the point that replaces it', () => {
  /** A gated arrival — what the insert returns when the source requires curation. */
  const ARRIVED = [[INSERT, { rows: [{ id: 12, curation_state: 'pending' }] }]] as
    Array<[RegExp, { rows?: unknown[]; rowCount?: number }]>;

  it('names, on the arrival, the point it replaces', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    // Same reference, a different point: the definition of a move, and the only
    // one the data supports. 6679 of 6680 locations carry a reference, and for
    // museums and landmarks it is the experience's own Wikidata id — so it
    // cannot change while the experience stays the same.
    await writeExperienceLocations(1, [{ name: 'A', externalRef: 'r1', lon: 10.5, lat: 20 }]);

    const pair = only(statements, PAIR);
    expect(pair).toMatch(/a\.external_ref IS NOT DISTINCT FROM w\.external_ref/);
    // `IS NOT DISTINCT FROM` rather than `=`, and that is load-bearing rather
    // than habit: the one location in the catalogue with no reference at all
    // (8754, "Routes of Santiago de Compostela in France") is that experience's
    // only point, so an `=` here would apply its withdrawal at once and leave a
    // World Heritage site in the list with nothing on the map.
    expect(pair).not.toMatch(/a\.external_ref = w\.external_ref/);
  });

  it('pairs one arrival to one withdrawal even where the reference is repeated', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Nine `(experience_id, external_ref)` pairs are duplicated across nine
    // objects — a UNESCO component crossing a border is listed once per country
    // under one reference. Without the row numbers both withdrawn rows would
    // pair to both arrivals, and each arrival can name only one point.
    const pair = only(statements, PAIR);
    expect(pair).toMatch(/row_number\(\) OVER \(PARTITION BY external_ref ORDER BY id\)/);
    expect(pair).toMatch(/ON a\.external_ref IS NOT DISTINCT FROM w\.external_ref AND a\.rn = w\.rn/);
  });

  it('holds what the references cannot pair, against whatever arrival is left', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Where "hold rather than apply" is actually decided. A source that renumbers
    // a component writes a withdrawal and an insert whose references do not line
    // up at all, and 787 of the 788 single-point UNESCO sites carry a component
    // reference — so the by-reference pass alone takes such a site's only pin off
    // the map under a gate, without the point even having to move.
    //
    // Both halves asserted: the leftovers are taken from what the first pass did
    // not claim — or one arrival would name two points and only the last write
    // would survive — and they are matched by position with no reference
    // condition at all.
    const pair = only(statements, PAIR);
    expect(pair).toMatch(/left_over AS \(/);
    expect(pair).toMatch(/WHERE id NOT IN \(SELECT old_id FROM by_reference\)/);
    expect(pair).toMatch(/WHERE id NOT IN \(SELECT new_id FROM by_reference\)/);
    expect(pair).toMatch(/row_number\(\) OVER \(ORDER BY id\) AS rn FROM withdrawn/);
    // One row per arrival, from the two passes together, each an inner join — so
    // exactly min(withdrawals, arrivals) withdrawals are held, and the points a
    // reader sees after a run are min(what they saw before, what the source now
    // offers): never zero while the source still offers a point. Not "never below
    // the source's list" — an arrival is gated, so a run that adds more than it
    // drops leaves the visible count below the new list on purpose.
    expect(pair).toMatch(/FROM by_reference\s*UNION ALL\s*SELECT old_id, new_id FROM left_over/);
  });

  it('holds only a point a reader can actually see', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The candidates to *be* the held point, and the reason the set is narrower
    // than "everything the source stopped offering". An unread point costs a
    // reader nothing when it goes, and letting one compete builds a chain no path
    // can take apart:
    //
    //   a gated site shows P(r1); a run renumbers and moves it, so A1(r2) holds P;
    //   before anyone publishes, the next run moves it again — A2(r2) matches A1 by
    //   reference, and P is left over with no arrival, surviving only because A1
    //   still names it. Publishing A2 withdraws A1, and A1 can then never be
    //   published, never be revisited by the statements that only touch offered
    //   rows, and never be deleted. P stays visible beside A2 for ever: two pins on
    //   a one-point site, undoable only by hand-written SQL.
    //
    // Asserted on the CTE that chooses the old point, not on the statement as a
    // whole — the arrival's own filter sits three lines away and would satisfy a
    // looser match.
    const withdrawn = /withdrawn AS \([\s\S]*?\n {14}\)/.exec(only(statements, PAIR));
    expect(withdrawn, 'the pairing statement has no withdrawn CTE').not.toBeNull();
    expect(withdrawn![0]).toMatch(/el\.curation_state <> 'pending'/);
  });

  it('holds only a point whose replacement a reader cannot see yet', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The whole reason to wait. An arrival a reader can already see replaces the
    // old pin the moment it lands, so holding the withdrawal would leave the
    // same place on the map twice.
    expect(only(statements, PAIR)).toMatch(/el\.curation_state = 'pending'/);
  });

  it('asks nothing about pairing when the run added nothing invisible', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(
      [[INSERT, { rows: [{ id: 12, curation_state: 'auto' }] }]]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // `requires_curation` is false on all three sources today, so an ungated run
    // has to behave exactly as it did before this existed — not merely reach the
    // same rows, but ask the same questions. The state comes back from the
    // insert's own RETURNING, so this cannot disagree with what was written.
    expect(statements.filter(s => PAIR.test(s))).toEqual([]);
    expect(only(statements, MARK)).toBeDefined();
  });

  it('withdraws a point nothing replaced, at once', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '1', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // A source that simply dropped a point offered no replacement, so there is
    // nothing to wait for and nothing to ask.
    expect(statements.filter(s => PAIR.test(s))).toEqual([]);
    expect(only(statements, MARK)).toMatch(/missing_since = NOW\(\)/);
    expect(result.unoffered).toBe(0);
  });

  it('passes over the withdrawal of a point something is waiting on', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The half that makes the pairing mean anything. Without it the row would be
    // paired and withdrawn in the same transaction.
    expect(only(statements, MARK))
      .toMatch(/NOT EXISTS \(\s*SELECT 1 FROM experience_locations waiting\s*WHERE waiting\.experience_id = \$1\s*AND waiting\.withdrawal_deferred_for_location_id = el\.id/);
  });

  it('lets go of a pairing whose point the source is offering again', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Reachable where one reference covers two points — a component listed once
    // per country — and the source lists the replaced point beside its
    // replacement. Nothing is being withdrawn any more, so a pairing standing
    // from an earlier run would hide a point the source offers, the moment the
    // arrival is published. Asked on every changed object, because the case is
    // exactly the one where no withdrawal is left to notice it.
    const unpair = only(statements, UNPAIR);
    expect(unpair).toMatch(/SET withdrawal_deferred_for_location_id = NULL/);
    expect(unpair).toMatch(/EXISTS \(\s*SELECT 1 FROM incoming i/);
    expect(unpair).not.toMatch(/NOT EXISTS/);
    // Both sides of the join scoped, like the release in `publishController`. The
    // foreign key does not say a pairing stays inside one object; the writer does,
    // and every statement that walks the pairing says so itself rather than
    // trusting the others.
    expect(unpair).toMatch(/n\.experience_id = \$1/);
    expect(unpair).toMatch(/old\.experience_id = \$1/);
  });

  it('lets go of a pairing whose replacement the source withdrew in turn', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // An arrival the source dropped before anyone published it can never be
    // published — the publish statement carries `missing_since IS NULL` — so a
    // pairing left standing on it would hold the old point visible for ever,
    // with nothing able to release it.
    expect(only(statements, MARK)).toMatch(/withdrawal_deferred_for_location_id = NULL/);
  });

  it('takes the held point out of the list without taking it off the map', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Not cosmetic, and not optional. `ordinal` is unique per experience and the
    // next run parks every positive ordinal at its negative before renumbering:
    // a held row left at -3 collides with the arrival's 3 the moment anything
    // else about the object changes, and the whole write for that experience
    // dies on the unique key. NULL is also what the column already means for a
    // row the source no longer lists.
    const hold = only(statements, HOLD);
    expect(hold).toMatch(/SET ordinal = NULL/);
    expect(hold).not.toMatch(/missing_since = NOW/);
    expect(hold).toMatch(/EXISTS \(\s*SELECT 1 FROM experience_locations waiting\s*WHERE waiting\.experience_id = \$1/);
    // And it says nothing about a point the source still offers.
    expect(hold).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM incoming i/);
  });

  it('does not rewrite a point it was already holding', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A held row keeps failing the fast path until a curator answers, so every
    // run reaches this statement. Without the guard each one would rewrite the
    // row to the value it already holds.
    expect(only(statements, HOLD)).toMatch(/el\.ordinal IS NOT NULL/);
  });

  it('pairs after the row exists to be named, and before the withdrawal reads it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient(ARRIVED);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The order is the whole mechanism, not an implementation detail: the column
    // is on the arrival, so it cannot be written before the insert, and the
    // withdrawal decides what to pass over by reading it. Both are asserted
    // because predicates alone cannot make this right.
    const insert = statements.findIndex(s => INSERT.test(s));
    const pair = statements.findIndex(s => PAIR.test(s));
    const mark = statements.findIndex(s => MARK.test(s));
    const hold = statements.findIndex(s => HOLD.test(s));
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(insert).toBeLessThan(pair);
    expect(pair).toBeLessThan(mark);
    expect(pair).toBeLessThan(hold);
    expect(statements.indexOf('COMMIT')).toBeGreaterThan(hold);
  });

  it('reports a held point as neither unoffered nor needing assignment', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'pending' }] }],
      [HOLD, { rowCount: 1 }],
      [MARK, { rowCount: 0 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // `unoffered` answers "how many stored points this run was the first to find
    // missing", and a held point is one the run wrote nothing about — the
    // callers turn that number into "place this experience again", which is the
    // arrival's job here and not the held row's.
    expect(result.unoffered).toBe(0);
    expect(result.needsAssignment).toEqual([12]);
  });
});

/**
 * What the run did to the object's set of points, named rather than counted, so
 * the changeset can record it and a curator can be shown it (ADR-0026).
 *
 * Names and references, never ids: the record has to stay legible after the row
 * it names has been renamed, which is the same reason the changeset keeps
 * `name_snapshot` per object.
 */
describe('writeExperienceLocations — the delta it reports', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedConnect.mockReset();
  });

  it('reports nothing when the stored rows already say exactly this', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '2', ids: [7, 8] }] });

    const result = await writeExperienceLocations(1, [A, B]);

    expect(result.delta).toEqual({ added: [], withdrawn: [], returned: [] });
  });

  it('names both the point it added and the point it withdrew', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '1', ids: [7, 8] }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'auto', name: 'B', external_ref: 'r2' }] }],
      [MARK, { rows: [{ id: 7, name: 'A', external_ref: 'r1' }], rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [B]);

    expect(result.delta.added).toEqual([{ name: 'B', ref: 'r2' }]);
    expect(result.delta.withdrawn).toEqual([{ name: 'A', ref: 'r1' }]);
  });

  it('reports a point the source offers again as returned, not as added', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client } = fakeClient([
      [RESURRECT, { rows: [{ id: 7, name: 'A', external_ref: 'r1' }] }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A]);

    // The same row, the same id, the same visit record on it. Reported as an
    // arrival it would read as a component the object never had.
    expect(result.delta.returned).toEqual([{ name: 'A', ref: 'r1' }]);
    expect(result.delta.added).toEqual([]);
  });

  it('reads a moved point as one withdrawal and one arrival', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const moved = { name: 'A', externalRef: 'r1', lon: 10.5, lat: 20.5 };
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'auto', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rows: [{ id: 7, name: 'A', external_ref: 'r1' }], rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [moved]);

    // Identity is the point together with the source's reference (ADR-0022), so
    // a corrected coordinate is not one row changing — it is a row leaving and
    // another arriving, and the delta says exactly that rather than inventing a
    // "moved" the writer never performed.
    expect(result.delta.added).toEqual([{ name: 'A', ref: 'r1' }]);
    expect(result.delta.withdrawn).toEqual([{ name: 'A', ref: 'r1' }]);
  });

  it('does not report a held withdrawal, because the run did not perform one', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'pending', name: 'B', external_ref: 'r2' }] }],
      [HOLD, { rowCount: 1 }],
      [MARK, { rows: [], rowCount: 0 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [B]);

    // The held point is still on the map and still `missing_since IS NULL`: the
    // run wrote nothing about its departure, and a delta claiming otherwise
    // would tell a curator a point had gone while a reader can still see it.
    expect(result.delta.withdrawn).toEqual([]);
    expect(result.delta.added).toEqual([{ name: 'B', ref: 'r2' }]);
  });

  it('carries a nameless point by its reference alone', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client } = fakeClient([
      [INSERT, { rows: [{ id: 12, curation_state: 'auto', name: null, external_ref: 'r9' }] }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [
      { name: null, externalRef: 'r9', lon: 1, lat: 2 },
    ]);

    // Both halves are nullable in the table, and most UNESCO components carry a
    // reference and no name of their own. Dropping such an entry would make the
    // delta silently disagree with what the writer did.
    expect(result.delta.added).toEqual([{ name: null, ref: 'r9' }]);
  });
});
