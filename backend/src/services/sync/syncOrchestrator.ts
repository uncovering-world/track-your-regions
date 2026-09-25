/**
 * Sync Orchestrator
 *
 * Generic orchestration for experience sync services: progress tracking,
 * cancellation, the order of a run's phases, error handling, and runningSyncs
 * cleanup. Each phase's writes live beside it — the item outcome
 * (`itemOutcome.ts`), missing detection (`missingDetection.ts`), the admission
 * step (`admissionStep.ts`), the run log (`runLog.ts`) and placement
 * (`placement.ts`) — and each sync service provides domain-specific callbacks
 * via `SyncServiceConfig` (`syncContract.ts`).
 */

import { createSyncLog, updateSyncLog } from './syncUtils.js';
import type { ChangeRecord } from './changeRecorder.js';
import { finishPlacement, enterAssigningPhase, terminalStatus } from './placement.js';
import { countAdmitted, markRefused } from './admission.js';
import {
  missingDetectionSkipReason,
  flagMissingExperiences,
  countActiveExperiences,
  countSeenAmongActive,
} from './missingDetection.js';
import { recordItemOutcome, recordItemFailure, recordFilteredEntities } from './itemOutcome.js';
import { applyAdmissionSweep, badgeAdmitted } from './admissionStep.js';
import {
  completionMessage,
  computeFinalStatus,
  recordChangesetOrMark,
  recordSyncFailure,
  runCounters,
} from './runLog.js';
import type { SyncRunContext, SyncServiceConfig } from './syncContract.js';
import type { SyncProgress, RunVerdict, ErrorDetail } from './types.js';
import { runningSyncs, isTerminalSyncStatus } from './types.js';

// =============================================================================
// Orchestrator
// =============================================================================


function isSyncStillRunning(progress: SyncProgress | undefined): boolean {
  return !!progress
    && !isTerminalSyncStatus(progress.status);
}

function initSyncProgress(dryRun: boolean): SyncProgress {
  return {
    cancel: false,
    kind: 'sync',
    status: 'fetching',
    statusMessage: dryRun ? 'Initializing preview...' : 'Initializing...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    held: 0,
    filtered: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun,
  };
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

  try {
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
    // The primary line, above the bar: `Processing N/N: <name>` would
    // otherwise stand there through missing detection, the admission sweep,
    // the changeset and the log close, until the completion line replaces
    // it. A cancelled run keeps its own words — the throw above skips this.
    progress.statusMessage = `Processed ${items.length}/${items.length}, tidying up...`;
  } finally {
    // The loop is the only thing that has a current object, so it is the
    // loop that drops it — on both exits, since a cancelled run still enters
    // the placement phase for what it moved, with the finished item's name
    // still set (the throw fires before the next item's is assigned). The
    // panel shows the name whenever it is non-empty, and nothing after this
    // point handles one object: left set, the last object's name sat under
    // the bar through the tidying up and the whole placement phase, as if
    // the run were still on it.
    progress.currentItem = '';
  }
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
  changes: ChangeRecord[],
  seenExternalIds: string[],
): Promise<string | null> {
  const skipReason = missingDetectionSkipReason({
    sourceCompleteness: config.sourceCompleteness,
    errors: progress.errors,
    cancelled: progress.cancel,
    seenCount,
    previousActiveCount,
  });

  if (skipReason !== null || progress.logId === null) return skipReason;

  const missing = await flagMissingExperiences(
    config.sourceId, progress.logId, progress.dryRun, seenExternalIds,
  );
  progress.missing = missing.length;
  changes.push(...missing);
  return null;
}

/**
 * Run a sync operation with full lifecycle management.
 *
 * Handles: already-running check, progress init, sync log, fetch, processing
 * loop with cancellation, changeset recording, missing detection, final status,
 * error handling, and delayed runningSyncs cleanup.
 *
 * A dry run walks the same path — same fetch, same diff, same changeset — and
 * writes everything except the experiences themselves. That makes a real source
 * delta reviewable without spending it.
 */
