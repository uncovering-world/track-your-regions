import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';

/**
 * Resolving an overlap is one of two actions, and each names what it needs:
 * a keep, the regions the division leaves; a split, the region split and
 * where each GADM child goes. The route's schema is a union on `action`, so
 * a request missing either is refused before a transaction opens.
 */

const { mockClientQuery, mockClientRelease, mockPoolConnect } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const clientRelease = vi.fn();
  return {
    mockClientQuery: clientQuery,
    mockClientRelease: clientRelease,
    mockPoolConnect: vi.fn(async () => ({ query: clientQuery, release: clientRelease })),
  };
});

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: mockPoolConnect },
}));

import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

/** The declared route these specs answer through (ADR-0071). */
const resolveOverlapRoute = routeAt(adminDeclaredRoutes, '/wv-import/matches/:worldViewId/resolve-overlap', 'post');

function makeRes() {
  const res = { _status: 200, _body: undefined as unknown } as {
    _status: number; _body: unknown; status: (code: number) => unknown; json: (body: unknown) => unknown;
  };
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: unknown) => { res._body = body; return res; };
  return res;
}

const request = (body: unknown) => ({ params: { worldViewId: '31' }, body });

/** The issue paths a refused request names. */
async function refusedPaths(body: unknown): Promise<string[]> {
  const error = await answerRoute(resolveOverlapRoute, request(body), makeRes()).then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(z.ZodError);
  return (error as z.ZodError).issues.map(issue => issue.path.join('.'));
}

beforeEach(() => {
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockPoolConnect.mockClear();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('resolve-overlap', () => {
  it('refuses a keep without the regions to remove the division from, before any query', async () => {
    expect(await refusedPaths({ action: 'keep', divisionId: 7, keepInRegionId: 1 })).toEqual(['removeFromRegionIds']);
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it('refuses a split without the region it splits and the assignments, before any query', async () => {
    expect(await refusedPaths({ action: 'split', divisionId: 7 })).toEqual(['splitRegionId', 'assignments']);
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it('removes the division from each named region on a keep', async () => {
    const res = makeRes();
    await answerRoute(resolveOverlapRoute, request({
      action: 'keep', divisionId: 7, keepInRegionId: 1, removeFromRegionIds: [2, 3],
    }), res);

    expect(res._body).toEqual({ success: true, action: 'keep', removed: 2 });
    const deletes = mockClientQuery.mock.calls.filter(call => /DELETE FROM region_members/.test(String(call[0])));
    expect(deletes.map(call => call[1])).toEqual([[2, 7], [3, 7]]);
  });

  it('moves the coarse division out and each GADM child to its region on a split', async () => {
    const res = makeRes();
    await answerRoute(resolveOverlapRoute, request({
      action: 'split', divisionId: 7, splitRegionId: 3,
      assignments: [{ gadmChildId: 71, targetRegionId: 3 }, { gadmChildId: 72, targetRegionId: 4 }],
    }), res);

    expect(res._body).toEqual({ success: true, action: 'split', assigned: 2 });
    const sqls = mockClientQuery.mock.calls.map(call => String(call[0]));
    expect(sqls.filter(sql => /DELETE FROM region_members/.test(sql))).toHaveLength(1);
    expect(sqls.filter(sql => /INSERT INTO region_members/.test(sql))).toHaveLength(2);
    expect(sqls.at(-1)).toBe('COMMIT');
  });
});
