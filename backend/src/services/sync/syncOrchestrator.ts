/**
 * Sync Orchestrator
 *
 * Generic orchestration for experience sync services. Handles progress tracking,
 * cancellation, sync log lifecycle, error handling, and runningSyncs cleanup.
 * Each sync service provides domain-specific callbacks via SyncServiceConfig.
 */

import { createSyncLog, updateSyncLog, cleanupCategoryData } from './syncUtils.js';
import { recordSyncChanges, type ChangeRecord } from './changeRecorder.js';
import {
  missingDetectionSkipReason,
  flagMissingExperiences,
  countActiveExperiences,
  type SourceCompleteness,
} from './missingDetection.js';
import type { ChangeSetResult } from './changeSet.js';
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

/** What a run is doing, handed to every processItem call. */
export interface SyncRunContext {
  dryRun: boolean;
  syncLogId: number | null;
}

export interface ProcessItemResult {
  outcome: 'created' | 'updated' | 'unchanged';
  experienceId: number | null;
  nameSnapshot: string;
  changeSet: ChangeSetResult;
}

export interface SyncServiceConfig<T> {
  categoryId: number;
  logPrefix: string;
  /**
   * Whether the source hands over its whole collection. Only `authoritative`
   * sources can have absence read as a delisting — a top-N Wikidata query drops
   * objects for reasons that have nothing to do with them existing.
   */
  sourceCompleteness: SourceCompleteness;
  /** Fetch and prepare items for processing. Can append to errorDetails for pre-processing errors. */
  fetchItems: (progress: SyncProgress, errorDetails: ErrorDetail[]) => Promise<FetchResult<T>>;
  /** Process a single item and describe what happened to it. Throw to count as error. */
  processItem: (item: T, progress: SyncProgress, context: SyncRunContext) => Promise<ProcessItemResult>;
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

function initSyncProgress(dryRun: boolean): SyncProgress {
  return {
    cancel: false,
    status: 'fetching',
    statusMessage: dryRun ? 'Initializing preview...' : 'Initializing...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun,
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
  changes: ChangeRecord[],
  context: SyncRunContext,
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
      const result = await config.processItem(item, progress, context);
      progress.curatedConflicts += result.changeSet.curatedConflicts.length;

      if (result.outcome === 'created') progress.created++;
      else if (result.outcome === 'updated') progress.updated++;
      else progress.unchanged++;

      // Unchanged rows are counted, not stored: the signal would drown in them.
      if (result.outcome !== 'unchanged' && progress.logId !== null) {
        changes.push({
          syncLogId: progress.logId,
          experienceId: result.experienceId,
          externalId: config.getItemId(item),
          nameSnapshot: result.nameSnapshot,
          changeType: result.outcome,
          changedFields: result.changeSet.changedFields,
          significance: result.changeSet.significance,
          error: null,
        });
      }
    } catch (err) {
      progress.errors++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ externalId: config.getItemId(item), error: errorMsg });
      if (progress.logId !== null) {
        changes.push({
          syncLogId: progress.logId,
          experienceId: null,
          externalId: config.getItemId(item),
          nameSnapshot: config.getItemName(item),
          changeType: 'failed',
          changedFields: null,
          significance: null,
          error: errorMsg,
        });
      }
      console.error('%s Error processing %s:', config.logPrefix, config.getItemId(item), errorMsg);
    }
    progress.progress = i + 1;
  }
}

function computeFinalStatus(progress: SyncProgress): 'success' | 'partial' | 'failed' {
  if (progress.errors === 0) return 'success';
  // A run that touched nothing at all failed; one that found everything already
  // current did not, even if a straggler errored.
  const seen = progress.created + progress.updated + progress.unchanged;
  return seen === 0 ? 'failed' : 'partial';
}

/**
 * Flag what the source stopped listing, unless a guard says the run cannot be
 * trusted to know. Returns the reason detection was skipped, if it was.
 */
