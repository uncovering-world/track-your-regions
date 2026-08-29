import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('../../services/authService.js', () => ({
  verifyAccessToken: vi.fn(),
  updateUserLastSeen: vi.fn().mockResolvedValue(undefined),
}));

import { pool } from '../../db/index.js';
import { verifyAccessToken } from '../../services/authService.js';
import { requireAuth } from '../../middleware/auth.js';
import { authenticatedLimiter } from '../../middleware/rateLimiter.js';
import { getGeometry, getSubdivisionGeometries, getRootGeometries } from './divisionGeometry.js';
import { getGeoshape } from '../admin/wvImportLifecycleController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedVerify = verifyAccessToken as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = { setHeader: vi.fn(), json: vi.fn(), status: vi.fn(), send: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

/**
 * These three reads carry GADM's boundaries — the same shapes for every
 * caller, at full resolution — and sit behind `requireAuth` + `requireAdmin`
 * only because the editor is the one that asks. `requireAuth` marks a
 * response `no-store`, which is right for a caller's own data and wrong for
 * these: it would re-download megabytes on every dialog open, where the
 * browser answers `304` today (#710).
 */
describe('division geometry reads keep the browser its revalidation', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('sets private, no-cache on a division geometry, rows or none', async () => {
    for (const rows of [[{ geometry: { type: 'Polygon', coordinates: [] } }], []]) {
      mockedQuery.mockResolvedValueOnce({ rows });
      const res = makeRes();
      await getGeometry({ params: { divisionId: '1' }, query: {} } as never, res as never);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
    }
  });

  it('sets it on the subdivision collection too', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 2, name: 'x', has_children: false, geometry: {} }] });
    const res = makeRes();
    await getSubdivisionGeometries({ params: { divisionId: '1' }, query: {} } as never, res as never);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });

  it('and on the root collection, which is the whole world', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, name: 'Europe', has_children: true, geometry: {} }] });
    const res = makeRes();
    await getRootGeometries({ params: {}, query: {} } as never, res as never);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });
});

describe('the geoshape proxy answers the same way', () => {
  // Wikimedia's boundary for a Wikidata id is the same bytes for every caller,
  // admin-gated because the editor is the one that asks — the sibling case to
  // the three above, and the one the first round of this rule missed.
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('marks a cached geoshape private, no-cache', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ geometry: { type: 'Polygon', coordinates: [] } }] });
    const res = makeRes();
    await getGeoshape({ params: { wikidataId: 'Q142' } } as never, res as never);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
  });
});

describe('the relaxation wins over requireAuth on the wire', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role: 'admin' });
    const app = express();
    app.disable('x-powered-by');
    // The chain as routes/index.ts wires it: identity first, then the
    // handler. `setHeader` replaces, so the handler's value is what ships —
    // asserting it on the wire is the only way to hold that, since a unit
    // call never sees the middleware's header at all.
    app.get('/geometry', authenticatedLimiter, requireAuth, getGeometry);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('answers private, no-cache, not the middleware\'s no-store', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ geometry: { type: 'Polygon', coordinates: [] } }] });

    const headers = await new Promise<Record<string, string | string[] | undefined>>((resolve, reject) => {
      const req = request(
        { port, path: '/geometry?divisionId=1', method: 'GET', headers: { authorization: 'Bearer x' } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(headers['cache-control']).toBe('private, no-cache');
    // The Vary the middleware appended survives — only Cache-Control was
    // replaced, and a private cache still keys the entry on the caller.
    expect(String(headers.vary).toLowerCase()).toContain('authorization');
  });
});
