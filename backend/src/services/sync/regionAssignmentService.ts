/**
 * Region Assignment Service
 *
 * Assigns experiences to regions based on spatial containment.
 * Uses experience_locations for per-location region assignment.
 * Also propagates assignments to ancestor regions in the hierarchy.
 */

import { pool } from '../../db/index.js';

export interface AssignmentProgress {
  cancel: boolean;
  status: 'assigning' | 'propagating' | 'denormalizing' | 'complete' | 'failed' | 'cancelled';
  statusMessage: string;
  directAssignments: number;       // Location-region assignments
  ancestorAssignments: number;     // Propagated to parent regions
  experienceAssignments: number;   // Denormalized experience-region assignments
  errors: number;
}

// Track running assignment operations
export const runningAssignments = new Map<number, AssignmentProgress>();

/**
 * Assign experiences to regions based on spatial containment.
 * Uses experience_locations for per-location assignment, supporting multi-location experiences.
 * Then propagates assignments up to ancestor regions and denormalizes to experience_regions.
 *
 * @param worldViewId - The world view to assign experiences within
 * @param sourceId - Optional: only assign experiences from this source
 */
export async function assignExperiencesToRegions(
  worldViewId: number,
  sourceId?: number
): Promise<AssignmentProgress> {
  // Check if already running for this world view
  const existing = runningAssignments.get(worldViewId);
  if (existing && !['complete', 'failed', 'cancelled'].includes(existing.status)) {
    throw new Error('Assignment already in progress for this world view');
  }

  const progress: AssignmentProgress = {
    cancel: false,
    status: 'assigning',
    statusMessage: 'Starting direct assignments...',
    directAssignments: 0,
    ancestorAssignments: 0,
    experienceAssignments: 0,
    errors: 0,
  };
  runningAssignments.set(worldViewId, progress);

  try {
    console.log(`[Region Assignment] Starting for world view ${worldViewId}${sourceId ? ` (source ${sourceId})` : ''}`);

    // Step 1: Clear existing auto-assignments for this world view
    progress.statusMessage = 'Clearing previous auto-assignments...';

    // Clear location-region assignments
    const clearLocResult = await pool.query(`
      DELETE FROM experience_location_regions elr
      USING experience_locations el, experiences e, regions r
      WHERE elr.location_id = el.id
        AND el.experience_id = e.id
        AND elr.region_id = r.id
        AND r.world_view_id = $1
        AND elr.assignment_type = 'auto'
        ${sourceId ? 'AND e.source_id = $2' : ''}
    `, sourceId ? [worldViewId, sourceId] : [worldViewId]);

    console.log(`[Region Assignment] Cleared ${clearLocResult.rowCount} location-region auto-assignments`);

    // Clear experience-region assignments (will be rebuilt from locations)
    const clearExpResult = await pool.query(`
      DELETE FROM experience_regions er
      USING regions r
      WHERE er.region_id = r.id
        AND r.world_view_id = $1
        AND er.assignment_type = 'auto'
        ${sourceId ? 'AND er.experience_id IN (SELECT id FROM experiences WHERE source_id = $2)' : ''}
    `, sourceId ? [worldViewId, sourceId] : [worldViewId]);

    console.log(`[Region Assignment] Cleared ${clearExpResult.rowCount} experience-region auto-assignments`);

    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled';
      return progress;
    }

    // Step 2: Direct assignments - find locations contained in regions
    // Each experience_location point is tested against region geometries
    progress.statusMessage = 'Computing direct spatial containment for locations...';

    const directResult = await pool.query(`
      INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
      SELECT DISTINCT el.id, r.id, 'auto'
      FROM experience_locations el
      JOIN experiences e ON el.experience_id = e.id
      CROSS JOIN regions r
      WHERE r.world_view_id = $1
        AND r.geom IS NOT NULL
        AND r.geom && el.location
        AND ST_Contains(r.geom, el.location)
        ${sourceId ? 'AND e.source_id = $2' : ''}
      ON CONFLICT (location_id, region_id) DO NOTHING
    `, sourceId ? [worldViewId, sourceId] : [worldViewId]);

    progress.directAssignments = directResult.rowCount || 0;
    console.log(`[Region Assignment] Created ${progress.directAssignments} direct location-region assignments`);

    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled';
      return progress;
    }

    // Step 3: Propagate to ancestor regions
    progress.status = 'propagating';
    progress.statusMessage = 'Propagating to ancestor regions...';

    const ancestorResult = await pool.query(`
      WITH RECURSIVE ancestors AS (
        -- Start with direct assignments for this world view
        SELECT elr.location_id, r.parent_region_id as region_id
        FROM experience_location_regions elr
        JOIN regions r ON elr.region_id = r.id
        WHERE r.world_view_id = $1
          AND r.parent_region_id IS NOT NULL
          AND elr.assignment_type = 'auto'
          ${sourceId ? `AND elr.location_id IN (
            SELECT el.id FROM experience_locations el
            JOIN experiences e ON el.experience_id = e.id
            WHERE e.source_id = $2
          )` : ''}

        UNION

        -- Recursively get ancestors
        SELECT a.location_id, r.parent_region_id
        FROM ancestors a
        JOIN regions r ON a.region_id = r.id
        WHERE r.parent_region_id IS NOT NULL
      )
      INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
      SELECT DISTINCT location_id, region_id, 'auto'
      FROM ancestors
      WHERE region_id IS NOT NULL
      ON CONFLICT (location_id, region_id) DO NOTHING
    `, sourceId ? [worldViewId, sourceId] : [worldViewId]);

    progress.ancestorAssignments = ancestorResult.rowCount || 0;
    console.log(`[Region Assignment] Created ${progress.ancestorAssignments} ancestor location-region assignments`);

    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'Cancelled';
      return progress;
    }

    // Step 4: Denormalize to experience_regions for backward compatibility
    // An experience is assigned to a region if ANY of its locations are in that region
    progress.status = 'denormalizing';
    progress.statusMessage = 'Denormalizing to experience-region assignments...';

    const expResult = await pool.query(`
      INSERT INTO experience_regions (experience_id, region_id, assignment_type)
      SELECT DISTINCT el.experience_id, elr.region_id, 'auto'
      FROM experience_location_regions elr
      JOIN experience_locations el ON elr.location_id = el.id
      JOIN experiences e ON el.experience_id = e.id
      JOIN regions r ON elr.region_id = r.id
      WHERE r.world_view_id = $1
        ${sourceId ? 'AND e.source_id = $2' : ''}
      ON CONFLICT (experience_id, region_id) DO NOTHING
    `, sourceId ? [worldViewId, sourceId] : [worldViewId]);

    progress.experienceAssignments = expResult.rowCount || 0;
    console.log(`[Region Assignment] Created ${progress.experienceAssignments} denormalized experience-region assignments`);

    // Update world view's last_assignment_at timestamp
    await pool.query(
      'UPDATE world_views SET last_assignment_at = NOW() WHERE id = $1',
      [worldViewId]
    );

    progress.status = 'complete';
    progress.statusMessage = `Complete: ${progress.directAssignments} direct, ${progress.ancestorAssignments} ancestor, ${progress.experienceAssignments} experience assignments`;

    console.log(`[Region Assignment] Complete for world view ${worldViewId}: ` +
      `locationDirect=${progress.directAssignments}, locationAncestor=${progress.ancestorAssignments}, experience=${progress.experienceAssignments}`);

    return progress;

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = 'failed';
    progress.statusMessage = errorMsg;
    progress.errors++;
    console.error(`[Region Assignment] Failed:`, errorMsg);
    throw err;
  } finally {
    // Clean up after delay, but only if this assignment's progress is still current
    const thisProgress = progress;
    setTimeout(() => {
      if (runningAssignments.get(worldViewId) === thisProgress) {
        runningAssignments.delete(worldViewId);
      }
    }, 30000);
  }
}

