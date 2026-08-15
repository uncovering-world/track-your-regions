/**
 * Detection of objects the source stopped listing.
 *
 * An upsert never deletes, so a delisted site would otherwise sit in the
 * database forever, indistinguishable from a current one. Flagging it is only
 * safe under three conditions, because the alternative reading of "not in this
 * run" is "this run did not see everything":
 *
 *   1. the source hands over its whole collection (UNESCO does; a top-200
 *      Wikidata query does not — falling out of a ranking is not a delisting)
 *   2. the run completed without errors and was not cancelled
 *   3. it saw at least 90% of what was there before
 *
 * The flag is a machine observation. Turning it into `former` or `lost` is a
 * curator's decision, made elsewhere.
 */

import { pool } from '../../db/index.js';
import type { ChangeRecord } from './changeRecorder.js';

export type SourceCompleteness = 'authoritative' | 'ranked';

export interface MissingDetectionInput {
  sourceCompleteness: SourceCompleteness;
  errors: number;
  cancelled: boolean;
  /**
   * Of the rows that were active before this run, how many the source offered
   * again — measured against the pre-run table, so it excludes rows this run
   * created and rows whose `missing_since` it cleared. Not "items processed":
   * an item that later throws still counts, because the source did list it.
   */
  seenCount: number;
  previousActiveCount: number;
}

export const MISSING_DETECTION_MIN_COVERAGE = 0.9;

/**
 * Why detection must not run, or null when it may.
 */
export function missingDetectionSkipReason(input: MissingDetectionInput): string | null {
  if (input.sourceCompleteness !== 'authoritative') {
    return 'source is ranked, not authoritative: absence means a lower rank, not a delisting';
  }
  if (input.cancelled) {
    return 'run was cancelled before it could see the whole collection';
  }
  if (input.errors > 0) {
    return `run finished with ${input.errors} error(s), so absence may be a fetch failure`;
  }
  if (input.previousActiveCount === 0) {
    return null;
  }
  const coverage = input.seenCount / input.previousActiveCount;
  if (coverage < MISSING_DETECTION_MIN_COVERAGE) {
    return `coverage ${(coverage * 100).toFixed(1)}% is below the ${MISSING_DETECTION_MIN_COVERAGE * 100}% floor`;
  }
  return null;
}

/**
 * Count the rows a run is expected to see again.
 *
 * A refused row is not among them (ADR-0024). The category has already turned
 * it down, so it is neither something the source owes us nor something whose
 * absence says anything; counting it would drag every category that refuses
 * anything toward the 90 % floor that disables detection.
 */
export async function countActiveExperiences(categoryId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM experiences
     WHERE category_id = $1
       AND source_membership = 'present'
       AND missing_since IS NULL
       AND is_manual = FALSE
       AND existence <> 'lost'
       AND admission <> 'refused'`,
    [categoryId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Of the rows that were there before, how many did this run see again.
 *
 * The numerator has to be drawn from the same set as `countActiveExperiences`,
 * or the ratio is not a coverage figure. Counting everything the source offered
 * would fold in rows created by this very run, rows returning from
 * `missing_since`, and `former` rows the source still lists — each of which
 * inflates the ratio, so the error runs one way only: it lets detection proceed
 * where the 90 % rule would refuse.
 */
export async function countSeenAmongActive(
  categoryId: number,
  seenExternalIds: string[],
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM experiences
     WHERE category_id = $1
       AND source_membership = 'present'
       AND missing_since IS NULL
       AND is_manual = FALSE
       AND existence <> 'lost'
       AND admission <> 'refused'
       AND external_id = ANY($2::text[])`,
    [categoryId, seenExternalIds]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Mark every still-present row the source did not offer this run, and describe
 * each one.
 *
 * Absence is decided against the external ids the run actually saw, not against
 * `last_seen_sync_log_id`. A dry run stamps nothing, so keying off the column
 * would report the entire category as missing; and in a real run a row that
 * arrived but failed to process never gets stamped either, though the source
 * plainly still lists it.
 *
 * In dry-run mode the same rows are identified and reported, but nothing is
 * written — the preview says what would be flagged without flagging it.
 */
export async function flagMissingExperiences(
  categoryId: number,
  syncLogId: number,
  dryRun: boolean,
  seenExternalIds: string[],
): Promise<ChangeRecord[]> {
  // is_manual rows are excluded on both counts. A curator can add an experience
  // straight into any category, UNESCO included; its `curator-<id>-<ts>` key
  // can never appear in a source listing, so measuring it against one would
  // report every clean run as having delisted the curator's own work.
  // A row judged `lost` is answered, whatever the source still says. Asking
  // again every run would put it back in the review queue for good — the only
  // way out would be to answer a different question — and leaving it in the
  // denominator counts a row that can never be seen against the coverage
  // guard, dragging the category toward the 90 % floor that disables detection.
  const predicate = `category_id = $1
      AND source_membership = 'present'
      AND missing_since IS NULL
      AND is_manual = FALSE
      AND existence <> 'lost'
      AND admission <> 'refused'
      AND external_id <> ALL($2::text[])`;

  const result = dryRun
    ? await pool.query(
        `SELECT id, external_id, name FROM experiences WHERE ${predicate}`,
        [categoryId, seenExternalIds]
      )
    : await pool.query(
        `UPDATE experiences SET missing_since = NOW()
         WHERE ${predicate}
         RETURNING id, external_id, name`,
        [categoryId, seenExternalIds]
      );

  return result.rows.map((row: { id: number; external_id: string; name: string }) => ({
    syncLogId,
    experienceId: row.id,
    externalId: row.external_id,
    nameSnapshot: row.name,
    changeType: 'missing' as const,
    changedFields: null,
    // The object itself went missing, so what it holds is not the news and was
    // never compared: this pass reads the ids a run saw, not any contents.
    contents: null,
    significance: null,
    error: null,
  }));
}
