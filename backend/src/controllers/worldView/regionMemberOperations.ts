/**
 * Region Member Operations
 *
 * Complex structural operations: expand to subregions, flatten, add children, usage counts.
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import {
  ChildDivisionsAdded, DivisionUsageCounts, SubregionFlattened, SubregionsExpanded, type CreatedSubregion,
} from '../../api/responses/regions.js';
import { pool } from '../../db/index.js';
import { visitedRegionRefusal, visitsUnder } from '../../db/regionVisits.js';
import { createError } from '../../middleware/errorHandler.js';
import { ensureRegionMember, invalidateRegionGeometry, moveMembersToRegion, syncImportMatchStatus } from './helpers.js';

interface ChildRow { id: number; name: string }

async function loadChildrenToAdd(
  gadmDivisionId: number,
  childIds: unknown,
): Promise<ChildRow[]> {
  // When childIds is provided, filter at the SQL layer so we don't materialise
  // the full parent's child list only to drop most of it client-side.
  const filterByIds = Array.isArray(childIds) && childIds.length > 0;
  const result = await pool.query(
    filterByIds
      ? `SELECT id, name FROM administrative_divisions WHERE parent_id = $1 AND id = ANY($2::int[]) ORDER BY name`
      : `SELECT id, name FROM administrative_divisions WHERE parent_id = $1 ORDER BY name`,
    filterByIds ? [gadmDivisionId, childIds] : [gadmDivisionId],
  );
  const suffix = filterByIds ? ` (filtered from ${(childIds as unknown[]).length} requested ids)` : '';
  console.log(`[AddChildren] Loaded ${result.rows.length} children${suffix}`);
  return result.rows;
}

interface SubregionResolutionCtx {
  worldViewId: number;
  userRegionId: number;
  colorToUse: string;
  assignmentMap: Map<number, number>;
  createdRegions: CreatedSubregion[];
}

/**
 * Resolve which subregion a child belongs to: explicit user assignment first,
 * then fall back to accent/case-insensitive name match, otherwise create.
 * Returns null when explicit assignment fails verification.
 */
async function resolveChildSubregion(
  child: ChildRow,
  ctx: SubregionResolutionCtx,
): Promise<number | null> {
  const explicitRegionId = ctx.assignmentMap.get(child.id);
  if (explicitRegionId) {
    const verify = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2 AND parent_region_id = $3',
      [explicitRegionId, ctx.worldViewId, ctx.userRegionId],
    );
    if (verify.rows.length > 0) return explicitRegionId;
    console.warn(
      `[AddChildren] Explicit assignment to region ${explicitRegionId} failed — not a child of region ${ctx.userRegionId} in world view ${ctx.worldViewId}`,
    );
    return null;
  }

  const existing = await pool.query(
    `SELECT id FROM regions WHERE world_view_id = $1 AND parent_region_id = $2
     AND lower(immutable_unaccent(name)) = lower(immutable_unaccent($3))`,
    [ctx.worldViewId, ctx.userRegionId, child.name],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const newRegion = await pool.query(
    `INSERT INTO regions (world_view_id, name, parent_region_id, color)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name`,
    [ctx.worldViewId, child.name, ctx.userRegionId, ctx.colorToUse],
  );
  ctx.createdRegions.push({
    id: newRegion.rows[0].id,
    name: newRegion.rows[0].name,
    divisionId: child.id,
  });
  return newRegion.rows[0].id;
}

/** Place each child in its subregion; answers how many were placed. */
async function addChildrenAsSubregions(
  children: ChildRow[],
  ctx: SubregionResolutionCtx,
  affectedRegionIds: Set<number>,
): Promise<number> {
  let placed = 0;
  for (const child of children) {
    const childSubregionId = await resolveChildSubregion(child, ctx);
    if (childSubregionId === null) continue;
    await ensureRegionMember(childSubregionId, child.id);
    affectedRegionIds.add(childSubregionId);
    placed++;
  }
  return placed;
}

async function addChildrenAsFlatMembers(
  children: ChildRow[],
  userRegionId: number,
  affectedRegionIds: Set<number>,
): Promise<void> {
  for (const child of children) {
    await ensureRegionMember(userRegionId, child.id);
  }
  affectedRegionIds.add(userRegionId);
  console.log(`[AddChildren] Added ${children.length} children as direct GADM members (no subregions)`);
}

/**
 * Add all GADM children (subdivisions) of a division as subregions
 * This is used when a GADM division is a member and user wants to add all its subdivisions as subregions
 * E.g., if Germany is a member, this adds Bayern, Berlin, etc. as subregions of the current region
 *
 * Optional body params:
 * - childIds: number[] - If provided, only add these specific children. If omitted, add all children.
 * - removeOriginal: boolean - If true (default), remove the original division. If false, keep it.
 * - inheritColor: boolean - If true (default), inherit parent region's color. If false, use default blue.
 * - createAsSubregions: boolean - If true (default), create subregions for each child. If false, just add as GADM members.
 */
