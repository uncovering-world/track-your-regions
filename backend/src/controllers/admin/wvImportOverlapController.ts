/**
 * Division overlap endpoints for the WorldView Import.
 *
 * Detects when the same geographic area is covered by multiple child regions
 * (direct duplicate, containment, or ancestor/descendant split) and resolves
 * the overlap via either "keep" (remove from selected regions) or "split"
 * (redistribute GADM children to target regions).
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

// =============================================================================
// Division overlap detection helpers
// =============================================================================

async function loadDivisionsByChild(childIds: number[]): Promise<Map<number, Set<number>>> {
  const membersResult = await pool.query(`
    SELECT rm.region_id, rm.division_id
    FROM region_members rm
    WHERE rm.region_id = ANY($1) AND rm.custom_geom IS NULL
  `, [childIds]);

  const divsByChild = new Map<number, Set<number>>();
  for (const row of membersResult.rows) {
    const regionId = row.region_id as number;
    const divId = row.division_id as number;
    if (!divsByChild.has(regionId)) divsByChild.set(regionId, new Set());
    divsByChild.get(regionId)!.add(divId);
  }
  return divsByChild;
}

async function loadDivisionDescendants(
  divIds: number[],
): Promise<Map<number, Set<number>>> {
  const descResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id AS root_div, id AS desc_div
      FROM administrative_divisions WHERE id = ANY($1)
      UNION ALL
      SELECT d.root_div, ad.id
      FROM descendants d
      JOIN administrative_divisions ad ON ad.parent_id = d.desc_div
    )
    SELECT root_div, array_agg(DISTINCT desc_div) AS desc_ids
    FROM descendants
    GROUP BY root_div
  `, [divIds]);

  const descendantsOf = new Map<number, Set<number>>();
  for (const row of descResult.rows) {
    descendantsOf.set(row.root_div as number, new Set(row.desc_ids as number[]));
  }
  return descendantsOf;
}

function buildCoveredByMap(
  divsByChild: Map<number, Set<number>>,
  descendantsOf: Map<number, Set<number>>,
): Map<number, Array<{ regionId: number; viaDivisionId: number }>> {
  const coveredBy = new Map<number, Array<{ regionId: number; viaDivisionId: number }>>();
  for (const [regionId, divs] of divsByChild) {
    for (const divId of divs) {
      const descendants = descendantsOf.get(divId) ?? new Set([divId]);
      for (const descDiv of descendants) {
        if (!coveredBy.has(descDiv)) coveredBy.set(descDiv, []);
        coveredBy.get(descDiv)!.push({ regionId, viaDivisionId: divId });
      }
    }
  }
  return coveredBy;
}

async function loadOverlapDivisionMetadata(
  overlapDivIds: number[],
  coveredBy: Map<number, Array<{ regionId: number; viaDivisionId: number }>>,
): Promise<{
  pathByDiv: Map<number, string>;
  viaNameByDiv: Map<number, string>;
  parentOf: Map<number, number | null>;
}> {
  const divInfoResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, name::text AS path
      FROM administrative_divisions WHERE id = ANY($1)
      UNION ALL
      SELECT a.id, a.name, ad.parent_id, ad.name || ' > ' || a.path
      FROM ancestors a
      JOIN administrative_divisions ad ON ad.id = a.parent_id
    )
    SELECT DISTINCT ON (id) id, path
    FROM ancestors
    ORDER BY id, length(path) DESC
  `, [overlapDivIds]);

  const pathByDiv = new Map<number, string>(
    divInfoResult.rows.map(r => [r.id as number, r.path as string]),
  );

  const viaDivIds = new Set<number>();
  for (const divId of overlapDivIds) {
    for (const c of coveredBy.get(divId)!) {
      viaDivIds.add(c.viaDivisionId);
    }
  }
  const viaDivNameResult = await pool.query(
    'SELECT id, name FROM administrative_divisions WHERE id = ANY($1)',
    [Array.from(viaDivIds)],
  );
  const viaNameByDiv = new Map<number, string>(
    viaDivNameResult.rows.map(r => [r.id as number, r.name as string]),
  );

  const parentResult = await pool.query(
    'SELECT id, parent_id FROM administrative_divisions WHERE id = ANY($1)',
    [overlapDivIds],
  );
  const parentOf = new Map<number, number | null>(
    parentResult.rows.map(r => [r.id as number, r.parent_id as number | null]),
  );

  return { pathByDiv, viaNameByDiv, parentOf };
}

/**
 * Check for division overlaps among children of a region.
 *
 * A division "overlaps" if the same geographic area is covered by multiple
 * children, which happens when:
 *  - The same division is assigned to 2+ children (direct duplicate)
 *  - Child A has a division and child B has its GADM ancestor (containment)
 *  - Child A has a GADM parent and child B has one of its descendants
 *
 * POST /api/admin/wv-import/matches/:worldViewId/check-overlap
 */
