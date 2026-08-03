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
  countSeenAmongActive,
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

/**
 * An entity the source offered that is not of the kind this category holds —
 * a Wikidata collection answering a museum query, say. Nothing failed, so it is
 * counted apart from errors and leaves the run's status alone.
 */
export interface FilteredEntity {
  externalId: string;
  name: string;
  reason: string;
}

export interface FetchResult<T> {
  items: T[];
  fetchedCount: number;
  filtered?: FilteredEntity[];
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
  /** The row had been flagged missing and the source has produced it again. */
  returnedFromMissing: boolean;
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
    filtered: 0,
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

/**
 * Name what happened to a row.
 *
 * Only reached for rows worth storing. An `unchanged` outcome therefore means
 * the row carried a curated conflict — a return from missing is the other
 * reason an untouched row is recorded, and it is answered above.
 */
function resolveChangeType(result: ProcessItemResult): ChangeRecord['changeType'] {
  if (result.returnedFromMissing && result.outcome !== 'created') return 'returned';
  if (result.outcome === 'unchanged') return 'conflict';
  return result.outcome;
}

/**
 * Fold one processed item into the run's counters and changeset.
 *
 * Unchanged rows are counted but not stored — a UNESCO run would otherwise
 * write 1247 rows of noise around the few dozen that say anything — unless they
 * carry news of their own, which the body spells out.
 */
function recordItemOutcome<T>(
  config: SyncServiceConfig<T>,
  item: T,
  result: ProcessItemResult,
  progress: SyncProgress,
  changes: ChangeRecord[],
): void {
  const { changedFields, curatedConflicts, significance } = result.changeSet;
  progress.curatedConflicts += curatedConflicts.length;

  if (result.outcome === 'created') progress.created++;
  else if (result.outcome === 'updated') progress.updated++;
  else progress.unchanged++;

  if (progress.logId === null) return;

  // Unchanged rows are normally not stored, but two of them carry news anyway:
  // one whose source diverged from a curator's edit (recorded nowhere else),
  // and one the source has started listing again after we flagged it missing.
  const worthRecording = result.outcome !== 'unchanged'
    || curatedConflicts.length > 0
    || result.returnedFromMissing;
  if (!worthRecording) return;

  const changeType = resolveChangeType(result);

  changes.push({
    syncLogId: progress.logId,
    experienceId: result.experienceId,
    externalId: config.getItemId(item),
    nameSnapshot: result.nameSnapshot,
    changeType,
    // Conflicts travel with the applied changes: the value the source proposed
    // is stored even though the upsert refused it, or "accept source" would
    // later have nothing to apply.
    changedFields: [...changedFields, ...curatedConflicts],
    significance,
    error: null,
  });
}

/**
 * Fold a failed item into the run's counters, error list and changeset.
 *
 * error_details already carried the message; the changeset row is what ties it
 * to a named object rather than a bare external id.
 */
function recordItemFailure<T>(
  config: SyncServiceConfig<T>,
  item: T,
  err: unknown,
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
  changes: ChangeRecord[],
): void {
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

/**
 * Fold entities the fetch rejected into the run — as their own count, not as
 * errors. A collection answering a museum query did not fail; it was never a
 * museum.
 */
function recordFilteredEntities(
  filtered: FilteredEntity[],
  progress: SyncProgress,
  changes: ChangeRecord[],
): void {
  for (const entity of filtered) {
    progress.filtered++;
    if (progress.logId === null) continue;
    changes.push({
      syncLogId: progress.logId,
      experienceId: null,
      externalId: entity.externalId,
      nameSnapshot: entity.name,
      changeType: 'filtered',
      changedFields: null,
      significance: null,
      error: entity.reason,
    });
  }
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
      recordItemOutcome(config, item, result, progress, changes);
    } catch (err) {
      recordItemFailure(config, item, err, progress, errorDetails, changes);
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
  seenCount: number,
  force: boolean,
  changes: ChangeRecord[],
  seenExternalIds: string[],
): Promise<string | null> {
  const skipReason = missingDetectionSkipReason({
    sourceCompleteness: config.sourceCompleteness,
    errors: progress.errors,
    cancelled: progress.cancel,
    force,
    seenCount,
    previousActiveCount,
  });

  if (skipReason !== null || progress.logId === null) return skipReason;

  const missing = await flagMissingExperiences(
    config.categoryId, progress.logId, progress.dryRun, seenExternalIds,
  );
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
  alreadyRecorded: boolean = false,
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  progress.status = progress.cancel ? 'cancelled' : 'failed';
  progress.statusMessage = errorMsg;

  if (progress.logId) {
    errorDetails.push({ externalId: 'system', error: errorMsg });
    try {
      if (!alreadyRecorded) await recordSyncChanges(changes);
    } catch (recordErr) {
      // Same marker the success path leaves: the run card reads it to tell a
      // lost record apart from a run that predates the changeset entirely.
      const msg = recordErr instanceof Error ? recordErr.message : String(recordErr);
      errorDetails.push({ externalId: 'changeset', error: `Failed to record changeset: ${msg}` });
      console.error('%s Failed to record changeset:', config.logPrefix, msg);
    }
    await updateSyncLog(config.categoryId, progress.logId, progress.status, {
      fetched: progress.total,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      filtered: progress.filtered,
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
  // The failure path also records the changeset, so it has to know whether the
  // success path already did — a throw from updateSyncLog would otherwise
  // insert every row twice.
  let changesRecorded = false;

  try {
    progress.logId = await createSyncLog(categoryId, triggeredBy, dryRun);
    console.log(`${logPrefix} Started sync (log ID: ${progress.logId})${force ? ' [FORCE MODE]' : ''}${dryRun ? ' [DRY RUN]' : ''}`);

    const previousActiveCount = await countActiveExperiences(categoryId);

    if (force) await runForceCleanup(config, progress);

    const { items, fetchedCount, filtered } = await config.fetchItems(progress, errorDetails);
    // fetchItems may append pre-processing errors before the loop counts errors itself
    progress.errors = errorDetails.length;

    recordFilteredEntities(filtered ?? [], progress, changes);

    // Both sides of the coverage ratio are measured against the table as it
    // stood before this run touched it. Counting afterwards would fold in the
    // rows the run just created and the ones it just cleared missing_since on —
    // neither was in previousActiveCount, and both only lift the ratio past the
    // floor the guard exists to enforce.
    const seenExternalIds = items.map(config.getItemId);
    // Skipped under force as well: the cleanup above emptied the category, so
    // the count would be 0 against a pre-cleanup denominator and would report a
    // coverage failure that never happened.
    const seenCount = config.sourceCompleteness === 'authoritative' && !force
      ? await countSeenAmongActive(categoryId, seenExternalIds)
      : 0;

    const context: SyncRunContext = { dryRun, syncLogId: progress.logId };
    await processItemsLoop(config, items, progress, errorDetails, changes, context);

    const detectionSkippedReason = await detectMissing(
      config, progress, previousActiveCount, seenCount, force, changes, seenExternalIds,
    );

    // Recorded before the log is closed, but never at the cost of closing it:
    // a failed insert here used to leave the run stuck at 'running' forever.
    try {
      await recordSyncChanges(changes);
      changesRecorded = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ externalId: 'changeset', error: `Failed to record changeset: ${msg}` });
      progress.errors++;
      console.error('%s Failed to record changeset:', logPrefix, msg);
    }

    // Computed after that attempt: a run whose per-object record never landed is
    // not a clean run, whatever the items themselves did, and an operator
    // reading `success` over a missing changeset would be misled.
    const finalStatus = computeFinalStatus(progress);
    // A failed run says so in the state itself, not only in the message: the
    // UI reads `status` to decide what happened, and 'complete' over a failed
    // verdict is the one case where the two genuinely disagree. 'partial' has
    // no state of its own — the message carries it.
    progress.status = finalStatus === 'failed' ? 'failed' : 'complete';
    const verdict = finalStatus === 'success' ? 'Complete' : `Complete (${finalStatus})`;
    progress.statusMessage = `${verdict}: ${progress.created} created, ${progress.updated} updated, `
      + `${progress.unchanged} unchanged, ${progress.missing} missing, ${progress.errors} errors`;

    await updateSyncLog(categoryId, progress.logId, finalStatus, {
      fetched: fetchedCount,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      filtered: progress.filtered,
      errors: progress.errors,
      detectionSkippedReason,
    }, errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`${logPrefix} Complete: created=${progress.created}, updated=${progress.updated}, unchanged=${progress.unchanged}, missing=${progress.missing}, errors=${progress.errors}`);
  } catch (err) {
    await recordSyncFailure(config, progress, err, errorDetails, changes, changesRecorded);
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
