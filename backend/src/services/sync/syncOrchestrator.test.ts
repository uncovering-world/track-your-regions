/**
 * Tests for the sync orchestrator.
 *
 * Tests the generic lifecycle management (progress tracking, cancellation,
 * error handling, status determination, changeset recording) in isolation from
 * any database or external API by mocking all callbacks and sync log utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrateSync, getSyncStatus, cancelSync, type SyncServiceConfig, type ProcessItemResult } from './syncOrchestrator.js';
import { runningSyncs, type SyncProgress } from './types.js';

// Mock sync log utilities — these hit the database
vi.mock('./syncUtils.js', () => ({
  createSyncLog: vi.fn().mockResolvedValue(42),
  updateSyncLog: vi.fn().mockResolvedValue(undefined),
  cleanupCategoryData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./changeRecorder.js', () => ({
  recordSyncChanges: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./missingDetection.js', () => ({
  missingDetectionSkipReason: vi.fn().mockReturnValue(null),
  flagMissingExperiences: vi.fn().mockResolvedValue([]),
  countActiveExperiences: vi.fn().mockResolvedValue(0),
}));

import { createSyncLog, updateSyncLog, cleanupCategoryData } from './syncUtils.js';
import { recordSyncChanges } from './changeRecorder.js';
import { missingDetectionSkipReason, flagMissingExperiences } from './missingDetection.js';

const TEST_CATEGORY_ID = 999;

interface TestItem {
  id: string;
  name: string;
}

/** A processItem result of the given outcome, with a matching change set. */
function processed(outcome: 'created' | 'updated' | 'unchanged'): ProcessItemResult {
  return {
    outcome,
    experienceId: 501,
    nameSnapshot: 'Item',
    changeSet: {
      changeType: outcome,
      changedFields: outcome === 'updated'
        ? [{ field: 'shortDescription', old: 'a', new: 'b', significance: 'minor', curatedConflict: false }]
        : [],
      significance: outcome === 'updated' ? 'minor' : null,
      curatedConflicts: [],
    },
  };
}

function makeProgress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    cancel: false,
    status: 'processing',
    statusMessage: 'Running...',
    progress: 0,
    total: 10,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun: false,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<SyncServiceConfig<TestItem>>): SyncServiceConfig<TestItem> {
  return {
    categoryId: TEST_CATEGORY_ID,
    logPrefix: '[Test Sync]',
    sourceCompleteness: 'authoritative',
    fetchItems: vi.fn().mockResolvedValue({ items: [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }], fetchedCount: 2 }),
    processItem: vi.fn().mockResolvedValue(processed('created')),
    getItemName: (item) => item.name,
    getItemId: (item) => item.id,
    ...overrides,
  };
}

describe('orchestrateSync', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    runningSyncs.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should process all items and report correct counts', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockResolvedValueOnce(processed('updated')),
    });

    await orchestrateSync(config, 1);

    expect(config.fetchItems).toHaveBeenCalledOnce();
    expect(config.processItem).toHaveBeenCalledTimes(2);
    expect(createSyncLog).toHaveBeenCalledWith(TEST_CATEGORY_ID, 1, false);
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'success',
      expect.objectContaining({ fetched: 2, created: 1, updated: 1, errors: 0 }),
      undefined,
    );
  });

  it('should report partial status when some items fail', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockRejectedValueOnce(new Error('item failed')),
    });

    await orchestrateSync(config, null);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'partial',
      expect.objectContaining({ fetched: 2, created: 1, updated: 0, errors: 1 }),
      [{ externalId: '2', error: 'item failed' }],
    );
  });

  it('should report failed status when all items fail', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await orchestrateSync(config, null);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'failed',
      expect.objectContaining({ fetched: 2, created: 0, updated: 0, errors: 2 }),
      expect.arrayContaining([
        { externalId: '1', error: 'boom' },
        { externalId: '2', error: 'boom' },
      ]),
    );
  });

  it('should count pre-processing errors from fetchItems in final status', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockImplementation(async (_progress, errorDetails) => {
        // Simulate fetchItems appending pre-processing errors (e.g., museums without coordinates)
        errorDetails.push({ externalId: 'bad-1', error: 'no coordinates' });
        return { items: [{ id: '1', name: 'Item 1' }], fetchedCount: 2 };
      }),
      processItem: vi.fn().mockResolvedValue(processed('created')),
    });

    await orchestrateSync(config, null);

    // Pre-processing error should be reflected in progress.errors and final status
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'partial', // 1 error + 1 created = partial
      expect.objectContaining({ fetched: 2, created: 1, updated: 0, errors: 1 }),
      [{ externalId: 'bad-1', error: 'no coordinates' }],
    );
  });

  it('should throw when sync is already running', async () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'processing' }));

    const config = makeConfig();
    await expect(orchestrateSync(config, null))
      .rejects.toThrow('sync already in progress');
  });

  it('should allow starting a new sync after previous completed', async () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'complete', statusMessage: 'Done', progress: 10, created: 10 }));

    const config = makeConfig();
    await orchestrateSync(config, null);

    expect(config.fetchItems).toHaveBeenCalledOnce();
  });

  it('should call cleanup on force sync', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null, { force: true });

    expect(cleanupCategoryData).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      '[Test Sync]',
      expect.objectContaining({ status: 'complete' }),
    );
  });

  it('should use custom cleanup when provided', async () => {
    const customCleanup = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({ cleanup: customCleanup });

    await orchestrateSync(config, null, { force: true });

    expect(customCleanup).toHaveBeenCalledOnce();
    expect(cleanupCategoryData).not.toHaveBeenCalled();
  });

  it('should not call cleanup when force is false', async () => {
    const customCleanup = vi.fn();
    const config = makeConfig({ cleanup: customCleanup });

    await orchestrateSync(config, null);

    expect(customCleanup).not.toHaveBeenCalled();
    expect(cleanupCategoryData).not.toHaveBeenCalled();
  });

  it('should handle cancellation during processing', async () => {
    const config = makeConfig({
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

    const status = runningSyncs.get(TEST_CATEGORY_ID);
    expect(status?.status).toBe('cancelled');
  });

  it('should propagate fetch errors as sync failures', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockRejectedValue(new Error('API down')),
    });

    await expect(orchestrateSync(config, null)).rejects.toThrow('API down');

    const status = runningSyncs.get(TEST_CATEGORY_ID);
    expect(status?.status).toBe('failed');
    expect(status?.statusMessage).toBe('API down');
  });

  it('should clean up runningSyncs after 30s delay', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null);

    // Progress still exists immediately after sync
    expect(runningSyncs.has(TEST_CATEGORY_ID)).toBe(true);

    // Advance past the 30s cleanup timer
    vi.advanceTimersByTime(31000);

    expect(runningSyncs.has(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should not clean up runningSyncs if a new sync started', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null);

    // Simulate a new sync starting before cleanup fires
    const newProgress = makeProgress({ status: 'fetching', statusMessage: 'New sync', total: 0 });
    runningSyncs.set(TEST_CATEGORY_ID, newProgress);

    vi.advanceTimersByTime(31000);

    // Old cleanup should NOT have removed the new sync's progress
    expect(runningSyncs.get(TEST_CATEGORY_ID)).toBe(newProgress);
  });
});

