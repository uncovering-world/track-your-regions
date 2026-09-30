/**
 * Shared sync utilities
 *
 * Common database operations used by the UNESCO, museum, landmark and worship
 * sync services. The object upsert — the place, its membership and the hold —
 * lives in `experienceUpsert.ts` and is re-exported here, so every service keeps
 * one import for what a run writes.
 */

// ADR-0064: raw parameterized SQL on the pool, typed by the generated rows.
import type { ClosedSyncStatus } from '@tyr/shared/runStatuses';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { CheckValue, ExperienceSyncLogsRow } from '../../db/schema.generated.js';
import { ORPHANED_RUN_MARKER, stoppedByRestartSql } from './syncLogMarkers.js';
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
 * region assignments — of a point that has not moved; deleting and re-inserting
 * would force a full re-assignment after every run.
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

/**
 * Where a running run stands, as its log row carries it (#1131): the phase,
 * the panel's line and object, how far through its items it is, and the
 * running counts, which go to the same total_* columns the close writes.
 */
export interface SyncLogProgress {
  phase: CheckValue<'experience_sync_logs', 'phase'>;
  statusMessage: string;
  currentItem: string;
  done: number;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  missing: number;
  curatedConflicts: number;
  held: number;
  filtered: number;
  errors: number;
  /**
   * The objects whose points the run has moved, and those it took over from
   * earlier runs, none of them placed yet (#1152); empty on a preview.
   */
  unplaced: number[];
}

/**
 * Write a running run's progress to its log row, and stamp `progress_at`.
 *
 * Only a running row: a write still in flight when the run closes its row
 * finds the status moved and touches nothing, so it can never put a running
 * count back over the figures the close wrote. `status` is not written here,
 * so the status-move guard never fires on it. Answers whether the row took it.
 */
