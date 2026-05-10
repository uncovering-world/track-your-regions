/**
 * Geometry computation with progress tracking for world views
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { runningComputations } from './types.js';
import type { ComputationProgress } from './types.js';
import { computeRegionGeometryCore } from './geometryComputeSingle.js';

/**
 * Get status of geometry computation for a hierarchy
 */
export async function getComputationStatus(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const status = runningComputations.get(worldViewId);
  if (!status) {
    res.json({ running: false });
    return;
  }

  // Check if computation has finished (Complete, Cancelled, or errored).
  // `Error:` is set by the background pipeline's catch block and must be
  // treated as finished here too — otherwise polling clients keep seeing
  // running:true for the full 30 s cleanup window after a failure.
  const isFinished = status.status === 'Complete'
    || status.status === 'Cancelled'
    || status.status.startsWith('Error:');

  res.json({
    running: !isFinished,
    progress: status.progress,
    total: status.total,
    status: status.status,
    percent: status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0,
    computed: status.computed,
    skipped: status.skipped,
    errors: status.errors,
    currentGroup: status.currentGroup,
    currentMembers: status.currentMembers,
  });
}

/**
 * Cancel geometry computation for a hierarchy
 */
export async function cancelComputation(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const status = runningComputations.get(worldViewId);
  if (status) {
    status.cancel = true;
    status.status = 'Cancelling...';
  }

  res.json({ cancelled: true });
}

interface GroupRow {
  id: number;
  name: string;
  depth: number;
  is_custom_boundary: boolean | null;
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

async function loadGroupsToCompute(worldViewId: number, forceRecompute: boolean): Promise<GroupRow[]> {
  const filter = forceRecompute
    ? 'cg.is_custom_boundary IS NOT TRUE'
    : 'cg.geom IS NULL AND cg.is_custom_boundary IS NOT TRUE';
  const sql = `
    ${GROUP_DEPTH_CTE}
    SELECT gd.id, gd.name, gd.depth, cg.is_custom_boundary
    FROM group_depth gd
    JOIN regions cg ON gd.id = cg.id
    WHERE ${filter}
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

  // Group may have been deleted mid-computation
  const exists = await pool.query(
    'SELECT id, is_custom_boundary FROM regions WHERE id = $1',
    [group.id],
  );
  if (exists.rows.length === 0) return;

  if (exists.rows[0].is_custom_boundary) {
    progressState.skipped++;
    return;
  }

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
export async function computeWorldViewGeometries(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const forceRecompute = req.query.force === 'true';
  const skipSnapping = req.query.skipSnapping === 'true';

  // Re-entry guard: only block if a previous computation is genuinely still running.
  // Completed/cancelled/errored entries are cleaned up so a new run can start.
  if (isComputationRunning(runningComputations.get(worldViewId))) {
    res.status(409).json({ error: 'Computation already in progress for this hierarchy' });
    return;
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

  const groups = await loadGroupsToCompute(worldViewId, forceRecompute);
  const totalCount = await pool.query(
    'SELECT COUNT(*) as count FROM regions WHERE world_view_id = $1',
    [worldViewId],
  );
  const total = parseInt(totalCount.rows[0].count);
  const alreadyComputed = total - groups.length;

  if (groups.length === 0) {
    runningComputations.delete(worldViewId);
    res.json({
      total,
      needsComputation: 0,
      alreadyComputed,
      status: 'complete',
      message: 'All groups already have computed geometries',
    });
    return;
  }

  progressState.total = groups.length;
  progressState.skipped = alreadyComputed;

  res.json({
    started: true,
    total,
    needsComputation: groups.length,
    alreadyComputed,
    message: 'Computation started in background. Poll /status endpoint for progress.',
  });

  console.log(`[Geometry] Starting computation for hierarchy ${worldViewId}: ${groups.length} groups to process (skipSnapping=${skipSnapping})`);

  try {
    await processGroups(groups, progressState, skipSnapping);
    await applyCoverageSimplification(worldViewId, progressState);
    await finalizeComputation(worldViewId, progressState);
  } catch (err) {
    // res.json({ started: true }) already flushed, so we can't return a 500 to
    // the caller. Mark the slot as errored so isComputationRunning() reports
    // false and a retry can start immediately (the placeholder cleanup below
    // still runs after 30 s for the final poll). Without this, the slot would
    // be stuck on whatever step string was in flight, blocking retries until
    // the cleanup timer fires.
    console.error(`[Geometry] Pipeline error for hierarchy ${worldViewId}:`, err);
    progressState.status = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    // Keep status available for ~30s for a final poll, then clean up.
    setTimeout(() => runningComputations.delete(worldViewId), 30000);
  }
}
