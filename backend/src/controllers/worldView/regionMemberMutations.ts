/**
 * Region Member Mutations
 *
 * Add, remove, and move division members within regions.
 */

import { Request, Response } from 'express';
import { pool } from '../../db/index.js';
import { ensureRegionMember, invalidateRegionGeometry, syncImportMatchStatus } from './helpers.js';

interface CreatedRegionEntry {
  id: number;
  name: string;
  divisionId: number;
}

interface AddDivisionsCtx {
  worldViewId: number;
  rootRegionId: number;
  colorToUse: string;
  hasSelectedChildren: boolean;
  childIds?: number[];
  includeChildren?: boolean;
  customName?: string;
  customGeometry?: unknown;
  createdRegions: CreatedRegionEntry[];
  affectedRegionIds: Set<number>;
}


/**
 * Find-or-create a region by (worldViewId, parentRegionId, name). Race-safe:
 * serialises concurrent callers on a transaction-scoped advisory lock keyed
 * by the (worldView, parent, name) triple before the SELECT-then-INSERT.
 *
 * The advisory lock is an application-level fix. The proper schema-level
 * resolution (partial unique index + `INSERT … ON CONFLICT DO UPDATE`) is
 * tracked in issue #378 — it needs a one-shot data cleanup of legacy dev-DB
 * duplicates (created by this same race before it was fixed), which is out
 * of scope for the lint-guardrail PR.
 */
