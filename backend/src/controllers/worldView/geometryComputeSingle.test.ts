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
 * A failed pipeline is answered softly, because it wrote nothing: the region
 * stays NULL and the next run takes it, so `{ computed: false, error }` is the
 * right answer and `computeOneGroup` tallying it as *skipped* with the run
 * reporting Complete is right with it.
 *
 * There is no second kind of failure to tell apart from it. Marking the
 * ancestors stale used to be a statement of its own here, made after the
 * geometry `UPDATE` had committed, so losing it had to be raised rather than
 * softened; since #680 the database does that work inside the `UPDATE` itself
 * (ADR-0035).
 */
describe('computeRegionGeometryCore answers a failed pipeline softly', () => {
  beforeEach(() => {
    client.query.mockReset();
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
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
