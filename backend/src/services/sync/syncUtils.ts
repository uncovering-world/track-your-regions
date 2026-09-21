/**
 * Shared sync utilities
 *
 * Common database operations used by the UNESCO, museum, landmark and worship
 * sync services. The object upsert — the place, its membership and the hold —
 * lives in `experienceUpsert.ts` and is re-exported here, so every service keeps
 * one import for what a run writes.
 */

// ADR-0064: raw parameterized SQL on the pool, typed by the generated rows.
import { pool, rollbackQuietly } from '../../db/index.js';
import type { ExperienceSyncLogsRow } from '../../db/schema.generated.js';
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
  sourceId: number,
  triggeredBy: number | null,
  isDryRun: boolean = false,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO experience_sync_logs (source_id, triggered_by, status, is_dry_run)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [sourceId, triggeredBy, isDryRun]
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
 * Also updates the experience_sources table with last sync info — except
 * after a dry run, which synced nothing. Claiming otherwise there would make
 * the source's own record of its last sync a lie.
 */
export async function updateSyncLog(
  sourceId: number,
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
    `UPDATE experience_sources SET
      last_sync_at = NOW(),
      last_sync_status = $2,
      last_sync_error = $3
     WHERE id = $1`,
    [sourceId, status, status === 'failed' ? 'See sync log for details' : null]
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
 * source the same way `updateSyncLog` does, since that is what both admin
 * surfaces read.
 */
export async function annotateClosedSyncLog(
  sourceId: number,
  logId: number,
  status: string,
  errorDetails: unknown[],
): Promise<void> {
  // One transaction, because the two rows are one statement of fact: the log
  // marked and the source not would leave the admin surfaces disagreeing
  // about the run they both read. Pinned to one client: `pool.query('BEGIN')`
  // would leave the two updates free to land on other connections.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const { rows: [log] } = await client.query<Pick<ExperienceSyncLogsRow, 'is_dry_run'>>(
      `UPDATE experience_sync_logs SET status = $2, error_details = $3
       WHERE id = $1
       RETURNING is_dry_run`,
      [logId, status, JSON.stringify(errorDetails)],
    );

    // A dry run synced nothing, so the source's record of its last sync is
    // not this run's to touch.
    if (!log?.is_dry_run) {
      // `last_sync_error` carries the same mapping `updateSyncLog` applies, or
      // a downgrade would leave a stale message from an earlier failed run
      // standing next to this run's new status.
      await client.query(
        `UPDATE experience_sources SET last_sync_status = $2, last_sync_error = $3
         WHERE id = $1`,
        [sourceId, status, status === 'failed' ? 'See sync log for details' : null],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}
