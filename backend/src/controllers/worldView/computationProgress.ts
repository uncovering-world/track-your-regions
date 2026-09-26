/**
 * Geometry computation with progress tracking for world views
 */

import type { z } from 'zod/v4';
import type { ComputationCancelled, ComputationStartResult, ComputationStatus } from '../../api/responses/geometry.js';
import { createError } from '../../middleware/errorHandler.js';
import type { computeGeometryQuerySchema, worldViewIdParamSchema } from '../../types/index.js';
import { pool } from '../../db/index.js';
import { runningComputations } from './types.js';
import type { ComputationProgress } from './types.js';
import { computeRegionGeometryCore } from './geometryComputeSingle.js';

type WorldViewParams = z.output<typeof worldViewIdParamSchema>;

/**
 * Get status of geometry computation for a hierarchy
 */
export async function getComputationStatus(
  { params: { worldViewId } }: { params: WorldViewParams },
): Promise<ComputationStatus> {
  const status = runningComputations.get(worldViewId);
  if (!status) return { running: false };

  // Check if computation has finished (Complete, Cancelled, or errored).
  // `Error:` is set by the background pipeline's catch block and must be
  // treated as finished here too — otherwise polling clients keep seeing
  // running:true for the full 30 s cleanup window after a failure.
  const isFinished = status.status === 'Complete'
    || status.status === 'Cancelled'
    || status.status.startsWith('Error:');

  return {
    running: !isFinished,
    progress: status.progress,
    total: status.total,
    status: status.status,
    percent: status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0,
    computed: status.computed,
    skipped: status.skipped,
    errors: status.errors,
    currentRegion: status.currentGroup,
    currentMembers: status.currentMembers,
  };
}

/**
 * Cancel geometry computation for a hierarchy
 */
export async function cancelComputation(
  { params: { worldViewId } }: { params: WorldViewParams },
): Promise<ComputationCancelled> {
  const status = runningComputations.get(worldViewId);
  if (status) {
    status.cancel = true;
    status.status = 'Cancelling...';
  }

  return { cancelled: true };
}

/**
 * Give up a world view's slot, if this run still holds it. A cancelled run no
 * longer blocks the guard, so a new one may have taken the slot while this one
 * was still reading or winding down; deleting by key alone would drop that
 * run's progress from the status a curator polls and let a third one start.
 */
function releaseSlot(worldViewId: number, run: ComputationProgress): void {
  if (runningComputations.get(worldViewId) === run) runningComputations.delete(worldViewId);
}

interface GroupRow {
  id: number;
  name: string;
  depth: number;
}

const GROUP_DEPTH_CTE = `
  WITH RECURSIVE group_depth AS (
    SELECT id, name, parent_region_id, 0 as depth
    FROM regions
    WHERE world_view_id = $1 AND parent_region_id IS NULL
    UNION ALL
    SELECT cg.id, cg.name, cg.parent_region_id, gd.depth + 1
    FROM regions cg
    JOIN group_depth gd ON cg.parent_region_id = gd.id
  )
`;

/**
 * The regions this run has to compute, deepest first.
 *
 * A forced run takes every region. An ordinary one takes those with no
 * geometry **and every ancestor of one**, which is the difference between a run
 * that converges and a run that leaves the tree inconsistent: a parent's
 * geometry is the union of its children, so a child gaining one leaves every
 * ancestor describing a smaller world than it contains. Selecting `geom IS
 * NULL` alone never revisits a parent that already has geometry, which is how
 * North America came to draw Mexico and the Caribbean while the United States
 * and Greenland stood underneath it (#667).
 *
 * Deepest first, so a parent is unioned after the children it is the union of.
 *
 * A user-drawn boundary is not derived from its members and must never be
 * recomputed from them (#283), so it is excluded from what a forced run takes,
 * from what an ordinary one takes, and from the closure's two arms as well: an
 * empty custom boundary asks nothing of the regions above it, and a custom
 * boundary in the middle of the tree does not pass a child's news any further
 * up, because its own shape does not move when that child gains one.
 */
