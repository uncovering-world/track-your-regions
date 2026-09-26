/**
 * Region Member Mutations
 *
 * Add, remove, and move division members within regions.
 */

import type { z } from 'zod/v4';
import type { DivisionsAdded, DivisionsRemoved, MemberMoved, CreatedSubregion } from '../../api/responses/regions.js';
import { pool } from '../../db/index.js';
import type { RegionMembersRow } from '../../db/schema.generated.js';
import { ensureRegionMember, syncImportMatchStatus } from './helpers.js';
import { badRequest, notFound } from '../../middleware/errorHandler.js';
import type {
  addDivisionsToRegionBodySchema, moveMemberBodySchema, regionIdParamSchema, removeDivisionsFromRegionBodySchema,
} from '../../types/index.js';

type RegionParams = z.output<typeof regionIdParamSchema>;

interface AddDivisionsCtx {
  worldViewId: number;
  rootRegionId: number;
  colorToUse: string;
  hasSelectedChildren: boolean;
  childIds?: number[];
  includeChildren?: boolean;
  customName?: string;
  customGeometry?: unknown;
  createdRegions: CreatedSubregion[];
  affectedRegionIds: Set<number>;
}


/**
 * Find-or-create a region by (worldViewId, parentRegionId, name). Race-safe:
 * leans on the partial unique index `idx_regions_unique_subregion_name` (added
 * by migration 004) so concurrent callers either insert a new row or surface
 * the existing one — Postgres resolves the conflict deterministically, no
 * application-level lock needed.
 *
 * `(xmax = 0)` distinguishes a freshly inserted row from one returned by the
 * conflict path (xmax is the deleting transaction id; on a brand-new row it's
 * always 0, on a row returned because of ON CONFLICT it's set). This lets us
 * keep the existing `createdEntry` semantics — non-null only on real creates.
 *
 * The `DO UPDATE SET name = regions.name` is a no-op write whose only purpose
 * is to make Postgres return the conflicting row via `RETURNING`. `DO NOTHING`
 * would leave RETURNING empty in the conflict case, forcing an extra round
 * trip to fetch the existing id.
 */
async function ensureSubregion(
  worldViewId: number,
  parentRegionId: number,
  name: string,
  color: string,
): Promise<{ id: number; createdEntry: { id: number; name: string } | null }> {
  const result = await pool.query(
    `INSERT INTO regions (world_view_id, name, parent_region_id, color)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (world_view_id, parent_region_id, name) WHERE parent_region_id IS NOT NULL
     DO UPDATE SET name = regions.name
     RETURNING id, name, (xmax = 0) AS inserted`,
    [worldViewId, name, parentRegionId, color],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    createdEntry: row.inserted ? { id: row.id, name: row.name } : null,
  };
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
export async function addDivisionsToRegion(
  { params: { regionId }, body }: { params: RegionParams; body: z.output<typeof addDivisionsToRegionBodySchema> },
): Promise<DivisionsAdded> {
  const {
    divisionIds,
    createAsSubregions,
    includeChildren,
    inheritColor,
    childIds,
    customName,
    customGeometry,
  } = body;

  if (!divisionIds || divisionIds.length === 0) {
    throw badRequest('divisionIds must be a non-empty array');
  }

  const regionInfo = await pool.query(
    'SELECT world_view_id, color FROM regions WHERE id = $1',
    [regionId],
  );
  if (regionInfo.rows.length === 0) throw notFound('Region not found');

  const ctx: AddDivisionsCtx = {
    worldViewId: regionInfo.rows[0].world_view_id,
    rootRegionId: regionId,
    colorToUse: inheritColor ? (regionInfo.rows[0].color || '#3388ff') : '#3388ff',
    hasSelectedChildren: childIds !== undefined && childIds.length > 0,
    childIds,
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

  // The regions whose members changed are cleared by the member trigger, in
  // the statements above (ADR-0068).
  for (const rid of ctx.affectedRegionIds) {
    await syncImportMatchStatus(rid);
  }

  return {
    added: divisionIds.length,
    createdRegions: createAsSubregions ? ctx.createdRegions : undefined,
  };
}

/**
 * Remove divisions from a region
 * Supports two modes:
 * - divisionIds: removes records without custom_geom (original divisions)
 * - memberRowIds: removes specific records by their row ID (for custom geometry parts)
 */
export async function removeDivisionsFromRegion(
  { params: { regionId }, body: { divisionIds, memberRowIds } }: {
    params: RegionParams;
    body: z.output<typeof removeDivisionsFromRegionBodySchema>;
  },
): Promise<DivisionsRemoved> {
  // If memberRowIds provided, delete by row ID (for custom geometry parts)
  // The answer counts the rows that went, not the ids the call named: an id
  // that names no member of this region removes nothing.
  let removed = 0;
  if (memberRowIds && memberRowIds.length > 0) {
    for (const rowId of memberRowIds) {
      const deleted = await pool.query(
        'DELETE FROM region_members WHERE id = $1 AND region_id = $2',
        [rowId, regionId]
      );
      removed += deleted.rowCount ?? 0;
    }
    await syncImportMatchStatus(regionId);
    return { removed };
  }

  if (!divisionIds || divisionIds.length === 0) {
    throw badRequest('divisionIds or memberRowIds must be a non-empty array');
  }

  for (const divisionId of divisionIds) {
    // Only delete records WITHOUT custom_geom (original divisions)
    // Records with custom_geom are split parts and should be deleted via memberRowIds
    const deleted = await pool.query(
      'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
      [regionId, divisionId]
    );
    removed += deleted.rowCount ?? 0;
  }

  await syncImportMatchStatus(regionId);

  return { removed };
}

/**
 * Move a member (by memberRowId) to a different region
 * This preserves the custom_geom and custom_name
 */
export async function moveMemberToRegion(
  { params: { regionId: fromRegionId }, body: { memberRowId, toRegionId } }: {
    params: RegionParams;
    body: z.output<typeof moveMemberBodySchema>;
  },
): Promise<MemberMoved> {
  // Update the region_id of the member record
  const result = await pool.query<Pick<RegionMembersRow, 'id' | 'region_id'>>(
    'UPDATE region_members SET region_id = $1 WHERE id = $2 AND region_id = $3 RETURNING id, region_id',
    [toRegionId, memberRowId, fromRegionId]
  );

  if (result.rows.length === 0) throw notFound('Member not found');

  // Both regions' geometry is cleared by the member trigger, which sees the
  // row leave one and arrive at the other (ADR-0068).

  // Sync match status for both regions
  await syncImportMatchStatus(fromRegionId);
  await syncImportMatchStatus(toRegionId);

  return {
    moved: true,
    memberRowId: result.rows[0].id,
    fromRegionId,
    toRegionId: result.rows[0].region_id,
  };
}
