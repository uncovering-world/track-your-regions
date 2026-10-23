/**
 * Tests for starting a run of a source that shares its gather with others
 * (ADR-0132): the start runs the whole pass, is refused while any source of it
 * is running, and pairs what each of its runs created.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  rollbackQuietly: vi.fn(),
}));
vi.mock('../../services/sync/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/index.js')>()),
  syncPlacePass: vi.fn(async () => undefined),
}));
// A pass of two sources, as the Public Art split will make it (#1807).
vi.mock('../../services/sync/passes.js', () => ({
  passOf: (sourceId: number) => ([3, 6].includes(sourceId) ? [3, 6] : [sourceId]),
}));
vi.mock('../../services/sync/mergeProposalFinder.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/mergeProposalFinder.js')>()),
  proposeMergesOfRun: vi.fn(async () => undefined),
}));
vi.mock('../experience/equalItemMerges.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../experience/equalItemMerges.js')>()),
  joinPlacesClaimingOneItem: vi.fn(async () => ({ merged: [], refused: [] })),
}));

import { pool } from '../../db/index.js';
import { runningSyncs, syncPlacePass } from '../../services/sync/index.js';
import { proposeMergesOfRun } from '../../services/sync/mergeProposalFinder.js';
import { joinPlacesClaimingOneItem } from '../experience/equalItemMerges.js';
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
    vi.mocked(syncPlacePass).mockClear();
    vi.mocked(proposeMergesOfRun).mockClear();
    vi.mocked(joinPlacesClaimingOneItem).mockClear();
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
    expect(syncPlacePass).not.toHaveBeenCalled();
  });

  it('refuses a pass one of whose sources is switched off, or reads another copy of Wikidata (#1820)', async () => {
    const both = (six: Record<string, unknown>) => ({
      rows: [
        { id: 3, name: 'Public art', is_active: true, wikidata_reader: 'subset' },
        { id: 6, name: 'Monuments & memorials', is_active: true, wikidata_reader: 'subset', ...six },
      ],
    });
    const refusal = async (six: Record<string, unknown>) => {
      mockedQuery.mockResolvedValueOnce(both(six));
      const res = makeRes();
      await answerRoute(startRoute, request(3) as never, res as never);
      expect(res.status).toHaveBeenCalledWith(400);
      return (res.json.mock.calls[0][0] as { error: string }).error;
    };

    expect(await refusal({ is_active: false })).toMatch(/Monuments & memorials runs in one pass with this source and is not active/);
    expect(await refusal({ wikidata_reader: 'live' })).toMatch(/read different copies of Wikidata \(Public art: local subset, Monuments & memorials: live service\)/);
    expect(syncPlacePass).not.toHaveBeenCalled();

    mockedQuery.mockResolvedValueOnce(both({}));
    await answerRoute(startRoute, request(3) as never, makeRes() as never);
    expect(syncPlacePass).toHaveBeenCalled();
  });

  it('joins once for the pass, then pairs the places every run of it created', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, name: 'Public art', is_active: true }] });
    vi.mocked(syncPlacePass).mockImplementationOnce(async () => {
      runningSyncs.set(3, { kind: 'sync', status: 'complete', dryRun: false, logId: 101 } as never);
      runningSyncs.set(6, { kind: 'sync', status: 'complete', dryRun: false, logId: 102 } as never);
    });
    const res = makeRes();

    await answerRoute(startRoute, request(3) as never, res as never);
    await vi.waitFor(() => expect(proposeMergesOfRun).toHaveBeenCalledTimes(2));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ started: true }));
    // The join reads the whole registry, so one for the pass, before the pairing.
    expect(joinPlacesClaimingOneItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(joinPlacesClaimingOneItem).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(proposeMergesOfRun).mock.invocationCallOrder[0]);
    expect(vi.mocked(proposeMergesOfRun).mock.calls.map((call) => call[0])).toEqual([101, 102]);
  });

  it('pairs a later run\'s arrivals even when its entry goes while an earlier pass runs', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3, name: 'Public art', is_active: true }] });
    vi.mocked(syncPlacePass).mockImplementationOnce(async () => {
      runningSyncs.set(3, { kind: 'sync', status: 'complete', dryRun: false, logId: 101 } as never);
      runningSyncs.set(6, { kind: 'sync', status: 'complete', dryRun: false, logId: 102 } as never);
    });
    // The first pass outlasts the release timers.
    vi.mocked(proposeMergesOfRun).mockImplementationOnce(async () => { runningSyncs.delete(6); return null; });

    await answerRoute(startRoute, request(3) as never, makeRes() as never);
    await vi.waitFor(() => expect(proposeMergesOfRun).toHaveBeenCalledTimes(2));

    expect(vi.mocked(proposeMergesOfRun).mock.calls.map((call) => call[0])).toEqual([101, 102]);
  });
});
