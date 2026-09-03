/**
 * Sync Orchestrator
 *
 * Generic orchestration for experience sync services. Handles progress tracking,
 * cancellation, sync log lifecycle, error handling, and runningSyncs cleanup.
 * Each sync service provides domain-specific callbacks via SyncServiceConfig.
 */

import { createSyncLog, updateSyncLog } from './syncUtils.js';
import { recordSyncChanges, type ChangeRecord } from './changeRecorder.js';
import { CHANGESET_LOST_MARKER } from './syncLogMarkers.js';
import { finishPlacement, enterAssigningPhase, terminalStatus } from './placement.js';
import {
  admissionSweepSkipReason,
  countAdmitted,
  markIconic,
  markNotAdmitted,
  markRefused,
  restoreAdmission,
  type AdmissionRow,
} from './admission.js';
import {
  missingDetectionSkipReason,
  flagMissingExperiences,
  countActiveExperiences,
  countSeenAmongActive,
  type SourceCompleteness,
} from './missingDetection.js';
import type { ChangeSetResult } from './changeSet.js';
import type { SyncProgress } from './types.js';
import { runningSyncs, isTerminalSyncStatus } from './types.js';
import type { RunVerdict, ErrorDetail, ContentsByKind } from './types.js';
import { contentsHeld, recordedContents } from './types.js';

// =============================================================================
// Types
// =============================================================================


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
  /**
   * Why this run may not withdraw the contents it stopped seeing, or absent
   * when it may.
   *
   * A collector that measures what it fetched against a floor answers here —
   * the museum run does, over its works (ADR-0044) — and the answer goes three
   * places: onto the log row, so a run that marked nothing because it saw too
   * little is not read as one that found nothing to mark; into every
   * `processItem` call through the context, so the writer marks nothing behind
   * it; and into the run's status, which cannot be `success` while the source's
   * departures are unrecorded. A source whose contents need no floor — points
   * are paired per object — leaves it out.
   */
  withdrawalSkippedReason?: string | null;
}


/** What a run is doing, handed to every processItem call. */
export interface SyncRunContext {
  dryRun: boolean;
  syncLogId: number | null;
  /**
   * Register that an experience's locations were just written, so the run can
   * place it before it ends.
   *
   * Called at the write, not carried back on the result. A service can throw
   * *after* moving a point — the museum one does, since treasures are upserted
   * afterwards — and a returned field is lost when it does. The point has
   * already moved on disk by then, so the object would keep a stale assignment
   * naming the region it left, with nothing to signal it.
   */
  onLocationsChanged: (experienceId: number) => void;
  /**
   * The collector's own verdict on withdrawing contents, carried back to the
   * writer: `FetchResult.withdrawalSkippedReason`, or null where the run may
   * withdraw. Threaded rather than remembered in module state so the order —
   * floor first, withdrawal second, never the reverse — is visible in one place.
   */
  withdrawalSkippedReason: string | null;
}

export interface ProcessItemResult {
  outcome: 'created' | 'updated' | 'unchanged';
  experienceId: number | null;
  nameSnapshot: string;
  changeSet: ChangeSetResult;
  /** The row had been flagged missing and the source has produced it again. */
  returnedFromMissing: boolean;
  /**
   * What the run did to the object's contents, by kind (ADR-0026).
   *
   * Optional because a source with nothing to hold has nothing to report, and
   * absent is not the same as an empty delta: one says the question does not
   * apply, the other that it was asked and the answer was nothing.
   */
  contents?: ContentsByKind;
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
  /**
   * Whether every run recomputes the whole membership from the whole pool,
   * rather than fetching a published list. Only such a source may sweep: for it
   * "absent from the admitted set" is a decision, and for the others it is the
   * ambiguous silence ADR-0020 was written about (ADR-0024).
   */
  recomputesMembership?: boolean;
  /**
   * Whether belonging to the category *is* the must-see badge: the source's
   * admission rule is a fame threshold, so every row it admits holds a work
   * above the line and carries `is_iconic` for that (works-first museums,
   * ADR-0023). A listing, or a source whose rule is not fame, badges nothing
   * however its membership is computed — the badge is a property of the rule,
   * not of recomputing (ADR-0045 decision 5). Read after the admission step,
   * once every row of the run has the admission it will keep (#760).
   */
  badgesAdmitted?: boolean;
  /** Fetch and prepare items for processing. Can append to errorDetails for pre-processing errors. */
  fetchItems: (progress: SyncProgress, errorDetails: ErrorDetail[]) => Promise<FetchResult<T>>;
  /** Process a single item and describe what happened to it. Throw to count as error. */
  processItem: (item: T, progress: SyncProgress, context: SyncRunContext) => Promise<ProcessItemResult>;
  /** Display name for progress messages. */
  getItemName: (item: T) => string;
  /** External ID for error reporting. */
  getItemId: (item: T) => string;
}

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

