/**
 * The map's read of the open questions (#2477): the list's questions under the
 * list's chips, grouped by place, with no page.
 *
 * The pool is a mock, so these read the statement rather than its answer, as
 * `reviewQueueKeys.test.ts` does for the list; what a mock cannot see is
 * `reviewQueueMembership.db.test.ts`'s, which runs the read on PostgreSQL.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../../services/authService.js', () => ({
  verifyAccessToken: vi.fn(),
  updateUserLastSeen: vi.fn().mockResolvedValue(undefined),
}));

import { pool } from '../../db/index.js';
import { verifyAccessToken } from '../../services/authService.js';
import { routerOf } from '../../api/route.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { experienceCurationRoutes } from '../../routes/experienceRoutes.js';
import { queryQueueKeys, type QueueSelection } from './reviewQueueKeys.js';
import { queryQueueMap } from './reviewQueueMapController.js';

const getMap = routeAt(experienceCurationRoutes, '/review/queue/map', 'get');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedVerify = verifyAccessToken as unknown as ReturnType<typeof vi.fn>;

/** Every chip the queue has, set at once. */
const EVERY_CHIP: QueueSelection = {
  q: '100% Rome', sourceIds: [4, 6], kinds: ['conflict', 'arrival'], regionId: 6737, runId: 430, showAside: true,
};

/** The Pantheon and the Colosseum, as the statement's one row hands them over. */
const ROME = [
  { placeId: 1201, lon: 12.4768, lat: 41.8986, questions: [{ kind: 'waiting', subs: ['arrival', 'held'] }] },
  {
    placeId: 1388, lon: 12.4922, lat: 41.8902,
    questions: [{ kind: 'conflict', subs: [] }, { kind: 'sources', subs: [] }, { kind: 'waiting', subs: ['contents'] }],
  },
];

function call(n = 0): [string, unknown[]] {
  const c = mockedQuery.mock.calls[n];
  if (!c) throw new Error(`statement ${n} was never sent`);
  return [String(c[0]), c[1] as unknown[]];
}

/** What a handler's spec answers into, with the body it was sent. */
function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedVerify.mockReset();
});

describe('the map reads the questions the list reads', () => {
  it('opens on the same union, scope and chips, bound to the same values', async () => {
    mockedQuery.mockResolvedValue({ rows: [{}] });
    await queryQueueKeys({ userId: 7, isAdmin: false, filters: { ...EVERY_CHIP, sort: 'date', limit: 25 } });
    await queryQueueMap({ userId: 7, isAdmin: false, selection: EVERY_CHIP });
    const [list, listParams] = call(0);
    const [map, mapParams] = call(1);

    const opening = map.slice(0, map.indexOf('\n, selected AS ('));
    expect(opening).toContain('scoped AS (');
    expect(opening).toContain('region_subtree AS (');
    expect(list.startsWith(opening)).toBe(true);
    // The list binds its facets' region and its page after the chips; the chips' values are the same, in the same places.
    expect(listParams.slice(0, mapParams.length)).toEqual(mapParams);
    expect(listParams).toHaveLength(mapParams.length + 2);

    // The chips' predicate over the scoped keys is the list page's, word for word.
    const where = map.slice(map.indexOf('FROM scoped k\n    WHERE ') + 'FROM scoped k\n    WHERE '.length, map.indexOf('\n  )\n, placed AS'));
    expect(where).toContain('k.source_ids && ');
    expect(where).toContain("k.kind = 'waiting' AND k.subs && ");
    expect(where).toContain('JOIN region_subtree rs');
    expect(where).toContain('k.run_id = ');
    expect(list).toContain(`WHERE ${where} AND `);
    expect(mapParams).toEqual(expect.arrayContaining(['%100\\% Rome%', [4, 6], ['conflict'], ['arrival'], 6737, 430]));
  });

  it('binds no parameter its statement does not reference, under any one chip or all of them', async () => {
    const selections: QueueSelection[] = [
      {}, { regionId: 6737 }, { regionId: 'none' }, { runId: 430 }, { q: 'Rome' }, { sourceIds: [4] },
      { kinds: ['arrival'] }, { regionId: 6737, runId: 430 }, { regionId: 6737, q: 'Rome' }, EVERY_CHIP,
    ];
    mockedQuery.mockResolvedValue({ rows: [{}] });
    for (const [i, selection] of selections.entries()) {
      await queryQueueMap({ userId: 7, isAdmin: false, selection });
      const [sql, params] = call(i);
      const referenced = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      // Postgres refuses a statement sent a parameter no expression uses.
      expect([...referenced].sort((a, b) => a - b)).toEqual(params.map((_, n) => n + 1));
    }
  });

  it('hides a set-aside batch unless asked, as the list does', async () => {
    mockedQuery.mockResolvedValue({ rows: [{}] });
    await queryQueueMap({ userId: 7, isAdmin: false, selection: {} });
    await queryQueueMap({ userId: 7, isAdmin: false, selection: { showAside: true } });
    expect(call(0)[0]).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM curator_queue_set_aside/);
    expect(call(1)[0]).not.toMatch(/NOT EXISTS \(\s*SELECT 1 FROM curator_queue_set_aside/);
  });

  it("parses the request's chips as the list does, dropping what it cannot hold", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ places: [], unplaced: 0 }] });
    await answerRoute(getMap, {
      user: { id: 7, role: 'curator' } as Express.User,
      query: { source: '4,99999999999', kind: 'arrival,bogus', region: 'none', aside: 'show' },
    }, response());
    const [sql, params] = call(0);
    expect(params).toContainEqual([4]);
    expect(params).toContainEqual(['arrival']);
    expect(params).not.toContain('bogus');
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM experience_regions er WHERE er.experience_id = k.id)');
    expect(sql).not.toMatch(/NOT EXISTS \(\s*SELECT 1 FROM curator_queue_set_aside/);
  });

  it('takes no page, no order and no cursor', async () => {
    const res = response();
    await expect(answerRoute(getMap, { user: { id: 7, role: 'curator' } as Express.User, query: { limit: '25' } }, res))
      .rejects.toThrow();
    mockedQuery.mockResolvedValue({ rows: [{}] });
    await queryQueueMap({ userId: 7, isAdmin: false, selection: {} });
    // The union's own subqueries pick one row here and there; what follows it pages nothing.
    const [sql] = call(0);
    expect(sql.slice(sql.indexOf('\n, selected AS ('))).not.toMatch(/\bLIMIT\b|\bOFFSET\b/);
    expect(sql).not.toContain('page_rows');
  });
});

