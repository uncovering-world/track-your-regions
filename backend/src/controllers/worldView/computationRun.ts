/**
 * A world view's geometry computation as the dump worker runs it (#1658,
 * ADR-0122): it takes the computations the admin panel queues in the ledger
 * (`computationLedger.ts`), one at a time and beside the dump builds, computes
 * the regions deepest first, then simplifies the borders siblings share. An
 * edit, a `git pull` or a restart of the backend does not stop it; stopping
 * the worker does, and the row then says to start it again.
 *
 * Only the worker's entry (`worker.ts`) imports this module, and only this
 * module imports the region pipeline it runs, so no request handler computes
 * a world view's geometry in the backend's process (the backend lint holds
 * both).
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { pool } from '../../db/index.js';
import { Operation } from '../../services/operationProgress.js';
import { WORKER_RUNNER } from '../../services/dumps/dumpWorker.js';
import { computeRegionGeometryCore } from './geometryComputeSingle.js';
import { loadGroupsToCompute, type GroupRow } from './computationScope.js';
import {
  beatComputation,
  claimNextComputation,
  closeComputation,
  closeOrphanedComputations,
  COMPUTATION_BEAT_EVERY_MS,
  type ClaimedComputation,
  type ComputationProgressRecord,
} from './computationLedger.js';

/** The computation's steps, as its progress counts them (#1356). */
const STEP = { regions: 1, coverage: 2 } as const;

/** How long the worker waits before it looks for a queued computation again. */
const POLL_EVERY_MS = 3_000;

/** A running computation's state in the worker, written to its row with each heartbeat. */
export interface ComputationProgress {
  cancel: boolean;
  progress: number;
  total: number;
  status: string;
  computed: number;
  skipped: number;
  errors: number;
  currentGroup: string;
  /** The step the run is on, of the two, and how far through it (#1356). */
  operation: Operation;
}

const recordOf = (state: ComputationProgress): ComputationProgressRecord => ({
  progress: state.progress,
  total: state.total,
  computed: state.computed,
  skipped: state.skipped,
  errors: state.errors,
  status: state.status,
  currentGroup: state.currentGroup,
  operation: state.operation.progress,
});

