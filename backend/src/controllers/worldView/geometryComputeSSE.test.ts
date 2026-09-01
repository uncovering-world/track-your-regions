import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const client = { query: vi.fn(), release: vi.fn() };
const poolQuery = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: { connect: vi.fn(async () => client), query: (...args: unknown[]) => poolQuery(...args) },
}));

vi.mock('../../services/hull/index.js', () => ({
  generateSingleHull: vi.fn(),
}));

import { computeSingleRegionGeometrySSE } from './geometryComputeSSE.js';
import { UNION_SHAPE, coarseningProblems } from './unionGeomToleranceGuard.js';
import { droppedMemberProblems } from './unionKeepsMembersGuard.js';

function respondClient(sql: string) {
  const s = String(sql);
  if (s.includes('member_points')) {
    return { rows: [{ member_points: '5000', child_points: '0', child_count: '0', child_row_count: '0', member_count: '1' }] };
  }
  if (s.includes('UPDATE regions') && s.includes('region_members')) {
    return { rows: [{ points: 5000 }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

function respondPool(sql: string) {
  const s = String(sql);
  if (s.includes('is_custom_boundary') && s.includes('uses_hull')) {
    // Initial region check.
    return { rows: [{ is_custom_boundary: false, name: 'Bavaria', has_geom: false, uses_hull: false }] };
  }
  if (s.includes('is_custom_boundary') && s.includes('parent_region_id')) {
    // precomputeMissingChildren's lookup — no children.
    return { rows: [] };
  }
  if (s.includes('focus_bbox')) {
    return { rows: [{ focus_bbox: null, anchor_point: null, world_view_id: null }] };
  }
  if (s.includes('parent_region_id FROM regions')) {
    return { rows: [{ parent_region_id: null }] };
  }
  return { rows: [], rowCount: 0 };
}

function createSSERes() {
  const chunks: string[] = [];
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { chunks.push(chunk); return true; }),
    end: vi.fn(),
  };
  return { res, chunks };
}

function parseEvents(chunks: string[]): Array<{ type: string; data?: Record<string, unknown> }> {
  return chunks.map((c) => JSON.parse(c.replace(/^data: /, '').trimEnd()));
}

// Regression test: computeSingleRegionGeometrySSE (the
// GET /geometry/compute-stream endpoint) reaches the same fast path as
// computeRegionGeometryCore and computeSingleRegionGeometry — this pins the
// third writer to agree with the other two on a single-division region.
describe('computeSingleRegionGeometrySSE reaches the same fast path', () => {
  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respondClient(String(sql)));
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => respondPool(String(sql)));
  });

  it('copies the member geometry for a region that is exactly one division', async () => {
    const req = { params: { regionId: '42' }, query: {} } as unknown as Request;
    const { res, chunks } = createSSERes();

    await computeSingleRegionGeometrySSE(req, res as unknown as Response);

    const events = parseEvents(chunks);
    const complete = events.find((e) => e.type === 'complete');
    expect(complete?.data).toMatchObject({ computed: true, points: 5000 });

    const sqls = client.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('UPDATE regions') && s.includes('region_members'))).toBe(true);
    // Same guarantee as the other two writers: the union machinery must not run at all.
    expect(sqls.some((s) => s.includes('ST_Collect'))).toBe(false);
  });
});


/**
 * The third writer of `regions.geom`, held to the same rule as the other two
 * (`geometryComputeSingle.test.ts` § the union path writes regions.geom with no
 * tolerance of its own): the authoritative geometry carries no tolerance of its
 * own, because every derived column is made from it and none can recover an
 * error baked in here (#443).
 *
 * Bound to the sink — every statement of the writer whose output can reach
 * `SET geom = validate_multipolygon($2)` — rather than to the file, and reading
 * the rule from `unionGeomToleranceGuard.ts` rather than restating it, so a
 * widening reaches this writer and the other two together.
 */
describe('the SSE union path writes regions.geom with no tolerance of its own', () => {
  const CLEANED = { sentinel: 'cleaned-union-geometry' };

  function respondUnionClient(sql: string) {
    const s = String(sql);
    if (s.includes('member_points')) return { rows: [UNION_SHAPE] };
    if (s.includes('direct_member_geoms')) {
      return { rows: [{ collected_geom: { sentinel: 'collected' }, geom_count: '4' }] };
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
    if (s.includes('UPDATE regions')) {
      return { rows: [{ points: 7000, uses_hull: false }], rowCount: 1 };
    }
    return respondClient(s);
  }

  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respondUnionClient(String(sql)));
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => respondPool(String(sql)));
  });

  it('stores what the cleaning step produced, and nothing on the way simplifies', async () => {
    const req = { params: { regionId: '42' }, query: {} } as unknown as Request;
    const { res } = createSSERes();

    await computeSingleRegionGeometrySSE(req, res as unknown as Response);

    const calls = client.query.mock.calls as Array<[unknown, unknown[]?]>;
    expect(coarseningProblems(calls, CLEANED)).toEqual([]);
  });
});

/**
 * The third writer, held to the second shared rule
 * (`geometryComputeSingle.test.ts` § the snap keeps the direct members a mixed
 * region holds): the union sees every input the collect step gathered, members
 * included, because snapping aligns the children's shared borders and does not
 * decide what the union is made of (#736).
 *
 * This writer is the one whose skip parameter the editor's checkbox sends, so
 * it is also the one an ordinary curator run reaches with snapping off — which
 * is what kept the defect quiet here while the other two carried it.
 */
describe('the SSE snap keeps the direct members a mixed region holds', () => {
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
    if (s.includes('UPDATE regions')) {
      return { rows: [{ points: 7000, uses_hull: false }], rowCount: 1 };
    }
    return respondClient(s);
  }

  beforeEach(() => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => respondMixed(String(sql)));
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => respondPool(String(sql)));
  });

  it('carries the members through the snap into the union', async () => {
    // `skipSnapping` absent: this endpoint's schema defaults it to 'false', so
    // the snap runs — the shape a caller who names no parameter gets.
    const req = { params: { regionId: '42' }, query: {} } as unknown as Request;
    const { res } = createSSERes();

    await computeSingleRegionGeometrySSE(req, res as unknown as Response);

    const calls = client.query.mock.calls as Array<[unknown, unknown[]?]>;
    expect(droppedMemberProblems(calls, { memberGeom: MEMBERS, snappedGeom: SNAPPED })).toEqual([]);
  });
});
