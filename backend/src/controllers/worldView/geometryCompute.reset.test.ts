import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const resetRegionToGADMRoute = routeAt(worldViewRoutes, '/regions/:regionId/geometry/reset', 'post');

const clientQuery = vi.fn();
const release = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: { connect: async () => ({ query: clientQuery, release }) },
  rollbackQuietly: async () => undefined,
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

/** The statements the reset sent, in order, each as its first line of SQL. */
function statements(): string[] {
  return clientQuery.mock.calls.map(([sql]) => String(sql).trim().split('\n')[0].trim());
}

/**
 * The drawing is dropped only together with the outline that replaces it
 * (#689): clearing the flag and writing the union are one transaction, whose
 * first UPDATE holds the region's row lock until the commit.
 */
describe('resetRegionToGADM', () => {
  beforeEach(() => {
    clientQuery.mockReset();
    release.mockReset();
  });

  it('clears the drawing and writes the union in one transaction', async () => {
    clientQuery.mockImplementation(async (sql: string) =>
      (String(sql).includes('SET geom') ? { rows: [{ points: 120 }] } : { rows: [] }));
    const res = answer();

    await answerRoute(resetRegionToGADMRoute, req, res as unknown as Response);

    expect(res.body).toMatchObject({ reset: true, points: 120 });
    expect(statements()).toEqual(['BEGIN', 'UPDATE regions', 'WITH direct_member_geoms AS (', 'COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps the drawing when the union fails', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SET geom')) throw new Error('canceling statement due to statement timeout');
      return { rows: [] };
    });
    const res = answer();

    await answerRoute(resetRegionToGADMRoute, req, res as unknown as Response).catch(() => undefined);

    expect(statements()).not.toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('still answers the reset, with no points, for a region with nothing to union', async () => {
    clientQuery.mockResolvedValue({ rows: [] });
    const res = answer();

    await answerRoute(resetRegionToGADMRoute, req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ reset: true, points: 0 });
  });
});
