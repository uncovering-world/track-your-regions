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
import { routerOf } from '../../api/route.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { divisionRoutes } from '../../routes/divisionRoutes.js';
import { getGeometryQuerySchema } from '../../types/index.js';
import { getGeometry } from './divisionGeometry.js';
import { routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';
import { getGeoshape } from '../admin/wvImportLifecycleController.js';
import { ReaderFacingError } from '../../api/readerFacingError.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedVerify = verifyAccessToken as unknown as ReturnType<typeof vi.fn>;

describe('the geoshape proxy answers the same way', () => {
  // Wikimedia's boundary for a Wikidata id is the same bytes for every caller,
  // admin-gated because the editor is the one that asks — the sibling case to
  // the division geometry below, and declared with the same policy.
  it('is declared revalidate, which writes private, no-cache', () => {
    expect(routeAt(adminDeclaredRoutes, '/wv-import/geoshape/:wikidataId').cache).toBe('revalidate');
  });

  it("passes Wikimedia's failure on under its status, in a sentence production still shows", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' }));
    try {
      const refused = await getGeoshape({ params: { wikidataId: 'Q64' } }).catch((err: unknown) => err);
      expect(refused).toBeInstanceOf(ReaderFacingError);
      expect(refused).toMatchObject({ statusCode: 503, message: 'Geoshape fetch failed: Service Unavailable' });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

/**
 * GADM's boundary is the same shape for every caller, at full resolution, and
 * sits behind `admin` only because the editor is the one that asks. Its route
 * declares `revalidate`, so the browser keeps the megabytes and answers `304`
 * rather than fetching them whole on every dialog open (#710), and says so on
 * the wire for the 204 as well as the body.
 */
describe('the division geometry route keeps the browser its revalidation', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role: 'admin' });
    const app = express();
    app.disable('x-powered-by');
    app.use(routerOf(divisionRoutes));
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const get = (path: string) => new Promise<{ status?: number; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const req = request(
      { port, path, method: 'GET', headers: { authorization: 'Bearer x' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });

  it.each([
    ['a boundary', [{ geometry: { type: 'MultiPolygon', coordinates: [] } }], 200],
    ['none', [], 204],
  ])('answers private, no-cache for %s, not no-store', async (_what, rows, status) => {
    mockedQuery.mockResolvedValueOnce({ rows });

    const answer = await get('/1/geometry');

    expect(answer.status).toBe(status);
    expect(answer.headers['cache-control']).toBe('private, no-cache');
    // The Vary requireAuth appended survives: a private cache still keys the
    // entry on the caller.
    expect(String(answer.headers.vary).toLowerCase()).toContain('authorization');
  });

  it('refuses an id that is not a number before it reaches the database', async () => {
    mockedQuery.mockReset();

    const answer = await get('/abc/geometry');

    expect(answer.status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

/**
 * A division's boundary at the detail the caller asks for (#1010). France is
 * 2.9 million characters of GeoJSON in full and about 100 000 at the stored
 * simplifications a preview draws; the cutting tools store what they cut, so
 * the full shape is the default.
 */
describe('the division geometry read answers the detail it is asked for', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ geometry: { type: 'MultiPolygon', coordinates: [] } }] });
  });

  const sqlFor = async (query: Record<string, string>) => {
    await getGeometry({ params: { divisionId: 1 }, query: getGeometryQuerySchema.parse(query) });
    return String(mockedQuery.mock.calls[0][0]);
  };

  it.each([
    ['low', 'COALESCE(geom_simplified_low, geom)'],
    ['medium', 'COALESCE(geom_simplified_medium, geom)'],
  ])('reads the stored %s simplification, falling back to the full shape', async (detail, column) => {
    expect(await sqlFor({ detail })).toContain(`ST_AsGeoJSON(${column})`);
  });

  it('reads the full shape for high', async () => {
    expect(await sqlFor({ detail: 'high' })).toContain('ST_AsGeoJSON(geom)');
  });
});