describe('one entry per place', () => {
  it('groups the questions by their place, in the class order, with the point', async () => {
    mockedQuery.mockResolvedValue({ rows: [{}] });
    await queryQueueMap({ userId: 7, isAdmin: true, selection: {} });
    const [sql] = call(0);
    expect(sql).toContain("json_agg(json_build_object('kind', s.kind, 'subs', s.subs) ORDER BY s.rank) AS questions");
    expect(sql).toContain('JOIN experiences e ON e.id = s.id');
    expect(sql).toMatch(/GROUP BY e\.id\s/);
    expect(sql).toContain('round(ST_X(e.location)::numeric, 5) AS lon, round(ST_Y(e.location)::numeric, 5) AS lat');
  });

  it("answers the statement's places as they are, held to the schema", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ places: ROME, unplaced: 0 }] });
    const res = response();
    await answerRoute(getMap, { user: { id: 7, role: 'curator' } as Express.User, query: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ places: ROME, unplaced: 0 });
  });
});

describe('the questions with no point', () => {
  it('counts a selected question whose place has no point to draw', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ places: ROME, unplaced: 2 }] });
    const map = await queryQueueMap({ userId: 7, isAdmin: true, selection: {} });
    expect(map.unplaced).toBe(2);
    const [sql] = call(0);
    expect(sql).toContain('WHERE e.location IS NOT NULL');
    expect(sql).toMatch(/count\(\*\)::int FROM selected s\s+WHERE NOT EXISTS \(SELECT 1 FROM placed p WHERE p\.id = s\.id\)\) AS unplaced/);
  });

  it('answers an empty map when nothing is selected', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ places: null, unplaced: null }] });
    expect(await queryQueueMap({ userId: 7, isAdmin: true, selection: {} })).toEqual({ places: [], unplaced: 0 });
  });
});

describe('the scope', () => {
  it('scopes a curator by the rows they may answer, and not an admin', async () => {
    mockedQuery.mockResolvedValue({ rows: [{}] });
    await queryQueueMap({ userId: 7, isAdmin: false, selection: {} });
    await queryQueueMap({ userId: 7, isAdmin: true, selection: {} });
    expect(call(0)[0]).toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');
    expect(call(0)[1][0]).toBe(7);
    expect(call(1)[0]).not.toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');
  });

  it("reads the caller's own id and role, never the request's", async () => {
    mockedQuery.mockResolvedValue({ rows: [{}] });
    await answerRoute(getMap, { user: { id: 31, role: 'admin' } as Express.User, query: {} }, response());
    expect(call(0)[1][0]).toBe(31);
    expect(call(0)[0]).not.toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');
  });
});

describe('who may read it', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.disable('x-powered-by');
    app.use(routerOf([getMap]));
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const get = (token?: string): Promise<number | undefined> => new Promise((resolve, reject) => {
    const req = request({
      port, path: '/review/queue/map', method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {},
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

  it('refuses a reader who is not a curator, and one with no token, before any statement', async () => {
    expect(getMap.access).toBe('curator');
    mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role: 'user' });
    expect(await get('t')).toBe(403);
    expect(await get()).toBe(401);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('answers a curator', async () => {
    mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role: 'curator' });
    mockedQuery.mockResolvedValue({ rows: [{ places: ROME, unplaced: 0 }] });
    expect(await get('t')).toBe(200);
  });
});
