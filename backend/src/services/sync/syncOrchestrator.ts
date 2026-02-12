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

  // Check if already running
  const existing = runningSyncs.get(categoryId);
  if (existing && existing.status !== 'complete' && existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new Error(`${logPrefix} sync already in progress`);
  }

  // Initialize progress
  const progress: SyncProgress = {
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
  runningSyncs.set(categoryId, progress);

  const errorDetails: ErrorDetail[] = [];

  try {
    progress.logId = await createSyncLog(categoryId, triggeredBy);
    console.log(`${logPrefix} Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}`);

    // Force cleanup
    if (force) {
      if (config.cleanup) {
        await config.cleanup(progress);
      } else {
        progress.statusMessage = 'Cleaning up existing data...';
        await cleanupCategoryData(categoryId, logPrefix, progress);
      }
    }

    // Fetch items
    const { items, fetchedCount } = await config.fetchItems(progress, errorDetails);

    // Sync pre-processing errors (fetchItems may append to errorDetails)
    progress.errors = errorDetails.length;

    // Processing loop
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
        if (result === 'created') {
          progress.created++;
        } else {
          progress.updated++;
        }
      } catch (err) {
        progress.errors++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errorDetails.push({ externalId: config.getItemId(item), error: errorMsg });
        console.error(`${logPrefix} Error processing ${config.getItemId(item)}:`, errorMsg);
      }

      progress.progress = i + 1;
    }

    // Final status
    const totalProcessed = progress.created + progress.updated;
    const finalStatus = progress.errors > 0 && totalProcessed === 0
      ? 'failed'
      : progress.errors > 0
      ? 'partial'
      : 'success';

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
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = errorMsg;

    if (progress.logId) {
      errorDetails.push({ externalId: 'system', error: errorMsg });
      await updateSyncLog(categoryId, progress.logId, progress.status, {
        fetched: progress.total,
        created: progress.created,
        updated: progress.updated,
        errors: progress.errors,
      }, errorDetails);
    }

    if (progress.status === 'cancelled') {
      console.log(`${logPrefix} Cancelled:`, errorMsg);
    } else {
      console.error(`${logPrefix} Failed:`, errorMsg);
    }
    throw err;
  } finally {
    // Clean up after delay, but only if this sync's progress is still current
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
