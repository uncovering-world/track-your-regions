/**
 * Region Assignment Service
 *
 * Assigns experiences to regions based on spatial containment.
 * Uses experience_locations for per-location region assignment.
 * Also propagates assignments to ancestor regions in the hierarchy.
 *
 * A point is placed in the leaves that hold it, tested through their geometry
 * cut into pieces, and in the other regions only when no leaf holds it; every
 * ancestor's row comes from the tree (`directPlacementSql`, ADR-0054).
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

/** Mark progress as cancelled if its `cancel` flag is set; returns true when cancelled. */
function checkCancelled(progress: AssignmentProgress): boolean {
  if (!progress.cancel) return false;
  progress.status = 'cancelled';
  progress.statusMessage = 'Cancelled';
  return true;
}

/** Step 1: drop the previous run's auto-assignments for this world view (and optionally one source). */
async function clearPreviousAssignments(
  worldViewId: number,
  sourceId: number | undefined,
  progress: AssignmentProgress
): Promise<void> {
  progress.statusMessage = 'Clearing previous auto-assignments...';
  const params = sourceId ? [worldViewId, sourceId] : [worldViewId];

  const clearLocResult = await pool.query(`
    DELETE FROM experience_location_regions elr
    USING experience_locations el, experiences e, regions r
    WHERE elr.location_id = el.id
      AND el.experience_id = e.id
      AND elr.region_id = r.id
      AND r.world_view_id = $1
      AND elr.assignment_type = 'auto'
      ${sourceId ? 'AND e.source_id = $2' : ''}
  `, params);
  console.log(`[Region Assignment] Cleared ${clearLocResult.rowCount} location-region auto-assignments`);

  const clearExpResult = await pool.query(`
    DELETE FROM experience_regions er
    USING regions r
    WHERE er.region_id = r.id
      AND r.world_view_id = $1
      AND er.assignment_type = 'auto'
      ${sourceId ? 'AND er.experience_id IN (SELECT id FROM experiences WHERE source_id = $2)' : ''}
  `, params);
  console.log(`[Region Assignment] Cleared ${clearExpResult.rowCount} experience-region auto-assignments`);
}

/**
 * Which regions of a world view hold a point — the direct step, written once for
 * both ways in (#851, ADR-0054).
 *
 * **Leaves first, through their pieces.** A leaf's geometry is kept cut into
 * pieces of at most 256 vertices (`region_geom_pieces`, replaced by a trigger on
 * every write of `regions.geom`), so a point meets the one or two small pieces
 * whose boxes hold it. Asked of whole geometries, a point in Paris was tested
 * against Asia — 7.1 million vertices, in a box spanning every longitude because
 * Russia's parts reach both sides of the antimeridian — and the first run of the
 * Places of worship source spent 25 minutes placing 1078 points. A point on the
 * line between two pieces is inside the leaf and on the boundary of both, where
 * `ST_Contains` on a piece says no: those points, and only those, are asked of
 * the whole leaf.
 *
 * **Then the other regions, for what no leaf holds.** A parent's geometry is not
 * exactly the sum of its children: it is built from a GADM division a level up,
 * and GADM's coastlines do not nest to the metre between levels, so a point a few
 * dozen metres off a shore can lie in its country and in no leaf of it — Juno
 * Beach, Delos. Those points are asked of every region that is not a leaf with
 * pieces: the non-leaves, and a leaf whose pieces are missing, which is asked
 * whole rather than skipped. A non-leaf gets a row only for a point no leaf holds,
 * however the leaf was asked: a point a leaf holds takes its ancestors' rows from
 * the tree in the next step, and a non-leaf whose outline covers it without
 * standing above that leaf gets none — Italy's union filled the Vatican in as a
 * small hole, and St Peter's is not in Italy. So a leaf's missing pieces cost time
 * and never change a row.
 *
 * Three facts about the planner the shape rests on, each measured (see
 * `docs/tech/experiences.md` § Region assignment). The leaf a piece belongs to is
 * looked up by key for each piece that holds a point (`LATERAL … OFFSET 0`):
 * joined plainly, a large placement read every leaf of the world view for a hash
 * join first, a second and a half before any point was tested. The points no
 * leaf holds are a materialized set of their own, or the anti-join lands above
 * the containment test and every point is tested against the continents after
 * all. And the other regions are found through their GiST index, only where an
 * unheld point's box touches them, with the points grouped per region: the test
 * then runs region by region, so consecutive tests share one prepared geometry,
 * and a region no unheld point comes near is never read — with no pieces at all
 * that is half a minute for the whole world view, where scanning every region
 * took nine.
 *
 * Offered points only, by the three terms of the controllers'
 * `offeredLocationSql()`, spelled out because a service imports no controller: a
 * point a source withdrew, a curator declared lost (ADR-0026) or turned down
 * (ADR-0053) must not hold its object in a region where nobody is shown it. Both
 * sites say so, so neither reads as an oversight.
 *
 * @param pointFilter `AND` and a condition on the point (`el`) or its object
 *   (`e`) with its value as `$2`, naming which points to place; empty for all.
 */
