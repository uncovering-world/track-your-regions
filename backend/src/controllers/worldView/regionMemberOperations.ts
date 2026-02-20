/**
 * Region Member Operations
 *
 * Complex structural operations: expand to subregions, flatten, add children, usage counts.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { invalidateRegionGeometry } from './helpers.js';

/**
 * Add all GADM children (subdivisions) of a division as subregions
 * This is used when a GADM division is a member and user wants to add all its subdivisions as subregions
 * E.g., if Germany is a member, this adds Bayern, Berlin, etc. as subregions of the current region
 *
 * Optional body params:
 * - childIds: number[] - If provided, only add these specific children. If omitted, add all children.
 * - removeOriginal: boolean - If true (default), remove the original division. If false, keep it.
 * - inheritColor: boolean - If true (default), inherit parent region's color. If false, use default blue.
 * - createAsSubregions/createAsSubgroups: boolean - If true (default), create subregions for each child. If false, just add as GADM members.
 */
export async function addChildDivisionsAsSubregions(req: Request, res: Response): Promise<void> {
  // For legacy route: /groups/:groupId/members/:regionId/add-children
  //   - groupId = user-defined region, regionId = GADM division
  // For new route: /regions/:regionId/members/:divisionId/add-children
  //   - regionId = user-defined region, divisionId = GADM division

  // If groupId exists, we're on legacy route
  const isLegacyRoute = !!req.params.groupId;
  const userRegionId = isLegacyRoute
    ? parseInt(String(req.params.groupId))
    : parseInt(String(req.params.regionId));
  const gadmDivisionId = isLegacyRoute
    ? parseInt(String(req.params.regionId))
    : parseInt(String(req.params.divisionId));

  const { childIds, removeOriginal = true, inheritColor = true, createAsSubregions, createAsSubgroups = true } = req.body || {};
  // Support both new (createAsSubregions) and legacy (createAsSubgroups) param names
  const shouldCreateAsSubregions = createAsSubregions ?? createAsSubgroups;

  console.log(`[AddChildren] Request: userRegionId=${userRegionId}, gadmDivisionId=${gadmDivisionId}, childIds=${childIds ? childIds.length : 'all'}, removeOriginal=${removeOriginal}, inheritColor=${inheritColor}, createAsSubregions=${shouldCreateAsSubregions}`);

  // Get the region's world view ID and color
  const regionInfo = await pool.query(
    'SELECT world_view_id, color FROM regions WHERE id = $1',
    [userRegionId]
  );

  if (regionInfo.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const worldViewId = regionInfo.rows[0].world_view_id;
  const parentColor = regionInfo.rows[0].color || '#3388ff';
  const colorToUse = inheritColor ? parentColor : '#3388ff';

  // Get the GADM division info
  const divisionInfo = await pool.query(
    'SELECT id, name, has_children FROM administrative_divisions WHERE id = $1',
    [gadmDivisionId]
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

  // Get all children (subdivisions of this GADM division)
  const allChildrenResult = await pool.query(`
    SELECT id, name FROM administrative_divisions
    WHERE parent_id = $1
    ORDER BY name
  `, [gadmDivisionId]);

  // Filter to specific children if childIds provided
  let childrenToAdd = allChildrenResult.rows;
  if (Array.isArray(childIds) && childIds.length > 0) {
    const childIdSet = new Set(childIds);
    childrenToAdd = childrenToAdd.filter((c: { id: number }) => childIdSet.has(c.id));
    console.log(`[AddChildren] Filtered to ${childrenToAdd.length} of ${allChildrenResult.rows.length} children`);
  } else {
    console.log(`[AddChildren] Adding all ${childrenToAdd.length} children`);
  }

  if (childrenToAdd.length === 0) {
    res.status(400).json({ error: 'No children to add' });
    return;
  }

  const createdRegions: { id: number; name: string; divisionId: number }[] = [];
  const affectedRegionIds = new Set<number>();

  if (shouldCreateAsSubregions) {
    // Create subregions for each child (or assign to existing regions)
    for (const child of childrenToAdd) {
      let childSubregionId: number;

      // Check for existing region with matching name (accent/case-insensitive)
      const existingRegion = await pool.query(
        `SELECT id FROM regions WHERE world_view_id = $1 AND parent_region_id = $2
         AND lower(immutable_unaccent(name)) = lower(immutable_unaccent($3))`,
        [worldViewId, userRegionId, child.name]
      );

      if (existingRegion.rows.length === 0) {
        // Create new region as child of current region
        const newRegion = await pool.query(`
          INSERT INTO regions (world_view_id, name, parent_region_id, color)
          VALUES ($1, $2, $3, $4)
          RETURNING id, name
        `, [worldViewId, child.name, userRegionId, colorToUse]);

        childSubregionId = newRegion.rows[0].id;

        createdRegions.push({
          id: newRegion.rows[0].id,
          name: newRegion.rows[0].name,
          divisionId: child.id,
        });
      } else {
        childSubregionId = existingRegion.rows[0].id;
      }

      // Add this child division as a member of the subregion
      const existingChildMember = await pool.query(
        'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
        [childSubregionId, child.id]
      );
      if (existingChildMember.rows.length === 0) {
        await pool.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)`,
          [childSubregionId, child.id]
        );
      }
      affectedRegionIds.add(childSubregionId);
    }
  } else {
    // Just add children as GADM members directly to this region (flat structure)
    for (const child of childrenToAdd) {
      const existingMember = await pool.query(
        'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
        [userRegionId, child.id]
      );
      if (existingMember.rows.length === 0) {
        await pool.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)`,
          [userRegionId, child.id]
        );
      }
    }
    affectedRegionIds.add(userRegionId);
    console.log(`[AddChildren] Added ${childrenToAdd.length} children as direct GADM members (no subregions)`);
  }

  // Optionally remove the original division from the region since its children now represent it
  // This prevents double-counting the geometry (parent + all children)
  if (removeOriginal) {
    await pool.query(
      'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
      [userRegionId, gadmDivisionId]
    );
    console.log(`[AddChildren] Removed original division ${gadmDivisionId} from region ${userRegionId}`);
  }

  // Invalidate geometry for this region and all ancestors
  await invalidateRegionGeometry(userRegionId);

  res.status(201).json({
    added: childrenToAdd.length,
    removedOriginal: removeOriginal,
    createdRegions,
  });
}

