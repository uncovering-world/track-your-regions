import { describe, it, expect, vi, beforeEach } from 'vitest';

const { client, rollbackQuietly } = vi.hoisted(() => ({
  client: { query: vi.fn(), release: vi.fn() },
  rollbackQuietly: vi.fn(),
}));

vi.mock('./index.js', () => ({
  pool: { connect: async () => client },
  rollbackQuietly,
}));

import { inRegionTransaction, invalidateRegionGeometry, lockSubtree, restoreRegions, type RegionTx } from './regionWriter.js';

/** A connection whose statements are recorded, handed to a writer as a transaction. */
function recordingTx() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { query, tx: { query } as unknown as RegionTx };
}

describe('inRegionTransaction', () => {
  beforeEach(() => {
    client.query.mockReset().mockResolvedValue({ rows: [] });
    client.release.mockReset();
    rollbackQuietly.mockReset().mockResolvedValue(undefined);
  });

  it('commits what the work wrote and answers what it returned', async () => {
    const answer = await inRegionTransaction(async (tx) => {
      await tx.query('UPDATE regions SET name = $1 WHERE id = $2', ['Hispania', 7]);
      return 7;
    });

    expect(answer).toBe(7);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'UPDATE regions SET name = $1 WHERE id = $2', 'COMMIT']);
    expect(rollbackQuietly).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('rolls back what the work wrote when it throws, and throws its error', async () => {
    await expect(inRegionTransaction(async (tx) => {
      await tx.query('DELETE FROM regions WHERE id = $1', [7]);
      throw new Error('update or delete on table "regions" violates foreign key constraint');
    })).rejects.toThrow('violates foreign key constraint');

    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    expect(rollbackQuietly).toHaveBeenCalledWith(client);
  });

  it('releases a client whose rollback failed as unusable, so its transaction never reaches the pool', async () => {
    const broken = new Error('Connection terminated unexpectedly');
    rollbackQuietly.mockResolvedValue(broken);

    await expect(inRegionTransaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    expect(client.release).toHaveBeenCalledWith(broken);
  });
});

describe('invalidateRegionGeometry', () => {
  it('skips rows with is_custom_boundary IS TRUE — regression for #283', async () => {
    // The guard is what this pins: without IS NOT TRUE the recursive CTE
    // reaches the starting region itself, so calling addMembers
    // right after createRegion(customGeometry) would null the just-created
    // custom shape and reset is_custom_boundary, then a subsequent recompute
    // would produce the merged-from-members geometry — losing the user's
    // drawing.
    const { query, tx } = recordingTx();
    await invalidateRegionGeometry(tx, 42);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([42]);
    expect(sql).toMatch(/is_custom_boundary IS NOT TRUE/);
    expect(sql).not.toMatch(/is_custom_boundary\s*=\s*false/);
  });

  it('still nulls geom + simplified columns', async () => {
    const { query, tx } = recordingTx();
    await invalidateRegionGeometry(tx, 7);
    const [sql] = query.mock.calls[0] as [string];
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
    const { query, tx } = recordingTx();
    await invalidateRegionGeometry(tx, 1);
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toMatch(/WHERE id = \$1/);
    expect(sql).not.toMatch(/WITH RECURSIVE/);
    expect(sql).not.toMatch(/parent_region_id/);
  });

  it('lets a lock timeout or a deadlock fail the change it belongs to (#689)', async () => {
    // Swallowed, the change would commit without the parent it names cleared,
    // which leaves that parent outside the next run's closure.
    const { query, tx } = recordingTx();
    query.mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(invalidateRegionGeometry(tx, 99)).rejects.toThrow('deadlock detected');
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
    await restoreRegions(db as unknown as RegionTx, [
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
    await restoreRegions(db as unknown as RegionTx, [
      { id: 8, name: 'Paphos', parent_region_id: 31, is_leaf: true, world_view_id: 5 },
      { id: 10, name: 'Cyprus', parent_region_id: 2, is_leaf: false, world_view_id: 5 },
      { id: 31, name: 'West', parent_region_id: 10, is_leaf: false, world_view_id: 5 },
    ]);

    expect(db.query.mock.calls.map(([, params]) => (params as unknown[])[0])).toEqual([10, 31, 8]);
  });
});

describe('lockSubtree', () => {
  it('walks the branch again once locked, and locks what joined it while the lock was awaited', async () => {
    // Polis (12) was attached under the branch after the first walk read it:
    // the second walk finds it, so the branch is locked again with it.
    const { query, tx } = recordingTx();
    const walks = [
      [{ id: 11, root: 10 }],
      [{ id: 11, root: 10 }, { id: 12, root: 10 }],
      [{ id: 11, root: 10 }, { id: 12, root: 10 }],
      [{ id: 11, root: 10 }, { id: 12, root: 10 }],
    ];
    query.mockImplementation(async () => ({ rows: walks.shift() ?? [] }));

    const branch = await lockSubtree(tx, [10], false);

    expect(branch.map((row) => row.id)).toEqual([11, 12]);
    const locks = query.mock.calls.filter(([sql]) => /FOR UPDATE OF r/.test(String(sql)));
    expect(locks).toHaveLength(2);
  });

  it('gives up on a branch that keeps changing rather than locking forever', async () => {
    const { query, tx } = recordingTx();
    let n = 0;
    query.mockImplementation(async () => ({ rows: [{ id: 100 + n++, root: 10 }] }));

    await expect(lockSubtree(tx, [10], false)).rejects.toThrow('kept changing');
  });
});

