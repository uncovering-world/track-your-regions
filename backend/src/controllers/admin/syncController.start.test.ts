/**
 * A run that created a place another source already holds as the same
 * Wikidata item is followed by the merge (#1247, ADR-0046 decision 2): the
 * Places of worship run that brings the Pantheon (Q99309) beside the
 * archaeological site of the same item makes them one place once it is over.
 * However the run ended; a preview created nothing and merges nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  rollbackQuietly: vi.fn(),
}));
vi.mock('../../services/sync/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/index.js')>()),
  syncPlacesOfWorship: vi.fn(),
}));
vi.mock('../experience/equalItemMerges.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../experience/equalItemMerges.js')>()),
  mergeArrivalsOfRun: vi.fn(async () => null),
}));

import { pool } from '../../db/index.js';
import { runningSyncs, syncPlacesOfWorship } from '../../services/sync/index.js';
import { mergeArrivalsOfRun } from '../experience/equalItemMerges.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

const startRoute = routeAt(adminDeclaredRoutes, '/sync/sources/:sourceId/start', 'post');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedSync = syncPlacesOfWorship as unknown as ReturnType<typeof vi.fn>;
const mockedMerge = mergeArrivalsOfRun as unknown as ReturnType<typeof vi.fn>;

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

describe('a run is followed by the merge of what it created', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedSync.mockReset();
    mockedMerge.mockClear();
    runningSyncs.clear();
  });

  it('merges the places the run created, by its log', async () => {
    runEndsAs({ logId: 812, dryRun: false });

    await start(false);

    await vi.waitFor(() => expect(mockedMerge).toHaveBeenCalledWith(812));
  });

  it('merges nothing after a preview', async () => {
    runEndsAs({ logId: 813, dryRun: true });

    await start(true);

    await vi.waitFor(() => expect(mockedSync).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockedMerge).not.toHaveBeenCalled();
  });

  it('merges what a run created before it failed', async () => {
    // A run that stopped half-way wrote the places it had created, and its
    // changeset names them; leaving them a second pin helps nobody.
    mockedSync.mockImplementation(async () => {
      runningSyncs.set(4, { logId: 814, dryRun: false, status: 'failed', cancel: false } as never);
      throw new Error('the source did not answer');
    });

    await start(false);

    await vi.waitFor(() => expect(mockedMerge).toHaveBeenCalledWith(814));
  });
});