function directPlacementSql(pointFilter: string): string {
  return `
    WITH offered AS MATERIALIZED (
      SELECT el.id, el.location
      FROM experience_locations el
      JOIN experiences e ON e.id = el.experience_id
      WHERE el.missing_since IS NULL AND el.existence <> 'lost'
        AND el.refused_at IS NULL
        ${pointFilter}
    ),
    leaf_hits AS MATERIALIZED (
      SELECT DISTINCT o.id AS location_id, p.region_id
      FROM offered o
      JOIN region_geom_pieces p
        ON p.geom && o.location AND ST_Intersects(p.geom, o.location)
      CROSS JOIN LATERAL (
        SELECT r.geom
        FROM regions r
        WHERE r.id = p.region_id AND r.world_view_id = $1 AND r.is_leaf
        OFFSET 0
      ) leaf
      WHERE CASE WHEN ST_Contains(p.geom, o.location) THEN true
                 ELSE ST_Contains(leaf.geom, o.location) END
    ),
    unheld AS MATERIALIZED (
      SELECT o.id, o.location
      FROM offered o
      WHERE NOT EXISTS (SELECT 1 FROM leaf_hits h WHERE h.location_id = o.id)
    ),
    candidates AS MATERIALIZED (
      SELECT r.id AS region_id, array_agg(u.id) AS location_ids, array_agg(u.location) AS locations
      FROM unheld u
      JOIN regions r ON r.geom && u.location
      WHERE r.world_view_id = $1
        AND NOT (r.is_leaf AND EXISTS (SELECT 1 FROM region_geom_pieces p WHERE p.region_id = r.id))
      GROUP BY r.id
    ),
    whole_hits AS MATERIALIZED (
      SELECT x.location_id, r.id AS region_id, r.is_leaf
      FROM candidates c
      JOIN regions r ON r.id = c.region_id
      CROSS JOIN LATERAL (
        SELECT c.location_ids[i] AS location_id
        FROM generate_subscripts(c.location_ids, 1) AS i
        WHERE ST_Contains(r.geom, c.locations[i])
        OFFSET 0
      ) x
    ),
    rest_hits AS (
      SELECT w.location_id, w.region_id
      FROM whole_hits w
      WHERE w.is_leaf
         OR NOT EXISTS (SELECT 1 FROM whole_hits l WHERE l.location_id = w.location_id AND l.is_leaf)
    )
    INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
    SELECT location_id, region_id, 'auto' FROM leaf_hits
    UNION ALL
    SELECT location_id, region_id, 'auto' FROM rest_hits
    ON CONFLICT (location_id, region_id) DO NOTHING
  `;
}

/** The points of one source's objects, for a rebuild narrowed to that source. */
const ONE_SOURCE = 'AND e.source_id = $2';
/** The points of the objects a run or a curator has just moved. */
const THESE_EXPERIENCES = 'AND el.experience_id = ANY($2::int[])';

/** Step 2: insert direct location→region rows — the leaves that hold each point, and for a point no leaf holds, the other regions that do. */
async function assignDirect(
  worldViewId: number,
  sourceId: number | undefined,
  progress: AssignmentProgress
): Promise<void> {
  progress.statusMessage = 'Computing direct spatial containment for locations...';

  const directResult = await pool.query(
    directPlacementSql(sourceId ? ONE_SOURCE : ''),
    sourceId ? [worldViewId, sourceId] : [worldViewId],
  );

  progress.directAssignments = directResult.rowCount || 0;
  console.log(`[Region Assignment] Created ${progress.directAssignments} direct location-region assignments`);
}

/** Step 3: propagate location→region assignments to all ancestor regions. */
async function assignAncestors(
  worldViewId: number,
  sourceId: number | undefined,
  progress: AssignmentProgress
): Promise<void> {
  progress.status = 'propagating';
  progress.statusMessage = 'Propagating to ancestor regions...';
  const params = sourceId ? [worldViewId, sourceId] : [worldViewId];

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
  `, params);

  progress.ancestorAssignments = ancestorResult.rowCount || 0;
  console.log(`[Region Assignment] Created ${progress.ancestorAssignments} ancestor location-region assignments`);
}

/** Step 4: denormalize location→region rows into experience→region for backward compatibility. */
async function denormalizeExperienceRegions(
  worldViewId: number,
  sourceId: number | undefined,
  progress: AssignmentProgress
): Promise<void> {
  progress.status = 'denormalizing';
  progress.statusMessage = 'Denormalizing to experience-region assignments...';
  const params = sourceId ? [worldViewId, sourceId] : [worldViewId];

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
  `, params);

  progress.experienceAssignments = expResult.rowCount || 0;
  console.log(`[Region Assignment] Created ${progress.experienceAssignments} denormalized experience-region assignments`);
}

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
    const sourceSuffix = sourceId ? ` (source ${sourceId})` : '';
    console.log(`[Region Assignment] Starting for world view ${worldViewId}${sourceSuffix}`);

    await clearPreviousAssignments(worldViewId, sourceId, progress);
    if (checkCancelled(progress)) return progress;

    await assignDirect(worldViewId, sourceId, progress);
    if (checkCancelled(progress)) return progress;

    await assignAncestors(worldViewId, sourceId, progress);
    if (checkCancelled(progress)) return progress;

    await denormalizeExperienceRegions(worldViewId, sourceId, progress);

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