export async function orchestrateSync<T>(
  config: SyncServiceConfig<T>,
  triggeredBy: number | null,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  const { sourceId, logPrefix } = config;
  const dryRun = options.dryRun ?? false;

  if (isSyncStillRunning(runningSyncs.get(sourceId))) {
    throw new Error(`${logPrefix} sync already in progress`);
  }

  const progress = initSyncProgress(dryRun);
  runningSyncs.set(sourceId, progress);
  const errorDetails: ErrorDetail[] = [];
  const changes: ChangeRecord[] = [];
  // Experiences whose geometry moved, so their region assignment is stale.
  const movedExperiences = new Set<number>();
  // The verdict the run reached, applied once placement has also finished.
  let finishedStatus: RunVerdict | undefined;
  // The failure path also records the changeset, so it has to know whether the
  // success path already did — a throw from updateSyncLog would otherwise
  // insert every row twice.
  let changesRecorded = false;
  // The two guards' verdicts, held outside the try so the failure path can
  // record them too: a run that skipped detection or withdrawal and then died
  // would otherwise leave NULL on its row, and the card could not say why
  // nothing was delisted or withdrawn before it failed. Every museum run
  // carries the first (its source is ranked), so the shape is the common one
  // and only the throw is rare.
  let detectionSkippedReason: string | null = null;
  let withdrawalSkippedReason: string | null = null;

  try {
    progress.logId = await createSyncLog(sourceId, triggeredBy, dryRun);
    console.log(`${logPrefix} Started sync (log ID: ${progress.logId})${dryRun ? ' [DRY RUN]' : ''}`);

    const previousActiveCount = await countActiveExperiences(sourceId);
    // Read before the run writes, so the sweep's floor compares like with like.
    const previousAdmittedCount = config.recomputesMembership ? await countAdmitted(sourceId) : 0;

    const fetched = await config.fetchItems(progress, errorDetails);
    const { items, fetchedCount, filtered } = fetched;
    withdrawalSkippedReason = fetched.withdrawalSkippedReason ?? null;
    // fetchItems may append pre-processing errors before the loop counts errors itself
    progress.errors = errorDetails.length;
    if (withdrawalSkippedReason !== null) {
      console.log(`${logPrefix} Withdrawals skipped: ${withdrawalSkippedReason}`);
    }

    // Unconditional, and before anything else touches admission: the run named
    // these and a rule turned them down, which no coverage floor or error count
    // can make less true (ADR-0024).
    const refusedRows = await markRefused(sourceId, filtered ?? [], dryRun);
    recordFilteredEntities(filtered ?? [], progress, changes, refusedRows);
    // An object a row holds is reported the same way and marked nowhere: it
    // is not a row of this source, whatever id it shares with one. And named
    // once: a chapel the fame door refused that an admitted basilica's `P276`
    // names is in both lists, and two rows for one entity would count it
    // twice — every producer keeps that rule inside its own list, and this is
    // where the two lists meet.
    const named = new Set((filtered ?? []).map((entity) => entity.externalId));
    recordFilteredEntities(
      (fetched.refusedContents ?? []).filter((entity) => !named.has(entity.externalId)),
      progress, changes,
    );

    // Both sides of the coverage ratio are measured against the table as it
    // stood before this run touched it. Counting afterwards would fold in the
    // rows the run just created and the ones it just cleared missing_since on —
    // neither was in previousActiveCount, and both only lift the ratio past the
    // floor the guard exists to enforce.
    const seenExternalIds = items.map(config.getItemId);
    const seenCount = config.sourceCompleteness === 'authoritative'
      ? await countSeenAmongActive(sourceId, seenExternalIds)
      : 0;

    const context: SyncRunContext = {
      dryRun,
      syncLogId: progress.logId,
      onLocationsChanged: (experienceId) => movedExperiences.add(experienceId),
      withdrawalSkippedReason,
    };
    await processItemsLoop(config, items, progress, errorDetails, changes, context);
    // The loop reads the flag before each item, so a press during the last one
    // would otherwise go unread. Later windows are closed at the other end:
    // `cancelSync` refuses once there is no item left to interrupt.
    if (progress.cancel) throw new Error('Sync cancelled');

    detectionSkippedReason = await detectMissing(
      config, progress, previousActiveCount, seenCount, changes, seenExternalIds,
    );

    const sweep = await applyAdmissionSweep(
      config, progress, seenExternalIds, previousAdmittedCount, changes,
    );
    if (sweep.skipReason !== null) {
      console.log(`${logPrefix} Admission sweep skipped: ${sweep.skipReason}`);
    }
    await badgeAdmitted(config, progress, seenExternalIds, items, sweep.swept);

    changesRecorded = await recordChangesetOrMark(changes, errorDetails, progress, logPrefix);

    // Computed after that attempt: a run whose per-object record never landed is
    // not a clean run, whatever the items themselves did, and an operator
    // reading `success` over a missing changeset would be misled.
    const finalStatus = computeFinalStatus(progress, withdrawalSkippedReason);
    // Everything that is not `failed` is a run that reached `complete`: the
    // log row's `partial` is not a progress state (`computeFinalStatus` names
    // the three things called `partial`).
    //
    // Not 'complete' yet either way: placement runs in the `finally` below and
    // is part of finishing the run, so declaring the run over here would let a
    // poller see `running: false` while it is still going — and read a status
    // the placement may be about to downgrade.
    finishedStatus = finalStatus === 'failed' ? 'failed' : 'complete';
    progress.statusMessage = completionMessage(progress, finalStatus, withdrawalSkippedReason);

    await updateSyncLog(sourceId, progress.logId, finalStatus, runCounters(
      progress, fetchedCount, detectionSkippedReason, withdrawalSkippedReason,
    ), errorDetails.length > 0 ? errorDetails : undefined);

    console.log(`${logPrefix} Complete: created=${progress.created}, updated=${progress.updated}, unchanged=${progress.unchanged}, held=${progress.held}, missing=${progress.missing}, errors=${progress.errors}`);

  } catch (err) {
    // Decided here, before the call: `recordSyncFailure` awaits `updateSyncLog`,
    // and a database outage — the very thing that lands a run here — would
    // reject it. A verdict produced inside would then never come back, leaving
    // the run non-terminal: `isSyncStillRunning` true forever, a spinner over a
    // finished run, and retries answered 409 until the cleanup timer fires.
    finishedStatus = progress.cancel ? 'cancelled' : 'failed';
    await recordSyncFailure(
      config, progress, err, errorDetails, changes, changesRecorded, finishedStatus,
      detectionSkippedReason, withdrawalSkippedReason);
    throw err;
  } finally {
    // The run is not over, but it is no longer processing items: placement is
    // its own phase, and a window of its own on a first run, where the whole
    // source lands in `movedExperiences` and every world view gets its own
    // transaction (seconds per world view, #851). Naming the phase
    // keeps `isSyncStillRunning` true — the poller must keep polling — while
    // giving `cancelSync` something to refuse and the panel something truthful
    // to show. Without it the panel offers a Cancel that nothing reads, beside
    // a completion message and a full bar.
    enterAssigningPhase(progress, movedExperiences, dryRun, finishedStatus);

    // Placed on the way out, not on the success path. A cancel is a button, and
    // a run stopped halfway has already moved the points it got to — leaving
    // those unplaced would put real objects in the wrong region, or nowhere,
    // until someone noticed. The set holds what was actually written, so
    // placing it is right however the run ended. It reports rather than throws,
    // so it cannot displace the failure that brought us here.
    const placed = await finishPlacement(config, progress, errorDetails, movedExperiences, {
      dryRun, finishedStatus, logPrefix,
    });

    // Only now is the run over, so only now may a poller see it that way. Both
    // paths set `finishedStatus` before anything that can reject — the success
    // path at the end of the try, the failure path as the catch's first
    // statement — so it is always one of the three terminal values here. The
    // default is `failed` rather than the run's own status: if a path is ever
    // added that forgets, a run reported as failed is recoverable, while one
    // left non-terminal spins a poller forever and answers retries with 409.
    progress.status = terminalStatus(placed, finishedStatus);

    // Clean up after delay, but only if this sync's progress is still current.
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(sourceId) === thisProgress) {
        runningSyncs.delete(sourceId);
      }
    }, 30000);
  }
}

