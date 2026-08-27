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

