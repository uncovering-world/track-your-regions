/**
 * The registry builds each route's middleware from its declaration, in one
 * order (ADR-0071). These run declared routes on a real Express app and read
 * the answers off the wire: the order is behaviour — a 401 before a 400, the
 * limiter before the token — and a unit call never sees it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type RequestHandler } from 'express';
import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod/v4';

vi.mock('../services/authService.js', () => ({
  verifyAccessToken: vi.fn(),
  updateUserLastSeen: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { verifyAccessToken } from '../services/authService.js';
import { pool } from '../db/index.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { defineRoute, NO_CONTENT, routerOf, shadowOf, type Route } from './route.js';

const mockedVerify = verifyAccessToken as unknown as ReturnType<typeof vi.fn>;
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const Count = z.strictObject({ n: z.number() });
const idParams = z.object({ id: z.coerce.number().int().positive() });
const handled = vi.fn();

/** The limiter the order test watches: it refuses when told to. */
let limiterRefuses = false;
const limiter: RequestHandler = (_req, res, next) => {
  if (limiterRefuses) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
};

const routes: Route[] = [
  defineRoute({
    method: 'get', path: '/public', access: 'public', cache: 'shared-revalidate', limiter,
    query: z.object({ n: z.coerce.number().default(3) }),
    response: Count,
    handler: async ({ query }) => {
      handled();
      return { n: query.n };
    },
  }),
  defineRoute({
    method: 'get', path: '/items/:id', access: 'curator', cache: 'no-store',
    params: idParams,
    response: Count,
    noContent: true,
    handler: async ({ params, caller }) => {
      handled(caller.id);
      return params.id === 404 ? NO_CONTENT : { n: params.id };
    },
  }),
  defineRoute({
    method: 'post', path: '/items', access: 'signed-in', cache: 'no-store', status: 201,
    body: z.object({ n: z.number() }),
    response: Count,
    handler: async ({ body }) => ({ n: body.n }),
  }),
  defineRoute({
    method: 'get', path: '/mine', access: 'optional', cache: 'revalidate',
    response: Count,
    handler: async ({ caller }) => ({ n: caller?.id ?? 0 }),
  }),
  defineRoute({
    method: 'get', path: '/regions/:regionId', access: 'optional', cache: 'revalidate',
    params: z.object({ regionId: z.coerce.number().int().positive() }),
    query: z.object({ worldViewId: z.coerce.number().int().positive().optional() }),
    scope: ({ params }) => ({ regionId: params.regionId }),
    response: Count,
    handler: async ({ params }) => {
      handled();
      return { n: params.regionId };
    },
  }),
  defineRoute({
    method: 'get', path: '/maybe', access: 'optional', cache: 'revalidate',
    query: z.object({ worldViewId: z.coerce.number().int().positive().optional() }),
    scope: ({ query }) => (query.worldViewId === undefined ? undefined : { worldViewId: query.worldViewId }),
    response: Count,
    handler: async () => ({ n: 1 }),
  }),
];

let server: Server;
let port: number;

beforeAll(async () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(routerOf(routes));
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  handled.mockReset();
  mockedVerify.mockReset();
  mockedQuery.mockReset();
  limiterRefuses = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

interface Answer {
  status?: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function send(method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = request({ port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : undefined }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const signedIn = (role: string) => mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role });

describe('the order the registry builds', () => {
  it('refuses a caller without a token before it reads a malformed id', async () => {
    const answer = await send('GET', '/items/abc');
    expect(answer.status).toBe(401);
    expect(handled).not.toHaveBeenCalled();
  });

  it('refuses a caller with the wrong role before it reads a malformed id', async () => {
    signedIn('user');
    expect((await send('GET', '/items/abc', { token: 't' })).status).toBe(403);
  });

  it('answers 400 for the malformed id once the caller may call the route, and never runs the handler', async () => {
    signedIn('curator');
    const answer = await send('GET', '/items/abc', { token: 't' });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: 'Validation error' });
    expect(handled).not.toHaveBeenCalled();
  });

  it('runs the limiter first, so a refused caller costs no token check', async () => {
    limiterRefuses = true;
    expect((await send('GET', '/public')).status).toBe(429);
    expect(handled).not.toHaveBeenCalled();
  });
});

