/**
 * The ledger of a world view's geometry computations (`geometry_computations`,
 * #1658, ADR-0122): a row queued when an admin asks for a computation, taken
 * and run by the dump worker, and closed with its outcome. As a dump build's
 * row is (ADR-0106), it is the only channel between the backend and the
 * worker: what was asked for, the running computation's progress and
 * heartbeat, and an admin's cancel.
 */

import { pool } from '../../db/index.js';
import type { CheckValue, GeometryComputationsRow } from '../../db/schema.generated.js';
import type { OperationProgress } from '../../services/operationProgress.js';

/**
 * A ledger row with its checked status read as the vocabulary it is, and
 * whether a running row has stopped beating: its process ended without
 * closing it, which the backend's startup or the next press closes.
 */
export type ComputationRow = Omit<GeometryComputationsRow, 'status'> & {
  status: CheckValue<'geometry_computations', 'status'>;
  stale: boolean;
};

/** What the panel shows of a running computation, written with each heartbeat. */
export interface ComputationProgressRecord {
  /** Regions processed so far, of `total`. */
  progress: number;
  /** Regions the worker found to compute when it started, which the tree may have moved since it was queued. */
  total: number;
  computed: number;
  skipped: number;
  errors: number;
  /** The step in words, as the panel's alert shows it. */
  status: string;
  currentGroup: string;
  /** The step the run is on and how far through it, with its times on the worker's clock (#1356). */
  operation: OperationProgress;
}

/** How often a running computation says it is alive and how far it got. */
export const COMPUTATION_BEAT_EVERY_MS = 5_000;
/** How long a running computation may go without beating before it counts as stopped. */
const ALIVE_FOR = "interval '5 minutes'";

/** A second queued or running computation of a world view, refused by the ledger's unique index. */
export class ComputationAlreadyRunning extends Error {}

/** Queue a computation of `worldViewId` for the worker; refuses a second one of the same world view. */
export async function enqueueComputation(
  worldViewId: number,
  request: { force: boolean; skipSnapping: boolean; regions: number; startedBy: number | null },
): Promise<number> {
  const result = await pool.query<Pick<GeometryComputationsRow, 'id'>>(
    `INSERT INTO geometry_computations (world_view_id, status, force, skip_snapping, regions, started_by)
     VALUES ($1, 'queued', $2, $3, $4, $5) RETURNING id`,
    [worldViewId, request.force, request.skipSnapping, request.regions, request.startedBy],
  ).catch((error: unknown) => {
    if ((error as { constraint?: string }).constraint === 'idx_geometry_computations_one_active') {
      throw new ComputationAlreadyRunning(`A computation of world view ${worldViewId} is already queued or running`);
    }
    throw error;
  });
  return result.rows[0].id;
}

export type ClaimedComputation = Pick<GeometryComputationsRow, 'id' | 'world_view_id' | 'force' | 'skip_snapping'>;

/** Take the oldest queued computation for `runner`, or none; two workers never take the same one. */
export async function claimNextComputation(runner: string): Promise<ClaimedComputation | null> {
  const result = await pool.query<ClaimedComputation>(
    `UPDATE geometry_computations SET status = 'running', runner = $1, heartbeat_at = NOW(), started_at = NOW()
      WHERE id = (SELECT id FROM geometry_computations WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, world_view_id, force, skip_snapping`,
    [runner],
  );
  return result.rows[0] ?? null;
}

/** Say the running computation `id` is alive and how far it got; answers whether an admin asked it to stop. */
export async function beatComputation(id: number, progress: ComputationProgressRecord): Promise<{ cancelRequested: boolean }> {
  const result = await pool.query<Pick<GeometryComputationsRow, 'cancel_requested_at'>>(
    'UPDATE geometry_computations SET heartbeat_at = NOW(), progress = $2 WHERE id = $1 RETURNING cancel_requested_at',
    [id, JSON.stringify(progress)],
  );
  return { cancelRequested: Boolean(result.rows[0]?.cancel_requested_at) };
}

/** Close the computation `id` with how it ended, and its last progress. */
export async function closeComputation(
  id: number,
  end: { status: 'success' | 'failed' | 'cancelled'; progress: ComputationProgressRecord; outcome: string | null; error: string | null },
): Promise<void> {
  await pool.query(
    `UPDATE geometry_computations SET status = $2, progress = $3, outcome = $4, error = $5, finished_at = NOW()
      WHERE id = $1`,
    [id, end.status, JSON.stringify(end.progress), end.outcome, end.error],
  );
}

/**
 * Ask the computation of `worldViewId` to stop: a queued one is closed at
 * once, a running one is told through its row and stops after the region in
 * hand. Answers whether there was one.
 */
export async function requestComputationCancel(worldViewId: number): Promise<boolean> {
  const queued = await pool.query(
    `UPDATE geometry_computations SET status = 'cancelled', error = 'Cancelled.', finished_at = NOW()
      WHERE world_view_id = $1 AND status = 'queued'`,
    [worldViewId],
  );
  const running = await pool.query(
    `UPDATE geometry_computations SET cancel_requested_at = NOW() WHERE world_view_id = $1 AND status = 'running'`,
    [worldViewId],
  );
  return (queued.rowCount ?? 0) + (running.rowCount ?? 0) > 0;
}

/**
 * The computation of `worldViewId` the panel shows: the one queued or running
 * now, or the last one if it ended within `endedWithin` seconds, so a poll
 * that comes after the end still reads how it ended; otherwise null. A
 * running one that stopped beating is shown, marked `stale`.
 */
export async function shownComputationOf(worldViewId: number, endedWithin = 30): Promise<ComputationRow | null> {
  const result = await pool.query<ComputationRow>(
    `SELECT *, (status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - ${ALIVE_FOR})) AS stale
       FROM geometry_computations
      WHERE world_view_id = $1
        AND (status IN ('queued', 'running') OR finished_at > NOW() - make_interval(secs => $2))
      ORDER BY id DESC LIMIT 1`,
    [worldViewId, endedWithin],
  );
  return result.rows[0] ?? null;
}

/**
 * Computations left running by a process that stopped: closed as failed, as
 * `closeOrphanedBuilds` closes a build's. A row stopped when it has not beaten
 * for five minutes, or, given `runner`, at once when that runner left it: a
 * worker that starts passes its own. Called when the backend and the worker
 * start. An ordinary computation started again takes up where this one
 * stopped, since it computes the regions with no geometry and their ancestors.
 */
export async function closeOrphanedComputations(options: { runner?: string } = {}): Promise<number> {
  const result = await pool.query(
    `UPDATE geometry_computations SET status = 'failed', finished_at = NOW(),
            error = 'The computation stopped: its process ended or restarted. Start it again to compute what is left.'
      WHERE status = 'running'
        AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - ${ALIVE_FOR} OR runner = $1)`,
    [options.runner ?? null],
  );
  return result.rowCount ?? 0;
}

/**
 * Close the computations `runner` is running as failed with `error`: the
 * worker's last word when something ends it. The status a poll reads is
 * public, so `error` says what ended the worker, never an error's own text.
 */
export async function failComputationsOf(runner: string, error: string): Promise<number> {
  const result = await pool.query(
    `UPDATE geometry_computations SET status = 'failed', error = $2, finished_at = NOW()
      WHERE status = 'running' AND runner = $1`,
    [runner, error.slice(0, 2000)],
  );
  return result.rowCount ?? 0;
}
