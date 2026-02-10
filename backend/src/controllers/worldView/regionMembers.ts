/**
 * Region Members operations (Admin divisions within user-defined regions)
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { invalidateRegionGeometry } from './helpers.js';

/**
 * Get all member admin divisions of a region, plus any subregions
 * Includes full path for admin divisions to distinguish duplicates like Russia in Asia vs Europe
 * Excludes admin divisions that are already represented as subregions (to avoid duplicates)
 */
export async function getRegionMembers(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));

  // Get subregions first (child regions of this region)
  const subregions = await pool.query(`
    SELECT id, name, NULL as "parentId",
           false as "hasChildren",
           'subregion' as "memberType",
           color,
           name as path
    FROM regions cg
    WHERE parent_region_id = $1
    ORDER BY name
  `, [regionId]);

  // Get the names of subregions to filter out matching admin divisions
  const subregionNames = new Set(subregions.rows.map(r => r.name));

  // Get admin division members with their full path, excluding those that match subregion names
  // Also include whether they have a custom geometry (partial admin division)
  const divisions = await pool.query(`
    WITH RECURSIVE division_path AS (
      -- Start with the member admin divisions
      SELECT
        cgm.id as member_row_id,
        ad.id as member_id,
        ad.id as current_id,
        COALESCE(cgm.custom_name, ad.name) as name,
        ad.parent_id,
        ad.has_children,
        COALESCE(cgm.custom_name, ad.name)::text as path,
        1 as depth,
        cgm.custom_geom IS NOT NULL as has_custom_geom
      FROM region_members cgm
      JOIN administrative_divisions ad ON cgm.division_id = ad.id
      WHERE cgm.region_id = $1

      UNION ALL

      -- Recursively get parents
      SELECT
        dp.member_row_id,
        dp.member_id,
        p.id as current_id,
        dp.name,
        p.parent_id,
        dp.has_children,
        (p.name || ' > ' || dp.path)::text as path,
        dp.depth + 1,
        dp.has_custom_geom
      FROM division_path dp
      JOIN administrative_divisions p ON dp.parent_id = p.id
    )
    SELECT DISTINCT ON (member_row_id)
      member_id as id,
      member_row_id as "memberRowId",
      name,
      has_children as "hasChildren",
      'division' as "memberType",
      path,
      has_custom_geom as "hasCustomGeometry"
    FROM division_path
    ORDER BY member_row_id, depth DESC
  `, [regionId]);

  // Filter out admin divisions that have a matching subregion (added with checkbox)
  const filteredDivisions = divisions.rows.filter(d => !subregionNames.has(d.name));

  // Combine and return both
  const allMembers = [
    ...subregions.rows.map(r => ({ ...r, isSubregion: true })),
    ...filteredDivisions.map(d => ({ ...d, isSubregion: false })),
  ];

  res.json(allMembers);
}

/**
 * Get geometries for all division members of a region
 * Returns a GeoJSON FeatureCollection with geometries (using custom_geom if available)
 */
export async function getRegionMemberGeometries(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));

  const result = await pool.query(`
    SELECT
      cgm.id as member_row_id,
      ad.id as division_id,
      COALESCE(cgm.custom_name, ad.name) as name,
      ST_AsGeoJSON(
        ST_Simplify(
          CASE
            -- Custom cut geometries may be invalid and need normalization
            WHEN cgm.custom_geom IS NOT NULL THEN ST_MakeValid(cgm.custom_geom)
            -- Administrative boundaries are preloaded and should not pay ST_MakeValid cost per row
            ELSE ad.geom
          END,
          0.001
        )
      )::json as geometry,
      cgm.custom_geom IS NOT NULL as has_custom_geom
    FROM region_members cgm
    JOIN administrative_divisions ad ON cgm.division_id = ad.id
    WHERE cgm.region_id = $1
      AND (cgm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
  `, [regionId]);

  const features = result.rows
    .filter(row => row.geometry)
    .map(row => ({
      type: 'Feature',
      properties: {
        memberRowId: row.member_row_id,
        divisionId: row.division_id,
        name: row.name,
        hasCustomGeom: row.has_custom_geom,
      },
      geometry: row.geometry,
    }));

  res.json({
    type: 'FeatureCollection',
    features,
  });
}

/**
 * Add administrative divisions to a region
 *
 * Options:
 * - createAsGroups: boolean - If true, also create each admin division as a subregion
 * - includeChildren/includeSiblings: boolean - If true (and createAsSubregions is true), also add all GADM children as subregions
 * - inheritColor: boolean - If true (default), inherit parent region's color for new subregions
 * - childIds: number[] - If provided, only add these specific child admin divisions (used with includeChildren)
 * - customName/customGroupName: string - If provided, use this name for the created region instead of the GADM name
 */