async function ensureSubregion(
  worldViewId: number,
  parentRegionId: number,
  name: string,
  color: string,
): Promise<{ id: number; createdEntry: { id: number; name: string } | null }> {
  const lockKey = `subregion:${worldViewId}:${parentRegionId}:${name}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Transaction-scoped advisory lock — released automatically on COMMIT/ROLLBACK.
    // hashtextextended(text, int8) returns an int8 that pg_advisory_xact_lock accepts.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);

    const existing = await client.query(
      'SELECT id FROM regions WHERE world_view_id = $1 AND parent_region_id = $2 AND name = $3',
      [worldViewId, parentRegionId, name],
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { id: existing.rows[0].id, createdEntry: null };
    }
    const newRegion = await client.query(
      `INSERT INTO regions (world_view_id, name, parent_region_id, color)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name`,
      [worldViewId, name, parentRegionId, color],
    );
    await client.query('COMMIT');
    return {
      id: newRegion.rows[0].id,
      createdEntry: { id: newRegion.rows[0].id, name: newRegion.rows[0].name },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processGadmChildren(
  ctx: AddDivisionsCtx,
  parentDivisionId: number,
  parentSubregionId: number,
): Promise<void> {
  const childrenResult = await pool.query(
    'SELECT id, name FROM administrative_divisions WHERE parent_id = $1 ORDER BY name',
    [parentDivisionId],
  );

  const childIdSet = ctx.hasSelectedChildren ? new Set(ctx.childIds) : null;
  const childrenToProcess = childIdSet
    ? childrenResult.rows.filter((c: { id: number }) => childIdSet.has(c.id))
    : childrenResult.rows;

  for (const child of childrenToProcess) {
    const { id: childSubregionId, createdEntry } = await ensureSubregion(
      ctx.worldViewId,
      parentSubregionId,
      child.name,
      ctx.colorToUse,
    );
    if (createdEntry) {
      ctx.createdRegions.push({ ...createdEntry, divisionId: child.id });
    }
    await ensureRegionMember(childSubregionId, child.id);
    ctx.affectedRegionIds.add(childSubregionId);
  }
}

async function addDivisionAsSubregion(
  ctx: AddDivisionsCtx,
  divisionId: number,
): Promise<void> {
  const divisionInfo = await pool.query(
    'SELECT name, has_children FROM administrative_divisions WHERE id = $1',
    [divisionId],
  );
  if (divisionInfo.rows.length === 0) return;

  const divisionName = divisionInfo.rows[0].name;
  const hasChildren = divisionInfo.rows[0].has_children;

  const subregionName = ctx.customName && ctx.customName.trim()
    ? ctx.customName.trim()
    : divisionName;

  const { id: subregionId, createdEntry } = await ensureSubregion(
    ctx.worldViewId,
    ctx.rootRegionId,
    subregionName,
    ctx.colorToUse,
  );
  if (createdEntry) {
    ctx.createdRegions.push({ ...createdEntry, divisionId });
  }

  // When childIds is provided (user selected specific children via dialog),
  // we should NOT add the parent division — only the selected children.
  if (!ctx.hasSelectedChildren) {
    await ensureRegionMember(subregionId, divisionId);
    ctx.affectedRegionIds.add(subregionId);
  }

  if (ctx.includeChildren && hasChildren) {
    await processGadmChildren(ctx, divisionId, subregionId);
  } else if (ctx.hasSelectedChildren && ctx.childIds) {
    for (const childId of ctx.childIds) {
      await ensureRegionMember(subregionId, childId);
    }
    ctx.affectedRegionIds.add(subregionId);
  }
}

async function addDivisionDirectly(
  ctx: AddDivisionsCtx,
  divisionId: number,
): Promise<void> {
  ctx.affectedRegionIds.add(ctx.rootRegionId);
  if (ctx.hasSelectedChildren && ctx.childIds) {
    for (const childId of ctx.childIds) {
      await ensureRegionMember(ctx.rootRegionId, childId);
    }
    return;
  }

  if (ctx.customGeometry) {
    await pool.query(
      `INSERT INTO region_members (region_id, division_id, custom_geom, custom_name)
       VALUES ($1, $2, validate_multipolygon(ST_GeomFromGeoJSON($3)), $4)`,
      [ctx.rootRegionId, divisionId, JSON.stringify(ctx.customGeometry), ctx.customName || null],
    );
    return;
  }

  await ensureRegionMember(ctx.rootRegionId, divisionId);
}

/**
 * Add administrative divisions to a region
 *
 * Options:
 * - createAsSubregions: boolean - If true, also create each admin division as a subregion
 * - includeChildren: boolean - If true (and createAsSubregions is true), also add all GADM children as subregions
 * - inheritColor: boolean - If true (default), inherit parent region's color for new subregions
 * - childIds: number[] - If provided, only add these specific child admin divisions (used with includeChildren)
 * - customName: string - If provided, use this name for the created region instead of the GADM name
 */
export async function addDivisionsToRegion(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const {
    divisionIds,
    createAsSubregions,
    includeChildren,
    inheritColor = true,
    childIds,
    customName,
    customGeometry,
  } = req.body;

  if (!Array.isArray(divisionIds) || divisionIds.length === 0) {
    res.status(400).json({ error: 'divisionIds must be a non-empty array' });
    return;
  }

  const regionInfo = await pool.query(
    'SELECT world_view_id, color FROM regions WHERE id = $1',
    [regionId],
  );
  if (regionInfo.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const ctx: AddDivisionsCtx = {
    worldViewId: regionInfo.rows[0].world_view_id,
    rootRegionId: regionId,
    colorToUse: inheritColor ? (regionInfo.rows[0].color || '#3388ff') : '#3388ff',
    hasSelectedChildren: Array.isArray(childIds) && childIds.length > 0,
    childIds: Array.isArray(childIds) ? childIds : undefined,
    includeChildren,
    customName,
    customGeometry,
    createdRegions: [],
    affectedRegionIds: new Set<number>(),
  };

  for (const divisionId of divisionIds) {
    if (createAsSubregions) {
      await addDivisionAsSubregion(ctx, divisionId);
    } else {
      await addDivisionDirectly(ctx, divisionId);
    }
  }

  await invalidateRegionGeometry(regionId);
  for (const rid of ctx.affectedRegionIds) {
    await syncImportMatchStatus(rid);
  }

  res.status(201).json({
    added: divisionIds.length,
    createdRegions: createAsSubregions ? ctx.createdRegions : undefined,
  });
}

/**
 * Remove divisions from a region
 * Supports two modes:
 * - divisionIds: removes records without custom_geom (original divisions)
 * - memberRowIds: removes specific records by their row ID (for custom geometry parts)
 */
export async function removeDivisionsFromRegion(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const { divisionIds, memberRowIds } = req.body;

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

  if (!Array.isArray(divisionIds) || divisionIds.length === 0) {
    res.status(400).json({ error: 'divisionIds or memberRowIds must be a non-empty array' });
    return;
  }

  for (const divisionId of divisionIds) {
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

  res.status(200).json({ removed: divisionIds.length });
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
