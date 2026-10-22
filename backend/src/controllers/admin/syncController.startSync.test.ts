/**
 * Tests for starting a run of a source that shares its gather with others
 * (ADR-0132): the start runs the whole pass, is refused while any source of it
 * is running, and merges what each of its runs created.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  rollbackQuietly: vi.fn(),
}));
vi.mock('../../services/sync/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/index.js')>()),
  syncLandmarks: vi.fn(async () => undefined),
}));
// A pass of two sources, as the Public Art split will make it (#1807).
vi.mock('../../services/sync/passes.js', () => ({
  passOf: (sourceId: number) => ([3, 6].includes(sourceId) ? [3, 6] : [sourceId]),
}));
vi.mock('../experience/equalItemMerges.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../experience/equalItemMerges.js')>()),
  mergeArrivalsOfRun: vi.fn(async () => undefined),
}));
vi.mock('../../services/sync/mergeProposalFinder.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/mergeProposalFinder.js')>()),
  proposeMergesOfRun: vi.fn(async () => undefined),
}));

import { pool } from '../../db/index.js';
import { runningSyncs, syncLandmarks } from '../../services/sync/index.js';
import { mergeArrivalsOfRun } from '../experience/equalItemMerges.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

const startRoute = routeAt(adminDeclaredRoutes, '/sync/sources/:sourceId/start', 'post');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

const request = (sourceId: number) => ({ params: { sourceId: String(sourceId) }, body: {}, user: { id: 7 } });

describe('startSync for a source of a pass', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    vi.mocked(syncLandmarks).mockClear();
    vi.mocked(mergeArrivalsOfRun).mockClear();
    runningSyncs.clear();
  });

  it('answers 409 while another source of its pass is running', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, name: 'Public art', is_active: true }] });
    runningSyncs.set(6, { cancel: false, kind: 'sync', status: 'fetching' } as never);
    const res = makeRes();

    await answerRoute(startRoute, request(3) as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringMatching(/one it runs with/),
    }));
    expect(syncLandmarks).not.toHaveBeenCalled();
  });

  it('merges the places every run of the pass created', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, name: 'Public art', is_active: true }] });
    vi.mocked(syncLandmarks).mockImplementationOnce(async () => {
      runningSyncs.set(3, { kind: 'sync', status: 'complete', dryRun: false, logId: 101 } as never);
      runningSyncs.set(6, { kind: 'sync', status: 'complete', dryRun: false, logId: 102 } as never);
    });
    const res = makeRes();

    await answerRoute(startRoute, request(3) as never, res as never);
    await vi.waitFor(() => expect(mergeArrivalsOfRun).toHaveBeenCalledTimes(2));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ started: true }));
    expect(vi.mocked(mergeArrivalsOfRun).mock.calls.map((call) => call[0])).toEqual([101, 102]);
  });

  it('merges a later run\'s arrivals even when its entry goes while an earlier merge runs', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, name: 'Public art', is_active: true }] });
    vi.mocked(syncLandmarks).mockImplementationOnce(async () => {
      runningSyncs.set(3, { kind: 'sync', status: 'complete', dryRun: false, logId: 101 } as never);
      runningSyncs.set(6, { kind: 'sync', status: 'complete', dryRun: false, logId: 102 } as never);
    });
    // The first merge outlasts the pass's release timers.
    vi.mocked(mergeArrivalsOfRun).mockImplementationOnce(async () => { runningSyncs.delete(6); return null; });

    await answerRoute(startRoute, request(3) as never, makeRes() as never);
    await vi.waitFor(() => expect(mergeArrivalsOfRun).toHaveBeenCalledTimes(2));

    expect(vi.mocked(mergeArrivalsOfRun).mock.calls.map((call) => call[0])).toEqual([101, 102]);
  });
});
