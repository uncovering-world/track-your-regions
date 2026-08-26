import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const client = { query: vi.fn(), release: vi.fn() };
const poolQuery = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: { connect: vi.fn(async () => client), query: (...args: unknown[]) => poolQuery(...args) },
}));

import { computeRegionGeometryCore, computeSingleRegionGeometry } from './geometryComputeSingle.js';

function respond(sql: string) {
  if (sql.includes('SELECT is_custom_boundary')) {
    return { rows: [{ is_custom_boundary: false, name: 'Bavaria', has_geom: false }] };
  }
  if (sql.includes('member_points')) {
    return { rows: [{ member_points: '5000', child_points: '0', child_count: '0', child_row_count: '0', member_count: '1' }] };
  }
  if (sql.includes('UPDATE regions')) {
    return { rows: [{ points: 5000 }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

describe('computeRegionGeometryCore fast path', () => {
  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respond(String(sql)));
  });

  it('copies the member geometry for a region that is exactly one division', async () => {
    const result = await computeRegionGeometryCore(42);

    expect(result).toMatchObject({ computed: true, points: 5000 });

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(true);
    // The union machinery must not run at all.
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(false);
  });

  it('falls through to the union path when the region has children', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '5000', child_points: '900', child_count: '3', child_row_count: '3', member_count: '1' }] };
      }
      return respond(s);
    });

    await computeRegionGeometryCore(42);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(true);
    // The fast path's direct-copy update must not have run.
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(false);
  });

  it('falls through to the union path when a child region exists but has no geometry yet', async () => {
    // Regression test: the fast-path guard must use a
    // structural child-row count, not the geometry-bearing `child_count`
    // (which is 0 here precisely because the child hasn't been computed
    // yet). One member + one geometry-less child must NOT be treated as a
    // single-division leaf, or the child's eventual geometry would never
    // be unioned in.
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '5000', child_points: '0', child_count: '0', child_row_count: '1', member_count: '1' }] };
      }
      return respond(s);
    });

    await computeRegionGeometryCore(42);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(true);
    // The fast path's direct-copy update must not have run.
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(false);
  });

  it('falls through to the union path when the region has several members', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '5000', child_points: '0', child_count: '0', member_count: '2' }] };
      }
      return respond(s);
    });

    await computeRegionGeometryCore(42);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(true);
    // The fast path's direct-copy update must not have run.
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(false);
  });

  it('leaves a hand-drawn boundary alone', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('SELECT is_custom_boundary')) {
        return { rows: [{ is_custom_boundary: true, name: 'Drawn', has_geom: true }] };
      }
      return respond(s);
    });

    await computeRegionGeometryCore(42);

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(false);
    // A custom boundary still falls through to the union path.
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(true);
  });
});

// Regression test: computeSingleRegionGeometry (the
// POST /geometry/compute HTTP handler) reaches the same fast path through
// computeGroupGeom — this pins the two writers to agree on a single-division
// region instead of one copying the member geometry and the other unioning it.
describe('computeSingleRegionGeometry (HTTP handler) reaches the same fast path', () => {
  function respondPool(sql: string) {
    const s = String(sql);
    if (s.includes('is_custom_boundary') && s.includes('uses_hull')) {
      // Initial region check.
      return { rows: [{ is_custom_boundary: false, name: 'Bavaria', usesHull: false, has_geom: false }] };
    }
    if (s.includes('is_custom_boundary') && s.includes('parent_region_id')) {
      // computeBottomUp's children lookup — no children.
      return { rows: [] };
    }
    if (s.includes('"geomPoints"')) {
      // Post-compute status check.
      return { rows: [{ id: 42, name: 'Bavaria', usesHull: false, hasGeom: true, hasHull: false, geomPoints: 5000, hullPoints: null }] };
    }
    if (s.includes('hull_geom = NULL')) {
      return { rows: [], rowCount: 0 };
    }
    if (s.includes('parent_region_id FROM regions')) {
      return { rows: [{ parent_region_id: null }] };
    }
    if (s.includes('world_view_id FROM regions')) {
      return { rows: [{ world_view_id: null }] };
    }
    return { rows: [], rowCount: 0 };
  }

  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respond(String(sql)));
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => respondPool(String(sql)));
  });

  it('copies the member geometry for a region that is exactly one division', async () => {
    const req = { params: { regionId: '42' }, query: {} } as unknown as Request;
    const json = vi.fn();
    const res = { json, status: vi.fn(() => ({ json })) } as unknown as Response;

    await computeSingleRegionGeometry(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ computed: true, points: 5000 }));

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(true);
    // Same guarantee as computeRegionGeometryCore: the union machinery must not run at all.
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(false);
  });
});