// =============================================================================
// Incremental Assignment
// =============================================================================

/**
 * Assign regions for a handful of experiences whose locations just changed.
 *
 * The full rebuild above answers "every location has moved" — the case where
 * region *geometry* changed. After a sync almost nothing has moved, and since
 * `locationWriter` keeps the row of a point that stayed put, the work left is
 * only the experiences whose geometry actually differs. Doing the full rebuild
 * for that would be wrong twice over: it re-tests every point of the world view
 * for the sake of a few, and its clear-then-insert leaves a window in which the
 * world view has no assignments at all and users see empty regions.
 *
 * Scoped by experience rather than by location on purpose. A point that moved
 * out of a region can leave a stale row at the *experience* level, which is a
 * union over that experience's locations — so the experience is the smallest
 * unit that can be recomputed correctly.
 *
 * Runs in one transaction, so the brief absence between clearing and
 * reinserting is never observable.
 */
export async function assignRegionsForExperiences(
  experienceIds: number[],
  worldViewId: number,
): Promise<number> {
  if (experienceIds.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const params = [worldViewId, experienceIds];

    // Only `auto` rows, at both levels: a curator's manual assignment is not
    // this function's to recompute.
    await client.query(`
      DELETE FROM experience_location_regions elr
      USING experience_locations el, regions r
      WHERE elr.location_id = el.id AND elr.region_id = r.id
        AND r.world_view_id = $1 AND elr.assignment_type = 'auto'
        AND el.experience_id = ANY($2::int[])
    `, params);

    await client.query(`
      DELETE FROM experience_regions er
      USING regions r
      WHERE er.region_id = r.id AND r.world_view_id = $1
        AND er.assignment_type = 'auto' AND er.experience_id = ANY($2::int[])
    `, params);

    // Offered points only, as `directPlacementSql` says. A point the source
    // withdrew keeps its row and its coordinate, and placing it would keep the
    // experience in a region on the strength of somewhere the reader is no
    // longer shown. The clear above is unfiltered for the same reason, from the
    // other side: a point withdrawn since the last placement has to lose the
    // rows it left behind.
    await client.query(directPlacementSql(THESE_EXPERIENCES), params);

    await client.query(`
      WITH RECURSIVE ancestors AS (
        SELECT elr.location_id, r.parent_region_id AS region_id
        FROM experience_location_regions elr
        JOIN regions r ON elr.region_id = r.id
        JOIN experience_locations el ON el.id = elr.location_id
        WHERE r.world_view_id = $1 AND r.parent_region_id IS NOT NULL
          AND elr.assignment_type = 'auto'
          AND el.experience_id = ANY($2::int[])
        UNION
        SELECT a.location_id, r.parent_region_id
        FROM ancestors a JOIN regions r ON a.region_id = r.id
        WHERE r.parent_region_id IS NOT NULL
      )
      INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
      SELECT DISTINCT location_id, region_id, 'auto' FROM ancestors
      WHERE region_id IS NOT NULL
      ON CONFLICT (location_id, region_id) DO NOTHING
    `, params);

    const denorm = await client.query(`
      INSERT INTO experience_regions (experience_id, region_id, assignment_type)
      SELECT DISTINCT el.experience_id, elr.region_id, 'auto'
      FROM experience_location_regions elr
      JOIN experience_locations el ON elr.location_id = el.id
      JOIN regions r ON elr.region_id = r.id
      WHERE r.world_view_id = $1 AND el.experience_id = ANY($2::int[])
      ON CONFLICT (experience_id, region_id) DO NOTHING
    `, params);

    await client.query('COMMIT');
    return denorm.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** World views assignment can actually place anything in. */
export async function worldViewsWithGeometry(): Promise<number[]> {
  // Wikivoyage has no geometry, so running assignment there would clear rows
  // and rebuild nothing. Asking the data rather than naming ids keeps that
  // true as world views come and go.
  const result = await pool.query(
    `SELECT DISTINCT world_view_id FROM regions WHERE geom IS NOT NULL ORDER BY 1`);
  return result.rows.map(r => r.world_view_id as number);
}