export async function addChildDivisionsAsSubregions(req: Request, res: Response): Promise<void> {
  // Route: /regions/:regionId/members/:divisionId/add-children
  //   regionId = user-defined region, divisionId = GADM division
  const userRegionId = parseInt(String(req.params.regionId));
  const gadmDivisionId = parseInt(String(req.params.divisionId));

  const {
    childIds,
    removeOriginal = true,
    inheritColor = true,
    createAsSubregions = true,
    assignments,
  } = req.body || {};

  const assignmentMap = new Map<number, number>();
  if (Array.isArray(assignments)) {
    for (const a of assignments as Array<{ gadmChildId: number; existingRegionId: number }>) {
      assignmentMap.set(a.gadmChildId, a.existingRegionId);
    }
  }

  console.log(`[AddChildren] Request: userRegionId=${userRegionId}, gadmDivisionId=${gadmDivisionId}, childIds=${childIds ? childIds.length : 'all'}, removeOriginal=${removeOriginal}, inheritColor=${inheritColor}, createAsSubregions=${createAsSubregions}`);

  const regionInfo = await pool.query(
    'SELECT world_view_id, color FROM regions WHERE id = $1',
    [userRegionId],
  );
  if (regionInfo.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const divisionInfo = await pool.query(
    'SELECT id, name, has_children FROM administrative_divisions WHERE id = $1',
    [gadmDivisionId],
  );
  if (divisionInfo.rows.length === 0) {
    res.status(404).json({ error: `Division ${gadmDivisionId} not found in GADM` });
    return;
  }
  if (!divisionInfo.rows[0].has_children) {
    res.status(400).json({ error: 'Division has no subdivisions to add' });
    return;
  }

  console.log(`[AddChildren] Division ${gadmDivisionId} (${divisionInfo.rows[0].name}) - fetching children`);

  const childrenToAdd = await loadChildrenToAdd(gadmDivisionId, childIds);
  if (childrenToAdd.length === 0) {
    res.status(400).json({ error: 'No children to add' });
    return;
  }

  const createdRegions: CreatedSubregion[] = [];
  const affectedRegionIds = new Set<number>();

  // Every child is placed as a flat member; as subregions, a child whose
  // explicit assignment fails verification is skipped, and not counted.
  let added = childrenToAdd.length;
  if (createAsSubregions) {
    added = await addChildrenAsSubregions(
      childrenToAdd,
      {
        worldViewId: regionInfo.rows[0].world_view_id,
        userRegionId,
        colorToUse: inheritColor ? (regionInfo.rows[0].color || '#3388ff') : '#3388ff',
        assignmentMap,
        createdRegions,
      },
      affectedRegionIds,
    );
  } else {
    await addChildrenAsFlatMembers(childrenToAdd, userRegionId, affectedRegionIds);
  }

  // Removing the original prevents double-counting parent + child geometry.
  let removedOriginal = false;
  if (removeOriginal) {
    const removed = await pool.query(
      'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
      [userRegionId, gadmDivisionId],
    );
    removedOriginal = (removed.rowCount ?? 0) > 0;
    console.log(`[AddChildren] Removed ${removed.rowCount ?? 0} row(s) of original division ${gadmDivisionId} from region ${userRegionId}`);
  }

  await invalidateRegionGeometry(userRegionId);
  for (const rid of affectedRegionIds) {
    await syncImportMatchStatus(rid);
  }

  respond(res.status(201), ChildDivisionsAdded, {
    added,
    removedOriginal,
    createdRegions,
  });
}

/**
 * Flatten a subregion - moves all GADM divisions from the subregion to the parent region and deletes the subregion
 * This converts a hierarchy structure back to flat GADM members
 */
export async function flattenSubregion(req: Request, res: Response): Promise<void> {
  const parentRegionId = parseInt(String(req.params.parentRegionId));
  const subregionId = parseInt(String(req.params.subregionId));

  console.log(`[Flatten] Request: parentRegionId=${parentRegionId}, subregionId=${subregionId}`);

  // Verify the subregion exists and belongs to the parent
  const subregionInfo = await pool.query(
    'SELECT id, name, parent_region_id, world_view_id FROM regions WHERE id = $1',
    [subregionId]
  );

  if (subregionInfo.rows.length === 0) {
    res.status(404).json({ error: 'Subregion not found' });
    return;
  }

  if (subregionInfo.rows[0].parent_region_id !== parentRegionId) {
    res.status(400).json({ error: 'Subregion does not belong to the specified parent region' });
    return;
  }

  // Before the first write: the members move to the parent before the
  // subregion's branch is deleted, and not in one transaction (#764).
  const visits = await visitsUnder(subregionId, true);
  if (visits > 0) throw createError(visitedRegionRefusal(visits), 409);

  // Every member row of the subregion and of each region under it moves to
  // the parent as the row it is, a cut part with its geometry (#1004).
  const subtree = await pool.query<{ id: number }>(`
    WITH RECURSIVE subtree AS (
      SELECT id FROM regions WHERE id = $1
      UNION ALL
      SELECT r.id FROM regions r JOIN subtree s ON r.parent_region_id = s.id
    )
    SELECT id FROM subtree
  `, [subregionId]);
  let movedCount = 0;
  for (const { id } of subtree.rows) {
    movedCount += await moveMembersToRegion(pool, id, parentRegionId);
  }
  console.log(`[Flatten] Moved ${movedCount} member rows from subregion ${subregionId} and its descendants`);

  // Recursively delete the subregion and all its descendants
  const deleteRegionRecursive = async (regionId: number): Promise<void> => {
    // First delete all child regions
    const childRegions = await pool.query(
      'SELECT id FROM regions WHERE parent_region_id = $1',
      [regionId]
    );

    for (const child of childRegions.rows) {
      await deleteRegionRecursive(child.id);
    }

    // Delete the region itself
    await pool.query('DELETE FROM regions WHERE id = $1', [regionId]);
  };

  await deleteRegionRecursive(subregionId);
  console.log(`[Flatten] Deleted subregion ${subregionId} and all descendants`);

  // Invalidate geometry for parent
  await invalidateRegionGeometry(parentRegionId);

  // Sync import match status for the parent (which now has the divisions)
  await syncImportMatchStatus(parentRegionId);

  respond(res, SubregionFlattened, {
    movedDivisions: movedCount,
    deletedRegion: true,
  });
}

/**
 * Expand GADM members to subregions
 * For each GADM division member in a region, create a subregion with the same name containing that division
 * This is the opposite of flattenSubregion
 */
export async function expandToSubregions(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const { inheritColor = true } = req.body;

  // Get the region info
  const regionInfo = await pool.query(
    'SELECT id, name, world_view_id, color FROM regions WHERE id = $1',
    [regionId]
  );

  if (regionInfo.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const region = regionInfo.rows[0];

  // Get all GADM division members (not subregions)
  const members = await pool.query(`
    SELECT rm.division_id, ad.name
    FROM region_members rm
    JOIN administrative_divisions ad ON rm.division_id = ad.id
    WHERE rm.region_id = $1
  `, [regionId]);

  if (members.rows.length === 0) {
    res.status(400).json({ error: 'No GADM members to expand' });
    return;
  }

  console.log(`[Expand] Expanding ${members.rows.length} GADM members to subregions in region ${regionId}`);

  const createdRegions: CreatedSubregion[] = [];

  for (const member of members.rows) {
    // Create a subregion for this division
    const newRegion = await pool.query(`
      INSERT INTO regions (world_view_id, name, parent_region_id, color)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name
    `, [region.world_view_id, member.name, regionId, inheritColor ? region.color : '#3388ff']);

    const newRegionId = newRegion.rows[0].id;
    createdRegions.push({ id: newRegionId, name: newRegion.rows[0].name, divisionId: member.division_id });

    // Add the division to the new subregion
    await pool.query(
      'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)',
      [newRegionId, member.division_id]
    );

    // Remove the division from the parent region
    await pool.query(
      'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
      [regionId, member.division_id]
    );
  }

  console.log(`[Expand] Created ${createdRegions.length} subregions`);

  // Invalidate geometry for parent and new subregions
  await invalidateRegionGeometry(regionId);

  // Sync import match status — parent lost members, new subregions gained them
  await syncImportMatchStatus(regionId);
  for (const cr of createdRegions) {
    await syncImportMatchStatus(cr.id);
  }

  respond(res, SubregionsExpanded, {
    createdRegions,
    expandedCount: createdRegions.length,
  });
}

/**
 * Get usage counts for divisions within a world view
 * Returns how many regions each division belongs to
 */
export async function getDivisionUsageCounts(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds } = req.body;

  if (!Array.isArray(divisionIds) || divisionIds.length === 0) {
    respond(res, DivisionUsageCounts, {});
    return;
  }

  // Query to count how many groups each division belongs to within this hierarchy
  const result = await pool.query<{ division_id: number; usage_count: number }>(`
    SELECT
      rm.division_id,
      COUNT(DISTINCT rm.region_id)::int as usage_count
    FROM region_members rm
    JOIN regions cg ON rm.region_id = cg.id
    WHERE cg.world_view_id = $1
      AND rm.division_id = ANY($2::int[])
    GROUP BY rm.division_id
  `, [worldViewId, divisionIds]);

  const usageCounts: DivisionUsageCounts = {};
  for (const row of result.rows) {
    usageCounts[String(row.division_id)] = row.usage_count;
  }

  respond(res, DivisionUsageCounts, usageCounts);
}