describe('what the handler receives and answers', () => {
  it('hands over the parsed input, coerced and defaulted, and the caller', async () => {
    signedIn('curator');
    const answer = await send('GET', '/items/12', { token: 't' });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ n: 12 });
    expect(handled).toHaveBeenCalledWith(7);
    expect((await send('GET', '/public')).body).toEqual({ n: 3 });
  });

  it('answers 204 with no body where the handler returns NO_CONTENT', async () => {
    signedIn('admin');
    const answer = await send('GET', '/items/404', { token: 't' });
    expect(answer.status).toBe(204);
    expect(answer.body).toBeUndefined();
  });

  it('answers the declared status for a create', async () => {
    signedIn('user');
    const answer = await send('POST', '/items', { token: 't', body: { n: 5 } });
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({ n: 5 });
  });

  it('reads the token where access is optional, and answers without one', async () => {
    expect((await send('GET', '/mine')).body).toEqual({ n: 0 });
    signedIn('user');
    expect((await send('GET', '/mine', { token: 't' })).body).toEqual({ n: 7 });
  });
});

describe('the world view a route names in scope', () => {
  const visible = (isPublic: boolean) => mockedQuery.mockResolvedValueOnce({ rows: [{ is_public: isPublic }] });

  it('answers a reader where the world view is public', async () => {
    visible(true);
    const answer = await send('GET', '/regions/5');
    expect(answer.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('JOIN world_views'), [5]);
  });

  it('answers 404 to a reader where it is hidden or missing, the same for both', async () => {
    visible(false);
    const hidden = await send('GET', '/regions/5');
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const missing = await send('GET', '/regions/6');
    expect([hidden.status, missing.status]).toEqual([404, 404]);
    expect(hidden.body).toEqual(missing.body);
    expect(handled).not.toHaveBeenCalled();
  });

  it('lets an admin through without asking', async () => {
    signedIn('admin');
    expect((await send('GET', '/regions/5', { token: 't' })).status).toBe(200);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('reads the id from the parsed input, so a malformed one is a 400 and never a query', async () => {
    expect((await send('GET', '/regions/abc')).status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('passes a read that names no world view, which is an unfiltered one', async () => {
    expect((await send('GET', '/maybe')).status).toBe(200);
    expect(mockedQuery).not.toHaveBeenCalled();
    visible(true);
    expect((await send('GET', '/maybe?worldViewId=3')).status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('FROM world_views'), [3]);
  });
});

describe('the cache header each policy writes', () => {
  it.each([
    ['/public', undefined, 'public, no-cache'],
    ['/items/1', 'curator', 'private, no-store'],
    ['/mine', undefined, 'private, no-cache'],
  ])('%s says what its declaration does', async (path, role, header) => {
    if (role) signedIn(role);
    const answer = await send('GET', path, role ? { token: 't' } : {});
    expect(answer.headers['cache-control']).toBe(header);
  });

  it('keys an answer that reads the token on the caller, and one that does not on nothing', async () => {
    expect(String((await send('GET', '/mine')).headers.vary).toLowerCase()).toContain('authorization');
    expect(String((await send('GET', '/public')).headers.vary ?? '').toLowerCase()).not.toContain('authorization');
  });
});

describe('what the compiler refuses', () => {
  it('tells a public route nothing about who is calling, so a handler that shapes its answer by the caller cannot be public', () => {
    const shapedByCaller = async ({ caller }: { caller: Express.User | undefined }) => ({ n: caller ? 1 : 0 });
    expect(defineRoute({
      method: 'get', path: '/shaped', access: 'optional', cache: 'revalidate', response: Count,
      handler: shapedByCaller,
    }).access).toBe('optional');
    defineRoute({
      method: 'get', path: '/shaped', access: 'public', cache: 'shared-revalidate', response: Count,
      // @ts-expect-error -- a public route's input has no caller
      handler: shapedByCaller,
    });
  });
});

describe('what the registry refuses to build', () => {
  const route = (method: Route['method'], path: string): Route => ({
    method, path, access: 'admin', cache: 'no-store', response: Count, handler: async () => ({ n: 1 }),
  });

  it('refuses a route an earlier one shadows', () => {
    expect(() => routerOf([route('get', '/:id'), route('get', '/search')]))
      .toThrow('GET /search is never reached: /:id above it answers first');
  });

  it('builds the literal above the parameter, and the same path under another method', () => {
    expect(() => routerOf([route('get', '/search'), route('get', '/:id')])).not.toThrow();
    expect(shadowOf([route('post', '/:id')], route('get', '/search'))).toBeUndefined();
    expect(shadowOf([route('get', '/:id')], route('get', '/search/more'))).toBeUndefined();
    expect(shadowOf([route('get', '/:id/geometry')], route('get', '/root/geometry'))?.path).toBe('/:id/geometry');
  });

  it('refuses a shared cache on a route that reads a token, however the declaration was built', () => {
    expect(() => routerOf([{ ...route('get', '/x'), cache: 'shared-revalidate' }]))
      .toThrow('GET /x is admin, and its answer may not be kept by a shared cache');
  });
});
