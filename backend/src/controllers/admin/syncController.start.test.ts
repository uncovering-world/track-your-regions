/**
 * A start is followed by the run's after-steps (#1805, `afterRun.ts`): the
 * join of the places claiming one item, the items of the components the run
 * left without one, the near-places pairing — once the run is over, however it
 * ended. The steps themselves are `afterRun.test.ts`'s; this checks that every
 * start hands them the source and its pass, with the catalogue's own answer
 * to the exact candidates.
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
vi.mock('./afterRun.js', () => ({
  afterRun: vi.fn(async () => undefined),
}));

import { pool } from '../../db/index.js';
import { runningSyncs, syncPlacePass } from '../../services/sync/index.js';
import { afterRun } from './afterRun.js';
import { acceptExactCandidates } from '../experience/exactCandidates.js';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { adminDeclaredRoutes } from '../../routes/adminDeclaredRoutes.js';

const startRoute = routeAt(adminDeclaredRoutes, '/sync/sources/:sourceId/start', 'post');
const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedSync = syncPlacePass as unknown as ReturnType<typeof vi.fn>;
const mockedAfter = afterRun as unknown as ReturnType<typeof vi.fn>;

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

describe('a start is followed by the run\'s after-steps', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedSync.mockReset();
    mockedAfter.mockClear();
    runningSyncs.clear();
  });

  it('hands the source, its whole pass and the catalogue\'s acceptance to the steps once the run is over', async () => {
    runEndsAs({ logId: 812, dryRun: false });

    await start(false);

    await vi.waitFor(() => expect(mockedAfter).toHaveBeenCalledWith(4, expect.arrayContaining([4]), acceptExactCandidates));
    // After the run, never beside it.
    expect(mockedAfter.mock.invocationCallOrder[0]).toBeGreaterThan(mockedSync.mock.invocationCallOrder[0]);
  });

  it('hands a preview to the steps too, which find no real run to act on', async () => {
    runEndsAs({ logId: 813, dryRun: true });

    await start(true);

    await vi.waitFor(() => expect(mockedAfter).toHaveBeenCalledTimes(1));
  });

  it('runs the steps after a run that failed, over what it wrote before', async () => {
    // A run that stopped half-way wrote the places it had created and the
    // items it had recorded; leaving two places claiming one of them helps nobody.
    mockedSync.mockImplementation(async () => {
      runningSyncs.set(4, { logId: 814, dryRun: false, status: 'failed', cancel: false } as never);
      throw new Error('the source did not answer');
    });

    await start(false);

    await vi.waitFor(() => expect(mockedAfter).toHaveBeenCalledWith(4, expect.arrayContaining([4]), acceptExactCandidates));
  });
});