export async function writeSyncLogProgress(logId: number, snapshot: SyncLogProgress): Promise<boolean> {
  const result = await pool.query(
    `UPDATE experience_sync_logs SET
      phase = $2,
      status_message = $3,
      current_item = $4,
      progress_done = $5,
      progress_total = $6,
      total_created = $7,
      total_updated = $8,
      total_unchanged = $9,
      total_missing = $10,
      total_curated_conflicts = $11,
      total_held = $12,
      total_filtered = $13,
      total_errors = $14,
      unplaced_experience_ids = $15::int[],
      progress_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [logId, snapshot.phase, snapshot.statusMessage, snapshot.currentItem, snapshot.done,
     snapshot.total, snapshot.created, snapshot.updated, snapshot.unchanged, snapshot.missing,
     snapshot.curatedConflicts, snapshot.held, snapshot.filtered, snapshot.errors, snapshot.unplaced],
  );
  return (result.rowCount ?? 0) > 0;
}

/** What earlier runs of a source moved and never placed, and the rows that name it. */
export interface UnplacedExperiences {
  logIds: number[];
  experienceIds: number[];
}

/**
 * The objects the source's earlier closed real runs moved and did not place
 * (#1152): a run the restart killed before its placement, or during it, and
 * one whose placement failed. Read by the source's next real run, which
 * places them with its own. A running row is not read: its run, in another
 * process, will place what it names.
 */
export async function readUnplacedExperiences(
  sourceId: number,
  beforeLogId: number,
): Promise<UnplacedExperiences> {
  const { rows } = await pool.query<Pick<ExperienceSyncLogsRow, 'id' | 'unplaced_experience_ids'>>(
    `SELECT id, unplaced_experience_ids
       FROM experience_sync_logs
      WHERE source_id = $1 AND id < $2 AND status <> 'running' AND NOT is_dry_run
        AND cardinality(unplaced_experience_ids) > 0
      ORDER BY id`,
    [sourceId, beforeLogId],
  );
  const experienceIds = new Set<number>();
  for (const row of rows) {
    for (const id of row.unplaced_experience_ids ?? []) experienceIds.add(id);
  }
  return { logIds: rows.map(row => row.id), experienceIds: [...experienceIds] };
}

/** Say on these runs' rows that what they named is placed now. Answers how many rows changed. */
export async function clearUnplacedExperiences(logIds: number[]): Promise<number> {
  const result = await pool.query(
    `UPDATE experience_sync_logs SET unplaced_experience_ids = '{}'
      WHERE id = ANY($1::int[]) AND cardinality(unplaced_experience_ids) > 0`,
    [logIds],
  );
  return result.rowCount ?? 0;
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
  status: ClosedSyncStatus,
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

/** A source's newest run as the status endpoint reads it (`readLatestSyncLog`). */
export type LatestSyncLogRow = Pick<ExperienceSyncLogsRow,
  'id' | 'status' | 'is_dry_run' | 'started_at' | 'completed_at' | 'phase' | 'status_message'
  | 'current_item' | 'progress_done' | 'progress_total' | 'progress_at' | 'total_fetched'
  | 'total_created' | 'total_updated' | 'total_unchanged' | 'total_missing'
  | 'total_curated_conflicts' | 'total_held' | 'total_filtered' | 'total_errors'> & {
  stopped_by_restart: boolean;
};

/**
 * The newest run of a source, previews included, or null for a source never
 * run: a run going on in another process, or the last one, whose row says how
 * far it got when a restart stopped it (#1131).
 */
export async function readLatestSyncLog(sourceId: number): Promise<LatestSyncLogRow | null> {
  const { rows } = await pool.query<LatestSyncLogRow>(
    `SELECT l.id, l.status, l.is_dry_run, l.started_at, l.completed_at, l.phase, l.status_message,
            l.current_item, l.progress_done, l.progress_total, l.progress_at, l.total_fetched,
            l.total_created, l.total_updated, l.total_unchanged, l.total_missing,
            l.total_curated_conflicts, l.total_held, l.total_filtered, l.total_errors,
            ${stoppedByRestartSql('l')} AS stopped_by_restart
       FROM experience_sync_logs l
      WHERE l.source_id = $1
      ORDER BY l.id DESC
      LIMIT 1`,
    [sourceId],
  );
  return rows[0] ?? null;
}

/**
 * Close the runs a dead process left `running`, at startup (#1131).
 *
 * Each is closed `failed` with the orphaned-run marker the review queue and
 * the run card read, and with how far it got: the counts and the phase its
 * progress writes left stand, and `total_fetched` becomes the items it had
 * been given, the figure a failed run closes with. A source whose newest real
 * run is one of these gets the same verdict as its last sync, as
 * `updateSyncLog` would have given it, so the card and the history agree; a
 * preview synced nothing and leaves the source alone.
 *
 * One statement, so the log and the source can never disagree about a run.
 * It closes every running row, which is right only while one backend process
 * runs the syncs: a second process starting would close the first's live runs.
 */
export async function closeOrphanedSyncLogs(): Promise<{ closed: number; sourcesMarked: number }> {
  const { rows: [counts] } = await pool.query<{ closed: number; sources_marked: number }>(
    `WITH closed AS (
       UPDATE experience_sync_logs SET
         status = 'failed',
         completed_at = NOW(),
         error_details = jsonb_build_array($1::jsonb),
         total_fetched = COALESCE(progress_total, total_fetched)
       WHERE status = 'running'
       RETURNING id, source_id, is_dry_run, completed_at
     ), newest AS (
       SELECT DISTINCT ON (source_id) id, source_id, completed_at
       FROM closed
       WHERE NOT is_dry_run
       ORDER BY source_id, id DESC
     ), marked AS (
       UPDATE experience_sources s SET
         last_sync_at = newest.completed_at,
         last_sync_status = 'failed',
         last_sync_error = $2
       FROM newest
       WHERE s.id = newest.source_id
         AND NOT EXISTS (
           SELECT 1 FROM experience_sync_logs later
           WHERE later.source_id = newest.source_id AND NOT later.is_dry_run AND later.id > newest.id
         )
       RETURNING s.id
     )
     SELECT (SELECT COUNT(*) FROM closed)::int AS closed,
            (SELECT COUNT(*) FROM marked)::int AS sources_marked`,
    [JSON.stringify(ORPHANED_RUN_MARKER), 'See sync log for details'],
  );
  return { closed: counts.closed, sourcesMarked: counts.sources_marked };
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
  status: ClosedSyncStatus,
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
