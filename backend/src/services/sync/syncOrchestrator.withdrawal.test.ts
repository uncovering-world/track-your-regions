/**
 * A collector that could not vouch for the contents it stopped seeing (ADR-0044).
 *
 * The museum run measures its works against a floor before anything is written,
 * and hands the orchestrator the reason when it fails. Three things have to
 * follow from that reason, and none of them is the collector's to do: the run
 * cannot be a success, the reason has to reach the log row, and every writer
 * has to be told — a floor that is computed and then forgotten is run 42 with
 * a withdrawal arm.
 *
 * Its own file beside `syncOrchestrator.test.ts`, which is at the line limit;
 * the mocks are the same ones, restated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  orchestrateSync, getSyncStatus, type SyncServiceConfig, type ProcessItemResult,
} from './syncOrchestrator.js';
import { runningSyncs } from './types.js';

vi.mock('./syncUtils.js', () => ({
  createSyncLog: vi.fn().mockResolvedValue(42),
  updateSyncLog: vi.fn().mockResolvedValue(undefined),
  annotateClosedSyncLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./changeRecorder.js', () => ({
  recordSyncChanges: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./regionAssignmentService.js', () => ({
  assignRegionsForExperiences: vi.fn().mockResolvedValue(3),
  worldViewsWithGeometry: vi.fn().mockResolvedValue([5]),
}));

vi.mock('./admission.js', () => ({
  admissionSweepSkipReason: vi.fn().mockReturnValue(null),
  countAdmitted: vi.fn().mockResolvedValue(0),
  markRefused: vi.fn().mockResolvedValue([]),
  restoreAdmission: vi.fn().mockResolvedValue([]),
  markNotAdmitted: vi.fn().mockResolvedValue([]),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
  countSeenAmongActive: vi.fn().mockResolvedValue(0),
}));

import { updateSyncLog } from './syncUtils.js';
import { markRefused, restoreAdmission } from './admission.js';
import { missingDetectionSkipReason } from './missingDetection.js';

const TEST_CATEGORY_ID = 999;

interface TestItem {
  id: string;
  name: string;
}

function unchanged(): ProcessItemResult {
  return {
    outcome: 'unchanged',
    experienceId: 501,
    nameSnapshot: 'Item',
    returnedFromMissing: false,
    changeSet: {
      changeType: 'unchanged', changedFields: [], significance: null,
      curatedConflicts: [], heldFields: [],
    },
  };
}

const REASON = 'this run placed 291 of the 1301 works the catalogue offers at the '
  + '100 museums it admits (22.4%), below the 90% floor';

/** Run 42's shape: every museum unchanged, nothing failed, a sixth of the pool. */
function shortRun(overrides?: Partial<SyncServiceConfig<TestItem>>): SyncServiceConfig<TestItem> {
  return {
    categoryId: TEST_CATEGORY_ID,
    logPrefix: '[Test Sync]',
    sourceCompleteness: 'ranked',
    fetchItems: vi.fn().mockResolvedValue({
      items: [{ id: '1', name: 'Louvre' }, { id: '2', name: 'Prado' }],
      fetchedCount: 291,
      withdrawalSkippedReason: REASON,
    }),
    processItem: vi.fn().mockResolvedValue(unchanged()),
    getItemName: (item) => item.name,
    getItemId: (item) => item.id,
    ...overrides,
  };
}