/**
 * Flatten a subregion - moves all GADM divisions from the subregion to the parent region and deletes the subregion
 * This converts a hierarchy structure back to flat GADM members
 */
export async function flattenSubregion(req: Request, res: Response): Promise<void> {
  const parentRegionId = parseInt(String(req.params.parentRegionId || req.params.parentGroupId));
  const subregionId = parseInt(String(req.params.subregionId || req.params.subgroupId));

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

  // Recursively collect all GADM division IDs from the subregion and its descendants
  const collectDivisionIds = async (regionId: number): Promise<number[]> => {
    // Get direct member divisions
    const directMembers = await pool.query(
      'SELECT division_id FROM region_members WHERE region_id = $1',
      [regionId]
    );
    const divisionIds = directMembers.rows.map((r: { division_id: number }) => r.division_id);

    // Get child regions and recursively collect their divisions
    const childRegions = await pool.query(
      'SELECT id FROM regions WHERE parent_region_id = $1',
      [regionId]
    );

    for (const child of childRegions.rows) {
      const childDivisions = await collectDivisionIds(child.id);
      divisionIds.push(...childDivisions);
    }

    return divisionIds;
  };

  const allDivisionIds = await collectDivisionIds(subregionId);
  console.log(`[Flatten] Collected ${allDivisionIds.length} GADM divisions from subregion ${subregionId}`);

  // Add all collected divisions to the parent region
  let movedCount = 0;
  for (const divisionId of allDivisionIds) {
    const existing = await pool.query(
      'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
      [parentRegionId, divisionId]
    );
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)`,
        [parentRegionId, divisionId]
      );
      movedCount++;
    }
  }

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

    // Delete member mappings
    await pool.query('DELETE FROM region_members WHERE region_id = $1', [regionId]);

    // Delete the region itself
    await pool.query('DELETE FROM regions WHERE id = $1', [regionId]);
  };

  await deleteRegionRecursive(subregionId);
  console.log(`[Flatten] Deleted subregion ${subregionId} and all descendants`);

  // Invalidate geometry for parent
  await invalidateRegionGeometry(parentRegionId);

  res.status(200).json({
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
  // Support both new (regionId) and legacy (groupId) param names
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));
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

  const createdRegions: { id: number; name: string }[] = [];

  for (const member of members.rows) {
    // Create a subregion for this division
    const newRegion = await pool.query(`
      INSERT INTO regions (world_view_id, name, parent_region_id, color)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name
    `, [region.world_view_id, member.name, regionId, inheritColor ? region.color : '#3388ff']);

    const newRegionId = newRegion.rows[0].id;
    createdRegions.push({ id: newRegionId, name: newRegion.rows[0].name });

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

  res.status(200).json({
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
  const { divisionIds, regionIds } = req.body;

  // Support both new (divisionIds) and legacy (regionIds) param names
  const ids = divisionIds || regionIds;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.json({});
    return;
  }

  // Query to count how many groups each division belongs to within this hierarchy
  const result = await pool.query(`
    SELECT
      rm.division_id,
      COUNT(DISTINCT rm.region_id) as usage_count
    FROM region_members rm
    JOIN regions cg ON rm.region_id = cg.id
    WHERE cg.world_view_id = $1
      AND rm.division_id = ANY($2::int[])
    GROUP BY rm.division_id
  `, [worldViewId, ids]);

  const usageCounts: Record<number, number> = {};
  for (const row of result.rows) {
    usageCounts[row.division_id] = parseInt(row.usage_count);
  }

  res.json(usageCounts);
}