async function computeOneGroup(
  group: GroupRow,
  progressState: ComputationProgress,
  skipSnapping: boolean,
): Promise<void> {
  progressState.currentGroup = group.name;
  progressState.status = `Computing: ${group.name} [depth ${group.depth}]`;

  // Group may have been deleted mid-computation. A hand-drawn boundary is
  // computeRegionGeometryCore's to turn away; it answers not computed, and is
  // counted as skipped below.
  const exists = await pool.query(
    'SELECT id FROM regions WHERE id = $1',
    [group.id],
  );
  if (exists.rows.length === 0) return;

  const startTime = Date.now();
  const result = await computeRegionGeometryCore(group.id, {
    skipSnapping,
    logPrefix: `[Geometry ${progressState.progress + 1}/${progressState.total}]`,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (result.computed) {
    progressState.operation.note(`Completed ${group.name} in ${elapsed}s (${result.points?.toLocaleString() || '?'} points)`);
    progressState.computed++;
  } else if (result.error) {
    progressState.operation.note(`Skipped ${group.name}: ${result.error}`);
    progressState.skipped++;
  }
}

async function processGroups(
  groups: GroupRow[],
  progressState: ComputationProgress,
  skipSnapping: boolean,
): Promise<void> {
  progressState.operation.step(STEP.regions, `Computing the geometry of ${groups.length} regions, deepest first`, groups.length);
  for (const group of groups) {
    if (progressState.cancel) {
      progressState.status = 'Cancelled';
      break;
    }
    try {
      await computeOneGroup(group, progressState, skipSnapping);
    } catch (e) {
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- group.id is a number
      console.error(`Error computing geometry for group ${group.id}:`, e);
      progressState.errors++;
      progressState.status = `Error: ${group.name}`;
    }
    progressState.progress++;
    progressState.operation.advance();
  }
}

async function applyCoverageSimplification(
  worldViewId: number,
  progressState: ComputationProgress,
): Promise<void> {
  if (progressState.cancel) return;

  progressState.status = 'Applying coverage simplification...';

  const parentIds = await pool.query(`
    SELECT DISTINCT parent_region_id
    FROM regions
    WHERE world_view_id = $1 AND parent_region_id IS NOT NULL AND geom_3857 IS NOT NULL
    GROUP BY parent_region_id
    HAVING COUNT(*) >= 2
  `, [worldViewId]);

  progressState.currentGroup = '';
  progressState.operation.step(STEP.coverage, `Simplifying the shared borders of ${parentIds.rows.length} parent regions, so siblings meet without gaps`, parentIds.rows.length);
  for (const row of parentIds.rows) {
    if (progressState.cancel) break;
    await pool.query('SELECT simplify_coverage_regions($1::integer)', [row.parent_region_id]);
    progressState.operation.advance();
  }
}

/** The run's end on its row: done, cancelled by an admin, or stopped with the worker. */
function endOf(progressState: ComputationProgress, stop: AbortSignal): Parameters<typeof closeComputation>[1] {
  const done = `${progressState.progress} of ${progressState.total} regions`;
  if (stop.aborted) {
    progressState.status = 'Error: the dump worker stopped; start the computation again to compute what is left.';
    progressState.operation.finish(`stopped with the worker after ${done}`);
    return { status: 'failed', progress: recordOf(progressState), outcome: null, error: 'The computation stopped with the dump worker. Start it again to compute what is left.' };
  }
  if (progressState.cancel) {
    // A cancel that landed after the loop's last check, in the last region or
    // in the second step, still ends the run as cancelled.
    progressState.status = 'Cancelled';
    progressState.operation.finish(`cancelled after ${done}`);
    return { status: 'cancelled', progress: recordOf(progressState), outcome: null, error: 'Cancelled.' };
  }
  const outcome = `${progressState.computed} computed, ${progressState.skipped} skipped, ${progressState.errors} errors`;
  progressState.status = 'Complete';
  progressState.currentGroup = '';
  progressState.operation.finish(outcome);
  return { status: 'success', progress: recordOf(progressState), outcome, error: null };
}

/**
 * Run the computation the worker took, to its end on the row: every five
 * seconds the row gets its progress and answers whether an admin asked it to
 * stop, which, like the worker stopping, ends the run after the region in
 * hand.
 */
export async function runComputation(claimed: ClaimedComputation, stop: AbortSignal): Promise<void> {
  const worldViewId = claimed.world_view_id;
  const progressState: ComputationProgress = {
    cancel: false,
    progress: 0,
    total: 0,
    status: 'Starting...',
    computed: 0,
    skipped: 0,
    errors: 0,
    currentGroup: '',
    operation: new Operation(`[Geometry] World view ${worldViewId}:`, Object.keys(STEP).length),
  };
  const stopAsked = () => {
    if (progressState.cancel) return;
    progressState.cancel = true;
    progressState.status = 'Cancelling...';
    progressState.operation.cancel();
  };
  stop.addEventListener('abort', stopAsked, { once: true });
  // A stop that landed while the claim was in flight fired before the listener.
  if (stop.aborted) stopAsked();
  const beat = async () => {
    const { cancelRequested } = await beatComputation(claimed.id, recordOf(progressState));
    if (cancelRequested) stopAsked();
  };
  const heartbeat = setInterval(() => {
    beat().catch(error => console.error('[Geometry] Computation %d could not beat:', claimed.id, error));
  }, COMPUTATION_BEAT_EVERY_MS);

  try {
    const groups = await loadGroupsToCompute(worldViewId, claimed.force);
    const totalCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM regions WHERE world_view_id = $1',
      [worldViewId],
    );
    progressState.total = groups.length;
    progressState.skipped = totalCount.rows[0].count - groups.length;
    console.log(`[Geometry] Starting computation ${claimed.id} of world view ${worldViewId}: ${groups.length} regions to process (skipSnapping=${claimed.skip_snapping})`);
    await beat();
    await processGroups(groups, progressState, claimed.skip_snapping);
    await applyCoverageSimplification(worldViewId, progressState);
    await closeComputation(claimed.id, endOf(progressState, stop));
  } catch (err) {
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- worldViewId is a number
    console.error(`[Geometry] Pipeline error for world view ${worldViewId}:`, err);
    progressState.status = 'Error: the computation stopped; the dump worker\'s log has the cause.';
    progressState.operation.finish('failed');
    await closeComputation(claimed.id, {
      status: 'failed', progress: recordOf(progressState), outcome: null,
      error: 'The computation stopped on an error; the dump worker\'s log has the cause.',
    });
  } finally {
    clearInterval(heartbeat);
    stop.removeEventListener('abort', stopAsked);
  }
}

/** Run the oldest queued computation, if any; answers whether there was one. */
export async function runNextComputation(stop: AbortSignal): Promise<boolean> {
  const claimed = await claimNextComputation(WORKER_RUNNER);
  if (!claimed) return false;
  console.log(`[Geometry] Worker took computation ${claimed.id} of world view ${claimed.world_view_id}`);
  await runComputation(claimed, stop);
  return true;
}

/** Take and run queued computations, one at a time, until `stop` aborts. */
export async function computationLoop(stop: AbortSignal): Promise<void> {
  const closed = await closeOrphanedComputations({ runner: WORKER_RUNNER });
  if (closed > 0) console.log(`[Geometry] Closed ${closed} computation(s) the worker's previous run left`);
  while (!stop.aborted) {
    const ran = await runNextComputation(stop).catch(error => {
      console.error('[Geometry] The worker could not take a computation:', error);
      return false;
    });
    if (!ran) await sleep(POLL_EVERY_MS, undefined, { signal: stop }).catch(() => undefined);
  }
}
