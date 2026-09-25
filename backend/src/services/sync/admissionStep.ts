/**
 * The admission step of a run, after its items: restore what the run admitted
 * again, sweep what it did not name, and badge what it admitted — for a source
 * that recomputes its whole membership (ADR-0024) and one whose rule is the
 * must-see badge (ADR-0045 decision 5).
 *
 * The writes themselves are `admission.ts`'s; this decides which of them a run
 * may make, in what order, and what the changeset says about them.
 */

import type { ChangeRecord } from './changeRecorder.js';
import {
  admissionSweepSkipReason,
  markIconic,
  markNotAdmitted,
  restoreAdmission,
  unmarkIconic,
} from './admission.js';
import type { SyncServiceConfig } from './syncContract.js';
import type { SyncProgress } from './types.js';

/**
 * The reason recorded against a row the run simply did not admit, as opposed to
 * one it named and turned down. There is no rule to quote, because no rule ran
 * on it: nothing this run selected placed anything here.
 */
const NOT_ADMITTED_REASON =
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
 * admit, so the *add* is neither ordered against the sweep nor gated with it.
 * The *clear* is gated with it, and the reason is below.
 *
 * The items come with the ids because a kind whose world tier has a door that
 * is not a masterpiece badges the masterpiece only, and what the run knows
 * about that is on the item it judged rather than on the row (`badgesAdmitted`).
 * The two lists are one list today — the ids are `items.map(getItemId)` — so an
 * id with no item behind it cannot arise; the filter answers `false` for one
 * anyway, so that a caller who ever hands a narrower set of ids does not have
 * the unaskable question answered `true` by default.
 *
 * Adds and takes back, but the taking back is the predicate's alone
 * (`unmarkIconic`). Where the badge *is* the admission rule every admitted row
 * is in `toBadge`, so there is nothing left over and no statement is sent.
 * Where it is a predicate the two sets come apart, and an archaeology museum
 * whose last famous find fell below the finds' line would otherwise go on
 * wearing a must-see badge for a find it is no longer credited with: the three
 * writers of `CLEAR_ICONIC` all fire when a row leaves the kind, and this row
 * stays. A curator's pin on the badge is honoured by the clear; a pin on
 * `admission` is a different answer and does not pin the badge.
 *
 * **And the clear runs only where the sweep ran** (`sweptMembership`). It is a
 * statement about every admitted row this run did *not* name, which is the
 * sweep's own set, and the sweep declines to touch that set on exactly the runs
 * where it cannot be trusted — an empty answer, errors, a collapse to under half
 * the previous membership (`admissionSweepSkipReason`). Ungated, one broken
 * SPARQL day would take the must-see badge off every archaeology museum the run
 * failed to reach, which is the catalogue-emptying the sweep's own guard exists
 * to prevent, in the one column the guard does not cover. The add is safe on any
 * run because it only ever speaks about rows the run did admit.
 *
 * The changeset does not record the flip, in either direction — that is #603's.
 */
export async function badgeAdmitted<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  admittedExternalIds: string[],
  items: T[],
  sweptMembership: boolean,
): Promise<void> {
  if (!config.badgesAdmitted) return;

  const badges = config.badgesAdmitted;
  const predicate = typeof badges === 'function' ? badges : null;
  let toBadge = admittedExternalIds;
  if (predicate) {
    const byId = new Map(items.map((item) => [config.getItemId(item), item]));
    toBadge = admittedExternalIds.filter((externalId) => {
      const item = byId.get(externalId);
      return item !== undefined && predicate(item);
    });
  }

  const badged = await markIconic(config.sourceId, toBadge, progress.dryRun);
  if (badged.length > 0) {
    console.log(`${config.logPrefix} Badged ${badged.length} admitted row(s) as must-see`);
  }

  if (!predicate || !sweptMembership) return;
  const cleared = await unmarkIconic(config.sourceId, toBadge, progress.dryRun);
  if (cleared.length > 0) {
    console.log(`${config.logPrefix} Took the must-see badge back off ${cleared.length} row(s)`);
  }
}

/**
 * What the sweep step did, for the writes that come after it.
 *
 * Two facts and not one, because "no skip reason" is not "the sweep ran": a
 * source that does not recompute its membership skips nothing and sweeps
 * nothing, and a caller told only the reason would read that silence as a run
 * that decided every row it did not name. `swept` is the one any such caller
 * has to ask; `skipReason` is for the line in the log.
 */
interface SweepOutcome {
  /** Whether `markNotAdmitted` really decided the rows this run did not name. */
  swept: boolean;
  /** Why it did not, where a guard refused it. Null both when it ran and when it does not apply. */
  skipReason: string | null;
}

/** The sweep does not apply to this source at all: nothing skipped, nothing decided. */
const NO_SWEEP: SweepOutcome = { swept: false, skipReason: null };

/**
 * Restore, then sweep — the second half of admission, for a source that
 * recomputes its whole membership rather than publishing a list (ADR-0024).
 *
 * The two are order-independent: restore only touches rows that are refused and
 * present in the admitted set, the sweep only rows that are admitted and absent
 * from it. What matters is that both run after `markRefused`, so a row this run
 * named as filtered *and* admitted ends the run admitted rather than hidden.
 * The must-see badge is not written here but after this step returns
 * (`badgeAdmitted`), so that it reads admission settled — and the badge's
 * *clear* is handed this step's answer, because it is a statement about rows
 * the run did not name and only the sweep decides those.
 */
export async function applyAdmissionSweep<T>(
  config: SyncServiceConfig<T>,
  progress: SyncProgress,
  admittedExternalIds: string[],
  previousAdmittedCount: number,
  changes: ChangeRecord[],
): Promise<SweepOutcome> {
  if (!config.recomputesMembership || progress.logId === null) return NO_SWEEP;

  const restored = await restoreAdmission(config.sourceId, admittedExternalIds, progress.dryRun);
  for (const row of restored) {
    console.log(`${config.logPrefix} Re-admitted ${row.name} (${row.externalId})`);
  }

  const skipReason = admissionSweepSkipReason({
    errors: progress.errors,
    cancelled: progress.cancel,
    admittedCount: admittedExternalIds.length,
    previousAdmittedCount,
  });
  if (skipReason !== null) return { swept: false, skipReason };

  const swept = await markNotAdmitted(
    config.sourceId, admittedExternalIds, NOT_ADMITTED_REASON, progress.dryRun,
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
  return { swept: true, skipReason: null };
}