describe('a run that saw too little to say what left', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
  });

  it('reports partial and records why, with no item having errored', async () => {
    // It reported success once; it must not again.
    await orchestrateSync(shortRun(), 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'partial',
      expect.objectContaining({ errors: 0, unchanged: 2, withdrawalSkippedReason: REASON }),
      undefined,
    );
  });

  it('hands the reason to every processItem, so a writer marks nothing behind it', async () => {
    const config = shortRun();

    await orchestrateSync(config, 1);

    expect(config.processItem).toHaveBeenCalledTimes(2);
    for (const call of (config.processItem as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ withdrawalSkippedReason: REASON }));
    }
  });

  it('hands null when the collector vouched, and records a success', async () => {
    // Absent from the fetch result — the shape every existing collector
    // returns — reads as "may withdraw", so a source with no floor is unchanged.
    const config = shortRun({
      fetchItems: vi.fn().mockResolvedValue({
        items: [{ id: '1', name: 'Louvre' }], fetchedCount: 2536,
      }),
    });

    await orchestrateSync(config, 1);

    expect(config.processItem).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ withdrawalSkippedReason: null }),
    );
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ withdrawalSkippedReason: null }),
      undefined,
    );
  });

  it('still ends the run complete rather than failed, and says why in the sentence', async () => {
    // The catalogue is correct and the changeset landed; what is unrecorded is
    // the source's departures. `partial` on the row, `complete` for the poller —
    // the same split placement's partial makes.
    await orchestrateSync(shortRun(), 1);

    const status = getSyncStatus(TEST_CATEGORY_ID);
    expect(status?.status).toBe('complete');
    expect(status?.statusMessage).toContain('Complete (partial)');
    expect(status?.statusMessage).toContain(REASON);
  });

  it('keeps a run with a straggler partial, and a run that touched nothing failed', async () => {
    // The floor's verdict neither upgrades nor downgrades the item-level one.
    const straggler = shortRun();
    (straggler.processItem as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(unchanged())
      .mockRejectedValueOnce(new Error('boom'));
    await orchestrateSync(straggler, 1);
    expect(updateSyncLog).toHaveBeenLastCalledWith(
      TEST_CATEGORY_ID, 42, 'partial',
      expect.objectContaining({ errors: 1, withdrawalSkippedReason: REASON }),
      expect.anything(),
    );

    runningSyncs.clear();
    vi.clearAllMocks();
    const broken = shortRun();
    (broken.processItem as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await orchestrateSync(broken, 1);
    expect(updateSyncLog).toHaveBeenLastCalledWith(
      TEST_CATEGORY_ID, 42, 'failed', expect.anything(), expect.anything(),
    );
  });
});

describe('a run that saw too little and then failed', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
  });

  it('keeps the reason on the row the failure leaves', async () => {
    // Both facts are true of such a run, and a card reading `failed` over a
    // NULL would not say why nothing was withdrawn before the failure. The
    // failure has to reach the catch path — an item that throws is caught per
    // item and closes the log on the ordinary path — so it is the admission
    // write after the fetch that dies here.
    (markRefused as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));

    await expect(orchestrateSync(shortRun(), 1)).rejects.toThrow('db down');

    expect(updateSyncLog).toHaveBeenLastCalledWith(
      TEST_CATEGORY_ID, 42, 'failed',
      expect.objectContaining({ withdrawalSkippedReason: REASON }),
      expect.anything(),
    );
  });

  it('leaves the reason null where the fetch itself never returned', async () => {
    const config = shortRun({ fetchItems: vi.fn().mockRejectedValue(new Error('API down')) });

    await expect(orchestrateSync(config, 1)).rejects.toThrow('API down');

    expect(updateSyncLog).toHaveBeenLastCalledWith(
      TEST_CATEGORY_ID, 42, 'failed',
      expect.objectContaining({ withdrawalSkippedReason: null }),
      expect.anything(),
    );
  });
});

describe('a run whose detection was skipped and then failed', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
  });

  it('keeps both guards’ reasons on the row the failure leaves', async () => {
    // The sibling of the withdrawal case, and the common shape: every museum
    // run skips detection (its source is ranked), so a run that then dies in
    // the admission sweep would otherwise leave NULL where the card reads why
    // nothing was delisted.
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValueOnce('source is ranked');
    (restoreAdmission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));

    await expect(orchestrateSync(shortRun({ recomputesMembership: true }), 1))
      .rejects.toThrow('db down');

    expect(updateSyncLog).toHaveBeenLastCalledWith(
      TEST_CATEGORY_ID, 42, 'failed',
      expect.objectContaining({
        detectionSkippedReason: 'source is ranked', withdrawalSkippedReason: REASON,
      }),
      expect.anything(),
    );
  });
});
