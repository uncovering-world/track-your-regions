/**
 * The admin panel's side of a world view's geometry computation (#1658,
 * ADR-0122): a computation is checked and queued in the ledger, and the dump
 * worker runs it (`computationRun.ts`), so an edit or a restart of the backend
 * does not stop it. What the panel shows of it is read back from its row,
 * whatever process runs it.
 */

import type { z } from 'zod/v4';
import type { ComputationCancelled, ComputationStartResult, ComputationStatus } from '../../api/responses/geometry.js';
import { createError } from '../../middleware/errorHandler.js';
import type { computeGeometryQuerySchema, worldViewIdParamSchema } from '../../types/index.js';
import { pool } from '../../db/index.js';
import { operationAnswer } from '../../services/operationProgress.js';
import { loadGroupsToCompute } from './computationScope.js';
import {
  closeOrphanedComputations,
  ComputationAlreadyRunning,
  enqueueComputation,
  requestComputationCancel,
  shownComputationOf,
  type ComputationProgressRecord,
  type ComputationRow,
} from './computationLedger.js';

type WorldViewParams = z.output<typeof worldViewIdParamSchema>;

/**
 * The status line of a computation that has ended, in the words the panel's
 * alert reads; a running row that stopped beating has ended too, its worker
 * gone without closing it.
 */
function endedStatus(row: ComputationRow): string {
  if (row.stale) return 'Error: The computation stopped: its process ended or restarted. Start it again to compute what is left.';
  if (row.status === 'success') return 'Complete';
  if (row.status === 'cancelled') return 'Cancelled';
  return `Error: ${row.error ?? 'the computation stopped.'}`;
}

/** The status line of a computation queued or running. */
function liveStatus(row: ComputationRow, progress: ComputationProgressRecord | null): string {
  if (row.status === 'queued') return 'Waiting for the dump worker...';
  if (row.cancel_requested_at) return 'Cancelling...';
  return progress?.status ?? 'Starting...';
}

/**
 * A computation's row as the status a poll reads. A running row that stopped
 * beating reads as stopped, so a panel never polls a region frozen by a
 * worker that was stopped and not started again.
 */
export function statusOf(row: ComputationRow, now = Date.now()): ComputationStatus {
  const progress = row.progress as ComputationProgressRecord | null;
  const running = (row.status === 'queued' || row.status === 'running') && !row.stale;
  const total = progress?.total ?? row.regions;
  const done = progress?.progress ?? 0;
  return {
    running,
    progress: done,
    total,
    status: running ? liveStatus(row, progress) : endedStatus(row),
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    computed: progress?.computed ?? 0,
    skipped: progress?.skipped ?? 0,
    errors: progress?.errors ?? 0,
    currentRegion: progress?.currentGroup ?? '',
    currentMembers: 0,
    ...(progress?.operation
      ? { operation: { ...operationAnswer(progress.operation, now), cancelling: running && row.cancel_requested_at !== null } }
      : {}),
  };
}

/**
 * The geometry computation of a world view as it stands: the one queued or
 * running, or the last one for a short while after it ended.
 */
export async function getComputationStatus(
  { params: { worldViewId } }: { params: WorldViewParams },
): Promise<ComputationStatus> {
  const row = await shownComputationOf(worldViewId);
  return row ? statusOf(row) : { running: false };
}

/** Ask the geometry computation of a world view to stop, queued or running. */
export async function cancelComputation(
  { params: { worldViewId } }: { params: WorldViewParams },
): Promise<ComputationCancelled> {
  await requestComputationCancel(worldViewId);
  return { cancelled: true };
}

/**
 * Queue the geometry computation of a world view for the dump worker. Answers
 * how many regions it will compute; refuses a second one of the same world
 * view while one is queued or running.
 */
export async function computeWorldViewGeometries(
  { params: { worldViewId }, query, caller }: {
    params: WorldViewParams; query: z.output<typeof computeGeometryQuerySchema>; caller: Express.User;
  },
): Promise<ComputationStartResult> {
  const force = query.force === 'true';
  const skipSnapping = query.skipSnapping === 'true';

  const groups = await loadGroupsToCompute(worldViewId, force);
  const totalCount = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM regions WHERE world_view_id = $1',
    [worldViewId],
  );
  const total = totalCount.rows[0].count;
  const alreadyComputed = total - groups.length;

  if (groups.length === 0) {
    return {
      started: false,
      total,
      needsComputation: 0,
      alreadyComputed,
      message: 'All groups already have computed geometries',
    };
  }

  // A computation whose process stopped without closing its row would
  // otherwise hold the world view's slot until something closed it.
  await closeOrphanedComputations();
  try {
    await enqueueComputation(worldViewId, { force, skipSnapping, regions: groups.length, startedBy: caller.id });
  } catch (error) {
    if (error instanceof ComputationAlreadyRunning) throw createError('Computation already in progress for this hierarchy', 409);
    throw error;
  }

  return {
    started: true,
    total,
    needsComputation: groups.length,
    alreadyComputed,
    message: 'Computation queued for the dump worker. Poll /status endpoint for progress.',
  };
}
