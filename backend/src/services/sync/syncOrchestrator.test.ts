/**
 * Tests for the sync orchestrator.
 *
 * Tests the generic lifecycle management (progress tracking, cancellation,
 * error handling, status determination) in isolation from any database
 * or external API by mocking all callbacks and sync log utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrateSync, getSyncStatus, cancelSync, type SyncServiceConfig } from './syncOrchestrator.js';
import { runningSyncs } from './types.js';

// Mock sync log utilities — these hit the database
vi.mock('./syncUtils.js', () => ({
  createSyncLog: vi.fn().mockResolvedValue(42),
  updateSyncLog: vi.fn().mockResolvedValue(undefined),
  cleanupCategoryData: vi.fn().mockResolvedValue(undefined),
}));

import { createSyncLog, updateSyncLog, cleanupCategoryData } from './syncUtils.js';

const TEST_CATEGORY_ID = 999;

interface TestItem {
  id: string;
  name: string;
}

function makeConfig(overrides?: Partial<SyncServiceConfig<TestItem>>): SyncServiceConfig<TestItem> {
  return {
    categoryId: TEST_CATEGORY_ID,
    logPrefix: '[Test Sync]',
    fetchItems: vi.fn().mockResolvedValue({ items: [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }], fetchedCount: 2 }),
    processItem: vi.fn().mockResolvedValue('created'),
    getItemName: (item) => item.name,
    getItemId: (item) => item.id,
    ...overrides,
  };
}

describe('orchestrateSync', () => {
  beforeEach(() => {
    runningSyncs.clear();
    vi.clearAllMocks();
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
        .mockResolvedValueOnce('created')
        .mockResolvedValueOnce('updated'),
    });

    await orchestrateSync(config, 1, false);

    expect(config.fetchItems).toHaveBeenCalledOnce();
    expect(config.processItem).toHaveBeenCalledTimes(2);
    expect(createSyncLog).toHaveBeenCalledWith(TEST_CATEGORY_ID, 1);
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'success',
      { fetched: 2, created: 1, updated: 1, errors: 0 },
      undefined,
    );
  });

  it('should report partial status when some items fail', async () => {
    const config = makeConfig({
      processItem: vi.fn()
        .mockResolvedValueOnce('created')
        .mockRejectedValueOnce(new Error('item failed')),
    });

    await orchestrateSync(config, null, false);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'partial',
      { fetched: 2, created: 1, updated: 0, errors: 1 },
      [{ externalId: '2', error: 'item failed' }],
    );
  });

  it('should report failed status when all items fail', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await orchestrateSync(config, null, false);

    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'failed',
      { fetched: 2, created: 0, updated: 0, errors: 2 },
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
      processItem: vi.fn().mockResolvedValue('created'),
    });

    await orchestrateSync(config, null, false);

    // Pre-processing error should be reflected in progress.errors and final status
    expect(updateSyncLog).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      42,
      'partial', // 1 error + 1 created = partial
      { fetched: 2, created: 1, updated: 0, errors: 1 },
      [{ externalId: 'bad-1', error: 'no coordinates' }],
    );
  });

  it('should throw when sync is already running', async () => {
    // Simulate a running sync
    runningSyncs.set(TEST_CATEGORY_ID, {
      cancel: false,
      status: 'processing',
      statusMessage: 'Running...',
      progress: 0, total: 10,
      created: 0, updated: 0, errors: 0,
      currentItem: '', logId: null,
    });

    const config = makeConfig();
    await expect(orchestrateSync(config, null, false))
      .rejects.toThrow('sync already in progress');
  });

  it('should allow starting a new sync after previous completed', async () => {
    runningSyncs.set(TEST_CATEGORY_ID, {
      cancel: false,
      status: 'complete',
      statusMessage: 'Done',
      progress: 10, total: 10,
      created: 10, updated: 0, errors: 0,
      currentItem: '', logId: null,
    });

    const config = makeConfig();
    await orchestrateSync(config, null, false);

    expect(config.fetchItems).toHaveBeenCalledOnce();
  });

  it('should call cleanup on force sync', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null, true);

    expect(cleanupCategoryData).toHaveBeenCalledWith(
      TEST_CATEGORY_ID,
      '[Test Sync]',
      expect.objectContaining({ status: 'complete' }),
    );
  });

  it('should use custom cleanup when provided', async () => {
    const customCleanup = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({ cleanup: customCleanup });

    await orchestrateSync(config, null, true);

    expect(customCleanup).toHaveBeenCalledOnce();
    expect(cleanupCategoryData).not.toHaveBeenCalled();
  });

  it('should not call cleanup when force is false', async () => {
    const customCleanup = vi.fn();
    const config = makeConfig({ cleanup: customCleanup });

    await orchestrateSync(config, null, false);

    expect(customCleanup).not.toHaveBeenCalled();
    expect(cleanupCategoryData).not.toHaveBeenCalled();
  });

  it('should handle cancellation during processing', async () => {
    const config = makeConfig({
      processItem: vi.fn().mockImplementation(async (_item, progress) => {
        progress.cancel = true; // Simulate cancel on first item
        return 'created';
      }),
      fetchItems: vi.fn().mockResolvedValue({
        items: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }],
        fetchedCount: 3,
      }),
    });

    await expect(orchestrateSync(config, null, false)).rejects.toThrow('Sync cancelled');

    // Should have processed only the first item before cancel was detected
    expect(config.processItem).toHaveBeenCalledTimes(1);

    const status = runningSyncs.get(TEST_CATEGORY_ID);
    expect(status?.status).toBe('cancelled');
  });

  it('should propagate fetch errors as sync failures', async () => {
    const config = makeConfig({
      fetchItems: vi.fn().mockRejectedValue(new Error('API down')),
    });

    await expect(orchestrateSync(config, null, false)).rejects.toThrow('API down');

    const status = runningSyncs.get(TEST_CATEGORY_ID);
    expect(status?.status).toBe('failed');
    expect(status?.statusMessage).toBe('API down');
  });

  it('should clean up runningSyncs after 30s delay', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null, false);

    // Progress still exists immediately after sync
    expect(runningSyncs.has(TEST_CATEGORY_ID)).toBe(true);

    // Advance past the 30s cleanup timer
    vi.advanceTimersByTime(31000);

    expect(runningSyncs.has(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should not clean up runningSyncs if a new sync started', async () => {
    const config = makeConfig();
    await orchestrateSync(config, null, false);

    // Simulate a new sync starting before cleanup fires
    const newProgress = {
      cancel: false, status: 'fetching' as const,
      statusMessage: 'New sync', progress: 0, total: 0,
      created: 0, updated: 0, errors: 0,
      currentItem: '', logId: null,
    };
    runningSyncs.set(TEST_CATEGORY_ID, newProgress);

    vi.advanceTimersByTime(31000);

    // Old cleanup should NOT have removed the new sync's progress
    expect(runningSyncs.get(TEST_CATEGORY_ID)).toBe(newProgress);
  });
});

describe('getSyncStatus', () => {
  beforeEach(() => runningSyncs.clear());
  afterEach(() => runningSyncs.clear());

  it('should return null when no sync exists', () => {
    expect(getSyncStatus(TEST_CATEGORY_ID)).toBeNull();
  });

  it('should return progress when sync exists', () => {
    const progress = {
      cancel: false, status: 'processing' as const,
      statusMessage: 'Working', progress: 5, total: 10,
      created: 3, updated: 2, errors: 0,
      currentItem: 'Item 5', logId: 42,
    };
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
    runningSyncs.set(TEST_CATEGORY_ID, {
      cancel: false, status: 'processing',
      statusMessage: 'Working', progress: 5, total: 10,
      created: 3, updated: 2, errors: 0,
      currentItem: 'Item 5', logId: 42,
    });

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(true);

    const progress = runningSyncs.get(TEST_CATEGORY_ID);
    expect(progress?.cancel).toBe(true);
    expect(progress?.statusMessage).toBe('Cancelling...');
  });

  it('should not cancel an already-complete sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, {
      cancel: false, status: 'complete',
      statusMessage: 'Done', progress: 10, total: 10,
      created: 10, updated: 0, errors: 0,
      currentItem: '', logId: 42,
    });

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });

  it('should not cancel a failed sync', () => {
    runningSyncs.set(TEST_CATEGORY_ID, {
      cancel: false, status: 'failed',
      statusMessage: 'Error', progress: 0, total: 0,
      created: 0, updated: 0, errors: 1,
      currentItem: '', logId: 42,
    });

    expect(cancelSync(TEST_CATEGORY_ID)).toBe(false);
  });
});
