/**
 * Shared sync utilities
 *
 * Common database operations used by UNESCO, museum, and landmark sync services.
 * The object upsert — the place, its membership and the hold — lives in
 * `experienceUpsert.ts` and is re-exported here, so the three services keep
 * one import for what a run writes.
 */

import { eq } from 'drizzle-orm';
import { pool, db } from '../../db/index.js';
import { experienceSyncLogs, experienceCategories } from '../../db/schema.js';
import {
  writeExperienceLocations, type LocationWriteResult, type LocationWriteRun,
} from './locationWriter.js';

export {
  upsertExperienceRecord,
  type ExperienceUpsertParams,
  type UpsertOutcome,
} from './experienceUpsert.js';

// =============================================================================
// Single-Location Upsert
// =============================================================================

/**
 * Write the one location a venue has.
 *
 * Used by museum and landmark syncs; UNESCO has its own multi-location path.
 * Both go through `writeExperienceLocations`, which keeps the row — and so the
 * region assignments — of a point that has not moved. This used to delete and
 * re-insert, which is why every run needed a full re-assignment afterwards.
 */
export async function upsertSingleLocation(
  experienceId: number,
  externalRef: string,
  lon: number,
  lat: number,
  run: LocationWriteRun,
): Promise<LocationWriteResult> {
  return writeExperienceLocations(experienceId, [
    { name: null, externalRef, lon, lat },
  ], run);
}

// =============================================================================
// Sync Log Operations
// =============================================================================

/**
 * Create a new sync log entry with status 'running'.
 */
export async function createSyncLog(
  categoryId: number,
  triggeredBy: number | null,
  isDryRun: boolean = false,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (category_id, triggered_by, status, is_dry_run)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [categoryId, triggeredBy, isDryRun]
  );
  return result.rows[0].id;
}

export interface SyncLogStats {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  missing: number;
  curatedConflicts: number;
  /** Rows the gate held whole; a subset of `unchanged`, counted again (#523). */
  held: number;
  filtered: number;
  errors: number;
  detectionSkippedReason?: string | null;
  /**
   * Why the run marked none of the contents its objects stopped holding — the
   * works floor (ADR-0044). A run carrying one is `partial`, never `success`.
   */
  withdrawalSkippedReason?: string | null;
}

/**
 * Update a sync log entry with final status and stats.
 *
 * Also updates the experience_categories table with last sync info — except
 * after a dry run, which synced nothing. Claiming otherwise there would make
 * the category's own record of its last sync a lie.
 */
export async function updateSyncLog(
  categoryId: number,
  logId: number,
  status: string,
  stats: SyncLogStats,
  errorDetails?: unknown[],
): Promise<void> {
  const result = await pool.query(
    `UPDATE experience_sync_logs SET
      completed_at = NOW(),
      status = $2,
      total_fetched = $3,
      total_created = $4,
      total_updated = $5,
      total_errors = $6,
      error_details = $7,
      total_unchanged = $8,
      total_missing = $9,
      total_curated_conflicts = $10,
      detection_skipped_reason = $11,
      total_filtered = $12,
      total_held = $13,
      withdrawal_skipped_reason = $14
     WHERE id = $1
     RETURNING is_dry_run`,
    [logId, status, stats.fetched, stats.created, stats.updated, stats.errors,
     errorDetails ? JSON.stringify(errorDetails) : null,
     stats.unchanged, stats.missing, stats.curatedConflicts,
     stats.detectionSkippedReason ?? null, stats.filtered, stats.held,
     stats.withdrawalSkippedReason ?? null]
  );

  if (result.rows[0]?.is_dry_run) return;

  await pool.query(
    `UPDATE experience_categories SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [categoryId, status, status === 'failed' ? 'See sync log for details' : null]
  );
}

/**
 * Note on an already-closed run that a follow-up step failed.
 *
 * Deliberately narrow. `updateSyncLog` is a full rewrite — it sets every stat
 * column, `detection_skipped_reason` and `withdrawal_skipped_reason`
 * unconditionally — so calling it again to change two fields would clobber the
 * eleven it is not being asked about. Three of those genuinely differ between
 * the caller's view and what the run wrote: `total_fetched` is the source's
 * item count rather than the processed one, `detection_skipped_reason` is
 * produced by `detectMissing`, and `withdrawal_skipped_reason` by the
 * collector's floor inside `fetchItems` (ADR-0044) — neither of which a later
 * caller has any way to recompute.
 *
 * Touches only `status` and `error_details`, and mirrors the status onto the
 * category the same way `updateSyncLog` does, since that is what both admin
 * surfaces read.
 */
export async function annotateClosedSyncLog(
  categoryId: number,
  logId: number,
  status: string,
  errorDetails: unknown[],
): Promise<void> {
  // ADR-0004: Drizzle over raw SQL. These are ordinary relational updates with
  // no PostGIS in them, which is where the raw `pool` is reserved for.
  //
  // One transaction, because the two rows are one statement of fact: the log
  // marked and the category not would leave the admin surfaces disagreeing
  // about the run they both read.
  await db.transaction(async (tx) => {
    const [log] = await tx
      .update(experienceSyncLogs)
      .set({ status, errorDetails })
      .where(eq(experienceSyncLogs.id, logId))
      .returning({ isDryRun: experienceSyncLogs.isDryRun });

    if (log?.isDryRun) return;

    // `last_sync_error` carries the same mapping `updateSyncLog` applies, or a
    // downgrade would leave a stale message from an earlier failed run standing
    // next to this run's new status.
    await tx
      .update(experienceCategories)
      .set({
        lastSyncStatus: status,
        lastSyncError: status === 'failed' ? 'See sync log for details' : null,
      })
      .where(eq(experienceCategories.id, categoryId));
  });
}