/**
 * The category's gate kept every proposed write out of a row a reader can
 * already see: nothing moved, and a verdict is waiting (#519).
 *
 * The one predicate behind two readers — the changeset row's word and the run's
 * `held` counter — so the two can never disagree, which migration 038 relies on
 * to fill the counter for runs that predate it from the rows they recorded.
 * Not `heldFields` alone: a created row under a gate is written pending rather
 * than refused, and `created` already carries that news.
 *
 * Either level. A field of a part readers can see is held like the object's own
 * since ADR-0037, and the row is then held whichever level the proposal sits at
 * — every field of the museum's own came through, and what a curator is being
 * asked about is one work's attribution. Read off the *recorded* contents rather
 * than the raw delta, so the same shape the changeset row carries is the one the
 * counter answers for.
 */
function wasHeld(result: ProcessItemResult, contents: ContentsByKind | null): boolean {
  return result.outcome === 'unchanged'
    && (result.changeSet.heldFields.length > 0 || contentsHeld(contents));
}

/**
 * Name what happened to a row.
 *
 * Only reached for rows worth storing, so an `unchanged` outcome means the run
 * refused something — a return from missing is the other reason an untouched row
 * is recorded, and it is answered above.
 *
 * The two refusals are two different events and get two different words (#519).
 * `conflict` is a value a curator had claimed: the stored value won on purpose
 * and nothing is waiting. `held` is a value the category's gate kept out of a row
 * a reader can already see: nobody has looked, and a verdict *is* waiting. A row
 * carrying both is `held`, because the held half is the part still unanswered —
 * `conflict` would be false of it, while `held` stays true of the whole row.
 *
 * The same principle holds against `returned`: a row can come back from missing
 * while still sitting on a hold from this very run, and the hold is again the
 * half nobody has answered. So the `held` check runs first, ahead of
 * `returnedFromMissing` — checked second, as this function once had it, a
 * combined row read as `returned` and never turned up under the admin report's
 * `?type=held` filter, the one place a curator would go looking for it.
 *
 * `contents` is the fourth word and it needed one: a row whose own fields all came
 * through while what it holds moved (ADR-0026). It has to be named because the
 * `unchanged` catch-all used to be safe — a curated divergence was the only other
 * reason such a row was stored — and the fourth exception made that fall-through
 * claim a disagreement that never happened, which the admin report's `?type=conflict`
 * filter would then hand back as one. So the claim is now asserted rather than
 * inferred: `conflict` requires a `curatedConflicts` entry, and `contents` is what
 * is left. Ordered after `conflict`, because a row carrying both has an unanswered
 * question on it and the delta is news that raises none.
 */
