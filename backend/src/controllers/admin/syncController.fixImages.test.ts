/**
 * Tests for the picture-repair route.
 *
 * The repair services refuse a start of their own — by throwing before they
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

import { pool } from '../../db/index.js';
import { fixUnescoImages, runningSyncs } from '../../services/sync/index.js';
import { fixImages } from './syncController.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedRepair = fixUnescoImages as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const request = (categoryId: number) => ({ params: { categoryId: String(categoryId) }, user: { id: 7 } });

describe('fixImages', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRepair.mockClear();
    runningSyncs.clear();
  });

  it('starts the repair for a live source with nothing running', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] });
    const res = makeRes();

    await fixImages(request(1) as never, res as never);

    expect(mockedRepair).toHaveBeenCalledWith(7);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ started: true }));
  });

  it('answers 409 while a run is in flight, rather than starting nothing and saying it did', async () => {
    // The service would refuse this itself, by throwing — after the handler
    // had answered success and the panel had begun following the other run.
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] });
    runningSyncs.set(1, { cancel: false, kind: 'sync', status: 'processing' } as never);
    const res = makeRes();

    await fixImages(request(1) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockedRepair).not.toHaveBeenCalled();
  });

  it('answers 400 for a source switched off, as the button is disabled for it', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: false }] });
    const res = makeRes();

    await fixImages(request(1) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedRepair).not.toHaveBeenCalled();
  });

  it('answers 404 for a source that does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await fixImages(request(1) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedRepair).not.toHaveBeenCalled();
  });

  it('answers 400 for a source that exists and has no repair', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, is_active: true }] });
    const res = makeRes();

    await fixImages(request(3) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not implemented') }));
  });

  it('answers 404 for an unknown source before asking whether a repair exists, as startSync does', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();

    await fixImages(request(99) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
