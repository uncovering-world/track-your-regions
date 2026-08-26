import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const poolQuery = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

import { createRegion } from './regionCrud.js';

/**
 * Regression test: a region created with a hand-drawn shape has geometry from
 * the moment it exists, so it never seeds the world-view run's closure — and its
 * parent already had geometry, so neither does that. Without an invalidation on
 * insert the parent is short of its children for good, reachable only by a
 * forced run: #667's shape, reached from the "create from staged" and
 * single-division custom dialogs rather than from an import. (The split dialogs
 * do not come here: they write `region_members.custom_geom`, which is a
 * different writer on a different arm.)
 */
describe('createRegion marks the ancestors stale when it inserts a drawn shape (#667)', () => {
  const GEOMETRY = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };

  function invalidations(): unknown[][] {
    return poolQuery.mock.calls.filter(([sql]) => String(sql).includes('RECURSIVE ancestors'));
  }

  function call(body: Record<string, unknown>) {
    const req = { params: { worldViewId: '5' }, body } as unknown as Request;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })), json } as unknown as Response;
    return createRegion(req, res).then(() => json);
  }

  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('INSERT INTO regions')) return { rows: [{ id: 4242 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  });

  it('invalidates for the new region, so its parent is drawn whole again', async () => {
    await call({ name: 'Split part', parentRegionId: 42, customGeometry: GEOMETRY });

    const [invalidation] = invalidations();
    expect(invalidation).toBeDefined();
    // The new region's own id: the walk goes up from it, and its drawn shape is
    // left alone (#283).
    expect(invalidation[1]).toEqual([4242]);
    expect(String(invalidation[0])).toMatch(/SELECT id FROM ancestors WHERE id <> \$1/);
  });

  it('does not, for a region born without geometry — it seeds the closure itself', async () => {
    await call({ name: 'Empty group', parentRegionId: 42 });

    expect(invalidations()).toHaveLength(0);
  });

  it('still answers 201 when the invalidation deadlocks, and says so in the log', async () => {
    // The one caller that logs instead of raising. The row is already committed,
    // so a 500 would skip the client's onSuccess (which adds the members) and
    // leave a region with a boundary and nothing in it, while the retry created
    // a second one — regions carry no uniqueness on (world view, name, parent).
    // The ancestors are stale either way; only the damage differs.
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('RECURSIVE ancestors')) throw new Error('deadlock detected');
      if (String(sql).includes('INSERT INTO regions')) return { rows: [{ id: 4242 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const json = await call({ name: 'Split part', parentRegionId: 42, customGeometry: GEOMETRY });

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ id: 4242 }));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('left stale'), 4242, expect.any(Error));
    error.mockRestore();
  });
});
