/**
 * Geometry computation with progress tracking for world views
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { runningComputations } from './types.js';
import type { ComputationProgress } from './types.js';
import { computeRegionGeometryCore } from './geometryCompute.js';

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

  // Check if computation has finished (Complete or Cancelled)
  const isFinished = status.status === 'Complete' || status.status === 'Cancelled';

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

/**
 * Compute geometries for all groups in a hierarchy (async with progress)
 * Processes groups from bottom to top (deepest first) so parent groups
 * can include already-computed child geometries
 */
export async function computeWorldViewGeometries(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const forceRecompute = req.query.force === 'true';
  const skipSnapping = req.query.skipSnapping === 'true';

  // Check if already running (not just if entry exists - it might be completed/cancelled)
  const existingStatus = runningComputations.get(worldViewId);
  if (existingStatus) {
    const isStillRunning = existingStatus.status !== 'Complete' &&
                           existingStatus.status !== 'Cancelled' &&
                           !existingStatus.cancel;
    if (isStillRunning) {
      res.status(409).json({ error: 'Computation already in progress for this hierarchy' });
      return;
    }
    // Clean up old entry before starting new computation
    runningComputations.delete(worldViewId);
  }

  // Get all groups in the hierarchy ordered by depth (deepest first)
  // This ensures child groups are computed before their parents
  const groupsQuery = forceRecompute
    ? `WITH RECURSIVE group_depth AS (
        SELECT id, name, parent_region_id, 0 as depth
        FROM regions
        WHERE world_view_id = $1 AND parent_region_id IS NULL
        UNION ALL
        SELECT cg.id, cg.name, cg.parent_region_id, gd.depth + 1
        FROM regions cg
        JOIN group_depth gd ON cg.parent_region_id = gd.id
      )
      SELECT gd.id, gd.name, gd.depth, cg.is_custom_boundary
      FROM group_depth gd
      JOIN regions cg ON gd.id = cg.id
      WHERE cg.is_custom_boundary IS NOT TRUE
      ORDER BY gd.depth DESC, gd.id`
    : `WITH RECURSIVE group_depth AS (
        SELECT id, name, parent_region_id, 0 as depth
        FROM regions
        WHERE world_view_id = $1 AND parent_region_id IS NULL
        UNION ALL
        SELECT cg.id, cg.name, cg.parent_region_id, gd.depth + 1
        FROM regions cg
        JOIN group_depth gd ON cg.parent_region_id = gd.id
      )
      SELECT gd.id, gd.name, gd.depth, cg.is_custom_boundary
      FROM group_depth gd
      JOIN regions cg ON gd.id = cg.id
      WHERE cg.geom IS NULL AND cg.is_custom_boundary IS NOT TRUE
      ORDER BY gd.depth DESC, gd.id`;

  const groups = await pool.query(groupsQuery, [worldViewId]);

  // Also get total count for reporting
  const totalCount = await pool.query(
    'SELECT COUNT(*) as count FROM regions WHERE world_view_id = $1',
    [worldViewId]
  );
  const alreadyComputed = parseInt(totalCount.rows[0].count) - groups.rows.length;

  if (groups.rows.length === 0) {
    res.json({
      total: parseInt(totalCount.rows[0].count),
      needsComputation: 0,
      alreadyComputed,
      status: 'complete',
      message: 'All groups already have computed geometries'
    });
    return;
  }

  // Initialize progress tracking
  const progressState: ComputationProgress = {
    cancel: false,
    progress: 0,
    total: groups.rows.length,
    status: 'Starting...',
    computed: 0,
    skipped: alreadyComputed,
    errors: 0,
    currentGroup: '',
    currentMembers: 0,
  };
  runningComputations.set(worldViewId, progressState);

  // Return immediately - computation continues in background
  res.json({
    started: true,
    total: parseInt(totalCount.rows[0].count),
    needsComputation: groups.rows.length,
    alreadyComputed,
    message: 'Computation started in background. Poll /status endpoint for progress.',
  });

  console.log(`[Geometry] Starting computation for hierarchy ${worldViewId}: ${groups.rows.length} groups to process (skipSnapping=${skipSnapping})`);

  // Run computation in background
  try {
    for (const group of groups.rows) {
      // Check for cancellation
      if (progressState.cancel) {
        progressState.status = 'Cancelled';
        break;
      }

      progressState.currentGroup = group.name;
      progressState.status = `Computing: ${group.name} [depth ${group.depth}]`;

      try {
        // Check if group still exists (might have been deleted during computation)
        const exists = await pool.query('SELECT id, is_custom_boundary FROM regions WHERE id = $1', [group.id]);
        if (exists.rows.length === 0) {
          progressState.progress++;
          continue;
        }

        // Skip custom boundary regions
        if (exists.rows[0].is_custom_boundary) {
          progressState.skipped++;
          progressState.progress++;
          continue;
        }

        // Use the shared computation function with skipSnapping option
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
      } catch (e) {
        console.error(`Error computing geometry for group ${group.id}:`, e);
        progressState.errors++;
        progressState.status = `Error: ${group.name}`;
      }

      progressState.progress++;
    }

    if (!progressState.cancel) {
      progressState.status = 'Complete';
      progressState.currentGroup = '';
      console.log(`[Geometry] Computation complete for hierarchy ${worldViewId}: computed=${progressState.computed}, skipped=${progressState.skipped}, errors=${progressState.errors}`);
    } else {
      console.log(`[Geometry] Computation cancelled for hierarchy ${worldViewId} at progress ${progressState.progress}/${progressState.total}`);
    }
  } finally {
    // Clean up after a delay to allow final status poll
    setTimeout(() => {
      runningComputations.delete(worldViewId);
    }, 30000); // Keep status available for 30 seconds after completion
  }
}
