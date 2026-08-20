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
import { LOCATION_UNCHANGED_METERS } from './changeSet.js';

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
    // Keyed the same way the old delete was: everything the source did not offer this
    // time, and nothing it did. Through the pairing rather than through the predicate —
    // that is where the reference now lives, and asking nearness here would exclude a row
    // that lost the pairing from every arm at once (ADR-0027 decision 5).
    expect(mark[0]).toMatch(/NOT EXISTS/);
    expect(mark[0]).toMatch(/FROM paired_rows p WHERE p\.location_id = el\.id/);
    // A row with no position in the source's list has no ordinal either.
    expect(mark[0]).toMatch(/ordinal = NULL/);
  });

  it('takes back a delisting on a point the source never stopped offering', async () => {
    // Reachable through the verdict endpoint: `former` on an offered point leaves the
    // flag NULL, so the `returned` arm — which matches flagged rows only — never sees
    // it. Ungated, the row would keep `former` for ever, and the withdrawal card reads
    // the axes as "nobody has answered", so its next departure would raise nothing.
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    expect(statements.find(s => KEEP.test(s))).toMatch(/source_membership = 'present'/);
  });

  it('does not let the fast path skip a delisting the source has contradicted', async () => {
    // The fast path means "nothing to do", and a row the source lists while recorded as
    // delisted is something to do — so it must not count as matched.
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '1', ids: [7] }] });

    await writeExperienceLocations(1, [A]);

    const [sql] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/AS matched/);
    expect(String(sql)).toMatch(/el\.source_membership = 'present'\) AS matched/);
  });

  it('lets the fast path forgive a claimed name the source never offers', async () => {
    // `upsertSingleLocation` synthesises a null name for every museum's and every
    // landmark's one point, so without this term a curator who names such a point
    // buys the slow path for ever — and buys nothing with it, since `noNameOffered`
    // suppresses the only change that run could have reported.
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '1', ids: [7] }] });

    await writeExperienceLocations(1, [A]);

    const [sql] = mockedQuery.mock.calls[0];
    // The same question `noNameOffered` asks, `COALESCE` included: that guard folds
    // the empty string the UNESCO parser makes of a malformed `name:`, and a term
    // written `IS NULL` would leave exactly that row paying for a silent report.
    expect(String(sql)).toMatch(/el\.curated_fields \? 'name' AND COALESCE\(i\.name, ''\) = ''/);
    // Only where the source offers nothing: a name it does offer is a conflict the
    // keeping arm has to compute, which is what ADR-0029 decision 5 keeps it for.
    expect(String(sql)).toMatch(/el\.name IS NOT DISTINCT FROM i\.name/);
  });

  it('takes back a curator’s delisting when the source offers a withdrawn point again', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '0', matched: '0', ids: null }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The one direction, as the experience upsert does it (ADR-0021): a listing is
    // evidence about the source's list, and `former` was a claim about that list.
    // Without this the point comes back visible while recorded as delisted — and can
    // never be asked about again, because the withdrawal card reads the axes as
    // "nobody has answered", so its next departure would raise no card at all.
    expect(statements.find(s => RESURRECT.test(s))).toMatch(/source_membership = 'present'/);
    // `existence` is not touched: a source that keeps listing a demolished building
    // does not un-demolish it, and that verdict has to outlive the listing.
    expect(statements.find(s => RESURRECT.test(s))).not.toMatch(/existence =/);
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
    //
    // Asserted as a property of every subquery rather than as a tally of the term: the
    // count went stale the moment a subquery was added, and a count above a list always
    // will. What the fast path promises is that *no* part of it reads a marked row.
    const sql = String(mockedQuery.mock.calls[0][0]);
    const subqueries = sql.split('(SELECT').filter(part => part.includes('experience_locations'));
    expect(subqueries.length).toBeGreaterThan(1);
    for (const part of subqueries) expect(part).toContain('missing_since IS NULL');
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

  it('measures across the antimeridian, where a raw subtraction reads 40 000 km', () => {
    // A metre apart on the ground, 359.99999° apart in arithmetic. Unnormalised, both
    // entries survive here, both answer `ST_DWithin` against one stored row, and the
    // object gains a second row for one place under one reference — the very thing this
    // function exists to stop. The haversine this measure replaced was safe for free
    // (`sin(dLon/2)` reads 360° − ε as ε); an equirectangular one has to be told
    // (CLAUDE.md § Antimeridian Handling).
    const acrossTheLine = [
      { name: 'east side', externalRef: 'r1', lon: 179.999995, lat: 0 },
      { name: 'west side', externalRef: 'r1', lon: -179.999995, lat: 0 },
    ];

    expect(dedupeByIdentity(acrossTheLine)).toHaveLength(1);
    // And a real separation across the line is still two places: 1° at the equator is
    // 111 km, so the tolerance must not swallow it just because the numbers straddle 180.
    expect(dedupeByIdentity([
      { name: 'east side', externalRef: 'r1', lon: 179.5, lat: 0 },
      { name: 'west side', externalRef: 'r1', lon: -179.5, lat: 0 },
    ])).toHaveLength(2);
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
      // Point alone would make the mark hide a component that shares a coordinate with a
      // survivor, and the update match two stored rows to one incoming entry. Every query
      // that decides identity *from* geometry has to carry the reference beside it.
      //
      // Keyed on the tolerance rather than on `ST_MakePoint`, which since ADR-0027 no
      // longer separates the two: the keeping and resurrection arms build a point in order
      // to *write* it, having already been told which row by the pairing, and a statement
      // that writes a coordinate is not a statement that matches on one.
      const spatial = statements.filter(s => /ST_DWithin/.test(s));
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
    // Keyed on the decided pairing rather than on nearness to the incoming list. Under a
    // tolerance the held row *is* near the arrival that replaces it — 1.2 cm in the case
    // this branch exists for — so asking about nearness cleared the pointer and left
    // migration 026 with no handle on the pair. Asking about the pairing says what was
    // meant: the pointer goes when the old row is the row the source is offering.
    expect(unpair).toMatch(/EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = old\.id\s*\)/);
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
    // And it says nothing about a row the pairing kept. Membership of `paired`, not
    // nearness: a row that lost the pairing to a nearer one is *near* the incoming point
    // and must still lose its place, or it keeps the negative ordinal the parking step
    // gave it and the next run collides on `(experience_id, ordinal)`.
    expect(hold).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = el\.id\s*\)/);
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

  it('does not re-place a corrected point the run left exactly where it was', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client } = fakeClient([
      // The resurrection arm first and empty: it opens `SET ordinal = i.ordinal`
      // too, so a bare KEEP pattern answers for both and the ids arrive twice.
      [RESURRECT, { rows: [] }],
      [KEEP, {
        rows: [
          // Claimed: the arm kept `el.location`, so nothing moved. `metres` is the
          // pairing distance to the point the source is still offering.
          {
            id: 7, metres: 2000, external_ref: 'r1',
            old_name: 'A', old_lon: 4.0, old_lat: 49.0, old_curated_fields: ['location'],
            new_name: 'A', new_lon: 4.0, new_lat: 49.018,
          },
          // Unclaimed and genuinely rewritten within the tolerance: this one is
          // placed again, because a region boundary is a line and no distance near
          // one is small enough to be safe.
          {
            id: 8, metres: 4, external_ref: 'r2',
            old_name: 'B', old_lon: 31.5, old_lat: 6.1, old_curated_fields: [],
            new_name: 'B', new_lon: 31.50004, new_lat: 6.1,
          },
        ],
      }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A, B]);

    // Otherwise every run deletes and reinserts this experience's `auto` region
    // rows for as long as the correction stands — nothing lost, since a manual
    // assignment is never touched, but exactly the churn the fast path exists to
    // remove, and it grows with how much curation has happened.
    expect(result.needsAssignment).toEqual([8]);
    expect(result.unchanged).toEqual([7]);
  });

  it('keeps a corrected point paired however far the source has moved on', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The claim would otherwise hold for exactly the corrections too small to need
    // it: a curator moves a pin off the wrong building — the motivating case is
    // 2.0 km — and the row falls out of a pairing bounded at ten metres, so the
    // source's point is inserted as a new row and the corrected one is marked
    // withdrawn. Paired by reference alone, it reaches the arm that protects it.
    const pairing = String(statements.find(s => s.includes('CREATE TEMP TABLE paired_rows')));
    expect(pairing).toContain("el.curated_fields ? 'location'");
    // Null-safe on purpose, and the fragment's docblock argues it: made strict,
    // this excludes the one row it most needs to cover, since `samePointSql`
    // falls back to exact coordinate equality when there is no reference — so a
    // corrected referenceless point would match nothing and be withdrawn. One
    // catalogue row has no reference (site 868), and it is its only point, so its
    // anchor moved with the correction too.
    expect(pairing).toContain('el.external_ref IS NOT DISTINCT FROM i.external_ref');
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

    // Identity is the point together with the source's reference (ADR-0022, narrowed
    // by ADR-0027), so a point that really moved — the fixture walks it 76 km, from
    // (10, 20) to (10.5, 20.5) — is a row leaving and another arriving, and the
    // delta says exactly that rather than inventing a "moved" the writer never
    // performed. A coordinate merely rewritten more precisely is the other case now,
    // and never reaches here: within ten metres the row is kept and updated.
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

/**
 * The rule for when a stored row *is* the point the source is offering (ADR-0027).
 *
 * These assert the SQL rather than a result, because the decision lives in a predicate
 * the database evaluates and the unit here has no database. What they are guarding is
 * the shape that cost the catalogue its only withdrawal: a coordinate rewritten 1.2 cm
 * more precisely read as a departure, with 1642 of 6680 points sitting on a rounded
 * coordinate behind it.
 */
describe('writeExperienceLocations — when a stored point is the incoming one', () => {
  /** Each composing site, and the slice of its statement the fragment must be inside. */
  const ASKS_SAME_POINT = [
    // Sliced rather than searched over the whole statement. The reason it was needed is
    // gone — the pairing is a table now, so this CTE appears in exactly one statement
    // instead of being prefixed to every arm — and the slice stays because the statement
    // it lands in also declares `best_row`, which is free to grow a predicate of its own
    // and would then answer this assertion on `candidate`'s behalf.
    ['the candidate relation the pairing is built from', /candidate AS \(/,
      (s: string) => s.slice(s.indexOf('candidate AS ('), s.indexOf('best_row AS ('))],
    ['the fast path', /AS matched/, (s: string) => s],
  ] as const;

  it('asks the same question in every place that asks it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient([
      [INSERT, { rows: [{ id: 9, curation_state: 'pending', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The two sites that genuinely compose the fragment (ADR-0027 decision 5): the
    // relation the pairing is built from, and the fast path. Shorter than every earlier
    // draft, and the shrinking is the design settling rather than coverage being dropped —
    // the arms were handed a decided pairing to read instead of a question to ask, and the
    // withdrawal-to-arrival lookup followed them, because the set it withdraws from has to
    // cover the *visible* rows the mark marks, or a visible pin goes with no arrival
    // holding it back.
    //
    // But `candidate` had to come back into the list, not be left to the arms' own test:
    // that one asserts structure, so reverting this join to an exact comparison turned
    // nothing red. What comes back with it is #543 on the slow path — a rewritten
    // coordinate stops pairing, the withdrawal arm marks the row, the insert writes
    // another beside it — and the fast path still matching is exactly what would hide it.
    // Reverting the lookup instead is #543 one level up, an arrival no longer recognising
    // the point it replaces.
    const all = [String(mockedQuery.mock.calls[0][0]), ...statements];
    for (const [what, pattern, slice] of ASKS_SAME_POINT) {
      const sql = all.find(s => pattern.test(s));
      expect(sql, `${what} runs`).toBeDefined();
      expect(slice(String(sql)), `${what} carries the tolerance`).toContain('ST_DWithin');
      expect(slice(String(sql)), `${what} keeps the reference`).toContain('external_ref IS NOT DISTINCT FROM i.external_ref');
    }

    // And every statement deciding a row is *not* the incoming one asks the pairing rather
    // than nearness. Two of them because a row that lost the pairing is near the incoming
    // point, so nearness would strand it; the third — the deferral's `withdrawn` — because
    // the set it withdraws from has to cover every row the mark will mark *that a reader can
    // see*, or a run applies one it should have held, and under a gate that takes a visible
    // pin off the map leaving an invisible `pending` arrival as the replacement (ADR-0027
    // decision 5). Cover the visible ones, not equal them: the two predicates differ by two
    // terms pulling opposite ways, which is what the assertions below pin.
    //
    // The `withdrawn` CTE is sliced out rather than matched over the whole statement,
    // because the statement pairs withdrawals to arrivals by reference and position and
    // asks about neither of these things elsewhere in itself.
    const withdrawnCte = (sql: string) => sql.slice(sql.indexOf('withdrawn AS ('), sql.indexOf('arrived AS ('));
    // `waits` — which rows this statement must pass over because an arrival is holding
    // them, and the three answers are three different sets rather than a flag:
    //
    // - the mark: any row an arrival waits on, unconditionally — that is what makes a
    //   deferral mean anything, or the row would be paired and withdrawn in one run;
    // - the hold: none, its whole subject being exactly those rows;
    // - the deferral's `withdrawn`: only rows held by an arrival **this run keeps**. The
    //   narrower set on purpose, and the difference is the defect it was added for: a
    //   point moved twice before anyone publishes has a first arrival that is itself
    //   unoffered, so excluding the row it holds leaves the second arrival with no
    //   pairing and two visible pins on a one-point site.
    const anyWaiting = /NOT EXISTS \(\s*SELECT 1 FROM experience_locations waiting[\s\S]*?waiting\.withdrawal_deferred_for_location_id = el\.id/;
    const survivingWaiting = /waiting\.withdrawal_deferred_for_location_id = el\.id\s*AND EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = waiting\.id\s*\)/;
    const asksThePairing = [
      ['the withdrawal arm', MARK, (s: string) => s, anyWaiting],
      ['the hold arm', HOLD, (s: string) => s, null],
      ['the deferral’s withdrawn set', PAIR, withdrawnCte, survivingWaiting],
    ] as const;
    for (const [what, pattern, slice, waits] of asksThePairing) {
      const sql = slice(String(all.find(s => pattern.test(s))));
      expect(sql, `${what} reads the pairing`).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = el\.id\s*\)/);
      expect(sql, `${what} does not ask about nearness`).not.toMatch(/SELECT 1 FROM incoming i/);
      if (waits) expect(sql, `${what} passes over the right held rows`).toMatch(waits);
    }
    // And the two sets are not each other: widening the deferral's to the mark's is the
    // revert that brings the two-pin residue back, so it is asserted as a difference
    // rather than left to the regexes above happening not to overlap.
    const deferral = withdrawnCte(String(all.find(s => PAIR.test(s))));
    expect(deferral, 'the deferral is the narrower set').toMatch(/p\.location_id = waiting\.id/);

    // A deferral slot is scarce — one per arrival — so the set it draws from has to be the
    // rows a reader can actually see, all three terms of that. `curation_state` alone is
    // not it: a point a curator answered "no longer exists" on, which the source then
    // offered again, comes back with `missing_since` cleared and `existence` deliberately
    // untouched. Invisible, unpaired, not pending — and it would take the slot from a point
    // somebody can see.
    for (const term of [/el\.missing_since IS NULL/, /el\.existence <> 'lost'/, /el\.curation_state <> 'pending'/]) {
      expect(deferral, `the deferral draws only on visible rows: ${String(term)}`).toMatch(term);
    }
  });

  it('holds the tolerance to a matching reference, and to ten metres', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    const sql = String(mockedQuery.mock.calls[0][0]);
    // Ten metres, and read from `changeSet.ts` rather than spelled here: the same number
    // already answers this question about the experience's own coordinate, and two
    // numbers would be two answers.
    expect(sql).toContain(`::geography,\n                                  ${LOCATION_UNCHANGED_METERS})`);
    // Distance in metres on `geography`, never in degrees: a degree of longitude is
    // 111 km at the equator and 23 km at Svalbard, and this catalogue holds points from
    // 78°N to 54°S.
    expect(sql).toContain('::geography');
    expect(sql).not.toMatch(/abs\(.*lat/i);
  });

  it('compares a point with no reference exactly, because nothing makes it a candidate', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [{ name: null, externalRef: null, lon: 1, lat: 2 }]);

    // Without a reference the tolerance would be a nearest-point search over the
    // object's own points, and 4172 pairs of points of one experience lie within a
    // kilometre — many at 0.000 m, since what separates two rock-art shelters in one
    // cliff is the component number and not the metres. So the exact branch stays,
    // reachable through `i.external_ref IS NULL`.
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('CASE WHEN i.external_ref IS NULL');
    expect(sql).toMatch(/THEN el\.location = ST_SetSRID/);
  });

  it('writes the source’s coordinate onto the row it keeps', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Without this the stored value never converges: the row matches every run against
    // the same stale number, and the rounding the tolerance exists to absorb stays in
    // the database for ever (ADR-0027 decision 4).
    // Sliced to the SET clause, not searched over the statement: the predicate below it
    // carries `el.location = ST_SetSRID(…)` in its exact branch, so a match anywhere in
    // the text passes whether or not anything is written — which is how this assertion
    // read before a mutation check caught it.
    const setOf = (sql: string) => sql.slice(sql.indexOf('SET'), sql.indexOf('FROM paired'));
    // The write is the ELSE of a claim guard since #488 reached the contents: a
    // curator's coordinate survives the run, and every other row still converges.
    const write = 'ELSE ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326) END';
    expect(setOf(String(statements.find(s => KEEP.test(s) && !RESURRECT.test(s))))).toContain(write);
    expect(setOf(String(statements.find(s => RESURRECT.test(s))))).toContain(write);
  });

  it('keeps a name and a coordinate a curator claimed, on both arms', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // A point is a thing a curator can be right about — a pin in the wrong place is
    // a traveller in the wrong place — and before this the next run took it back.
    // Both arms, because a point that goes away and returns is the same point.
    const setOf = (sql: string) => sql.slice(sql.indexOf('SET'), sql.indexOf('FROM paired'));
    for (const arm of [KEEP, RESURRECT]) {
      const sql = setOf(String(statements.find(s => (arm === KEEP
        ? KEEP.test(s) && !RESURRECT.test(s)
        : RESURRECT.test(s)))));
      expect(sql).toContain("CASE WHEN el.curated_fields ? 'name' THEN el.name");
      expect(sql).toContain("CASE WHEN el.curated_fields ? 'location' THEN el.location");
    }

    // And not on the source's handle: `external_ref` and `ordinal` are what the
    // pairing reads to tell a moved point from a replaced one, so a claim there
    // would not protect a judgement — it would blind the writer to its own row.
    const kept = setOf(String(statements.find(s => KEEP.test(s) && !RESURRECT.test(s))));
    expect(kept).toContain('external_ref = i.external_ref');
    expect(kept).toContain('ordinal = i.ordinal');
  });

  it('sends a row it moved back for placement, however small the move', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    // Keyed on the distance the arm reports, which is what tells it from the
    // resurrection arm — both open `SET ordinal = i.ordinal`.
    const KEPT_ROWS = /RETURNING el\.id, p\.metres/;
    const { client, statements } = fakeClient([
      [KEPT_ROWS, { rows: [{ id: 7, metres: 0 }, { id: 8, metres: 0.0124 }] }],
    ]);
    mockedConnect.mockResolvedValue(client);

    const result = await writeExperienceLocations(1, [A, B]);

    // Adopting the coordinate cost `unchanged` the property that made it safe: the row
    // matched, but it is no longer where it was assigned from. Ten metres is nothing to
    // a traveller and everything to a polygon — a region's edge is a line, so 1.2 cm
    // across it is a different country — and nothing revisits the row afterwards,
    // because the fast path matches the new coordinate on every later run. So the arm
    // reports the distance and the two lists split on it.
    expect(only(statements, KEPT_ROWS)).toMatch(/SET ordinal = i\.ordinal/);
    expect(result.needsAssignment).toEqual([8]);
    expect(result.unchanged).toEqual([7]);
  });

  it('decides the pairing once, before anything reads it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client, statements } = fakeClient([
      [INSERT, { rows: [{ id: 9, curation_state: 'pending', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rowCount: 1 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Two defects in one assertion, and both were shipped on this branch.
    //
    // As a CTE the pairing was *decided per statement*, so the keeping arm's own write —
    // moving a row onto the source's coordinate, and thereby off every other incoming
    // point — could hand an ordinal to a second row after every arm that would have
    // written it had run. That row keeps its parked negative ordinal, and the next run's
    // parking collides with it on `(experience_id, ordinal)`, aborting that experience's
    // write from then on. Materialised once, every statement after it agrees about it —
    // stated as a class rather than counted, the count having been wrong twice here as
    // statements moved onto the pairing one at a time.
    //
    // And the mocked lane cannot see the other one at all: a statement reading the
    // relation without declaring it raises `relation … does not exist` on a real database
    // and rolls the transaction back, on every slow-path run. That reached review twice
    // here. Ordering is what covers both — the table has to be built before it is read
    // (#522 is the executable lane that would catch either as a failure instead).
    // Comments stripped first, or the guard reads prose: the statements here explain
    // themselves at length, and a `--` line saying the word "paired" is not a statement
    // naming the relation. Caught by this very case going red on a comment.
    const sqlOnly = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    const all = [String(mockedQuery.mock.calls[0][0]), ...statements].map(sqlOnly);
    const built = all.findIndex(s => /CREATE TEMP TABLE paired_rows/.test(s));
    expect(built, 'the pairing is materialised').toBeGreaterThanOrEqual(0);
    expect(all[built], 'built from the pairing CTE').toMatch(/paired AS \(/);
    all.forEach((sql, i) => {
      if (/paired_rows/.test(sql) && i !== built) {
        expect(i, `reads the pairing after it is built: ${sql.slice(0, 60)}`).toBeGreaterThan(built);
        expect(sql, 'reads the table rather than redeciding it').not.toMatch(/paired AS \(/);
      }
      // The original `42P01`, kept as its own check rather than folded into the ordering
      // one: bare `paired` is the CTE, and only the statement that builds the table may
      // name it. `\bpaired\b` cannot match inside `paired_rows`, the underscore being a
      // word character, so this is about the relation the arms no longer have.
      if (/\bpaired\b/.test(sql)) {
        expect(sql, `names the CTE it declares: ${sql.slice(0, 60)}`).toMatch(/paired AS \(/);
      }
    });
  });

  it('puts the rows it inserts into the pairing, so the mark cannot take them back', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient([
      [INSERT, { rows: [{ id: 9, curation_state: 'pending', name: 'A', external_ref: 'r1' }] }],
      [MARK, { rows: [], rowCount: 0 }],
    ]);
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Deciding the pairing once cost the insert its protection: the table predates every
    // row the insert writes, and membership of it is the withdrawal arm's *only* test of
    // whether the source still offers a row. So a point the run had just added answered
    // every predicate of the mark — added and withdrawn by one run, hidden from every
    // reader, its regions never written because placement takes offered rows only. Under
    // a gate it is worse and does not heal: the row is `pending` *and* marked, and publish
    // carries `missing_since IS NULL`, so nobody can ever release it.
    //
    // The insert therefore extends the pairing in the same statement, which is also what
    // keeps it one decision rather than two.
    const insert = statements.findIndex(s => INSERT.test(s));
    const mark = statements.findIndex(s => MARK.test(s));
    expect(statements[insert]).toMatch(/INSERT INTO paired_rows/);
    expect(insert, 'the insert runs before the mark can read the pairing').toBeLessThan(mark);
  });

  it('withdraws the row that lost the pairing, rather than stranding it', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '2', matched: '0', ids: [7, 8] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // Two visible rows within the tolerance of one incoming point: one wins the pairing,
    // and the other is a second row for a place the run has already kept. Asking "is
    // anything in the incoming list near it" excludes it from every arm — it is near —
    // so it keeps the negative ordinal the parking step gave it, and the next run's
    // parking collides on `(experience_id, ordinal)` and aborts that experience's write
    // for good. Membership of `paired` is the question that makes the loser withdrawable.
    const mark = only(statements, MARK);
    expect(mark).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM paired_rows p WHERE p\.location_id = el\.id\s*\)/);
    expect(mark).not.toMatch(/SELECT 1 FROM incoming i/);
  });

  it('pairs each incoming point with one row, and each row with one point', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A]);

    // The tolerance gave away what the exact match had for free: two rows within ten
    // metres under one reference both satisfy the predicate for one incoming point, and
    // the keeping and resurrection arms would then write the same ordinal onto two rows
    // — `UNIQUE(experience_id, ordinal)` aborting that experience's write on every run
    // after. So the arms read a decided pairing, made one-to-one from both directions,
    // preferring the row that is not marked (ADR-0027 decision 5a — not the row a reader
    // can see, which under a gate is a different row).
    //
    // Both orderings are pinned, because they are the product decision and because they
    // are all this lane can reach: the passes are greedy, so a complete pairing inside the
    // tolerance can go unfound (decision 5a-i, #549), and observing that needs SQL run
    // against Postgres rather than a mock that never parses it (#522).
    //
    // Asserted on the statement that *builds* the table, since that is now the only place
    // the decision is made — the arms read its result and can no longer restate it.
    const build = String(statements.find(s => /CREATE TEMP TABLE paired_rows/.test(s)));
    expect(build).toContain('DISTINCT ON (ordinal)');
    expect(build).toContain('DISTINCT ON (location_id)');
    expect(build).toContain('ORDER BY ordinal, (missing_since IS NULL) DESC, metres');
    expect(build).toContain('ORDER BY location_id, ordinal');
    const kept = String(statements.find(s => KEEP.test(s) && !RESURRECT.test(s)));
    expect(kept).toContain('FROM paired_rows p JOIN incoming i ON i.ordinal = p.ordinal');
    // And the insert reads the same relation rather than asking the predicate again,
    // or a point the pairing kept is inserted a second time beside the row it updated.
    expect(String(statements.find(s => INSERT.test(s))))
      .toContain('NOT EXISTS (SELECT 1 FROM paired_rows p WHERE p.ordinal = i.ordinal)');
  });
});
