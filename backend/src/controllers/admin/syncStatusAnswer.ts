/**
 * The answers of the sync status endpoint (`getSyncStatus` in
 * `syncController.ts`), from the three places a source's run can be read
 * (#1131):
 *
 * - the run this process holds, from memory, the only one it can cancel;
 * - a run going on elsewhere — another backend process — from its log row,
 *   as its progress writes left it;
 * - no run going: the source's last real run, and the newest run's own row,
 *   which says when a restart stopped it and how far it had got.
 */

import type { SyncLastRun, SyncStatus } from '../../api/responses/admin.js';
import type { CheckValue, ExperienceSourcesRow } from '../../db/schema.generated.js';
import type { LatestSyncLogRow } from '../../services/sync/syncUtils.js';
import { isCancellable } from '../../services/sync/syncOrchestrator.js';
import { isTerminalSyncStatus, type SyncProgress } from '../../services/sync/types.js';

function percentOf(progress: number, total: number): number {
  return total > 0 ? Math.round((progress / total) * 100) : 0;
}

/** The run this process holds, as it stands in memory. */
export function heldRunStatusOf(status: SyncProgress): SyncStatus {
  return {
    running: !isTerminalSyncStatus(status.status),
    // Whether a Cancel press would actually be acted on. Sent rather than
    // re-derived in the panel: a copy that lags shows up as a button
    // promising what the server refuses.
    cancellable: isCancellable(status),
    kind: status.kind,
    status: status.status,
    statusMessage: status.statusMessage,
    progress: status.progress,
    total: status.total,
    percent: percentOf(status.progress, status.total),
    created: status.created,
    updated: status.updated,
    unchanged: status.unchanged,
    missing: status.missing,
    curatedConflicts: status.curatedConflicts,
    held: status.held,
    filtered: status.filtered,
    errors: status.errors,
    currentItem: status.currentItem,
    logId: status.logId,
    dryRun: status.dryRun,
  };
}

/**
 * A run another process holds, as its log row says. Never cancellable from
 * here: the flag a cancel sets lives in the memory of the process running it.
 */
export function rowRunStatusOf(row: LatestSyncLogRow): SyncStatus {
  const progress = row.progress_done ?? 0;
  const total = row.progress_total ?? 0;
  const progressAt = row.progress_at ?? row.started_at;
  return {
    running: true,
    cancellable: false,
    kind: 'sync',
    // The CHECK is what makes the stored text one of the phases.
    status: (row.phase as CheckValue<'experience_sync_logs', 'phase'> | null) ?? 'fetching',
    statusMessage: row.status_message ?? '',
    progress,
    total,
    percent: percentOf(progress, total),
    created: row.total_created ?? 0,
    updated: row.total_updated ?? 0,
    unchanged: row.total_unchanged ?? 0,
    missing: row.total_missing ?? 0,
    curatedConflicts: row.total_curated_conflicts ?? 0,
    held: row.total_held ?? 0,
    filtered: row.total_filtered ?? 0,
    errors: row.total_errors ?? 0,
    currentItem: row.current_item ?? '',
    logId: row.id,
    dryRun: row.is_dry_run,
    ...(progressAt === null ? {} : { progressAt: progressAt.toISOString() }),
  };
}

/** A closed run as the card reads it. */
export function lastRunOf(row: LatestSyncLogRow): SyncLastRun {
  return {
    logId: row.id,
    // The CHECK is what makes the stored text one of the statuses, and the
    // caller answers a running row with `rowRunStatusOf` instead.
    status: row.status as CheckValue<'experience_sources', 'last_sync_status'>,
    dryRun: row.is_dry_run,
    startedAt: row.started_at === null ? null : row.started_at.toISOString(),
    completedAt: row.completed_at === null ? null : row.completed_at.toISOString(),
    phase: row.phase as CheckValue<'experience_sync_logs', 'phase'> | null,
    progress: row.progress_done ?? 0,
    total: row.progress_total ?? row.total_fetched ?? 0,
    created: row.total_created ?? 0,
    updated: row.total_updated ?? 0,
    held: row.total_held ?? 0,
    errors: row.total_errors ?? 0,
    stoppedByRestart: row.stopped_by_restart,
  };
}

/** No run going: the source's last real run, and the newest run's row when there is one. */
export function idleStatusOf(
  source: Pick<ExperienceSourcesRow, 'last_sync_at' | 'last_sync_status'>,
  latest: LatestSyncLogRow | null,
): SyncStatus {
  return {
    running: false,
    lastSyncAt: source.last_sync_at === null ? null : source.last_sync_at.toISOString(),
    // The CHECK is what makes the stored text one of the closing statuses.
    lastSyncStatus: source.last_sync_status as CheckValue<'experience_sources', 'last_sync_status'> | null,
    ...(latest === null ? {} : { lastRun: lastRunOf(latest) }),
  };
}
