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

import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import { MEMBERSHIPS, membershipAdmittedSql, sourcePlacesSql } from '../../db/membership.js';
import type { ChangeRecord } from './changeRecorder.js';
import { hideLostSql } from '../../db/readerPredicates.js';

/**
 * The places a run is expected to see again, as `e` with the run's membership
 * as `sm` ($1 the source): listed, unmarked, not a curator's own, not lost,
 * and not refused by the source's own rule. Reached through the membership,
 * and matched by its `external_id`, never the place's (ADR-0084).
 *
 * A refused row is not among them (ADR-0024). The source has already turned
 * it down, so it is neither something the source owes us nor something whose
 * absence says anything; counting it would drag every source that refuses
 * anything toward the 90 % floor that disables detection.
 *
 * is_manual rows are excluded on both counts. A curator can add an experience
 * straight into any source, UNESCO included; its `curator-<id>-<ts>` key can
 * never appear in a source listing, so measuring it against one would report
 * every clean run as having delisted the curator's own work.
 *
 * A row judged `lost` is answered, whatever the source still says. Asking
 * again every run would put it back in the review queue for good — the only
 * way out would be to answer a different question — and leaving it in the
 * denominator counts a row that can never be seen against the coverage guard,
 * dragging the source toward the 90 % floor that disables detection.
 */
const EXPECTED = `sm.source_id = $1
       AND sm.source_membership = 'present'
       AND sm.missing_since IS NULL
       AND e.is_manual = FALSE
       AND ${hideLostSql('e')}
       AND ${membershipAdmittedSql('sm')}`;

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

/** Count the rows a run is expected to see again (`EXPECTED`). */
export async function countActiveExperiences(sourceId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ${sourcePlacesSql('e', 'sm')}
     WHERE ${EXPECTED}`,
    [sourceId]
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
  sourceId: number,
  seenExternalIds: string[],
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ${sourcePlacesSql('e', 'sm')}
     WHERE ${EXPECTED}
       AND sm.external_id = ANY($2::text[])`,
    [sourceId, seenExternalIds]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Mark the memberships `flagged` names, under their places' locks.
 *
 * The places first, in one statement and in id order, then the memberships:
 * the order a curator's write takes (the place's `OBJECT_LOCK`, then its
 * membership), so this many-row write and a curator's one-row write cannot
 * each hold what the other waits for. Marking the membership writes the place
 * as well — its derived flag — which is the second half of that order.
 */
async function markMemberships(
  flagged: string,
  sourceId: number,
  seenExternalIds: string[],
): Promise<{ id: number; external_id: string; name: string }[]> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id FROM experiences WHERE id IN (SELECT id FROM (${flagged}) f) ORDER BY id ${OBJECT_LOCK}`,
      [sourceId, seenExternalIds],
    );
    // Only the places just locked: the next statement reads a newer snapshot,
    // and a membership a curator restored in between would otherwise be
    // marked under no lock of its place.
    const marked = await client.query(
      `UPDATE ${MEMBERSHIPS} m SET missing_since = NOW(), updated_at = NOW()
         FROM (${flagged}) f
        WHERE m.experience_id = f.id AND m.source_id = $1 AND m.external_id = f.external_id
          AND m.experience_id = ANY($3::int[])
          AND m.missing_since IS NULL
       RETURNING f.id, f.external_id, f.name`,
      [sourceId, seenExternalIds, locked.rows.map((row: { id: number }) => row.id)],
    );
    await client.query('COMMIT');
    return marked.rows;
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * Mark every still-present row the source did not offer this run, and describe
 * each one.
 *
 * Absence is decided against the external ids the run actually saw, not against
 * `last_seen_sync_log_id`. A dry run stamps nothing, so keying off the column
 * would report the entire source as missing; and in a real run a row that
 * arrived but failed to process never gets stamped either, though the source
 * plainly still lists it.
 *
 * In dry-run mode the same rows are identified and reported, but nothing is
 * written — the preview says what would be flagged without flagging it.
 */
export async function flagMissingExperiences(
  sourceId: number,
  syncLogId: number,
  dryRun: boolean,
  seenExternalIds: string[],
): Promise<ChangeRecord[]> {
  // The mark is the membership's (ADR-0084): this source has stopped listing
  // the place, which says nothing of another source that still does. The
  // place's own flag follows from its memberships (derive_place_listing()).
  const predicate = `${EXPECTED}
      AND sm.external_id <> ALL($2::text[])`;
  const flagged = `SELECT e.id, sm.external_id, e.name FROM ${sourcePlacesSql('e', 'sm')} WHERE ${predicate}`;

  const rows = dryRun
    ? (await pool.query(flagged, [sourceId, seenExternalIds])).rows
    : await markMemberships(flagged, sourceId, seenExternalIds);

  return rows.map((row: { id: number; external_id: string; name: string }) => ({
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
