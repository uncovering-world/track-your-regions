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
    expect(result).toEqual({ unchanged: [7, 8], needsAssignment: [], unoffered: 0 });
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