/**
 * Regression test: the bulk core is the writer a world-view run goes through,
 * and it has to mark its ancestors stale the way its two siblings do.
 *
 * The run selects the regions with no geometry *and every ancestor of one*.
 * That closure is evaluated once per run, so it only keeps working while a
 * descendant is still NULL at selection time. If a parent's own union times out,
 * nothing under it is NULL any more and no later run ever selects it again --
 * North America would keep drawing 18.3 % of itself while every run reported
 * Complete (#667). Both of the core's writing exits are covered: the six-step
 * union, and the fast path that copies a single division's geometry, which
 * returns early and moved this region's outline just the same.
 */
describe('computeRegionGeometryCore marks the ancestors stale after a write (#667)', () => {
  function invalidations(): string[] {
    return poolQuery.mock.calls
      .map((c) => String(c[0]).replace(/\s+/g, ' '))
      .filter((s) => s.includes('RECURSIVE ancestors'));
  }

  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respond(String(sql)));
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('does so on the fast path, which writes and returns early', async () => {
    const result = await computeRegionGeometryCore(42);
    expect(result).toMatchObject({ computed: true });

    const [sql] = invalidations();
    expect(sql).toBeDefined();
    // The ancestors, not the region itself: it has just been computed and is right.
    expect(sql).toContain('WHERE id <> $1');
    // A user-drawn shape is not derived from its members (#283).
    expect(sql).toContain('is_custom_boundary IS NOT TRUE');
    expect(poolQuery.mock.calls.find(([s]) => String(s).includes('RECURSIVE ancestors'))?.[1]).toEqual([42]);
  });

  it('does so on the six-step union path', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '5000', child_points: '900', child_count: '3', child_row_count: '3', member_count: '4' }] };
      }
      if (s.includes('ST_Collect(geom) as collected_geom')) {
        return { rows: [{ collected_geom: 'COLLECTED', geom_count: '4' }] };
      }
      if (s.includes('union_geom')) return { rows: [{ union_geom: 'UNIONED' }] };
      if (s.includes('cleaned_geom')) return { rows: [{ cleaned_geom: 'CLEANED', num_points: '4200' }] };
      return respond(s);
    });

    const result = await computeRegionGeometryCore(42);
    expect(result).toMatchObject({ computed: true, points: 5000 });
    expect(invalidations()).toHaveLength(1);
  });

  it('does not, when there was nothing to write', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '0', child_points: '0', child_count: '0', child_row_count: '0', member_count: '0' }] };
      }
      return respond(s);
    });

    const result = await computeRegionGeometryCore(42);
    expect(result).toMatchObject({ computed: false });
    expect(invalidations()).toHaveLength(0);
  });
});

/**
 * Regression test: computing a region computes its missing descendants first,
 * and those writes must mark the tree stale on their own.
 *
 * A curator clicks Compute on a continent. computeBottomUp writes geometry to
 * every child that had none, and only then does the continent's own union run --
 * which is the expensive one, and the one that hits the 300 s timeout (#459).
 * If only the successful parent invalidated, the children's writes would have
 * consumed the very NULLs the run's closure seeds on: the continent would keep
 * its stale outline with nothing NULL beneath it, and no later run would select
 * it again. The curator's attempt to repair #667 would be what makes it
 * unreachable.
 */