export async function addDivisionsToRegion(req: Request, res: Response): Promise<void> {
  // Support both new (regionId) and legacy (groupId) param names
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));
  const { divisionIds, regionIds, createAsGroups, createAsSubregions, includeSiblings, includeChildren, inheritColor = true, childIds, customGroupName, customName, customGeometry } = req.body;

  // Support both new (divisionIds) and legacy (regionIds) param names
  const ids = divisionIds || regionIds;
  // Support both new (createAsSubregions) and legacy (createAsGroups) param names
  const shouldCreateAsSubregions = createAsSubregions ?? createAsGroups;
  // Support both new (includeChildren) and legacy (includeSiblings) param names
  const shouldIncludeChildren = includeChildren ?? includeSiblings;
  // Support both new (customName) and legacy (customGroupName) param names
  const customRegionName = customName ?? customGroupName;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'divisionIds must be a non-empty array' });
    return;
  }

  // Get the region's world view ID and color for creating subregions
  const regionInfo = await pool.query(
    'SELECT world_view_id, color FROM regions WHERE id = $1',
    [regionId]
  );

  if (regionInfo.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const worldViewId = regionInfo.rows[0].world_view_id;
  const parentColor = regionInfo.rows[0].color || '#3388ff';
  const colorToUse = inheritColor ? parentColor : '#3388ff';
  const createdRegions: { id: number; name: string; divisionId: number }[] = [];

  // Insert all division mappings
  for (const divisionId of ids) {
    // If createAsSubregions is true, create a subregion and add division there instead
    if (shouldCreateAsSubregions) {
      // Get GADM division info
      const divisionInfo = await pool.query(
        'SELECT name, has_children FROM administrative_divisions WHERE id = $1',
        [divisionId]
      );

      if (divisionInfo.rows.length > 0) {
        const divisionName = divisionInfo.rows[0].name;
        const hasChildren = divisionInfo.rows[0].has_children;

        // Use custom name if provided, otherwise use GADM division name
        const subregionName = customRegionName && customRegionName.trim() ? customRegionName.trim() : divisionName;

        // Check if a region with this name already exists under this parent
        const existingRegion = await pool.query(
          'SELECT id FROM regions WHERE world_view_id = $1 AND parent_region_id = $2 AND name = $3',
          [worldViewId, regionId, subregionName]
        );

        let subregionId: number;

        if (existingRegion.rows.length === 0) {
          // Create new region as child of current region
          const newRegion = await pool.query(`
            INSERT INTO regions (world_view_id, name, parent_region_id, color)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name
          `, [worldViewId, subregionName, regionId, colorToUse]);

          subregionId = newRegion.rows[0].id;

          createdRegions.push({
            id: newRegion.rows[0].id,
            name: newRegion.rows[0].name,
            divisionId: divisionId,
          });
        } else {
          subregionId = existingRegion.rows[0].id;
        }

        // When childIds is provided (user selected specific children via dialog),
        // we should NOT add the parent division - only the selected children
        const hasSelectedChildren = Array.isArray(childIds) && childIds.length > 0;

        if (!hasSelectedChildren) {
          // Add this division as a member of the subregion (NOT the parent region)
          // First check if it already exists (since we removed the unique constraint)
          const existing = await pool.query(
            'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
            [subregionId, divisionId]
          );
          if (existing.rows.length === 0) {
            await pool.query(
              `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)`,
              [subregionId, divisionId]
            );
          }
        }

        // If includeChildren is true and division has children, add them as subregions too
        if (shouldIncludeChildren && hasChildren) {
          const childrenResult = await pool.query(
            'SELECT id, name FROM administrative_divisions WHERE parent_id = $1 ORDER BY name',
            [divisionId]
          );

          // Filter by childIds if provided
          const childIdSet = hasSelectedChildren ? new Set(childIds) : null;
          const childrenToProcess = childIdSet
            ? childrenResult.rows.filter((c: { id: number }) => childIdSet.has(c.id))
            : childrenResult.rows;

          for (const child of childrenToProcess) {
            // Check if a region with this child's name already exists under the new subregion
            const existingChildRegion = await pool.query(
              'SELECT id FROM regions WHERE world_view_id = $1 AND parent_region_id = $2 AND name = $3',
              [worldViewId, subregionId, child.name]
            );

            let childSubregionId: number;

            if (existingChildRegion.rows.length === 0) {
              const newChildRegion = await pool.query(`
                INSERT INTO regions (world_view_id, name, parent_region_id, color)
                VALUES ($1, $2, $3, $4)
                RETURNING id, name
              `, [worldViewId, child.name, subregionId, colorToUse]);

              childSubregionId = newChildRegion.rows[0].id;

              createdRegions.push({
                id: newChildRegion.rows[0].id,
                name: newChildRegion.rows[0].name,
                divisionId: child.id,
              });
            } else {
              childSubregionId = existingChildRegion.rows[0].id;
            }

            // Add child division as member of the child subregion
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
          }
        } else if (hasSelectedChildren) {
          // Add selected children as simple members of the subregion (not creating new subregions for them)
          for (const childId of childIds) {
            const existingChild = await pool.query(
              'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
              [subregionId, childId]
            );
            if (existingChild.rows.length === 0) {
              await pool.query(
                `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)`,
                [subregionId, childId]
              );
            }
          }
        }
      }
    } else {
      // Normal case: add divisions directly to this region (no subregion creation)
      const hasSelectedChildren = Array.isArray(childIds) && childIds.length > 0;

      if (hasSelectedChildren) {
        // User selected specific children - add only those, not the parent
        for (const childId of childIds) {
          const existingMember = await pool.query(
            'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
            [regionId, childId]
          );
          if (existingMember.rows.length === 0) {
            await pool.query(
              `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)`,
              [regionId, childId]
            );
          }
        }
      } else {
        // No specific children selected - add the division itself
        // Support custom geometry if provided
        if (customGeometry) {
          await pool.query(
            `INSERT INTO region_members (region_id, division_id, custom_geom, custom_name)
             VALUES ($1, $2, ST_Multi(ST_GeomFromGeoJSON($3)), $4)`,
            [regionId, divisionId, JSON.stringify(customGeometry), customRegionName || null]
          );
        } else {
          // No custom geometry - check if already exists before inserting
          const existingMember = await pool.query(
            'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
            [regionId, divisionId]
          );
          if (existingMember.rows.length === 0) {
            await pool.query(
              `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)`,
              [regionId, divisionId]
            );
          }
        }
      }
    }
  }

  // Invalidate geometry for this region and all ancestors
  await invalidateRegionGeometry(regionId);

  res.status(201).json({
    added: ids.length,
    createdRegions: shouldCreateAsSubregions ? createdRegions : undefined,
  });
}

