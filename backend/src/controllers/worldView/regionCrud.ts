/**
 * Regions CRUD operations (User-defined regions within World Views)
 */

import type { z } from 'zod/v4';
import { NO_CONTENT } from '../../api/route.js';
import type { Region, Regions, RegionSearchResults } from '../../api/responses/regions.js';
import { pool } from '../../db/index.js';
import type { RegionsRow } from '../../db/schema.generated.js';
import { visitedRegionRefusal, visitsUnder } from '../../db/regionVisits.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import {
  deleteRegions, inRegionTransaction, insertDrawnRegion, insertRegion, invalidateRegionGeometry,
  lockRegion, lockSubtree, moveChildRegions, type RegionTx, updateRegionFields,
} from '../../db/regionWriter.js';
import { moveMembersToRegion } from './helpers.js';
import { REGION_SELECT_SQL, regionOf, regionSearchResultOf, type RegionRow, type RegionSearchRow } from './regionAnswerRows.js';
import type {
  createRegionBodySchema, deleteRegionQuerySchema, regionIdParamSchema, regionSearchQuerySchema,
  updateRegionBodySchema, worldViewIdParamSchema,
} from '../../types/index.js';

type WorldViewParams = z.output<typeof worldViewIdParamSchema>;
type RegionParams = z.output<typeof regionIdParamSchema>;

/**
 * One region as every region answer reads it. A write answers with this read
 * rather than with its own RETURNING, so what it hands back is the row the tree
 * would list, as the triggers and the rest of the handler left it.
 */
async function readRegion(regionId: number): Promise<Region> {
  const result = await pool.query<RegionRow>(`${REGION_SELECT_SQL} WHERE cg.id = $1`, [regionId]);
  if (result.rows.length === 0) throw notFound(`Region ${regionId} not found`);
  return regionOf(result.rows[0]);
}

/**
 * Get all regions in a World View
 */
export async function getRegions({ params: { worldViewId } }: { params: WorldViewParams }): Promise<Regions> {
  const result = await pool.query<RegionRow>(`
    ${REGION_SELECT_SQL}
    WHERE cg.world_view_id = $1
    ORDER BY cg.name
  `, [worldViewId]);

  return result.rows.map(regionOf);
}

/**
 * Get root-level regions in a World View (no parent)
 */
export async function getRootRegions({ params: { worldViewId } }: { params: WorldViewParams }): Promise<Regions> {
  const result = await pool.query<RegionRow>(`
    ${REGION_SELECT_SQL}
    WHERE cg.world_view_id = $1 AND cg.parent_region_id IS NULL
    ORDER BY cg.name
  `, [worldViewId]);

  return result.rows.map(regionOf);
}

/**
 * Get subregions of a region
 */
export async function getSubregions({ params: { regionId } }: { params: RegionParams }): Promise<Regions> {
  const result = await pool.query<RegionRow>(`
    ${REGION_SELECT_SQL}
    WHERE cg.parent_region_id = $1
    ORDER BY cg.name
  `, [regionId]);

  return result.rows.map(regionOf);
}

/**
 * Get ancestors of a region (from root to the region itself)
 */
