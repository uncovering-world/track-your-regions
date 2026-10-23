/**
 * A real run is followed by the join of the places that claim one Wikidata
 * item (ADR-0046 decision 2, ADR-0143): a World Heritage run that records on a
 * component's point the item another kind's place already is leaves two places
 * claiming it, made one once the run is over. However the run ended; a preview
 * wrote nothing and joins nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  rollbackQuietly: vi.fn(),
}));
vi.mock('../../services/sync/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/index.js')>()),
  syncPlacePass: vi.fn(),
}));
vi.mock('../experience/equalItemMerges.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../experience/equalItemMerges.js')>()),
  joinPlacesClaimingOneItem: vi.fn(async () => ({ merged: [], refused: [] })),
}));
vi.mock('../../services/sync/mergeProposalFinder.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/mergeProposalFinder.js')>()),
  proposeMergesOfRun: vi.fn(async () => null),
}));

import { pool } from '../../db/index.js';
import { runningSyncs, syncPlacePass } from '../../services/sync/index.js';
import { joinPlacesClaimingOneItem } from '../experience/equalItemMerges.js';
import { proposeMergesOfRun } from '../../services/sync/mergeProposalFinder.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

const startRoute = routeAt(adminDeclaredRoutes, '/sync/sources/:sourceId/start', 'post');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedSync = syncPlacePass as unknown as ReturnType<typeof vi.fn>;
const mockedJoin = joinPlacesClaimingOneItem as unknown as ReturnType<typeof vi.fn>;
const mockedPropose = proposeMergesOfRun as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

/** The run as the orchestrator leaves it registered once it is over. */
function runEndsAs(progress: { logId: number; dryRun: boolean }) {
  mockedSync.mockImplementation(async () => {
    runningSyncs.set(4, { ...progress, status: 'complete', cancel: false } as never);
  });
}

async function start(dryRun: boolean) {
  mockedQuery.mockResolvedValueOnce({ rows: [{ id: 4, name: 'Places of worship', is_active: true }] });
  await answerRoute(startRoute, { params: { sourceId: '4' }, body: { dryRun }, user: { id: 7 } } as never, makeRes() as never);
}

describe('a run is followed by the join of the places that claim one item', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedSync.mockReset();
    mockedJoin.mockClear();
    mockedPropose.mockClear();
    runningSyncs.clear();
  });

  it('joins once the run is over, then pairs the places the run created, by its log', async () => {
    runEndsAs({ logId: 812, dryRun: false });

    await start(false);

    await vi.waitFor(() => expect(mockedPropose).toHaveBeenCalledWith(812));
    expect(mockedJoin).toHaveBeenCalledTimes(1);
    expect(mockedJoin.mock.invocationCallOrder[0]).toBeLessThan(mockedPropose.mock.invocationCallOrder[0]);
  });

  it('joins nothing after a preview', async () => {
    runEndsAs({ logId: 813, dryRun: true });

    await start(true);

    await vi.waitFor(() => expect(mockedSync).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockedJoin).not.toHaveBeenCalled();
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it('joins what a run wrote before it failed', async () => {
    // A run that stopped half-way wrote the items it had recorded; leaving
    // two places claiming one of them helps nobody.
    mockedSync.mockImplementation(async () => {
      runningSyncs.set(4, { logId: 814, dryRun: false, status: 'failed', cancel: false } as never);
      throw new Error('the source did not answer');
    });

    await start(false);

    await vi.waitFor(() => expect(mockedJoin).toHaveBeenCalledTimes(1));
  });
});