/**
 * Get assignment status for a world view
 */
export function getAssignmentStatus(worldViewId: number): AssignmentProgress | null {
  return runningAssignments.get(worldViewId) || null;
}

/**
 * Cancel running assignment
 */
export function cancelAssignment(worldViewId: number): boolean {
  const progress = runningAssignments.get(worldViewId);
  if (progress && !['complete', 'failed', 'cancelled'].includes(progress.status)) {
    progress.cancel = true;
    progress.statusMessage = 'Cancelling...';
    return true;
  }
  return false;
}

/**
 * Get experience counts by region for a world view
 */
export async function getExperienceCountsByRegion(
  worldViewId: number,
  sourceId?: number
): Promise<{ regionId: number; regionName: string; count: number }[]> {
  const result = await pool.query(`
    SELECT
      r.id as region_id,
      r.name as region_name,
      COUNT(er.experience_id) as count
    FROM regions r
    LEFT JOIN experience_regions er ON r.id = er.region_id
      ${sourceId ? 'AND er.experience_id IN (SELECT id FROM experiences WHERE source_id = $2)' : ''}
    WHERE r.world_view_id = $1
    GROUP BY r.id, r.name
    HAVING COUNT(er.experience_id) > 0
    ORDER BY count DESC
  `, sourceId ? [worldViewId, sourceId] : [worldViewId]);

  return result.rows.map(row => ({
    regionId: row.region_id,
    regionName: row.region_name,
    count: parseInt(row.count),
  }));
}
