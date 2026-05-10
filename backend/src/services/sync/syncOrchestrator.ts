/**
 * Sync Orchestrator
 *
 * Generic orchestration for experience sync services. Handles progress tracking,
 * cancellation, sync log lifecycle, error handling, and runningSyncs cleanup.
 * Each sync service provides domain-specific callbacks via SyncServiceConfig.
 */

import { createSyncLog, updateSyncLog, cleanupCategoryData } from './syncUtils.js';
import type { SyncProgress } from './types.js';
import { runningSyncs } from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface ErrorDetail {
  externalId: string;
  error: string;
}

export interface FetchResult<T> {
  items: T[];
  fetchedCount: number;
}

export interface SyncServiceConfig<T> {
  categoryId: number;
  logPrefix: string;
  /** Fetch and prepare items for processing. Can append to errorDetails for pre-processing errors. */
  fetchItems: (progress: SyncProgress, errorDetails: ErrorDetail[]) => Promise<FetchResult<T>>;
  /** Process a single item. Return 'created' or 'updated'. Throw to count as error. */
  processItem: (item: T, progress: SyncProgress) => Promise<'created' | 'updated'>;
  /** Display name for progress messages. */
  getItemName: (item: T) => string;
  /** External ID for error reporting. */
  getItemId: (item: T) => string;
  /** Custom cleanup for force sync (replaces default cleanupCategoryData). */
  cleanup?: (progress: SyncProgress) => Promise<void>;
}

// =============================================================================
// Orchestrator
// =============================================================================

function isSyncStillRunning(progress: SyncProgress | undefined): boolean {
  return !!progress
    && progress.status !== 'complete'
    && progress.status !== 'failed'
    && progress.status !== 'cancelled';
}

function initSyncProgress(): SyncProgress {
  return {
    cancel: false,
    status: 'fetching',
    statusMessage: 'Initializing...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    errors: 0,
    currentItem: '',
    logId: null,
  };
}

async function runForceCleanup<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
): Promise<void> {
  if (config.cleanup) {
    await config.cleanup(progress);
    return;
  }
  progress.statusMessage = 'Cleaning up existing data...';
  await cleanupCategoryData(config.categoryId, config.logPrefix, progress);
}

async function processItemsLoop<T>(
  config: SyncServiceConfig<T>,
  items: T[],
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
): Promise<void> {
  progress.status = 'processing';
  progress.total = items.length;
  progress.progress = 0;

  for (let i = 0; i < items.length; i++) {
    if (progress.cancel) throw new Error('Sync cancelled');
    const item = items[i];
    progress.currentItem = config.getItemName(item);
    progress.statusMessage = `Processing ${i + 1}/${items.length}: ${progress.currentItem}`;
    try {
      const result = await config.processItem(item, progress);
      if (result === 'created') progress.created++;
      else progress.updated++;
    } catch (err) {
      progress.errors++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ externalId: config.getItemId(item), error: errorMsg });
      console.error(`${config.logPrefix} Error processing ${config.getItemId(item)}:`, errorMsg);
    }
    progress.progress = i + 1;
  }
}

function computeFinalStatus(progress: SyncProgress): 'success' | 'partial' | 'failed' {
  if (progress.errors === 0) return 'success';
  return progress.created + progress.updated === 0 ? 'failed' : 'partial';
}

async function recordSyncFailure<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  err: unknown,
  errorDetails: ErrorDetail[],
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  progress.status = progress.cancel ? 'cancelled' : 'failed';
  progress.statusMessage = errorMsg;

  if (progress.logId) {
    errorDetails.push({ externalId: 'system', error: errorMsg });
    await updateSyncLog(config.categoryId, progress.logId, progress.status, {
      fetched: progress.total,
      created: progress.created,
      updated: progress.updated,
      errors: progress.errors,
    }, errorDetails);
  }

  if (progress.status === 'cancelled') {
    console.log(`${config.logPrefix} Cancelled:`, errorMsg);
  } else {
    console.error(`${config.logPrefix} Failed:`, errorMsg);
  }
}

/**
 * Run a sync operation with full lifecycle management.
 *
 * Handles: already-running check, progress init, sync log, force cleanup,
 * fetch, processing loop with cancellation, final status, error handling,
 * and delayed runningSyncs cleanup.
 */
export async function orchestrateSync<T>(
  config: SyncServiceConfig<T>,
  triggeredBy: number | null,
  force: boolean = false,
): Promise<void> {
  const { categoryId, logPrefix } = config;

  if (isSyncStillRunning(runningSyncs.get(categoryId))) {
    throw new Error(`${logPrefix} sync already in progress`);
  }

  const progress = initSyncProgress();
  runningSyncs.set(categoryId, progress);
  const errorDetails: ErrorDetail[] = [];

  try {
    progress.logId = await createSyncLog(categoryId, triggeredBy);
    console.log(`${logPrefix} Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}`);

    if (force) await runForceCleanup(config, progress);

    const { items, fetchedCount } = await config.fetchItems(progress, errorDetails);
    // fetchItems may append pre-processing errors before the loop counts errors itself
    progress.errors = errorDetails.length;

    await processItemsLoop(config, items, progress, errorDetails);

    const finalStatus = computeFinalStatus(progress);
    progress.status = 'complete';
    progress.statusMessage = `Complete: ${progress.created} created, ${progress.updated} updated, ${progress.errors} errors`;

    await updateSyncLog(categoryId, progress.logId, finalStatus, {
      fetched: fetchedCount,
      created: progress.created,
      updated: progress.updated,
      errors: progress.errors,
    }, errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`${logPrefix} Complete: created=${progress.created}, updated=${progress.updated}, errors=${progress.errors}`);
  } catch (err) {
    await recordSyncFailure(config, progress, err, errorDetails);
    throw err;
  } finally {
    // Clean up after delay, but only if this sync's progress is still current.
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(categoryId) === thisProgress) {
        runningSyncs.delete(categoryId);
      }
    }, 30000);
  }
}

// =============================================================================
// Generic Status & Cancel
// =============================================================================

/**
 * Get sync status for any category by ID.
 */
export function getSyncStatus(categoryId: number): SyncProgress | null {
  return runningSyncs.get(categoryId) || null;
}

/**
 * Cancel a running sync for any category by ID.
 */
export function cancelSync(categoryId: number): boolean {
  const progress = runningSyncs.get(categoryId);
  if (progress && progress.status !== 'complete' && progress.status !== 'failed' && progress.status !== 'cancelled') {
    progress.cancel = true;
    progress.statusMessage = 'Cancelling...';
    return true;
  }
  return false;
}
