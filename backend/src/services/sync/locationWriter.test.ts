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

/** A client whose every statement is recorded, so the write path can be read back. */
function fakeClient() {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return { client, statements };
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
    expect(result).toEqual({ unchanged: [7, 8], needsAssignment: [], removed: 0 });
  });

  it('never deletes a location the source still offers', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ stored: '1', matched: '0', ids: [7] }] });
    const { client, statements } = fakeClient();
    mockedConnect.mockResolvedValue(client);

    await writeExperienceLocations(1, [A, B]);

    // The whole bug in one assertion: a delete keyed on the experience alone
    // takes every location, and the cascade takes their assignments with it.
    const deletes = statements.filter(s => /DELETE FROM experience_locations/i.test(s));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/NOT EXISTS/);
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
      if (/DELETE FROM experience_locations/i.test(sql)) throw new Error('boom');
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
      // Point alone would make the delete drop a component that shares a
      // coordinate with a survivor, and the update match two stored rows to
      // one incoming entry. Both queries have to carry the reference.
      const spatial = statements.filter(s => /ST_MakePoint/.test(s));
      expect(spatial.length).toBeGreaterThan(0);
      for (const sql of spatial) {
        expect(sql).toMatch(/external_ref IS NOT DISTINCT FROM i\.external_ref/);
      }
    });
  });
});
