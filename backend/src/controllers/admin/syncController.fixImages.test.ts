/**
 * Tests for the picture-repair route and the component-item search, two jobs
 * that report through a source's sync status.
 *
 * The jobs refuse a start of their own — by throwing before they
 * register — but a throw lands after the handler has answered, so the route
 * has to stand at the same doors `startSync` stands at, or a press during a
 * sync is answered `started: true` and the panel follows the wrong run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  rollbackQuietly: vi.fn(),
}));
vi.mock('../../services/sync/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/index.js')>()),
  fixUnescoImages: vi.fn(async () => undefined),
  fixMuseumImages: vi.fn(async () => undefined),
}));

vi.mock('../../services/sync/componentItemJob.js', () => ({
  findUnescoComponentItems: vi.fn(async () => undefined),
}));

import { pool } from '../../db/index.js';
import { findUnescoComponentItems } from '../../services/sync/componentItemJob.js';
import { fixUnescoImages, runningSyncs } from '../../services/sync/index.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const fixImagesRoute = routeAt(adminDeclaredRoutes, '/sync/sources/:sourceId/fix-images', 'post');
const findItemsRoute = routeAt(adminDeclaredRoutes, '/sync/sources/:sourceId/find-component-items', 'post');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedRepair = fixUnescoImages as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const request = (sourceId: number) => ({ params: { sourceId: String(sourceId) }, user: { id: 7 } });

describe('fixImages', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRepair.mockClear();
    runningSyncs.clear();
  });

  it('starts the repair for a live source with nothing running', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] });
    const res = makeRes();

    await answerRoute(fixImagesRoute, request(1) as never, res as never);

    expect(mockedRepair).toHaveBeenCalledWith(7);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ started: true }));
  });

  it('answers 409 while a run is in flight, rather than starting nothing and saying it did', async () => {
    // The service would refuse this itself, by throwing — after the handler
    // had answered success and the panel had begun following the other run.
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] });
    runningSyncs.set(1, { cancel: false, kind: 'sync', status: 'processing' } as never);
    const res = makeRes();

    await answerRoute(fixImagesRoute, request(1) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockedRepair).not.toHaveBeenCalled();
  });

  it('answers 400 for a source switched off, as the button is disabled for it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: false }] });
    const res = makeRes();

    await answerRoute(fixImagesRoute, request(1) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedRepair).not.toHaveBeenCalled();
  });

  it('answers 404 for a source that does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(fixImagesRoute, request(1) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedRepair).not.toHaveBeenCalled();
  });

  it('answers 400 for a source that exists and has no repair', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, is_active: true }] });
    const res = makeRes();

    await answerRoute(fixImagesRoute, request(3) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not implemented') }));
  });

  it('answers 404 for an unknown source before asking whether a repair exists, as startSync does', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await answerRoute(fixImagesRoute, request(99) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('findComponentItems', () => {
  const mockedSearch = findUnescoComponentItems as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedSearch.mockClear();
    runningSyncs.clear();
  });

  it('starts the search for World Heritage, the source whose objects have numbered components', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] });
    const res = makeRes();

    await answerRoute(findItemsRoute, request(1) as never, res as never);

    expect(mockedSearch).toHaveBeenCalledWith(7);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ started: true }));
  });

  it('answers 409 while a run is in flight', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] });
    runningSyncs.set(1, { cancel: false, kind: 'repair', status: 'processing' } as never);
    const res = makeRes();

    await answerRoute(findItemsRoute, request(1) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('answers 400 for a source with no components to search', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 2, is_active: true }] });
    const res = makeRes();

    await answerRoute(findItemsRoute, request(2) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedSearch).not.toHaveBeenCalled();
  });
});
