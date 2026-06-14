/**
 * splitSelectionForAccept — Pure helper for the batch "Accept selected" action.
 *
 * Splits a selection of suggestions into two buckets:
 *  - cleanIds:       division IDs with no conflict → can be accepted directly.
 *  - conflictedSugs: suggestions that have a conflict → must route through the
 *                    transfer preview dialog (or direct-transfer fallback).
 *
 * This split prevents the 409 that occurs when clean divisions are included in
 * a transfer batch: acceptWithTransfer requires the donor to own every division
 * in the batch, but clean divisions have no donor.
 */

export interface SuggestionForSplit {
  divisionId: number;
  conflict?: unknown;
}

export interface SplitResult<T extends SuggestionForSplit> {
  cleanIds: number[];
  conflictedSugs: T[];
}

export function splitSelectionForAccept<T extends SuggestionForSplit>(
  selectedSugs: T[],
): SplitResult<T> {
  const cleanIds = selectedSugs
    .filter(s => !s.conflict)
    .map(s => s.divisionId);
  const conflictedSugs = selectedSugs.filter(s => !!s.conflict);
  return { cleanIds, conflictedSugs };
}
