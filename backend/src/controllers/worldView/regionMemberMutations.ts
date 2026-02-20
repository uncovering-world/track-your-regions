/**
 * Region Member Mutations
 *
 * Add, remove, and move division members within regions.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { invalidateRegionGeometry, syncImportMatchStatus } from './helpers.js';

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
  const affectedRegionIds = new Set<number>();

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
          affectedRegionIds.add(subregionId);
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
            affectedRegionIds.add(childSubregionId);
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
          affectedRegionIds.add(subregionId);
        }
      }
    } else {
      // Normal case: add divisions directly to this region (no subregion creation)
      affectedRegionIds.add(regionId);
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
             VALUES ($1, $2, validate_multipolygon(ST_GeomFromGeoJSON($3)), $4)`,
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

  // Sync match status for all imported regions that received members
  for (const rid of affectedRegionIds) {
    await syncImportMatchStatus(rid);
  }

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
    await syncImportMatchStatus(regionId);
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
  await syncImportMatchStatus(regionId);

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

  // Sync match status for both regions
  await syncImportMatchStatus(fromRegionId);
  await syncImportMatchStatus(toRegionId);

  res.status(200).json({ moved: true, member: result.rows[0] });
}
