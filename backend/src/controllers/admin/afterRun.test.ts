/**
 * The steps one Start Sync runs once its items are written (#1805): on the
 * entry the card still follows, in order, each counted as a step; the entries
 * kept while they go and the run's verdict standing at the end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../../services/sync/componentItemJob.js', () => ({
  runComponentItemSearch: vi.fn(async () => ({ sentence: '2 of 3 components without an item have a candidate', candidates: 2, queries: 7 })),
}));
vi.mock('../../services/sync/mergeProposalFinder.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/mergeProposalFinder.js')>()),
  drainPairing: vi.fn(async () => ({ places: 2, wholeCatalogue: false, open: 1, fromWikidata: 0 })),
}));
vi.mock('../../services/sync/componentItemFinder.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sync/componentItemFinder.js')>()),
  heldSubset: vi.fn(async () => ({ dumpDate: '2026-10-05' })),
}));
vi.mock('../experience/equalItemMerges.js', () => ({
  joinPlacesClaimingOneItem: vi.fn(async () => ({ merged: [], refused: [] })),
}));

import { pool } from '../../db/index.js';
import { heldSubset } from '../../services/sync/componentItemFinder.js';
import { runComponentItemSearch } from '../../services/sync/componentItemJob.js';
import { drainPairing } from '../../services/sync/mergeProposalFinder.js';
import { runningSyncs, type SyncProgress } from '../../services/sync/types.js';
import { joinPlacesClaimingOneItem } from '../experience/equalItemMerges.js';
import { afterRun } from './afterRun.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const accept = vi.fn(async () => ({ accepted: 0, sites: 0, leftForNextPass: 0 }));

function ended(logId: number, status: SyncProgress['status'] = 'complete', dryRun = false): SyncProgress {
  return {
    cancel: false, kind: 'sync', status, statusMessage: `Sync completed: ${logId}`, progress: 0, total: 0,
    created: 0, updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0, held: 0, filtered: 0, errors: 0,
    currentItem: '', logId, dryRun,
  };
}

describe('the steps after a run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runningSyncs.clear();
    mockedQuery.mockReset();
    vi.mocked(joinPlacesClaimingOneItem).mockClear();
    vi.mocked(drainPairing).mockClear();
    vi.mocked(runComponentItemSearch).mockClear();
    accept.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('joins once, pairs the changed places once for the pass, and reports on the entry the card still follows: the pass\'s last run', async () => {
    const first = ended(101);
    const second = ended(102);
    runningSyncs.set(3, first);
    runningSyncs.set(6, second);

    const done = afterRun(3, [3, 6], accept);
    // While the steps go: every entry is held, and the last run's reads as a
    // run still going — the first source's card stopped asking when its own
    // run ended, minutes before the pass did.
    expect(first.continues).toBe(true);
    expect(second.continues).toBe(true);
    expect(first.status).toBe('complete');
    expect(second.status).toBe('processing');
    expect(second.operation).toBeDefined();
    await done;

    expect(joinPlacesClaimingOneItem).toHaveBeenCalledTimes(1);
    expect(drainPairing).toHaveBeenCalledTimes(1);
    expect(runComponentItemSearch).not.toHaveBeenCalled();
    expect(second.status).toBe('complete');
    expect(second.statusMessage).toBe('Sync completed: 102; 2 changed places paired again with near places, 1 near pair open among them');
    expect(first.statusMessage).toBe('Sync completed: 101');
    expect(first.continues).toBe(false);
    expect(second.continues).toBe(false);
    // Readable for a while, then released, as a writer's entry is.
    expect(runningSyncs.get(6)).toBe(second);
    vi.advanceTimersByTime(30000);
    expect(runningSyncs.get(3)).toBeUndefined();
    expect(runningSyncs.get(6)).toBeUndefined();
  });

  it('pairs what a cancelled run wrote, and keeps its verdict', async () => {
    const run = ended(601, 'cancelled');
    run.cancel = true;
    run.statusMessage = 'Cancelled.';
    runningSyncs.set(4, run);

    await afterRun(4, [4], accept);

    expect(drainPairing).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('cancelled');
    expect(run.statusMessage).toBe('Cancelled.; 2 changed places paired again with near places, 1 near pair open among them');
  });

  it('leaves the marks to the next drain when a Cancel reaches the pairing, and says so', async () => {
    const first = ended(501);
    const second = ended(502);
    runningSyncs.set(3, first);
    runningSyncs.set(6, second);
    vi.mocked(joinPlacesClaimingOneItem).mockImplementationOnce(async () => { second.cancel = true; return { merged: [], refused: [] }; });

    await afterRun(3, [3, 6], accept);

    expect(drainPairing).not.toHaveBeenCalled();
    expect(second.statusMessage).toBe('Sync completed: 502; the pairing was cancelled; the next one pairs the places this run changed');
  });

  it('searches the items of the components a World Heritage run left without one, and only those', async () => {
    const run = ended(201);
    runningSyncs.set(1, run);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5001 }, { id: 5002 }] });

    await afterRun(1, [1], accept);

    expect(runComponentItemSearch).toHaveBeenCalledWith(run, run.operation, { pointIds: [5001, 5002] }, accept);
    expect(run.statusMessage).toBe('Sync completed: 201; 2 of 3 components without an item have a candidate; 2 changed places paired again with near places, 1 near pair open among them');
  });

  it('skips the search when the run left no new component without an item', async () => {
    const run = ended(202);
    runningSyncs.set(1, run);
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    await afterRun(1, [1], accept);

    expect(runComponentItemSearch).not.toHaveBeenCalled();
    expect(drainPairing).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a preview, and keeps a partial verdict', async () => {
    runningSyncs.set(4, ended(301, 'complete', true));
    await afterRun(4, [4], accept);
    expect(joinPlacesClaimingOneItem).not.toHaveBeenCalled();

    const partial = ended(302, 'partial');
    runningSyncs.set(4, partial);
    await afterRun(4, [4], accept);
    expect(partial.status).toBe('partial');
  });

  it('names a failed step, still runs the steps after it, and restores the verdict', async () => {
    const run = ended(401);
    runningSyncs.set(4, run);
    vi.mocked(joinPlacesClaimingOneItem).mockRejectedValueOnce(new Error('the database went away'));

    await afterRun(4, [4], accept);

    expect(drainPairing).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('complete');
    expect(run.statusMessage).toBe('Sync completed: 401; the joining of places claiming one item failed; the server log has the cause; 2 changed places paired again with near places, 1 near pair open among them');
    expect(run.continues).toBe(false);
  });

  it('pairs the changed places when the search fails', async () => {
    const run = ended(402);
    runningSyncs.set(1, run);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5001 }] });
    vi.mocked(runComponentItemSearch).mockRejectedValueOnce(new Error('Wikidata went away'));

    await afterRun(1, [1], accept);

    expect(drainPairing).toHaveBeenCalledTimes(1);
    expect(run.statusMessage).toBe('Sync completed: 402; the search for the new components\' items failed; the server log has the cause; 2 changed places paired again with near places, 1 near pair open among them');
  });

  it('skips the search with its reason where the local Wikidata subset is not built, and still pairs', async () => {
    const run = ended(403);
    runningSyncs.set(1, run);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5001 }, { id: 5002 }] });
    vi.mocked(heldSubset).mockResolvedValueOnce(null);

    await afterRun(1, [1], accept);

    expect(runComponentItemSearch).not.toHaveBeenCalled();
    expect(drainPairing).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('complete');
    expect(run.statusMessage).toBe('Sync completed: 403; 2 new components left without an item, since the local Wikidata subset is not built: build it under Public Dumps, then Find component items; 2 changed places paired again with near places, 1 near pair open among them');
  });
});
