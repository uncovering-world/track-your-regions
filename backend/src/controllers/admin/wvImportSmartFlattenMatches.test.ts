import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * A smart flatten's automatic matches are never stored on the descendants
 * (#1097): the preview draws the shape with the divisions it would match and
 * writes nothing, and the flatten absorbs those divisions into the region in
 * the transaction that deletes the descendants, after its undo snapshot, so an
 * undo puts the descendants back as they were.
 *
 * The fixture is a region with one child, Bavaria, that has no member and whose
 * name finds one strong candidate.
 */

const { mockPoolQuery, mockClientQuery, mockPoolConnect, trigramSearch } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  return {
    mockPoolQuery: vi.fn(),
    mockClientQuery: clientQuery,
    mockPoolConnect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    trigramSearch: vi.fn(),
  };
});

vi.mock('../../db/index.js', () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
  rollbackQuietly: async (client: { query: (sql: string) => Promise<unknown> }) => {
    await client.query('ROLLBACK');
    return undefined;
  },
}));
vi.mock('../../services/worldViewImport/index.js', () => ({ matchChildrenAsCountries: vi.fn() }));
vi.mock('../../services/worldViewImport/aiMatcher.js', () => ({
  dbSearchSingleRegion: vi.fn(async () => ({ found: 0 })),
  trigramSearch,
}));
vi.mock('../../services/worldViewImport/spatialAnomalyDetector.js', () => ({
  detectAnomaliesForRegion: vi.fn(),
}));

import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

const previewRoute = routeAt(adminDeclaredRoutes, '/wv-import/matches/:worldViewId/smart-flatten/preview', 'post');
const flattenRoute = routeAt(adminDeclaredRoutes, '/wv-import/matches/:worldViewId/smart-flatten', 'post');

const GERMANY = 100;
const BAVARIA = 201;
const BAVARIA_DIVISION = 5001;

type Row = Record<string, unknown>;

/** First matching pattern wins. */
function answering(answers: Array<[RegExp, Row[]]>) {
  return async (sql: string) => {
    const hit = answers.find(([pattern]) => pattern.test(sql));
    const rows = hit ? hit[1] : [];
    return { rows, rowCount: rows.length };
  };
}

const POOL: Array<[RegExp, Row[]]> = [
  [/FROM user_visited_regions/, [{ visits: 0 }]],
  [/SELECT id, name FROM regions WHERE id = \$1 AND world_view_id/, [{ id: GERMANY, name: 'Germany' }]],
  [/WITH RECURSIVE desc_regions/, [{ id: BAVARIA, name: 'Bavaria' }]],
  [/SELECT DISTINCT region_id FROM region_members/, []],
  [/ST_Union/, [{ geojson: '{"type":"MultiPolygon","coordinates":[]}' }]],
  [/COUNT\(\*\) AS cnt/, [{ cnt: '1' }]],
];

function makeReq(): AuthenticatedRequest {
  return { params: { worldViewId: '31' }, body: { regionId: GERMANY } } as unknown as AuthenticatedRequest;
}

function makeRes(): Response & { _body?: unknown } {
  const res = {} as Response & { _body?: unknown };
  res.status = vi.fn(() => res) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => { res._body = body; return res; }) as unknown as Response['json'];
  return res;
}

/** Every statement that stores a match, on the pool or a transaction's client. */
function matchWrites(): string[] {
  return [...mockPoolQuery.mock.calls, ...mockClientQuery.mock.calls]
    .map(([sql]) => String(sql))
    .filter(sql => /INSERT INTO (region_members|region_import_state)/.test(sql));
}

beforeEach(() => {
  mockPoolQuery.mockReset().mockImplementation(answering(POOL));
  mockClientQuery.mockReset().mockImplementation(answering([
    [/FOR UPDATE OF r|SELECT id, root FROM subtree/, [{ id: BAVARIA, root: GERMANY }]],
  ]));
  trigramSearch.mockReset().mockResolvedValue([{ divisionId: BAVARIA_DIVISION, similarity: 0.9 }]);
});

describe('a smart flatten preview', () => {
  it('shows the shape with the match it would make, and stores nothing', async () => {
    const res = makeRes();
    await answerRoute(previewRoute, makeReq(), res);

    expect(res._body).toMatchObject({ blocked: false, descendants: 1, divisions: 1 });
    expect(matchWrites()).toEqual([]);
    expect(mockPoolConnect).not.toHaveBeenCalled();
    // The shape is drawn from the planned division beside the members.
    const union = mockPoolQuery.mock.calls.find(([sql]) => /ST_Union/.test(String(sql)));
    expect(union?.[1]).toEqual([[BAVARIA], [BAVARIA_DIVISION]]);
  });

  it('stores nothing when a descendant stays unmatched', async () => {
    trigramSearch.mockResolvedValue([]);
    const res = makeRes();
    await answerRoute(previewRoute, makeReq(), res);

    expect(res._body).toEqual({ blocked: true, unmatched: [{ id: BAVARIA, name: 'Bavaria' }] });
    expect(matchWrites()).toEqual([]);
  });
});

describe('a smart flatten', () => {
  it('absorbs the matched division into the region, in its transaction, and writes nothing onto the descendant', async () => {
    const res = makeRes();
    await answerRoute(flattenRoute, makeReq(), res);

    const calls = mockClientQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
    const sqls = calls.map(c => c.sql);
    const absorbed = calls.findIndex(c => /INSERT INTO region_members/.test(c.sql) && JSON.stringify(c.params) === JSON.stringify([GERMANY, BAVARIA_DIVISION]));
    expect(absorbed).toBeGreaterThan(sqls.indexOf('BEGIN'));
    // After the undo snapshot read the descendants' members, so an undo puts
    // Bavaria back with none, as it was.
    expect(absorbed).toBeGreaterThan(sqls.findIndex(sql => /SELECT region_id, division_id FROM region_members WHERE region_id = ANY/.test(sql)));
    expect(sqls).toContain('COMMIT');
    // Neither a member nor an import state is written onto the descendant.
    expect(calls.filter(c => /INSERT INTO (region_members|region_import_state)/.test(c.sql) && (c.params as unknown[])[0] === BAVARIA)).toEqual([]);
    expect(mockPoolQuery.mock.calls.map(([sql]) => String(sql)).filter(sql => /INSERT INTO/.test(sql))).toEqual([]);
  });

  it('stores nothing when it is blocked', async () => {
    trigramSearch.mockResolvedValue([]);
    const res = makeRes();
    await answerRoute(flattenRoute, makeReq(), res);

    expect(res._body).toEqual({ blocked: true, unmatched: [{ id: BAVARIA, name: 'Bavaria' }] });
    expect(matchWrites()).toEqual([]);
  });
});