function resolveChangeType(
  result: ProcessItemResult,
  contents: ContentsByKind | null,
): ChangeRecord['changeType'] {
  if (wasHeld(result, contents)) return 'held';
  if (result.returnedFromMissing && result.outcome !== 'created') return 'returned';
  if (result.outcome === 'unchanged' && result.changeSet.curatedConflicts.length > 0) return 'conflict';
  if (result.outcome === 'unchanged' && contents !== null) return 'contents';
  // Unreachable, and kept as the historical value rather than a new invention:
  // `worthRecording` stores an `unchanged` row for exactly the four reasons named
  // above, so nothing reaches this with that outcome today. It is where a *fifth*
  // exception would land silently, which is what happened to the fourth — so a fifth
  // belongs in a branch of its own here, decided before the exception ships rather
  // than discovered in the admin report afterwards.
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
  const { changedFields, curatedConflicts, heldFields, significance } = result.changeSet;
  // What the row will carry about the object's contents, decided before the
  // counters: a held field of a part makes the row held (ADR-0037), and the
  // counter has to answer for the same shape the row does.
  const contents = recordedContents(result.contents ?? {});
  // Claimed fields only. A held field is not one a person claimed — the whole
  // difference the two words carry — and `total_curated_conflicts` would stop
  // meaning what its column comment says if it absorbed them.
  progress.curatedConflicts += curatedConflicts.length;

  // A held row is `unchanged`: the gate kept the write out, so nothing about the
  // row moved and `total_updated` — which counts rows that actually changed —
  // must not move either (#519).
  if (result.outcome === 'created') progress.created++;
  else if (result.outcome === 'updated') progress.updated++;
  else progress.unchanged++;

  // Counted again, inside `unchanged` rather than beside it (#523): that
  // counter's meaning is already fixed by its column comment. `curatedConflicts`
  // above is the precedent for counting a refusal on top of the outcome
  // buckets, not for the arithmetic — it counts claimed fields, on updated rows
  // too, where this counts rows, and only inside `unchanged`. Without this a
  // gated run reads as a run that touched nothing — run 68 held all 1272
  // UNESCO sites and reported "unchanged 1272".
  if (wasHeld(result, contents)) progress.held++;

  if (progress.logId === null) return;

  // Unchanged rows are normally not stored, but four of them carry news anyway:
  // one whose source diverged from a curator's edit (recorded nowhere else), one
  // whose change the gate held — the proposal a curator will be shown, which
  // lives nowhere else either — one the source has started listing again after we
  // flagged it missing, and one whose own fields all came through while what it
  // holds moved (ADR-0026). The fourth is the case that produced no row at all
  // until this column existed: a serial site gaining a component was recorded
  // nowhere, not merely rendered nowhere.
  const worthRecording = result.outcome !== 'unchanged'
    || curatedConflicts.length > 0
    || heldFields.length > 0
    || result.returnedFromMissing
    || contents !== null;
  if (!worthRecording) return;

  const changeType = resolveChangeType(result, contents);

  changes.push({
    syncLogId: progress.logId,
    experienceId: result.experienceId,
    externalId: config.getItemId(item),
    nameSnapshot: result.nameSnapshot,
    changeType,
    // Both refusals travel with the applied changes, each field carrying the
    // reason it was not written: the value the source proposed is stored even
    // though the upsert refused it, or "accept source" and publishing would each
    // later have nothing to apply.
    changedFields: [...changedFields, ...curatedConflicts, ...heldFields],
    contents,
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
      contents: null,
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
 *
 * `refused` are the rows the category already held under one of those ids, now
 * marked (ADR-0024). Keying the changeset entry to the row is what lets a
 * curator get from "the run turned this down" to the thing it turned down.
 */
function recordFilteredEntities(
  filtered: FilteredEntity[],
  progress: SyncProgress,
  changes: ChangeRecord[],
  refused: AdmissionRow[] = [],
): void {
  const rowByExternalId = new Map(refused.map((row) => [row.externalId, row.id]));
  for (const entity of filtered) {
    progress.filtered++;
    if (progress.logId === null) continue;
    changes.push({
      syncLogId: progress.logId,
      experienceId: rowByExternalId.get(entity.externalId) ?? null,
      externalId: entity.externalId,
      nameSnapshot: entity.name,
      changeType: 'filtered',
      changedFields: null,
      contents: null,
      significance: null,
      error: entity.reason,
    });
  }
}

/**
 * The reason recorded against a row the run simply did not admit, as opposed to
 * one it named and turned down. There is no rule to quote, because no rule ran
 * on it: nothing this run selected placed anything here.
 */
export const NOT_ADMITTED_REASON =
  'this run selected nothing that belongs to it';

/**
 * The must-see badge on the rows this run admits, for a source whose admission
 * rule is the badge (`badgesAdmitted`).
 *
 * After the admission step, on purpose: that is when `admission` is a settled
 * answer for every row of the run — a refusal this run lifted is admitted by
 * now, one a curator confirmed is not — and a run that never gets this far (a
 * cancel exits before the admission step, as does any throw) badges nothing
 * rather than a row it did not re-admit (#760). The sweep touches only rows
 * absent from this set and the guard says nothing about the rows the run did
 * admit, so the badge is neither ordered against the sweep nor gated with it.
 */
async function badgeAdmitted<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  admittedExternalIds: string[],
): Promise<void> {
  if (!config.badgesAdmitted) return;

  const badged = await markIconic(config.categoryId, admittedExternalIds, progress.dryRun);
  if (badged.length > 0) {
    console.log(`${config.logPrefix} Badged ${badged.length} admitted row(s) as must-see`);
  }
}

/**
 * Restore, then sweep — the second half of admission, for a source that
 * recomputes its whole membership rather than publishing a list (ADR-0024).
 *
 * The two are order-independent: restore only touches rows that are refused and
 * present in the admitted set, the sweep only rows that are admitted and absent
 * from it. What matters is that both run after `markRefused`, so a row this run
 * named as filtered *and* admitted ends the run admitted rather than hidden.
 * The must-see badge is not written here but after this step returns
 * (`badgeAdmitted`), so that it reads admission settled.
 */
async function applyAdmissionSweep<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  admittedExternalIds: string[],
  previousAdmittedCount: number,
  changes: ChangeRecord[],
): Promise<string | null> {
  if (!config.recomputesMembership || progress.logId === null) return null;

  const restored = await restoreAdmission(config.categoryId, admittedExternalIds, progress.dryRun);
  for (const row of restored) {
    console.log(`${config.logPrefix} Re-admitted ${row.name} (${row.externalId})`);
  }

  const skipReason = admissionSweepSkipReason({
    errors: progress.errors,
    cancelled: progress.cancel,
    admittedCount: admittedExternalIds.length,
    previousAdmittedCount,
  });
  if (skipReason !== null) return skipReason;

  const swept = await markNotAdmitted(
    config.categoryId, admittedExternalIds, NOT_ADMITTED_REASON, progress.dryRun,
  );
  for (const row of swept) {
    progress.filtered++;
    changes.push({
      syncLogId: progress.logId,
      experienceId: row.id,
      externalId: row.externalId,
      nameSnapshot: row.name,
      changeType: 'filtered',
      changedFields: null,
      contents: null,
      significance: null,
      error: NOT_ADMITTED_REASON,
    });
  }
  return null;
}

/**
 * Persist the per-object changeset, or leave a marker saying it was lost.
 *
 * Recorded before the log is closed, but never at the cost of closing it: a
 * failed insert here used to leave the run stuck at 'running' forever.
 */
async function recordChangesetOrMark(
  changes: ChangeRecord[],
  errorDetails: ErrorDetail[],
  progress: SyncProgress,
  logPrefix: string,
): Promise<boolean> {
  try {
    await recordSyncChanges(changes);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorDetails.push({ ...CHANGESET_LOST_MARKER, error: `Failed to record changeset: ${msg}` });
    progress.errors++;
    console.error('%s Failed to record changeset:', logPrefix, msg);
    return false;
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

function computeFinalStatus(
  progress: SyncProgress,
  withdrawalSkippedReason: string | null,
): 'success' | 'partial' | 'failed' {
  // A run that saw too little to say what left is not a success, whatever its
  // items did: the catalogue is correct, and the source's departures are
  // unrecorded (ADR-0044). Run 42 is the case — 291 works where the run before
  // had 1906, every item unchanged, `success`.
  if (progress.errors === 0) return withdrawalSkippedReason === null ? 'success' : 'partial';
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
  alreadyRecorded: boolean,
  // Decided by the caller, before this is called: everything below awaits, and
  // the database outage that lands a run here would reject `updateSyncLog`, so
  // a verdict produced in here could never be relied on to come back.
  verdict: Exclude<RunVerdict, 'complete'>,
  // The two guards' verdicts, kept on the row a failed run leaves too: a run
  // that skipped detection or withdrawal and then died is both, and a card
  // reading only `failed` over a NULL would not say why nothing was delisted
  // or withdrawn before the failure. Null where the step that produces each
  // never ran — the fetch for the withdrawal reason, detection for its own.
  detectionSkippedReason: string | null,
  withdrawalSkippedReason: string | null,
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  progress.statusMessage = errorMsg;

  if (progress.logId) {
    errorDetails.push({ externalId: 'system', error: errorMsg });
    try {
      if (!alreadyRecorded) await recordSyncChanges(changes);
    } catch (recordErr) {
      // Same marker the success path leaves: the run card reads it to tell a
      // lost record apart from a run that predates the changeset entirely.
      const msg = recordErr instanceof Error ? recordErr.message : String(recordErr);
      errorDetails.push({ ...CHANGESET_LOST_MARKER, error: `Failed to record changeset: ${msg}` });
      console.error('%s Failed to record changeset:', config.logPrefix, msg);
    }
    await updateSyncLog(config.categoryId, progress.logId, verdict, {
      fetched: progress.total,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      held: progress.held,
      filtered: progress.filtered,
      errors: progress.errors,
      detectionSkippedReason,
      withdrawalSkippedReason,
    }, errorDetails);
  }

  if (verdict === 'cancelled') {
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
  const { categoryId, logPrefix } = config;
  const dryRun = options.dryRun ?? false;

  if (isSyncStillRunning(runningSyncs.get(categoryId))) {
    throw new Error(`${logPrefix} sync already in progress`);
  }

  const progress = initSyncProgress(dryRun);
  runningSyncs.set(categoryId, progress);
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
    progress.logId = await createSyncLog(categoryId, triggeredBy, dryRun);
    console.log(`${logPrefix} Started sync (log ID: ${progress.logId})${dryRun ? ' [DRY RUN]' : ''}`);

    const previousActiveCount = await countActiveExperiences(categoryId);
    // Read before the run writes, so the sweep's floor compares like with like.
    const previousAdmittedCount = config.recomputesMembership ? await countAdmitted(categoryId) : 0;

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
    const refusedRows = await markRefused(categoryId, filtered ?? [], dryRun);
    recordFilteredEntities(filtered ?? [], progress, changes, refusedRows);

    // Both sides of the coverage ratio are measured against the table as it
    // stood before this run touched it. Counting afterwards would fold in the
    // rows the run just created and the ones it just cleared missing_since on —
    // neither was in previousActiveCount, and both only lift the ratio past the
    // floor the guard exists to enforce.
    const seenExternalIds = items.map(config.getItemId);
    const seenCount = config.sourceCompleteness === 'authoritative'
      ? await countSeenAmongActive(categoryId, seenExternalIds)
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

    const sweepSkippedReason = await applyAdmissionSweep(
      config, progress, seenExternalIds, previousAdmittedCount, changes,
    );
    if (sweepSkippedReason !== null) {
      console.log(`${logPrefix} Admission sweep skipped: ${sweepSkippedReason}`);
    }
    await badgeAdmitted(config, progress, seenExternalIds);

    changesRecorded = await recordChangesetOrMark(changes, errorDetails, progress, logPrefix);

    // Computed after that attempt: a run whose per-object record never landed is
    // not a clean run, whatever the items themselves did, and an operator
    // reading `success` over a missing changeset would be misled.
    const finalStatus = computeFinalStatus(progress, withdrawalSkippedReason);
    // Three different things are called `partial`, and only one of them is a
    // progress state:
    //
    // - `computeFinalStatus`'s, some items errored. It goes to the log row and
    //   stops there; the run itself still reached `complete`, which is why this
    //   line maps everything that is not `failed` onto it.
    // - `computeFinalStatus`'s again, the source's departures are unrecorded:
    //   the collector saw too little of the contents it holds to say what left
    //   (`withdrawalSkippedReason`, ADR-0044), with no item having errored at
    //   all. The "Withdrawals skipped" line on the run card is what tells this
    //   one from the other two at the chip.
    // - placement's — the run finished but placing what it moved did not. That
    //   one *is* a progress state, assigned later by `terminalStatus`.
    //
    // All three surface as `last_sync_status = 'partial'` and the same chip, so
    // the distinction lives only here. Worth keeping straight: a reader who
    // assumes one meaning finds the others' code inexplicable.
    //
    // Not 'complete' yet either way: placement runs in the `finally` below and
    // is part of finishing the run, so declaring the run over here would let a
    // poller see `running: false` while it is still going — and read a status
    // the placement may be about to downgrade.
    finishedStatus = finalStatus === 'failed' ? 'failed' : 'complete';
    const verdict = finalStatus === 'success' ? 'Complete' : `Complete (${finalStatus})`;
    // The reason rides the sentence too: on a run with no errors it is the whole
    // of why the verdict says partial, and the panel shows this line before it
    // shows the log row.
    const skipped = withdrawalSkippedReason === null
      ? '' : `; withdrew nothing — ${withdrawalSkippedReason}`;
    progress.statusMessage = `${verdict}: ${progress.created} created, ${progress.updated} updated, `
      + `${progress.unchanged} unchanged (${progress.held} held), ${progress.missing} missing, `
      + `${progress.errors} errors${skipped}`;

    await updateSyncLog(categoryId, progress.logId, finalStatus, {
      fetched: fetchedCount,
      created: progress.created,
      updated: progress.updated,
      unchanged: progress.unchanged,
      missing: progress.missing,
      curatedConflicts: progress.curatedConflicts,
      held: progress.held,
      filtered: progress.filtered,
      errors: progress.errors,
      detectionSkippedReason,
      withdrawalSkippedReason,
    }, errorDetails.length > 0 ? errorDetails : undefined);

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
    // its own phase and can take minutes on a first run, where the whole
    // category lands in `movedExperiences` and every world view gets its own
    // transaction. Naming the phase keeps `isSyncStillRunning` true — the
    // poller must keep polling — while giving `cancelSync` something to refuse
    // and the panel something truthful to show. Without it the panel offers a
    // Cancel that nothing reads, beside a completion message and a full bar.
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
 * Cancel a running sync for any category by ID.
 *
 * Answers whether the press was acted on, not whether the run stopped: it sets
 * a flag the item loop reads, and refuses outright once there is no loop left.
 */
export function cancelSync(categoryId: number): boolean {
  const progress = runningSyncs.get(categoryId);
  if (progress && isCancellable(progress)) {
    progress.cancel = true;
    progress.statusMessage = 'Cancelling...';
    return true;
  }
  return false;
}