// =============================================================================
// Generic Status & Cancel
// =============================================================================

/**
 * Get sync status for any source by ID.
 */
export function getSyncStatus(sourceId: number): SyncProgress | null {
  return runningSyncs.get(sourceId) || null;
}

/**
 * Can a cancel still be acted on?
 *
 * Only while there is an item loop left to interrupt: fetching, or processing
 * with items remaining. Past the last item nothing reads the flag — detection,
 * changeset recording, log closure and placement never look at it — so
 * accepting there would report a cancellation that does not happen and let the
 * run finish as a success.
 *
 * Exported because the admin panel disables its button on exactly this rule.
 * Derived twice, the two would drift, and the drift shows up as a button
 * promising something the server refuses.
 */
export function isCancellable(progress: SyncProgress): boolean {
  return progress.status === 'fetching'
    || (progress.status === 'processing' && progress.progress < progress.total);
}

/**
 * Cancel a running sync for any source by ID.
 *
 * Answers whether the press was acted on, not whether the run stopped: it sets
 * a flag the item loop reads, and refuses outright once there is no loop left.
 */
export function cancelSync(sourceId: number): boolean {
  const progress = runningSyncs.get(sourceId);
  if (progress && isCancellable(progress)) {
    progress.cancel = true;
    progress.statusMessage = 'Cancelling...';
    return true;
  }
  return false;
}
