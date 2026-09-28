import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./index.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { pool } from './index.js';
import { invalidateRegionGeometry, restoreRegions } from './regionWriter.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('invalidateRegionGeometry', () => {
  beforeEach(() => {
    mockedQuery.mockClear();
  });

  it('skips rows with is_custom_boundary IS TRUE — regression for #283', async () => {
    // The guard is what this pins: without IS NOT TRUE the recursive CTE
    // reaches the starting region itself, so calling addMembers
    // right after createRegion(customGeometry) would null the just-created
    // custom shape and reset is_custom_boundary, then a subsequent recompute
    // would produce the merged-from-members geometry — losing the user's
    // drawing.
    await invalidateRegionGeometry(42);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([42]);
    expect(sql).toMatch(/is_custom_boundary IS NOT TRUE/);
    expect(sql).not.toMatch(/is_custom_boundary\s*=\s*false/);
  });

  it('still nulls geom + simplified columns', async () => {
    await invalidateRegionGeometry(7);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/geom\s*=\s*NULL/);
    expect(sql).toMatch(/geom_3857\s*=\s*NULL/);
    expect(sql).toMatch(/geom_simplified_low\s*=\s*NULL/);
    expect(sql).toMatch(/geom_simplified_medium\s*=\s*NULL/);
  });

  it('touches one row and leaves the walk upward to the database (#680)', async () => {
    // The ancestors are the trigger's business now: nulling this region's geom
    // is itself a write to regions.geom, so trg_regions_geom_invalidates_parent
    // fires and takes the chain from here. A second walk in TypeScript would be
    // the rule written twice, which is what #679 spent a review discovering.
    await invalidateRegionGeometry(1);
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(sql).not.toMatch(/WITH RECURSIVE/);
    expect(sql).not.toMatch(/parent_region_id/);
  });

  it('swallows lock/deadlock errors (concurrent invalidation safe)', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('could not obtain lock on row in relation "regions"'));
    await expect(invalidateRegionGeometry(99)).resolves.toBeUndefined();

    mockedQuery.mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(invalidateRegionGeometry(99)).resolves.toBeUndefined();
  });

  it('rethrows non-lock errors', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('relation "regions" does not exist'));
    await expect(invalidateRegionGeometry(99)).rejects.toThrow('does not exist');
  });
});

describe('restoreRegions', () => {
  it('recreates a deleted region with no geometry, which is what makes undo self-healing', async () => {
    // Undoing a dismiss, a prune or a smart flatten needs no invalidation of
    // its own: every region it recreates arrives with `geom NULL`, which is
    // precisely what seeds the run's closure -- the restored rows are selected,
    // and every ancestor of one with them, so the parent is recomputed without
    // anybody naming it. Restore a snapshot of `geom` here and that stops being
    // true, and the undo paths would need what the forward paths need.
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await restoreRegions(db, [
      { id: 12, name: 'Limassol', parent_region_id: 10, is_leaf: true, world_view_id: 5 },
      { id: 10, name: 'Cyprus', parent_region_id: null, is_leaf: false, world_view_id: 5 },
    ]);

    const statements = db.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toHaveLength(2);
    for (const sql of statements) expect(sql).not.toMatch(/(?<!\w)geom/);
    // A parent before its child, whatever order the snapshot held.
    expect(db.query.mock.calls.map(([, params]) => (params as unknown[])[0])).toEqual([10, 12]);
  });

  it('puts a parent back before a child that carries the lower id', async () => {
    // The import review can move an older region under one it added later:
    // Paphos (8) under a new district (31) under Cyprus (10). Restored by id,
    // Paphos would name a parent not yet there and the undo would fail whole.
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await restoreRegions(db, [
      { id: 8, name: 'Paphos', parent_region_id: 31, is_leaf: true, world_view_id: 5 },
      { id: 10, name: 'Cyprus', parent_region_id: 2, is_leaf: false, world_view_id: 5 },
      { id: 31, name: 'West', parent_region_id: 10, is_leaf: false, world_view_id: 5 },
    ]);

    expect(db.query.mock.calls.map(([, params]) => (params as unknown[])[0])).toEqual([10, 31, 8]);
  });
});