describe('orchestrateSync changeset recording', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    runningSyncs.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('counts unchanged rows separately from updated ones', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('updated'))
        .mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'success',
      expect.objectContaining({ created: 0, updated: 1, unchanged: 1 }),
      undefined,
    );
  });

  it('does not record unchanged rows in the changeset', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('created'))
        .mockResolvedValueOnce(processed('unchanged')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changeType).toBe('created');
  });

  it('records a failed item with its error and no experience id', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    const recorded = (recordSyncChanges as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(recorded[0]).toMatchObject({
      changeType: 'failed',
      experienceId: null,
      error: 'No valid coordinates',
    });
  });

  it('counts curated conflicts across the run', async () => {
    const conflicted = processed('unchanged');
    conflicted.changeSet.curatedConflicts = [
      { field: 'name', old: 'ours', new: 'theirs', significance: 'major', curatedConflict: true },
    ];
    const config = makeConfig({
      processItem: vi.fn().mockResolvedValue(conflicted),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ curatedConflicts: 2 }),
      undefined,
    );
  });

  it('flags missing objects when the guards allow it', async () => {
    (flagMissingExperiences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      syncLogId: 42, experienceId: 77, externalId: '1234', nameSnapshot: 'Dresden Elbe Valley',
      changeType: 'missing', changedFields: null, significance: null, error: null,
    }]);

    await orchestrateSync(makeConfig(), 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ missing: 1 }),
      undefined,
    );
  });

  it('skips missing detection and records why', async () => {
    (missingDetectionSkipReason as ReturnType<typeof vi.fn>).mockReturnValueOnce('source is ranked');

    await orchestrateSync(makeConfig(), 1);

    expect(flagMissingExperiences).not.toHaveBeenCalled();
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'success',
      expect.objectContaining({ detectionSkippedReason: 'source is ranked' }),
      undefined,
    );
  });

  it('marks the log as a dry run and tells processItem', async () => {
    const config = makeConfig();

    await orchestrateSync(config, 1, { dryRun: true });

    expect(createSyncLog).toHaveBeenCalledWith(TEST_CATEGORY_ID, 1, true);
    expect(config.processItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dryRun: true, syncLogId: 42 }),
    );
  });

  it('refuses to combine a dry run with force cleanup', async () => {
    await expect(orchestrateSync(makeConfig(), 1, { force: true, dryRun: true }))
      .rejects.toThrow(/dry run/i);
  });

  it('calls a run partial, not failed, when everything was already current', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce(processed('unchanged'))
        .mockRejectedValueOnce(new Error('No valid coordinates')),
    });

    await orchestrateSync(config, 1);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID, 42, 'partial',
      expect.objectContaining({ unchanged: 1, errors: 1 }),
      expect.anything(),
    );
  });
});

describe('getSyncStatus', () => {
  beforeEach(() => runningSyncs.clear());
  afterEach(() => runningSyncs.clear());

  it('should return null when no sync exists', () => {
    expect(getSyncStatus(TEST_CATEGORY_ID)).toBeNull();
  });

  it('should return progress when sync exists', () => {
    const progress = makeProgress({ statusMessage: 'Working', progress: 5, created: 3, updated: 2, currentItem: 'Item 5', logId: 42 });
    runningSyncs.set(TEST_CATEGORY_ID, progress);

    expect(getSyncStatus(TEST_CATEGORY_ID)).toBe(progress);
  });
});

describe('cancelSync', () => {
  beforeEach(() => runningSyncs.clear());
  afterEach(() => runningSyncs.clear());

  it('should return false when no sync exists', () => {
    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should cancel a running sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ statusMessage: 'Working', progress: 5, created: 3, updated: 2, currentItem: 'Item 5', logId: 42 }));

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(true);

    const progress = runningSyncs.get(TEST_CATEGORY_ID);
    expect(progress?.cancel).toBe(true);
    expect(progress?.statusMessage).toBe('Cancelling...');
  });

  it('should not cancel an already-complete sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'complete', statusMessage: 'Done', progress: 10, created: 10, logId: 42 }));

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should not cancel a failed sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, makeProgress({ status: 'failed', statusMessage: 'Error', total: 0, errors: 1, logId: 42 }));

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });
});
