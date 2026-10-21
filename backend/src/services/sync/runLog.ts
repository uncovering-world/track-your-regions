/**
 * The run's log row, from the changeset it carries to the status it is closed
 * with — on a run that finished and on one that failed or was cancelled.
 *
 * The orchestrator decides *when* each of these happens, because the order is
 * the contract: the changeset is recorded before the row is closed, the
 * verdict is set before anything that can reject, and placement runs after
 * both (`placement.ts`). This module holds *what* each step writes.
 */

import { updateSyncLog, type SyncLogStats } from './syncUtils.js';
import { sentenceFor } from '../../api/readerFacingError.js';
import { recordSyncChanges, type ChangeRecord } from './changeRecorder.js';
import { CHANGESET_LOST_MARKER } from './syncLogMarkers.js';
import type { SyncServiceConfig } from './syncContract.js';
import type { SyncProgress, RunVerdict, ErrorDetail, PinTally, VisitQuestionTally } from './types.js';

/**
 * Persist the per-object changeset, or leave a marker saying it was lost.
 *
 * Recorded before the log is closed, but never at the cost of closing it: a
 * failed insert here must not leave the run at 'running', which nothing but
 * the next backend start would then clear.
 */
export async function recordChangesetOrMark(
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

/**
 * The status a finished run's log row carries.
 *
 * Three different things are called `partial`, and only one of them is a
 * progress state:
 *
 * - this function's, some items errored. It goes to the log row and stops
 *   there; the run itself still reached `complete`, which is why the
 *   orchestrator maps everything that is not `failed` onto it.
 * - this function's again, a guard left the catalogue as it was with no item
 *   having errored at all: the collector saw too little of the contents it
 *   holds to say what left (the withdrawal reason, ADR-0044), or the admission
 *   sweep refused a run that admitted nothing or under half what the last one
 *   did, so the places the kind's rule would delist stayed admitted (ADR-0024,
 *   #751). The "Withdrawals skipped" or "Admission sweep skipped" line on the
 *   run card is what tells this one from the other two at the chip.
 * - placement's — the run finished but placing what it moved did not. That one
 *   *is* a progress state, assigned later by `terminalStatus`.
 *
 * All three surface as `last_sync_status = 'partial'` and the same chip, so
 * the distinction lives only here. Worth keeping straight: a reader who
 * assumes one meaning finds the others' code inexplicable.
 */
export function computeFinalStatus(
  progress: SyncProgress,
  skipped: Pick<GuardSkips, 'withdrawal' | 'admissionSweep'>,
): 'success' | 'partial' | 'failed' {
  // A run that saw too little to say what left is not a success, whatever its
  // items did: the catalogue is correct, and the source's departures are
  // unrecorded (ADR-0044). Run 42 is the case — 291 works where the run before
  // had 1906, every item unchanged, `success`. A run whose sweep was refused
  // is the same: the kind's rule was not applied to what it no longer admits,
  // and the collapse that refused it is what a person has to look at.
  if (progress.errors === 0) {
    return skipped.withdrawal === null && skipped.admissionSweep === null ? 'success' : 'partial';
  }
  // A run that touched nothing at all failed; one that found everything already
  // current did not, even if a straggler errored.
  const seen = progress.created + progress.updated + progress.unchanged;
  return seen === 0 ? 'failed' : 'partial';
}

/**
 * Why each of the run's three guards did nothing, or null where it ran or never
 * got its turn: missing detection's coverage floor, the works floor that keeps
 * withdrawals back (ADR-0044), and the admission sweep's floor (ADR-0024).
 */
export interface GuardSkips {
  detection: string | null;
  withdrawal: string | null;
  admissionSweep: string | null;
}

/**
 * The counters and the guards' verdicts a log row is closed with, whichever
 * way the run ended. `fetched` is the caller's: what the source handed over on
 * a finished run, how many items the loop was given on a failed one.
 */
export function runCounters(
  progress: SyncProgress,
  fetched: number,
  skipped: GuardSkips,
): SyncLogStats {
  return {
    fetched,
    created: progress.created,
    updated: progress.updated,
    unchanged: progress.unchanged,
    missing: progress.missing,
    curatedConflicts: progress.curatedConflicts,
    held: progress.held,
    filtered: progress.filtered,
    errors: progress.errors,
    detectionSkippedReason: skipped.detection,
    withdrawalSkippedReason: skipped.withdrawal,
    admissionSweepSkippedReason: skipped.admissionSweep,
  };
}

/**
 * The line the admin panel shows over a finished run's bar.
 *
 * The withdrawal and sweep reasons ride the sentence too: on a run with no
 * errors they are the whole of why the verdict says partial, and the panel
 * shows this line before it shows the log row.
 */
export function completionMessage(
  progress: SyncProgress,
  finalStatus: 'success' | 'partial' | 'failed',
  guards: Pick<GuardSkips, 'withdrawal' | 'admissionSweep'>,
): string {
  const verdict = finalStatus === 'success' ? 'Complete' : `Complete (${finalStatus})`;
  const skipped = (guards.withdrawal === null ? '' : `; withdrew nothing — ${guards.withdrawal}`)
    + (guards.admissionSweep === null ? '' : `; delisted nothing — ${guards.admissionSweep}`);
  return `${verdict}: ${progress.created} created, ${progress.updated} updated, `
    + `${progress.unchanged} unchanged (${progress.held} held), ${progress.missing} missing, `
    + `${progress.errors} errors${skipped}${pinsSentence(progress.pins, progress.dryRun)}`
    + visitQuestionsSentence(progress.visitQuestions, progress.dryRun);
}

/**
 * What the run said of the curators' pins on admission (#1370), for its closing
 * line: nothing where the source has no pin the run read.
 */
export function pinsSentence(pins: PinTally | undefined, dryRun = false): string {
  if (!pins || pins.asked + pins.agreed + pins.standing === 0) return '';
  const standing = pins.standing ? `, ${pins.standing} left as the curator answered` : '';
  // A preview writes no question, so its history says what it would have asked.
  return `; pins: ${pins.asked} ${dryRun ? 'would be asked' : 'asked'} about again, ${pins.agreed} agreed with${standing}`;
}

/**
 * What the run asked of its offered places (#1770), for its closing line:
 * nothing where it read none.
 */
export function visitQuestionsSentence(tally: VisitQuestionTally | undefined, dryRun = false): string {
  if (tally?.failed) return '; places with nothing to see: not asked, the step failed (see the backend log) — the next run asks';
  if (tally?.stopped && tally.read === 0) return '; places with nothing to see: stopped by Cancel before any was read';
  if (!tally || (tally.read === 0 && !tally.unread)) return '';
  return `; places with nothing to see: ${tally.asked} ${dryRun ? 'would be asked' : 'asked'} of a curator, `
    + `of ${tally.short} that fewer than two witnesses vouch for among ${tally.read} read`
    + (tally.unread ? `, ${tally.unread} left for the next run as OpenStreetMap did not answer` : '')
    + (tally.stopped ? ', stopped by Cancel' : '');
}

export async function recordSyncFailure(
  config: Pick<SyncServiceConfig<unknown>, 'sourceId' | 'logPrefix'>,
  progress: SyncProgress,
  err: unknown,
  errorDetails: ErrorDetail[],
  changes: ChangeRecord[],
  alreadyRecorded: boolean,
  // Decided by the caller, before this is called: everything below awaits, and
  // the database outage that lands a run here would reject `updateSyncLog`, so
  // a verdict produced in here could never be relied on to come back.
  verdict: Exclude<RunVerdict, 'complete'>,
  // The guards' verdicts, kept on the row a failed run leaves too: a run that
  // skipped detection, withdrawal or the sweep and then died is both, and a
  // card reading only `failed` over a NULL would not say why nothing was
  // delisted, withdrawn or swept before the failure. Null where the step that
  // produces each never ran.
  skipped: GuardSkips,
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  // Logged first: every write below awaits, and the outage that brought the
  // run here can reject them before a later line runs.
  if (verdict === 'cancelled') {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- logPrefix is a module constant supplied by the sync services
    console.log(`${config.logPrefix} Cancelled:`, errorMsg);
  } else {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- logPrefix is a module constant supplied by the sync services
    console.error(`${config.logPrefix} Failed:`, errorMsg);
  }

  // The card polls this, so it carries a sentence; the error's own text goes
  // to the server log above and to the run's log row, which the sync history
  // shows (#1021). The card puts "The sync failed: " before it. It points at
  // the history only once the row holding the cause has been written: a run
  // whose row was never created, or whose update the outage rejects, has no
  // entry there that says why.
  const failed = verdict !== 'cancelled';
  progress.statusMessage = failed ? sentenceFor(err, 'the server log has the cause.') : 'Sync cancelled.';

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
    await updateSyncLog(config.sourceId, progress.logId, verdict, runCounters(
      progress, progress.total, skipped,
    ), errorDetails);
    if (failed) progress.statusMessage = sentenceFor(err, 'its entry in the sync history has the cause.');
  }
}