/**
 * Remove divisions from a region
 * Supports two modes:
 * - divisionIds: removes records without custom_geom (original divisions)
 * - memberRowIds: removes specific records by their row ID (for custom geometry parts)
 */
export async function removeDivisionsFromRegion(req: Request, res: Response): Promise<void> {
  // Support both new (regionId) and legacy (groupId) param names
  const regionId = parseInt(String(req.params.regionId || req.params.groupId));
  const { divisionIds, regionIds, memberRowIds } = req.body;

  // Support both new (divisionIds) and legacy (regionIds) param names
  const ids = divisionIds || regionIds;

  // If memberRowIds provided, delete by row ID (for custom geometry parts)
  if (Array.isArray(memberRowIds) && memberRowIds.length > 0) {
    for (const rowId of memberRowIds) {
      await pool.query(
        'DELETE FROM region_members WHERE id = $1 AND region_id = $2',
        [rowId, regionId]
      );
    }
    // Invalidate geometry after removing members
    await invalidateRegionGeometry(regionId);
    res.status(200).json({ removed: memberRowIds.length });
    return;
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'divisionIds or memberRowIds must be a non-empty array' });
    return;
  }

  for (const divisionId of ids) {
    // Only delete records WITHOUT custom_geom (original divisions)
    // Records with custom_geom are split parts and should be deleted via memberRowIds
    await pool.query(
      'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
      [regionId, divisionId]
    );
  }

  // Invalidate geometry for this region and all ancestors
  await invalidateRegionGeometry(regionId);

  res.status(200).json({ removed: ids.length });
}

/**
 * Move a member (by memberRowId) to a different region
 * This preserves the custom_geom and custom_name
 */
export async function moveMemberToRegion(req: Request, res: Response): Promise<void> {
  const fromRegionId = parseInt(String(req.params.regionId));
  const { memberRowId, toRegionId } = req.body;

  if (!memberRowId || !toRegionId) {
    res.status(400).json({ error: 'memberRowId and toRegionId are required' });
    return;
  }

  // Update the region_id of the member record
  const result = await pool.query(
    'UPDATE region_members SET region_id = $1 WHERE id = $2 AND region_id = $3 RETURNING *',
    [toRegionId, memberRowId, fromRegionId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }

  // Invalidate geometry for both regions
  await invalidateRegionGeometry(fromRegionId);
  await invalidateRegionGeometry(toRegionId);

  res.status(200).json({ moved: true, member: result.rows[0] });
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

  if (shouldCreateAsSubregions) {
    // Create subregions for each child (original behavior)
    for (const child of childrenToAdd) {
      // Check if a region with this name already exists under this parent region
      const existingRegion = await pool.query(
        'SELECT id FROM regions WHERE world_view_id = $1 AND parent_region_id = $2 AND name = $3',
        [worldViewId, userRegionId, child.name]
      );

      let childSubregionId: number;

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
    SELECT cgm.division_id, ad.name
    FROM region_members cgm
    JOIN administrative_divisions ad ON cgm.division_id = ad.id
    WHERE cgm.region_id = $1
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
      cgm.division_id,
      COUNT(DISTINCT cgm.region_id) as usage_count
    FROM region_members cgm
    JOIN regions cg ON cgm.region_id = cg.id
    WHERE cg.world_view_id = $1
      AND cgm.division_id = ANY($2::int[])
    GROUP BY cgm.division_id
  `, [worldViewId, ids]);

  const usageCounts: Record<number, number> = {};
  for (const row of result.rows) {
    usageCounts[row.division_id] = parseInt(row.usage_count);
  }

  res.json(usageCounts);
}
