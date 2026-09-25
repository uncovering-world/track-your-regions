/**
 * What one item of a run leaves behind: its counters, and the changeset row
 * that says what happened to the object — or why nothing did (ADR-0020).
 *
 * The run's loop hands each processed, failed or filtered item here; nothing
 * in this module writes to the database. The rows are collected and recorded
 * once, by the run log (`runLog.ts`).
 */

import type { ChangeRecord } from './changeRecorder.js';
import type { AdmissionRow } from './admission.js';
import type { FilteredEntity, ProcessItemResult, SyncServiceConfig } from './syncContract.js';
import type { SyncProgress, ErrorDetail, ContentsByKind } from './types.js';
import { contentsHeld, recordedContents } from './types.js';

/**
 * The source's gate kept every proposed write out of a row a reader can
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
 * and nothing is waiting. `held` is a value the source's gate kept out of a row
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
 * `contents` is the fourth word: a row whose own fields all came through while
 * what it holds moved (ADR-0026). It has to be named because a fall-through that
 * reads every other stored row as a curated divergence would claim a
 * disagreement that never happened, which the admin report's `?type=conflict`
 * filter would then hand back as one. So the claim is asserted rather than
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
export function recordItemOutcome<T>(
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
export function recordItemFailure<T>(
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
 * `refused` are the rows the source already held under one of those ids, now
 * marked (ADR-0024). Keying the changeset entry to the row is what lets a
 * curator get from "the run turned this down" to the thing it turned down.
 */
export function recordFilteredEntities(
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