async function loadGroupsToCompute(worldViewId: number, forceRecompute: boolean): Promise<GroupRow[]> {
  const sql = forceRecompute
    ? `
      ${GROUP_DEPTH_CTE}
      SELECT gd.id, gd.name, gd.depth
      FROM group_depth gd
      JOIN regions cg ON gd.id = cg.id
      WHERE cg.is_custom_boundary IS NOT TRUE
      ORDER BY gd.depth DESC, gd.id
    `
    : `
      ${GROUP_DEPTH_CTE},
      -- The regions with nothing to draw, and every ancestor of one: walking up
      -- from each of them and collecting what is passed on the way. A custom
      -- boundary stops the walk on both arms: its shape is drawn, not derived
      -- from members, so it never asks to be recomputed and nothing under it
      -- reaches what is above it either (#283).
      needs_geometry AS (
        SELECT gd.id, gd.parent_region_id
        FROM group_depth gd
        JOIN regions r ON r.id = gd.id
        WHERE r.geom IS NULL AND r.is_custom_boundary IS NOT TRUE
        UNION
        SELECT p.id, p.parent_region_id
        FROM group_depth p
        JOIN regions pr ON pr.id = p.id
        JOIN needs_geometry n ON n.parent_region_id = p.id
        WHERE pr.is_custom_boundary IS NOT TRUE
      )
      SELECT gd.id, gd.name, gd.depth
      FROM group_depth gd
      JOIN regions cg ON gd.id = cg.id
      WHERE cg.is_custom_boundary IS NOT TRUE
        AND gd.id IN (SELECT id FROM needs_geometry)
      ORDER BY gd.depth DESC, gd.id
    `;
  const result = await pool.query(sql, [worldViewId]);
  return result.rows as GroupRow[];
}

function isComputationRunning(state: ComputationProgress | undefined): boolean {
  return !!state
    && state.status !== 'Complete'
    && state.status !== 'Cancelled'
    && !state.status.startsWith('Error:')
    && !state.cancel;
}

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
    console.log(`[Geometry] Completed ${group.name} in ${elapsed}s (${result.points?.toLocaleString() || '?'} points)`);
    progressState.computed++;
  } else if (result.error) {
    console.log(`[Geometry] Skipped ${group.name}: ${result.error}`);
    progressState.skipped++;
  }
}

async function processGroups(
  groups: GroupRow[],
  progressState: ComputationProgress,
  skipSnapping: boolean,
): Promise<void> {
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
  }
}

async function applyCoverageSimplification(
  worldViewId: number,
  progressState: ComputationProgress,
): Promise<void> {
  if (progressState.cancel) return;

  progressState.status = 'Applying coverage simplification...';
  console.log(`[Geometry] Running coverage simplification for gap-free borders...`);

  const parentIds = await pool.query(`
    SELECT DISTINCT parent_region_id
    FROM regions
    WHERE world_view_id = $1 AND parent_region_id IS NOT NULL AND geom_3857 IS NOT NULL
    GROUP BY parent_region_id
    HAVING COUNT(*) >= 2
  `, [worldViewId]);

  let coverageCount = 0;
  for (const row of parentIds.rows) {
    if (progressState.cancel) break;
    await pool.query('SELECT simplify_coverage_regions($1::integer)', [row.parent_region_id]);
    coverageCount++;
  }
  console.log(`[Geometry] Coverage simplification complete: ${coverageCount} parent groups processed`);
}

async function finalizeComputation(
  worldViewId: number,
  progressState: ComputationProgress,
): Promise<void> {
  if (progressState.cancel) {
    console.log(`[Geometry] Computation cancelled for hierarchy ${worldViewId} at progress ${progressState.progress}/${progressState.total}`);
    return;
  }

  if (progressState.computed > 0) {
    await pool.query(
      'UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1 WHERE id = $1',
      [worldViewId],
    );
  }
  progressState.status = 'Complete';
  progressState.currentGroup = '';
  console.log(`[Geometry] Computation complete for hierarchy ${worldViewId}: computed=${progressState.computed}, skipped=${progressState.skipped}, errors=${progressState.errors}`);
}

