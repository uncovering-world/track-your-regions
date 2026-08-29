import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('../services/authService.js', () => ({
  verifyAccessToken: vi.fn(),
  updateUserLastSeen: vi.fn().mockResolvedValue(undefined),
}));

import { verifyAccessToken } from '../services/authService.js';
import { optionalAuth, requireAuth } from './auth.js';
import { publicReadLimiter, authenticatedLimiter } from './rateLimiter.js';

const mockedVerify = verifyAccessToken as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = { setHeader: vi.fn(), vary: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function headersOf(port: number, path: string, headers: Record<string, string>): Promise<Record<string, string | string[] | undefined>> {
  return new Promise((resolve, reject) => {
    const req = request({ port, path, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.headers));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * `optionalAuth` is the middleware that puts an identity on the request, and a
 * handler behind it reads that identity to shape its answer — that is the only
 * reason to use it rather than nothing. So it is the place that knows the
 * response is private to its caller, and the place that says so in the
 * headers: a route added tomorrow gets the rule by carrying the middleware,
 * not by remembering an inline block (#597).
 */
describe('optionalAuth marks the response private to its caller', () => {
  beforeEach(() => {
    mockedVerify.mockReset();
  });

  it('forbids a shared cache and keys the private one on the caller, for an anonymous request', () => {
    // Express sends an ETag and `Vary: Origin` by default and says nothing
    // about who asked. That is enough for a proxy or CDN to store an admin's
    // or a curator's answer under the URL alone and hand it to a visitor.
    const res = makeRes();
    const next = vi.fn();
    optionalAuth({ headers: {} } as never, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
    // vary() rather than setHeader('Vary'): CORS has already put Origin there,
    // and setHeader would replace it instead of adding to it.
    expect(res.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('says the same for a token-bearing request, whether or not the token verifies', () => {
    // The anonymous answer is one variant of a caller-shaped body too: stored
    // under the URL alone it would be served to an admin. Both variants carry
    // the same headers, so a cache never has to tell them apart.
    for (const payload of [null, { sub: 7, uuid: 'u', role: 'curator' }]) {
      mockedVerify.mockReturnValue(payload);
      const res = makeRes();
      const next = vi.fn();
      const req = { headers: { authorization: 'Bearer x' } } as never;
      optionalAuth(req, res as never, next);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
      expect(res.vary).toHaveBeenCalledWith('Authorization');
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps revalidation open: no-cache, not no-store', () => {
    // `private` alone forbids the shared cache the issue is about. `no-cache`
    // leaves the browser its ETag round-trip — measured on the dev stack, a
    // region's list, its locations and its geometry all answer 304 today,
    // ~865 kB gzipped for Europe that `no-store` would re-download on every
    // reload — and the origin answers each revalidation for the *current*
    // caller, so a stored variant can never be served to the wrong one.
    const res = makeRes();
    optionalAuth({ headers: {} } as never, res as never, vi.fn());

    const [, value] = res.setHeader.mock.calls.find(([name]) => name === 'Cache-Control') ?? [];
    expect(value).not.toMatch(/no-store/);
  });
});

describe('optionalAuth on the wire', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    // helmet does this for the real app; this one has no helmet.
    app.disable('x-powered-by');
    app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
    // The chain as the route files wire it: limiter, then identity, then
    // the handler. CodeQL's missing-rate-limiting query reads a route that
    // authorizes without a limiter ahead of it as a finding, fixture or not.
    app.get('/read', publicReadLimiter, optionalAuth, (_req, res) => {
      res.json({ ok: true });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('composes with the Vary CORS already wrote rather than replacing it', async () => {
    // A cache keyed on Authorization but not Origin, or the other way round,
    // is the failure both headers exist to prevent; the test holds the two
    // together on a real response, where `res.vary`'s append is what matters.
    const headers = await headersOf(port, '/read', { origin: 'http://localhost:5173' });

    expect(headers['cache-control']).toBe('private, no-cache');
    const vary = String(headers.vary).split(',').map((v) => v.trim().toLowerCase());
    expect(vary).toContain('origin');
    expect(vary).toContain('authorization');
  });
});

/**
 * `requireAuth` is the other half of the same rule (#710). What it fronts is
 * the caller's own data — visited regions and experiences, a profile with its
 * email, an admin's or a curator's screen — which `docs/security/asvs-checklist.yaml`
 * V14.2.1 classifies as sensitive. A shared cache is kept out of most of it by
 * RFC 9111 § 3.5, since the access token travels in `Authorization` — but not
 * of the callers that cannot send a header — the streams `EventSource` opens
 * and the three admin images loaded as `<img src>` — whose token rides in the
 * query string instead; `private` is what forbids it there. The browser's own cache is kept out by
 * neither, and with Express's defaults — an ETag and no freshness —
 * it stores the body and serves it back on `304` after sign-out, on whatever
 * machine the traveller signed in from. `no-store` is what keeps it out.
 */
describe('requireAuth marks the response the caller\'s own: no-store', () => {
  beforeEach(() => {
    mockedVerify.mockReset();
  });

  it('refuses every cache, the browser\'s included, for a bearer token that verifies', () => {
    mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role: 'user' });
    const res = makeRes();
    const next = vi.fn();
    requireAuth({ headers: { authorization: 'Bearer x' }, query: {} } as never, res as never, next);

    // `no-store`, not `no-cache`: optionalAuth keeps the revalidation
    // round-trip because its bodies are public data and large. These are
    // one reader's own and small — an id list, a profile — and a 304 here
    // is the history served from disk.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('says the same for the SSE shape, where the token rides in the query string', () => {
    mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role: 'admin' });
    const res = makeRes();
    const next = vi.fn();
    requireAuth({ headers: {}, query: { token: 'x' } } as never, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('marks the 401 too, whether the token is missing or does not verify', () => {
    // The header goes on before the token is read, so no path out of the
    // middleware answers with Express's defaults — the rule is the
    // middleware's, not the happy path's.
    mockedVerify.mockReturnValue(null);
    for (const req of [{ headers: {}, query: {} }, { headers: { authorization: 'Bearer bad' }, query: {} }]) {
      const res = makeRes();
      const next = vi.fn();
      requireAuth(req as never, res as never, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
      expect(res.vary).toHaveBeenCalledWith('Authorization');
      expect(next).not.toHaveBeenCalled();
    }
  });
});

describe('requireAuth on the wire', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role: 'user' });
    const app = express();
    app.disable('x-powered-by');
    app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
    // The chain as userRoutes.ts wires it: limiter, then identity, then the
    // handler (the limiter is router-level there; inline here for CodeQL's
    // missing-rate-limiting query, which reads the route in isolation).
    app.get('/mine', authenticatedLimiter, requireAuth, (_req, res) => {
      res.json({ visited: [1, 2, 3] });
    });
    // The three SSE streams set their own Cache-Control after the middleware,
    // the way geometryComputeSSE.ts does; `setHeader` replaces, so the stream
    // keeps the `no-cache` EventSource proxies expect — and the `private`
    // beside it, since the stream's token rides in the query string and RFC
    // 9111 § 3.5 excludes nothing for a request with no Authorization header.
    app.get('/stream', authenticatedLimiter, requireAuth, (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.write('data: {}\n\n');
      res.end();
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('composes with the Vary CORS already wrote rather than replacing it', async () => {
    const headers = await headersOf(port, '/mine', { origin: 'http://localhost:5173', authorization: 'Bearer x' });

    expect(headers['cache-control']).toBe('private, no-store');
    const vary = String(headers.vary).split(',').map((v) => v.trim().toLowerCase());
    expect(vary).toContain('origin');
    expect(vary).toContain('authorization');
  });

  it('lets an SSE handler keep the value it sets after the middleware', async () => {
    const headers = await headersOf(port, '/stream', { origin: 'http://localhost:5173', authorization: 'Bearer x' });

    expect(headers['content-type']).toMatch(/^text\/event-stream/);
    expect(headers['cache-control']).toBe('private, no-cache');
  });
});
