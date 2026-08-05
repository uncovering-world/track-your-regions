/**
 * Placing what a sync moved, and reporting when that fails.
 *
 * Its own module because it is its own responsibility: the orchestrator runs a
 * source's items through a lifecycle, while this decides where the objects that
 * moved now belong. Nothing here is needed to run that lifecycle — it talks to
 * `regionAssignmentService`, `syncLogMarkers` and `annotateClosedSyncLog`, none
 * of which the loop touches.
 */

import { assignRegionsForExperiences, worldViewsWithGeometry } from './regionAssignmentService.js';
import { annotateClosedSyncLog } from './syncUtils.js';
import { PLACEMENT_FAILED_MARKER } from './syncLogMarkers.js';
import type { SyncProgress, ErrorDetail, RunVerdict } from './types.js';

/** What placement reported, or nothing when it had no verdict of its own. */
export type PlacementOutcome = RunVerdict | 'partial' | undefined;

/**
 * Place the experiences whose geometry moved, in every world view that has
 * geometry to place them in.
 *
 * Part of finishing a run rather than a step an admin has to remember. Only
 * what moved: `locationWriter` keeps the row of a point that stayed put, so an
 * ordinary run leaves this set nearly empty and this call does nothing.
 *
 * Runs after the log is closed, and reports failure rather than throwing. The
 * reasoning is the same as for recording the changeset: assignment going wrong
 * must not leave the run stuck at 'running'.
 */
export async function placeMovedExperiences(
  moved: Set<number>,
  dryRun: boolean,
  logPrefix: string,
): Promise<string[]> {
  const failures: string[] = [];
  // A preview reports what a run would do and writes nothing downstream; its
  // set is empty anyway, since the services skip the location write entirely.
  if (dryRun || moved.size === 0) return failures;
  const ids = [...moved];

  // Inside the guard, not before it. A transient failure on this SELECT would
  // otherwise escape a function whose whole contract is that it reports rather
  // than throws — and reach the outer catch, which rewrites an already-closed
  // successful log to 'failed' over a query the run never depended on.
  let worldViews: number[];
  try {
    worldViews = await worldViewsWithGeometry();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('%s Could not list world views to place into: %s', logPrefix, msg);
    return [`could not list world views: ${msg}`];
  }

  for (const wv of worldViews) {
    try {
      const placed = await assignRegionsForExperiences(ids, wv);
      console.log('%s Placed %d moved experience(s) in world view %d: %d region rows',
        logPrefix, ids.length, wv, placed);
    } catch (err) {
      // Constant format string, as everywhere this codebase logs a value: a
      // template literal here lets that value forge the shape of a log line,
      // which Semgrep flags as unsafe-formatstring.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('%s Region assignment failed for world view %d: %s', logPrefix, wv, msg);
      failures.push(`world view ${wv}: ${msg}`);
    }
  }

  return failures;
}

/**
 * Say in the log that placement failed, not only on the console.
 *
 * `updateSyncLog` has already closed this run — usually as a success — and an
 * operator reading that has no way to know `experience_regions` is stale for
 * the objects it moved, or that a full re-assignment is the remedy. Nothing
 * else in the product prompts for one.
 *
 * Downgrades a successful run to `partial`: the catalogue is correct and the
 * changeset landed, so the run did its own job — what is stale is
 * `experience_regions` for the objects it moved.
 *
 * A run that already reached a terminal state keeps it. `recordSyncFailure`
 * writes either `failed` or `cancelled`, and both are facts an operator needs:
 * overwriting `cancelled` with `partial` would lose that someone stopped the
 * run, which the history panel renders as its own chip and which survives
 * nowhere else in the row.
 *
 * The write is narrow on purpose. `updateSyncLog` sets every stat column, so
 * reusing it here would rewrite ten fields this caller has no correct values
 * for — `total_fetched` differs between the source's item count and the
 * processed one, and `detection_skipped_reason` is `detectMissing`'s answer,
 * which nothing here recomputes.
 */
export async function recordPlacementFailure(
  config: { categoryId: number },
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
  failures: string[],
  finishedStatus: RunVerdict | undefined,
  logPrefix: string,
): Promise<PlacementOutcome> {
  if (failures.length === 0 || !progress.logId) return undefined;

  errorDetails.push({
    ...PLACEMENT_FAILED_MARKER,
    error: `Region assignment failed after the run closed: ${failures.join('; ')}`,
  });
  // No append to `statusMessage`: it renders only while the run is running, and
  // this fires two statements before the status flips to finished. The signal
  // the admin actually gets is the Partial chip and the marker in the log,
  // which outlive the run.

  // Read from the verdict the run reached, not from `progress.status`: that is
  // deliberately still un-set here, because the run must not report itself
  // finished until placement is done — on either path. Only `complete` is
  // eligible for the downgrade; `cancelled` and `failed` are facts of their own.
  const status = finishedStatus === 'complete' ? 'partial' : finishedStatus ?? 'failed';

  try {
    await annotateClosedSyncLog(config.categoryId, progress.logId, status, errorDetails);
    return status;
  } catch (err) {
    console.error('%s Could not record the placement failure: %s',
      logPrefix, err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/**
 * Place what the run moved, and say so in the log if that fails.
 *
 * The two steps are one act — placing, and reporting that placing went wrong —
 * and keeping them together is what lets the caller's `finally` stay readable.
 */
export async function finishPlacement(
  config: { categoryId: number },
  progress: SyncProgress,
  errorDetails: ErrorDetail[],
  moved: Set<number>,
  opts: {
    dryRun: boolean;
    finishedStatus: RunVerdict | undefined;
    logPrefix: string;
  },
): Promise<PlacementOutcome> {
  const failures = await placeMovedExperiences(moved, opts.dryRun, opts.logPrefix);
  return recordPlacementFailure(
    config, progress, errorDetails, failures, opts.finishedStatus, opts.logPrefix);
}

/**
 * Name the placement phase, when there is a window worth naming.
 *
 * Placement can take minutes on a category's first run — the whole of it lands
 * in the moved set and every world view gets its own transaction — and through it the
 * run is deliberately still open. Left as `processing`, the panel offers a
 * Cancel that nothing reads any more, beside a completion message and a full
 * bar. `isSyncStillRunning` treats `assigning` as running, so the poller
 * carries on; `cancelSync` refuses it, so the button stops promising what it
 * cannot do.
 *
 * Skipped when there is nothing to place: that window does not exist, and the
 * message must not be overwritten — a failed run would lose the reason it
 * failed to a phase label for work that never ran.
 */
export function enterAssigningPhase(
  progress: SyncProgress,
  moved: Set<number>,
  dryRun: boolean,
  finishedStatus: RunVerdict | undefined,
): void {
  if (dryRun || moved.size === 0) return;
  progress.status = 'assigning';
  if (finishedStatus !== 'failed') {
    progress.statusMessage = 'Assigning regions for what moved...';
  }
}

/**
 * What the run should report, once placement has had its say.
 *
 * The status actually written wins over the one the run reached: left to the
 * run's own verdict, `runningSyncs` would answer `complete` for up to thirty
 * seconds over a log row saying `partial`, and the panel reads `complete` as
 * success. The default is `failed` rather than a non-terminal value — a run
 * reported failed is recoverable, one left mid-flight spins a poller forever.
 */
export function terminalStatus(
  placed: PlacementOutcome,
  finished: RunVerdict | undefined,
): SyncProgress['status'] {
  if (placed === 'partial') return 'partial';
  return finished ?? 'failed';
}