/**
 * Compute geometries for all groups in a hierarchy (async with progress)
 * Processes groups from bottom to top (deepest first) so parent groups
 * can include already-computed child geometries
 */
export async function computeWorldViewGeometries(
  { params: { worldViewId }, query }: { params: WorldViewParams; query: z.output<typeof computeGeometryQuerySchema> },
): Promise<ComputationStartResult> {
  const forceRecompute = query.force === 'true';
  const skipSnapping = query.skipSnapping === 'true';

  // Re-entry guard: only block if a previous computation is genuinely still running.
  // Completed/cancelled/errored entries are cleaned up so a new run can start.
  if (isComputationRunning(runningComputations.get(worldViewId))) {
    throw createError('Computation already in progress for this hierarchy', 409);
  }
  // Reserve the slot synchronously — BEFORE the first await — so a second
  // concurrent request can't pass the guard while we're inspecting the DB.
  // The placeholder is replaced below once we know the real total.
  const progressState: ComputationProgress = {
    cancel: false,
    progress: 0,
    total: 0,
    status: 'Starting...',
    computed: 0,
    skipped: 0,
    errors: 0,
    currentGroup: '',
    currentMembers: 0,
  };
  runningComputations.set(worldViewId, progressState);

  // The slot is released on a failed read here too: nothing has started, and a
  // placeholder left behind would answer every later request 409.
  let groups: Awaited<ReturnType<typeof loadGroupsToCompute>>;
  let total: number;
  try {
    groups = await loadGroupsToCompute(worldViewId, forceRecompute);
    const totalCount = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM regions WHERE world_view_id = $1',
      [worldViewId],
    );
    total = totalCount.rows[0].count;
  } catch (err) {
    releaseSlot(worldViewId, progressState);
    throw err;
  }
  const alreadyComputed = total - groups.length;

  if (groups.length === 0) {
    releaseSlot(worldViewId, progressState);
    return {
      started: false,
      total,
      needsComputation: 0,
      alreadyComputed,
      message: 'All groups already have computed geometries',
    };
  }

  progressState.total = groups.length;
  progressState.skipped = alreadyComputed;

  // Not awaited: the answer goes out when this handler returns, and the
  // caller polls /status for the rest.
  void computeInBackground(worldViewId, groups, progressState, skipSnapping);

  return {
    started: true,
    total,
    needsComputation: groups.length,
    alreadyComputed,
    message: 'Computation started in background. Poll /status endpoint for progress.',
  };
}

/** The pipeline behind `computeWorldViewGeometries`, after its answer has gone. */
async function computeInBackground(
  worldViewId: number, groups: GroupRow[], progressState: ComputationProgress, skipSnapping: boolean,
): Promise<void> {
  console.log(`[Geometry] Starting computation for hierarchy ${worldViewId}: ${groups.length} groups to process (skipSnapping=${skipSnapping})`);

  try {
    await processGroups(groups, progressState, skipSnapping);
    await applyCoverageSimplification(worldViewId, progressState);
    await finalizeComputation(worldViewId, progressState);
  } catch (err) {
    // The answer ({ started: true }) has gone, so this cannot be a 500 to the
    // caller. Mark the slot as errored so isComputationRunning() reports
    // false and a retry can start immediately (the placeholder cleanup below
    // still runs after 30 s for the final poll). Without this, the slot would
    // be stuck on whatever step string was in flight, blocking retries until
    // the cleanup timer fires.
    // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- worldViewId is a number
    console.error(`[Geometry] Pipeline error for hierarchy ${worldViewId}:`, err);
    progressState.status = 'Error: the computation stopped; the server log has the cause.';
  } finally {
    // Keep status available for ~30s for a final poll, then clean up.
    setTimeout(() => releaseSlot(worldViewId, progressState), 30000);
  }
}
