import { describe, it, expect, vi, beforeEach } from 'vitest';

const client = { query: vi.fn(), release: vi.fn() };

vi.mock('../../db/index.js', () => ({
  pool: { connect: vi.fn(async () => client), query: vi.fn() },
}));

import { recomputeRegionGeometry } from './geometryCompute.js';

/** The merge statement's answer, the transaction's own statements answering nothing. */
const merging = (rows: unknown[]) => client.query.mockImplementation(async (sql: string) =>
  (String(sql).includes('UPDATE regions') ? { rows } : { rows: [] }));
const statements = () => client.query.mock.calls.map((c) => String(c[0]));

describe('recomputeRegionGeometry', () => {
  beforeEach(() => {
    client.query.mockReset();
    client.release.mockReset();
  });

  it('reports what it wrote', async () => {
    merging([{ points: 4200 }]);

    const result = await recomputeRegionGeometry(7);

    expect(result).toMatchObject({ computed: true, points: 4200 });
    // One merge statement, and the ancestors above it are the trigger's
    // business: the UPDATE is a write to regions.geom, so
    // trg_regions_geom_invalidates_parent fires from inside it (#680).
    expect(statements().filter((s) => s.includes('UPDATE regions'))).toHaveLength(1);
  });

  it('answers computed:false when the merge wrote nothing', async () => {
    // No members and no computed children, or a hand-drawn boundary the UPDATE's
    // own guard excluded: nothing moved, so nothing above it is stale either.
    merging([]);

    const result = await recomputeRegionGeometry(7);

    expect(result).toMatchObject({ computed: false });
  });

  /**
   * The editor's stream calls it for each child without geometry, a continent
   * a worker run cleared included, so it holds to the stream's request bound
   * rather than unioning with no limit (#459).
   */
  it("runs under the request's bound, in a transaction of its own, and rolls back what fails", async () => {
    merging([{ points: 1 }]);
    await recomputeRegionGeometry(7);
    expect(statements()).toEqual(expect.arrayContaining(['BEGIN', "SET LOCAL statement_timeout = '300000'", 'COMMIT']));

    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes('UPDATE regions')) {
        throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      }
      return { rows: [] };
    });
    await expect(recomputeRegionGeometry(7)).rejects.toMatchObject({ code: '57014' });
    expect(statements()).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