export async function getRegionAncestors({ params: { regionId } }: { params: RegionParams }): Promise<Regions> {
  // The whole row of each, as every region answer carries it: the client's
  // selection takes the last entry as the selected region itself, and a region
  // restored from the address has nothing else to be completed from.
  const result = await pool.query<RegionRow>(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_region_id, 1 AS depth
      FROM regions WHERE id = $1
      UNION ALL
      SELECT r.id, r.parent_region_id, a.depth + 1
      FROM regions r
      INNER JOIN ancestors a ON r.id = a.parent_region_id
    )
    ${REGION_SELECT_SQL}
    JOIN ancestors a ON a.id = cg.id
    ORDER BY a.depth DESC
  `, [regionId]);

  if (result.rows.length === 0) {
    throw notFound(`Region ${regionId} not found`);
  }

  return result.rows.map(regionOf);
}

/**
 * Search regions by name within a World View
 * Uses ILIKE with unaccent fallback and fuzzy trigram matching
 */
export async function searchRegions(
  { params: { worldViewId }, query: { query, limit } }: {
    params: WorldViewParams;
    query: z.output<typeof regionSearchQuerySchema>;
  },
): Promise<RegionSearchResults> {
  // The schema counts what was typed; two characters of it may be blanks.
  const inputQuery = query.trim();
  if (inputQuery.length < 2) return [];

  const queryTerms = inputQuery.split(/\s+/).filter(t => t.length > 0);
  const params: (string | number)[] = [inputQuery, worldViewId];
  const nameMatchClauses: string[] = [];
  const nameMatchClausesUnaccent: string[] = [];
  const pathMatchClausesUnaccent: string[] = [];

  queryTerms.forEach((term, i) => {
    const paramIndex = i + 3; // $3, $4, ...
    params.push(`%${term}%`);
    nameMatchClauses.push(`r.name ILIKE $${paramIndex}`);
    nameMatchClausesUnaccent.push(`unaccent(r.name) ILIKE unaccent($${paramIndex})`);
    pathMatchClausesUnaccent.push(`unaccent(path) ILIKE unaccent($${paramIndex})`);
  });

  const executeSearch = async (mode: 'regular' | 'unaccent' | 'fuzzy') => {
    let matchCondition: string;
    let fuzzyScoring: string;

    if (mode === 'regular') {
      matchCondition = `(${nameMatchClauses.join(' OR ')})`;
      fuzzyScoring = '0';
    } else if (mode === 'unaccent') {
      matchCondition = `(${nameMatchClausesUnaccent.join(' OR ')})`;
      fuzzyScoring = '0';
    } else {
      matchCondition = `similarity(unaccent(r.name), unaccent($1)) > 0.3`;
      fuzzyScoring = `(similarity(unaccent(r.name), unaccent($1)) * 400)::int`;
    }

    const query = `
      WITH RECURSIVE path_cte AS (
        SELECT
          r.id, r.name, r.parent_region_id,
          r.name::text AS path,
          r.id AS target_id,
          1 AS depth
        FROM regions r
        WHERE r.world_view_id = $2 AND ${matchCondition}

        UNION ALL

        SELECT
          p.id, p.name, p.parent_region_id,
          p.name || ' > ' || c.path,
          c.target_id,
          c.depth + 1
        FROM regions p
        JOIN path_cte c ON p.id = c.parent_region_id
      ),
      full_paths AS (
        SELECT
          target_id,
          path,
          depth
        FROM path_cte
        WHERE parent_region_id IS NULL
      ),
      scored AS (
        SELECT
          fp.target_id,
          fp.path,
          fp.depth,
          r.name,
          r.parent_region_id,
          r.description,
          r.color,
          r.uses_hull,
          r.focus_bbox,
          r.anchor_point,
          (
            CASE WHEN LOWER(unaccent(r.name)) = LOWER(unaccent($1)) THEN 1000 ELSE 0 END
            + CASE WHEN unaccent(r.name) ILIKE unaccent($1) || '%' THEN 500 ELSE 0 END
            + ${fuzzyScoring}
            + CASE WHEN unaccent(fp.path) ILIKE '%' || unaccent($1) || '%' THEN 300 ELSE 0 END
            + CASE WHEN unaccent(r.name) ILIKE '%' || unaccent($1) || '%' THEN 200 ELSE 0 END
            + CASE WHEN ${pathMatchClausesUnaccent.join(' AND ')} THEN 100 ELSE 0 END
            + CASE WHEN fp.depth <= 10 THEN (10 - fp.depth) * 10 ELSE 0 END
            + CASE WHEN LENGTH(r.name) < 20 THEN (20 - LENGTH(r.name)) * 2 ELSE 0 END
          ) as relevance_score
        FROM full_paths fp
        JOIN regions r ON r.id = fp.target_id
      )
      SELECT DISTINCT ON (target_id)
        target_id as id,
        name,
        parent_region_id,
        description,
        color,
        uses_hull,
        CASE WHEN focus_bbox IS NOT NULL
          THEN json_build_array(focus_bbox[1], focus_bbox[2], focus_bbox[3], focus_bbox[4])
        END as focus_bbox,
        CASE WHEN anchor_point IS NOT NULL
          THEN json_build_array(ST_X(anchor_point), ST_Y(anchor_point))
        END as anchor_point,
        EXISTS (SELECT 1 FROM regions WHERE parent_region_id = target_id) as has_subregions,
        path,
        relevance_score
      FROM scored
      ORDER BY target_id, relevance_score DESC
    `;

    return pool.query<RegionSearchRow>(query, params);
  };

  let result = await executeSearch('regular');
  if (result.rows.length === 0) {
    result = await executeSearch('unaccent');
  }
  if (result.rows.length === 0) {
    result = await executeSearch('fuzzy');
  }

  const sorted = result.rows
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);

  return sorted.map(regionSearchResultOf);
}

/**
 * Create a new region in a World View
 */
export async function createRegion(
  { params: { worldViewId }, body: { name, description, parentRegionId, color, customGeometry } }: {
    params: WorldViewParams;
    body: z.output<typeof createRegionBodySchema>;
  },
): Promise<Region> {
  const parentId = parentRegionId;

  console.log(`[CreateRegion] name=${name}, hasCustomGeometry=${!!customGeometry}, customGeometryType=${customGeometry?.type}`);

  const region = {
    worldViewId, name, description: description || null, parentRegionId: parentId || null, color: color || '#3388ff',
  };
  let createdId: number;

  if (customGeometry) {
    // If custom geometry is provided, store it directly and mark as custom boundary
    const geometryJson = JSON.stringify(customGeometry);
    console.log(`[CreateRegion] Saving custom geometry with ${geometryJson.length} chars, first 200: ${geometryJson.substring(0, 200)}`);

    try {
      const inserted = await inRegionTransaction((tx) => insertDrawnRegion(tx, { ...region, geometryJson }));
      createdId = inserted.id;

      console.log(`[CreateRegion] Result: id=${createdId}, hasGeom=${inserted.hasGeom}, geomPoints=${inserted.geomPoints}`);
    } catch (err) {
      console.error(`[CreateRegion] SQL Error:`, err);
      throw err;
    }
  } else {
    createdId = (await inRegionTransaction((tx) => insertRegion(tx, region))).id;
  }

  return readRegion(createdId);
}

type UpdateRegionBody = z.output<typeof updateRegionBodySchema>;

/**
 * Move the parent's memberships of the division the region is named after
 * (a region created with "Also create as subregion") to the new parent, in two
 * set-based statements on the caller's transaction.
 */
async function moveDivisionMembershipsForParentChange(
  tx: RegionTx,
  oldParentId: number | null,
  newParentId: number | null,
  regionName: string,
): Promise<void> {
  if (oldParentId === null) return;

  const moved = await tx.query(
    `DELETE FROM region_members rm
     USING administrative_divisions ad
     WHERE rm.division_id = ad.id
       AND rm.region_id = $1
       AND ad.name = $2
     RETURNING rm.division_id`,
    [oldParentId, regionName],
  );
  if (newParentId !== null && moved.rows.length > 0) {
    await tx.query(
      `INSERT INTO region_members (region_id, division_id)
       SELECT $1, did FROM unnest($2::int[]) AS t(did)
       ON CONFLICT (region_id, division_id) WHERE custom_geom IS NULL DO NOTHING`,
      [newParentId, moved.rows.map(r => r.division_id)],
    );
  }
}

/**
 * Update a region
 */
export async function updateRegion(
  { params: { regionId }, body }: { params: RegionParams; body: UpdateRegionBody },
): Promise<Region> {
  const { name, description, parentRegionId: newParentId, color, usesHull } = body;

  // One transaction, the region locked first (#689): what the reparent
  // compares against is what it will write over, and the move lands with the
  // invalidations below or not at all.
  await inRegionTransaction(async (tx) => {
    const current = await lockRegion<Pick<RegionsRow, 'name' | 'parent_region_id'>>(tx, regionId, 'name, parent_region_id');
    if (!current) throw notFound(`Region ${regionId} not found`);
    const oldParentId = current.parent_region_id;

    await updateRegionFields(tx, regionId, { name, description, parentRegionId: newParentId, color, usesHull });

    // Parent change: move the corresponding GADM division membership too.
    // This handles regions created via "Also create as subregion" checkbox.
    //
    // All three rows are named explicitly, because a structural move is the one
    // thing the geometry trigger cannot see: no geometry is written, and both
    // parents' unions change all the same -- one loses a child and the members
    // that moved with it, the other gains them. The moved region's own
    // invalidation reaches the new parent through the trigger *when it writes a
    // row*, which it does not for a hand-drawn region (nothing derived from
    // members may wipe a drawn shape, #283) -- and a parent's union does include
    // a hand-drawn child, since it collects every child with geometry and filters
    // none out. Leaving the third call to that path would put a continent beyond
    // the reach of every later run whenever a curator moved a drawn region into
    // it. Same reason deleteRegion names its parent: a DELETE fires no trigger on
    // geom either.
    if (newParentId !== undefined && oldParentId !== newParentId) {
      await moveDivisionMembershipsForParentChange(tx, oldParentId, newParentId, current.name);
      await invalidateRegionGeometry(tx, regionId);
      if (oldParentId) await invalidateRegionGeometry(tx, oldParentId);
      if (newParentId) await invalidateRegionGeometry(tx, newParentId);
    }
  });

  return readRegion(regionId);
}

/**
 * Delete a region
 * Query params:
 * - moveChildrenToParent: if true, move children to this region's parent instead of deleting them
 */
export async function deleteRegion(
  { params: { regionId }, query }: { params: RegionParams; query: z.output<typeof deleteRegionQuerySchema> },
): Promise<typeof NO_CONTENT> {
  const moveChildrenToParent = query.moveChildrenToParent === 'true';

  // One transaction, the region locked first (#689): the visit count, the
  // moves and the delete stand or fall together, so a refusal or a failure
  // at the delete leaves no child or member moved.
  await inRegionTransaction(async (tx) => {
    const region = await lockRegion<Pick<RegionsRow, 'parent_region_id'>>(tx, regionId, 'parent_region_id');
    if (!region) throw notFound('Region not found');
    const parentRegionId = region.parent_region_id;

    const visits = await visitsUnder(regionId, !moveChildrenToParent, tx);
    if (visits > 0) throw createError(visitedRegionRefusal(visits), 409);

    if (moveChildrenToParent) {
      // Move all subregions to this region's parent (or to root if no parent)
      await moveChildRegions(tx, regionId, parentRegionId);

      // The region's members move to the parent (if there is one) row by row,
      // a cut part with its geometry (#384).
      if (parentRegionId) {
        await moveMembersToRegion(tx, regionId, parentRegionId);
      }
    } else {
      // Delete every descendant (ON DELETE SET NULL would only orphan them),
      // locked first so it is the branch that goes
      const branch = (await lockSubtree(tx, [regionId], false)).map((row) => row.id);
      if (branch.length > 0) await deleteRegions(tx, branch);
    }

    await deleteRegions(tx, [regionId]);

    // Invalidate parent's geometry (and its ancestors)
    if (parentRegionId) {
      await invalidateRegionGeometry(tx, parentRegionId);
    }
  });

  return NO_CONTENT;
}