async function detectMissing<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  previousActiveCount: number,
  changes: ChangeRecord[],
): Promise<string | null> {
  const skipReason = missingDetectionSkipReason({
    sourceCompleteness: config.sourceCompleteness,
    errors: progress.errors,
    cancelled: progress.cancel,
    seenCount: progress.created + progress.updated + progress.unchanged,
    previousActiveCount,
  });

  if (skipReason !== null || progress.logId === null) return skipReason;

  const missing = await flagMissingExperiences(config.categoryId, progress.logId, progress.dryRun);
  progress.missing = missing.length;
  changes.push(...missing);
  return null;
}

async function recordSyncFailure<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  err: unknown,
  errorDetails: ErrorDetail[],
  changes: ChangeRecord[],
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  progress.status = progress.cancel ? 'cancelled' : 'failed';
  progress.statusMessage = errorMsg;

  if (progress.logId) {
    errorDetails.push({ externalId: 'system', error: errorMsg });
    await recordSyncChanges(changes);
    await updateSyncLog(config.categoryId, progress.logId, progress.status, {
      fetched: progress.total,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      errors: progress.errors,
    }, errorDetails);
  }

  if (progress.status === 'cancelled') {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- logPrefix is a module constant supplied by the sync services
    console.log(`${config.logPrefix} Cancelled:`, errorMsg);
  } else {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- logPrefix is a module constant supplied by the sync services
    console.error(`${config.logPrefix} Failed:`, errorMsg);
  }
}

/**
 * Run a sync operation with full lifecycle management.
 *
 * Handles: already-running check, progress init, sync log, force cleanup,
 * fetch, processing loop with cancellation, changeset recording, missing
 * detection, final status, error handling, and delayed runningSyncs cleanup.
 *
 * A dry run walks the same path — same fetch, same diff, same changeset — and
 * writes everything except the experiences themselves. That makes a real source
 * delta reviewable without spending it.
 */
export async function orchestrateSync<T>(
  config: SyncServiceConfig<T>,
  triggeredBy: number | null,
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  const { categoryId, logPrefix } = config;
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;

  if (force && dryRun) {
    throw new Error(`${logPrefix} cannot run a dry run in force mode: force deletes before it previews`);
  }

  if (isSyncStillRunning(runningSyncs.get(categoryId))) {
    throw new Error(`${logPrefix} sync already in progress`);
  }

  const progress = initSyncProgress(dryRun);
  runningSyncs.set(categoryId, progress);
  const errorDetails: ErrorDetail[] = [];
  const changes: ChangeRecord[] = [];

  try {
    progress.logId = await createSyncLog(categoryId, triggeredBy, dryRun);
    console.log(`${logPrefix} Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}${dryRun ? ' [DRY RUN]' : ''}`);

    const previousActiveCount = await countActiveExperiences(categoryId);

    if (force) await runForceCleanup(config, progress);

    const { items, fetchedCount } = await config.fetchItems(progress, errorDetails);
    // fetchItems may append pre-processing errors before the loop counts errors itself
    progress.errors = errorDetails.length;

    const context: SyncRunContext = { dryRun, syncLogId: progress.logId };
    await processItemsLoop(config, items, progress, errorDetails, changes, context);

    const detectionSkippedReason = await detectMissing(config, progress, previousActiveCount, changes);

    const finalStatus = computeFinalStatus(progress);
    progress.status = 'complete';
    progress.statusMessage = `Complete: ${progress.created} created, ${progress.updated} updated, ${progress.unchanged} unchanged, ${progress.missing} missing, ${progress.errors} errors`;

    await recordSyncChanges(changes);
    await updateSyncLog(categoryId, progress.logId, finalStatus, {
      fetched: fetchedCount,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      errors: progress.errors,
      detectionSkippedReason,
    }, errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`${logPrefix} Complete: created=${progress.created}, updated=${progress.updated}, unchanged=${progress.unchanged}, missing=${progress.missing}, errors=${progress.errors}`);
  } catch (err) {
    await recordSyncFailure(config, progress, err, errorDetails, changes);
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