export async function checkDivisionOverlap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/check-overlap — parentRegionId=${parentRegionId}`);

  const parentRegion = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [parentRegionId, worldViewId],
  );
  if (parentRegion.rows.length === 0) {
    res.status(404).json({ error: 'Parent region not found in this world view' });
    return;
  }

  const childrenResult = await pool.query(
    'SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2 ORDER BY name',
    [parentRegionId, worldViewId],
  );
  if (childrenResult.rows.length === 0) {
    res.json({ overlaps: [] });
    return;
  }

  const childIds = childrenResult.rows.map(r => r.id as number);
  const childNameById = new Map<number, string>(
    childrenResult.rows.map(r => [r.id as number, r.name as string]),
  );

  const divsByChild = await loadDivisionsByChild(childIds);

  const allDivIds = new Set<number>();
  for (const divs of divsByChild.values()) {
    for (const d of divs) allDivIds.add(d);
  }
  if (allDivIds.size === 0) {
    res.json({ overlaps: [] });
    return;
  }

  const descendantsOf = await loadDivisionDescendants(Array.from(allDivIds));
  const coveredBy = buildCoveredByMap(divsByChild, descendantsOf);

  const overlapDivIds: number[] = [];
  for (const [divId, coverages] of coveredBy) {
    const uniqueRegions = new Set(coverages.map(c => c.regionId));
    if (uniqueRegions.size > 1) {
      overlapDivIds.push(divId);
    }
  }

  if (overlapDivIds.length === 0) {
    res.json({ overlaps: [] });
    return;
  }

  const { pathByDiv, viaNameByDiv, parentOf } = await loadOverlapDivisionMetadata(overlapDivIds, coveredBy);

  const overlapSet = new Set(overlapDivIds);
  const topLevelOverlaps: number[] = [];
  for (const divId of overlapDivIds) {
    const parentId = parentOf.get(divId);
    if (parentId == null || !overlapSet.has(parentId)) {
      topLevelOverlaps.push(divId);
    }
  }

  const overlaps = topLevelOverlaps.map(divId => {
    const coverages = coveredBy.get(divId)!;
    const uniqueRegions = new Set(coverages.map(c => c.regionId));
    const regions = Array.from(uniqueRegions).map(regionId => {
      const via = coverages.find(c => c.regionId === regionId)!;
      return {
        regionId,
        regionName: childNameById.get(regionId) ?? `Region ${regionId}`,
        viaDivisionId: via.viaDivisionId,
        viaDivisionName: viaNameByDiv.get(via.viaDivisionId) ?? `Division ${via.viaDivisionId}`,
        isDirect: via.viaDivisionId === divId,
      };
    });

    return {
      divisionId: divId,
      divisionPath: pathByDiv.get(divId) ?? `Division ${divId}`,
      regions,
    };
  }).sort((a, b) => a.divisionPath.localeCompare(b.divisionPath));

  console.log(`[WV Import] Overlap check: ${overlaps.length} top-level overlapping divisions found`);
  res.json({ overlaps });
}

/**
 * Get GADM children of a division (for split-deeper preview).
 *
 * POST /api/admin/wv-import/matches/:worldViewId/overlap-children
 * Body: { divisionId }
 * Returns the direct GADM children with names and which child region (if any) they belong to.
 */
export async function getOverlapDivisionChildren(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { divisionId, childRegionIds } = req.body;

  // Get GADM children of this division
  const childrenResult = await pool.query(`
    SELECT ad.id, ad.name, ad.has_children,
           safe_geo_area(ad.geom_simplified_medium) AS area_km2
    FROM administrative_divisions ad
    WHERE ad.parent_id = $1
      AND ad.geom_simplified_medium IS NOT NULL
    ORDER BY ad.name
  `, [divisionId]);

  if (childrenResult.rows.length === 0) {
    res.json({ children: [], canSplit: false });
    return;
  }

  // Check which child regions already have these GADM children assigned
  const gadmChildIds = childrenResult.rows.map(r => r.id as number);
  const memberResult = await pool.query(`
    SELECT rm.division_id, rm.region_id
    FROM region_members rm
    WHERE rm.division_id = ANY($1) AND rm.region_id = ANY($2)
  `, [gadmChildIds, childRegionIds]);

  const assignedTo = new Map<number, number>();
  for (const row of memberResult.rows) {
    assignedTo.set(row.division_id as number, row.region_id as number);
  }

  const children = childrenResult.rows.map(r => ({
    divisionId: r.id as number,
    name: r.name as string,
    hasChildren: r.has_children as boolean,
    areaKm2: r.area_km2 ? Math.round(r.area_km2 as number) : null,
    assignedToRegionId: assignedTo.get(r.id as number) ?? null,
  }));

  res.json({ children, canSplit: true });
}

/**
 * Apply overlap resolution: either "keep" or "split".
 *
 * POST /api/admin/wv-import/matches/:worldViewId/resolve-overlap
 * Body: { action: 'keep', divisionId, keepInRegionId, removeFromRegionIds }
 *    or { action: 'split', divisionId, splitRegionId, assignments: [{ gadmChildId, targetRegionId }] }
 */
export async function resolveOverlap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { action } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (action === 'keep') {
      const { divisionId, removeFromRegionIds } = req.body;
      // Remove the division from the specified regions
      for (const regionId of removeFromRegionIds) {
        await client.query(
          'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
          [regionId, divisionId],
        );
      }
      await client.query('COMMIT');
      console.log(`[WV Import] Overlap resolved (keep): division ${divisionId} removed from regions ${removeFromRegionIds.join(', ')}`);
      res.json({ success: true, action: 'keep', removed: removeFromRegionIds.length });

    } else if (action === 'split') {
      const { divisionId, splitRegionId, assignments } = req.body as {
        action: string;
        divisionId: number;
        splitRegionId: number;
        assignments: Array<{ gadmChildId: number; targetRegionId: number }>;
      };

      // 1. Remove the coarse division from the region being split
      await client.query(
        'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
        [splitRegionId, divisionId],
      );

      // 2. Add GADM children to their target regions
      for (const { gadmChildId, targetRegionId } of assignments) {
        // Upsert: don't fail if already assigned
        await client.query(`
          INSERT INTO region_members (region_id, division_id)
          VALUES ($1, $2)
          ON CONFLICT (region_id, division_id) DO NOTHING
        `, [targetRegionId, gadmChildId]);
      }

      await client.query('COMMIT');
      console.log(`[WV Import] Overlap resolved (split): division ${divisionId} in region ${splitRegionId} → ${assignments.length} GADM children redistributed`);
      res.json({ success: true, action: 'split', assigned: assignments.length });

    } else {
      // Unreachable in practice (Zod validates `action`), but ROLLBACK
      // keeps the connection clean if validation is ever relaxed.
      await client.query('ROLLBACK');
      res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
