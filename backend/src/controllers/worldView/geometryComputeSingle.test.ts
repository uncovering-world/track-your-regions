import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const client = { query: vi.fn(), release: vi.fn() };
const poolQuery = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: { connect: vi.fn(async () => client), query: (...args: unknown[]) => poolQuery(...args) },
}));

import { computeRegionGeometryCore, computeSingleRegionGeometry } from './geometryComputeSingle.js';
import { UNION_SHAPE, coarseningProblems } from './unionGeomToleranceGuard.js';
import { droppedMemberProblems } from './unionKeepsMembersGuard.js';

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

/**
 * `regions.geom` is the authoritative shape every derived column is made from
 * (rule 1 of `docs/tech/geometry-columns.md`), so nothing may apply a tolerance
 * between the union and the column. The union path used to end its cleaning
 * step with `ST_SimplifyPreserveTopology(geom, 0.0001)` — roughly 11 m at the
 * equator, baked into a column no rung can recover it from, while the fast path
 * and the two smaller union writers stored the shape they had computed (#443).
 *
 * The guard binds the **sink**, not the file. Four statements of the writer can
 * put a geometry into that column — the collect step, the neighbour snap (whose
 * output replaces what the union reads), the union, the cleaning step — and the
 * write itself; each is identified by what it *is* rather than by its position,
 * and none may carry a coarsening call. Naming the sink is what makes it fail
 * for a tolerance reintroduced under another name, or moved one statement
 * earlier.
 *
 * The collect step is the single exception, and a narrow one: it legitimately
 * carries the input-side timeout guard above 300,000 points (#459), so what is
 * asserted there is that its *only* coarsening calls are the ones under
 * `CASE WHEN $2` — the bound parameter alone would say nothing about a tolerance
 * written into the `ELSE` arm.
 *
 * The rule and the whole assertion sequence live in `unionGeomToleranceGuard.ts`,
 * shared with the SSE writer's guard, so a widening reaches both writers or
 * neither.
 */
describe('the union path writes regions.geom with no tolerance of its own', () => {
  const CLEANED = { sentinel: 'cleaned-union-geometry' };

  function respondUnion(sql: string) {
    const s = String(sql);
    if (s.includes('member_points')) return { rows: [UNION_SHAPE] };
    if (s.includes('direct_member_geoms')) {
      return { rows: [{ collected_geom: { sentinel: 'collected' }, geom_count: '4' }] };
    }
    if (s.includes('ST_UnaryUnion')) {
      return { rows: [{ union_geom: { sentinel: 'unioned' } }] };
    }
    if (s.includes('holes_filtered')) {
      return {
        rows: [{
          cleaned_geom: CLEANED, holes_before: '4',
          num_polygons: '2', num_rings: '3', num_points: '7000',
        }],
      };
    }
    return respond(s);
  }

  /** Asserts the whole path from the union to the column carries no coarsening. */
  function expectNoCoarsening() {
    const calls = client.query.mock.calls as Array<[unknown, unknown[]?]>;
    expect(coarseningProblems(calls, CLEANED)).toEqual([]);
  }

  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respondUnion(String(sql)));
    poolQuery.mockReset();
    poolQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  it('stores what the cleaning step produced, and nothing on the way simplifies', async () => {
    // `skipSnapping: false` because this writer's default is to skip it, and the
    // snap is one of the statements the guard is about: its result replaces the
    // geometry the union reads, so a tolerance there reaches the column. The
    // default-skip path is covered by the fall-through cases above.
    await computeRegionGeometryCore(42, { skipSnapping: false });
    expectNoCoarsening();
  });

  it('holds the same for the HTTP handler, which reaches the union through computeGroupGeom', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('is_custom_boundary') && s.includes('uses_hull')) {
        return { rows: [{ is_custom_boundary: false, name: 'Bavaria', usesHull: false, has_geom: false }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const req = { params: { regionId: '42' }, query: {} } as unknown as Request;
    const json = vi.fn();
    const res = { json, status: vi.fn(() => ({ json })) } as unknown as Response;
    await computeSingleRegionGeometry(req, res);

    expectNoCoarsening();
  });
});

/**
 * The collect step gathers two kinds of shape — the region's direct members and
 * its child regions — and the neighbour snap that may run before the union
 * reads only the second. Its result was assigned straight back over the
 * collected geometry, so on a region holding both, the members' territory never
 * reached the union: Andorra stored 439.3 km² of its member division's 451.1,
 * and North America's member held 9,843,418 km² — Canada — that no child of it
 * held, because Canada's own region row had no geometry yet (#736).
 *
 * Snapping aligns the children's shared borders; it does not decide which
 * inputs the union is made of. The check is the chain, not one statement: the
 * members the collect step gathered reach the snap, the snap reads them, and
 * what the snap hands back is what the union gets. It lives in
 * `unionKeepsMembersGuard.ts`, shared with the SSE writer's guard, because this
 * defect existed in three copies of one statement.
 */
describe('the snap keeps the direct members a mixed region holds', () => {
  const COLLECTED = { sentinel: 'collected-members-and-children' };
  const MEMBERS = { sentinel: 'members-only' };
  const SNAPPED = { sentinel: 'snapped-children-and-members' };
  const CLEANED = { sentinel: 'cleaned-union-geometry' };

  function respondMixed(sql: string) {
    const s = String(sql);
    if (s.includes('member_points')) return { rows: [UNION_SHAPE] };
    if (s.includes('direct_member_geoms')) {
      return { rows: [{ collected_geom: COLLECTED, member_geom: MEMBERS, geom_count: '4' }] };
    }
    if (s.includes('ST_Snap(')) {
      return {
        rows: [{
          id: 7, name: 'Encamp', neighbor_count: '2',
          original_points: '100', new_points: '104', added_points: '4',
          collected_geom: SNAPPED, total_snapped_points: '104',
        }],
      };
    }
    if (s.includes('ST_UnaryUnion')) return { rows: [{ union_geom: { sentinel: 'unioned' } }] };
    if (s.includes('holes_filtered')) {
      return {
        rows: [{
          cleaned_geom: CLEANED, holes_before: '4',
          num_polygons: '2', num_rings: '3', num_points: '7000',
        }],
      };
    }
    return respond(s);
  }

  function expectMembersKept() {
    const calls = client.query.mock.calls as Array<[unknown, unknown[]?]>;
    expect(droppedMemberProblems(calls, { memberGeom: MEMBERS, snappedGeom: SNAPPED })).toEqual([]);
  }

  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respondMixed(String(sql)));
    poolQuery.mockReset();
    poolQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  it('carries the members through the snap into the union', async () => {
    await computeRegionGeometryCore(42, { skipSnapping: false });
    expectMembersKept();
  });

  it('holds the same for the HTTP handler, which snaps whenever there are children', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('is_custom_boundary') && s.includes('uses_hull')) {
        return { rows: [{ is_custom_boundary: false, name: 'Andorra', usesHull: false, has_geom: false }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const req = { params: { regionId: '42' }, query: {} } as unknown as Request;
    const json = vi.fn();
    const res = { json, status: vi.fn(() => ({ json })) } as unknown as Response;
    await computeSingleRegionGeometry(req, res);

    expectMembersKept();
  });
});
