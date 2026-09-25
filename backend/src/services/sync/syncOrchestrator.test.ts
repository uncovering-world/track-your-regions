/**
 * Tests for the run's own lifecycle: it refuses to start twice, it stops when
 * asked, it fails when the source does, and it leaves the registry as it found
 * it — plus the three reads and the one write that registry answers.
 *
 * All of it in isolation from any database or external API: every callback and
 * every sync-log utility is mocked, and what the run then does to a changeset
 * is the four sibling files' subject (`syncOrchestrator.log`, `.changeset`,
 * `.held`, `.sweep`), which share the builders and the mock reset through
 * `syncOrchestrator.fixtures.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sync log utilities — these hit the database
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
  markIconic: vi.fn().mockResolvedValue([]),
  unmarkIconic: vi.fn().mockResolvedValue([]),
  markNotAdmitted: vi.fn().mockResolvedValue([]),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
  countSeenAmongActive: vi.fn().mockResolvedValue(0),
}));

import { orchestrateSync, getSyncStatus, cancelSync, isCancellable } from './syncOrchestrator.js';
import { runningSyncs, type SyncProgress } from './types.js';
import { annotateClosedSyncLog, createSyncLog, updateSyncLog } from './syncUtils.js';
import { restoreAdmission, markIconic } from './admission.js';
import { assignRegionsForExperiences } from './regionAssignmentService.js';
import {
  TEST_SOURCE_ID, processed, makeProgress, makeConfig, resetOrchestratorMocks,
  restoreOrchestratorTimers,
} from './syncOrchestrator.fixtures.js';

describe('orchestrateSync', () => {
  beforeEach(resetOrchestratorMocks);
  afterEach(restoreOrchestratorTimers);

  it('should throw when sync is already running', async () => {
    runningSyncs.set(TEST_SOURCE_ID, makeProgress({ status: 'processing' }));

    const config = makeConfig();
    await expect(orchestrateSync(config, null))
      .rejects.toThrow('sync already in progress');
  });

  it('should allow starting a new sync after previous completed', async () => {
    runningSyncs.set(TEST_SOURCE_ID, makeProgress({ status: 'complete', statusMessage: 'Done', progress: 10, created: 10 }));

    const config = makeConfig();
    await orchestrateSync(config, null);

    expect(config.fetchItems).toHaveBeenCalledOnce();
  });

  it('empties nothing before it starts, whatever it was asked for', async () => {
    // A run refreshes what the source offers and marks what it withdrew. There
    // is no mode that empties the source first: the visit records and manual
    // region assignments that went with it are the one thing no later run can
    // rebuild. The config has no cleanup hook to call, and this holds the line
    // against one appearing.
    const config = makeConfig();
    await orchestrateSync(config, null, { force: true } as never);

    expect(Object.keys(config)).not.toContain('cleanup');
    expect(config.fetchItems).toHaveBeenCalledOnce();
  });

  it('should handle cancellation during processing', async () => {
    const config = makeConfig({
      recomputesMembership: true,
      badgesAdmitted: true,
      processItem: vi.fn().mockImplementation(async (_item, progress) => {
        progress.cancel = true; // Simulate cancel on first item
        return processed('created');
      }),
      fetchItems: vi.fn().mockResolvedValue({
        items: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }],
        fetchedCount: 3,
      }),
    });

    await expect(orchestrateSync(config, null)).rejects.toThrow('Sync cancelled');

    // Should have processed only the first item before cancel was detected
    expect(config.processItem).toHaveBeenCalledTimes(1);

    const status = runningSyncs.get(TEST_SOURCE_ID);
    expect(status?.status).toBe('cancelled');

    // A cancel exits ahead of the admission step, so a row this run selected
    // but had not yet re-admitted is left as it was -- refused and unbadged --
    // rather than refused and badged, which the catalogue check reports (#760).
    expect(restoreAdmission).not.toHaveBeenCalled();
    expect(markIconic).not.toHaveBeenCalled();
  });

  it('should propagate fetch errors as sync failures', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockRejectedValue(new Error('API down')),
    });

    await expect(orchestrateSync(config, null)).rejects.toThrow('API down');

    const status = runningSyncs.get(TEST_SOURCE_ID);
    expect(status?.status).toBe('failed');
    // A sentence for the card; 'API down' is the run log's and the server's (#1021).
    expect(status?.statusMessage).toBe('its entry in the sync history has the cause.');
  });

  it('points at the server log when the run never wrote a history entry', async () => {
    // The database down as the run starts: createSyncLog fails inside the
    // try, so there is no row in the sync history to point at.
    vi.mocked(createSyncLog).mockRejectedValueOnce(new Error('connection terminated'));

    await expect(orchestrateSync(makeConfig(), null)).rejects.toThrow('connection terminated');

    expect(runningSyncs.get(TEST_SOURCE_ID)?.statusMessage).toBe('the server log has the cause.');
  });

  it('points at the server log when the history row could not be updated', async () => {
    // The database lost mid-run: the row exists but never gets the cause, so
    // the history would show a run with no reason.
    vi.mocked(updateSyncLog).mockRejectedValueOnce(new Error('connection terminated'));
    const config = makeConfig({ fetchItems: vi.fn().mockRejectedValue(new Error('API down')) });

    await expect(orchestrateSync(config, null)).rejects.toThrow();

    expect(runningSyncs.get(TEST_SOURCE_ID)?.statusMessage).toBe('the server log has the cause.');
  });

  it('should clean up runningSyncs after 30s delay', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null);

    // Progress still exists immediately after sync
    expect(runningSyncs.has(TEST_SOURCE_ID)).toBe(true);

    // Advance past the 30s cleanup timer
    vi.advanceTimersByTime(31000);

    expect(runningSyncs.has(TEST_SOURCE_ID)).toBe(false);
  });

  it('should not clean up runningSyncs if a new sync started', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null);

    // Simulate a new sync starting before cleanup fires
    const newProgress = makeProgress({ status: 'fetching', statusMessage: 'New sync', total: 0 });
    runningSyncs.set(TEST_SOURCE_ID, newProgress);

    vi.advanceTimersByTime(31000);

    // Old cleanup should NOT have removed the new sync's progress
    expect(runningSyncs.get(TEST_SOURCE_ID)).toBe(newProgress);
  });
});

describe('getSyncStatus', () => {
  beforeEach(() => runningSyncs.clear());
  afterEach(() => runningSyncs.clear());

  it('should return null when no sync exists', () => {
    expect(getSyncStatus(TEST_SOURCE_ID)).toBeNull();
  });

  it('should return progress when sync exists', () => {
    const progress = makeProgress({ statusMessage: 'Working', progress: 5, created: 3, updated: 2, currentItem: 'Item 5', logId: 42 });
    runningSyncs.set(TEST_SOURCE_ID, progress);

    expect(getSyncStatus(TEST_SOURCE_ID)).toBe(progress);
  });
});

describe('cancelSync', () => {
  beforeEach(() => runningSyncs.clear());
  afterEach(() => runningSyncs.clear());

  it('should return false when no sync exists', () => {
    expect(cancelSync(TEST_SOURCE_ID)).toBe(false);
  });

  it('should cancel a running sync', () => {
    runningSyncs.set(TEST_SOURCE_ID, makeProgress({ statusMessage: 'Working', progress: 5, created: 3, updated: 2, currentItem: 'Item 5', logId: 42 }));

    expect(cancelSync(TEST_SOURCE_ID)).toBe(true);

    const progress = runningSyncs.get(TEST_SOURCE_ID);
    expect(progress?.cancel).toBe(true);
    expect(progress?.statusMessage).toBe('Cancelling...');
  });

  it('should not cancel an already-complete sync', () => {
    runningSyncs.set(TEST_SOURCE_ID, makeProgress({ status: 'complete', statusMessage: 'Done', progress: 10, created: 10, logId: 42 }));

    expect(cancelSync(TEST_SOURCE_ID)).toBe(false);
  });

  it('should not cancel a failed sync', () => {
    runningSyncs.set(TEST_SOURCE_ID, makeProgress({ status: 'failed', statusMessage: 'Error', total: 0, errors: 1, logId: 42 }));

    expect(cancelSync(TEST_SOURCE_ID)).toBe(false);
  });
});

describe('registering a location write', () => {
  beforeEach(() => {
    (assignRegionsForExperiences as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(3);
    (annotateClosedSyncLog as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
    runningSyncs.delete(TEST_SOURCE_ID);
  });

  it('keeps what an item wrote even when that item then throws', async () => {
    // The museum service upserts treasures *after* moving the point, and that
    // can throw. Carried back on the result, the id would be lost with the
    // throw while the point had already moved on disk — leaving a stale `auto`
    // row naming the region it left, and nothing to signal it.
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_item, _progress, ctx) => {
        ctx.onLocationsChanged(11);
        throw new Error('treasures blew up');
      }),
    });

    await orchestrateSync(config, null);

    expect(assignRegionsForExperiences).toHaveBeenCalledWith([11], 5);
  });
});

describe('isCancellable', () => {
  const at = (status: SyncProgress['status'], progress: number, total: number) =>
    makeProgress({ status, progress, total });

  it('accepts while items are still being fetched', () => {
    expect(isCancellable(at('fetching', 0, 0))).toBe(true);
  });

  it('accepts while items remain to process', () => {
    expect(isCancellable(at('processing', 3, 10))).toBe(true);
  });

  it('refuses once the last item is done', () => {
    // Nothing reads `progress.cancel` past this point — detection, changeset
    // recording, log closure and placement all ignore it — so accepting would
    // report a cancellation that does not happen and let the run finish as a
    // success.
    expect(isCancellable(at('processing', 10, 10))).toBe(false);
  });

  it('refuses while regions are being assigned', () => {
    expect(isCancellable(at('assigning', 10, 10))).toBe(false);
  });

  it('refuses a run that has already ended', () => {
    for (const status of ['complete', 'partial', 'failed', 'cancelled'] as const) {
      expect(isCancellable(at(status, 10, 10))).toBe(false);
    }
  });
});
