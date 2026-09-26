import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const resetRegionToGADMRoute = routeAt(worldViewRoutes, '/regions/:regionId/geometry/reset', 'post');

const poolQuery = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));


function answer() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

const req = { params: { regionId: '42' } } as unknown as Request;

describe('resetRegionToGADM keeps a boundary drawn while it ran (#439)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
  });

  it('answers 409 when the region was drawn by hand between clearing the flag and the write', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('SET geom')) return { rows: [], rowCount: 0 };
      if (s.includes('AS drawn')) return { rows: [{ drawn: true }] };
      return { rows: [], rowCount: 1 };
    });
    const res = answer();

    await answerRoute(resetRegionToGADMRoute, req, res as unknown as Response);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'The boundary was drawn by hand while it was being reset; the drawing is kept' });
    const write = poolQuery.mock.calls.map(([sql]) => String(sql)).find((s) => s.includes('SET geom'));
    expect(write).toContain('is_custom_boundary IS NOT TRUE');
  });

  it('still answers the reset, with no points, for a region with nothing to union', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('SET geom')) return { rows: [], rowCount: 0 };
      if (s.includes('AS drawn')) return { rows: [{ drawn: false }] };
      return { rows: [], rowCount: 1 };
    });
    const res = answer();

    await answerRoute(resetRegionToGADMRoute, req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ reset: true, points: 0 });
  });
});