describe('a descendant computed on the way to its parent marks the tree stale even when the parent fails (#667)', () => {
  const PARENT = 42;
  const CHILD = 99;

  beforeEach(() => {
    client.query.mockReset();
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('uses_hull as "usesHull"') && s.includes('is_custom_boundary')) {
        return { rows: [{ is_custom_boundary: false, name: 'North America', usesHull: false, has_geom: true }] };
      }
      if (s.includes('has_geom') && s.includes('parent_region_id = $1')) {
        // computeBottomUp's lookup: one child without geometry under the
        // continent, and nothing under the child.
        const rows = params?.[0] === PARENT ? [{ id: CHILD, is_custom_boundary: false, has_geom: false }] : [];
        return { rows };
      }
      return { rows: [], rowCount: 0 };
    });
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      const id = Array.isArray(params) ? params[0] : undefined;
      if (s.includes('member_points')) {
        return id === CHILD
          ? { rows: [{ member_points: '5000', child_points: '0', child_count: '0', child_row_count: '0', member_count: '1' }] }
          : { rows: [{ member_points: '900000', child_points: '900000', child_count: '4', child_row_count: '4', member_count: '9' }] };
      }
      if (s.includes('UPDATE regions') && s.includes('region_members')) {
        return { rows: [{ points: 5000 }], rowCount: 1 };
      }
      if (s.includes('ST_Collect')) {
        throw new Error('canceling statement due to statement timeout');
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('invalidates from the child that succeeded, not only from a parent that did not', async () => {
    const req = { params: { regionId: String(PARENT) }, query: {} } as unknown as Request;
    const json = vi.fn();
    const res = { json, status: vi.fn(() => ({ json })) } as unknown as Response;

    await computeSingleRegionGeometry(req, res);

    const invalidatedFor = poolQuery.mock.calls
      .filter(([sql]) => String(sql).includes('RECURSIVE ancestors'))
      .map(([, params]) => (params as unknown[])[0]);

    // The child's own write did it, which is what re-seeds the closure.
    expect(invalidatedFor).toContain(CHILD);
    // The continent's union failed, so it wrote nothing and invalidated nothing.
    expect(invalidatedFor).not.toContain(PARENT);
  });
});

/**
 * Regression test: a failed invalidation must not be downgraded into the soft
 * result this function answers a failed *pipeline* with.
 *
 * The two are opposite states. A pipeline that fails wrote nothing, so the
 * region stays NULL and the next run takes it — `{ computed: false, error }` is
 * the right answer, and `computeOneGroup` tallying it as *skipped* with the run
 * reporting Complete is right too. An invalidation fails after the geometry
 * `UPDATE` has committed, so the region is fine and the tree above it is
 * silently wrong for good; answering that the same way would hand back exactly
 * the state raising exists to prevent, with the run reporting Complete (#667).
 * Both writing exits are covered — the six-step union and the fast path, which
 * invalidates from inside `computeSingleMemberFastPath`.
 */
describe('computeRegionGeometryCore does not downgrade a failed invalidation (#667)', () => {
  beforeEach(() => {
    client.query.mockReset();
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('RECURSIVE ancestors')) throw new Error('deadlock detected');
      return { rows: [], rowCount: 0 };
    });
  });

  it('rethrows on the fast path, so the run counts an error rather than a skip', async () => {
    client.query.mockImplementation(async (sql: string) => respond(String(sql)));

    await expect(computeRegionGeometryCore(42)).rejects.toThrow('could not be marked stale');
  });

  it('rethrows on the six-step union path', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '5000', child_points: '900', child_count: '3', child_row_count: '3', member_count: '4' }] };
      }
      if (s.includes('ST_Collect(geom) as collected_geom')) return { rows: [{ collected_geom: 'C', geom_count: '4' }] };
      if (s.includes('union_geom')) return { rows: [{ union_geom: 'U' }] };
      if (s.includes('cleaned_geom')) return { rows: [{ cleaned_geom: 'X', num_points: '4200' }] };
      return respond(s);
    });

    await expect(computeRegionGeometryCore(42)).rejects.toThrow('could not be marked stale');
  });

  it('still answers softly when the pipeline itself failed, since nothing was written', async () => {
    client.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('member_points')) {
        return { rows: [{ member_points: '900000', child_points: '900000', child_count: '4', child_row_count: '4', member_count: '9' }] };
      }
      if (s.includes('ST_Collect')) throw new Error('canceling statement due to statement timeout');
      return respond(s);
    });

    const result = await computeRegionGeometryCore(42);
    expect(result).toMatchObject({ computed: false });
    expect(result.error).toContain('statement timeout');
  });
});
