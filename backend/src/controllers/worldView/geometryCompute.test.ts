/**
 * The two admin endpoints that write a region's geometry by hand.
 *
 * Both move the region's outline, so both leave every derived ancestor
 * describing a different world — the same obligation the compute paths carry,
 * and one neither of them met before #667. `resetRegionToGADM` is the sharper
 * case: it does not merely change the shape, it changes where the upward walk
 * stops, since the region goes from hand-drawn (which ends the walk) to derived.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const poolQuery = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

import { updateRegionGeometry, resetRegionToGADM } from './geometryCompute.js';

function invalidations(): unknown[][] {
  return poolQuery.mock.calls.filter(([sql]) => String(sql).includes('RECURSIVE ancestors'));
}

const GEOMETRY = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };

describe('updateRegionGeometry marks the ancestors stale after a redraw (#667)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  function call(body: Record<string, unknown>) {
    const req = { params: { regionId: '42' }, body } as unknown as Request;
    const send = vi.fn();
    const res = { status: vi.fn(() => ({ send, json: vi.fn() })), json: vi.fn() } as unknown as Response;
    return updateRegionGeometry(req, res);
  }

  it('does so on the plain redraw', async () => {
    await call({ geometry: GEOMETRY });

    const [invalidation] = invalidations();
    expect(invalidation).toBeDefined();
    expect(invalidation[1]).toEqual([42]);
    // The region keeps the shape just drawn; only what is above it is nulled.
    expect(String(invalidation[0])).toMatch(/SELECT id FROM ancestors WHERE id <> \$1/);
  });

  it('does so on the redraw that also carries a hull', async () => {
    await call({ geometry: GEOMETRY, hullGeometry: GEOMETRY });
    expect(invalidations()).toHaveLength(1);
  });

  it('does not, when the request carried no geometry', async () => {
    // The handler answers 400 before writing anything.
    await call({});
    expect(invalidations()).toHaveLength(0);
  });
});

describe('resetRegionToGADM marks the ancestors stale (#667)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
  });

  function call() {
    const req = { params: { regionId: '42' } } as unknown as Request;
    const json = vi.fn();
    const res = { json, status: vi.fn(() => ({ json })) } as unknown as Response;
    return resetRegionToGADM(req, res).then(() => json);
  }

  it('does so after the union is written', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('merged_geom')) return { rows: [{ points: 4200 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const json = await call();

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reset: true, points: 4200 }));
    expect(invalidations()).toHaveLength(1);
    expect(invalidations()[0][1]).toEqual([42]);
  });

  it('does not, when the union produced nothing to write', async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await call();

    expect(invalidations()).toHaveLength(0);
  });
});
