/**
 * Regions CRUD operations (User-defined regions within World Views)
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import { Region, Regions, RegionSearchResults, RegionUpdated } from '../../api/responses/regions.js';
import { pool } from '../../db/index.js';
import type { RegionsRow } from '../../db/schema.generated.js';
import { notFound } from '../../middleware/errorHandler.js';
import { invalidateRegionGeometry } from './helpers.js';
import { REGION_SELECT_SQL, regionOf, regionSearchResultOf, type RegionRow, type RegionSearchRow } from './regionAnswerRows.js';

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
export async function getRegions(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const result = await pool.query<RegionRow>(`
    ${REGION_SELECT_SQL}
    WHERE cg.world_view_id = $1
    ORDER BY cg.name
  `, [worldViewId]);

  respond(res, Regions, result.rows.map(regionOf));
}

/**
 * Get root-level regions in a World View (no parent)
 */
export async function getRootRegions(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));

  const result = await pool.query<RegionRow>(`
    ${REGION_SELECT_SQL}
    WHERE cg.world_view_id = $1 AND cg.parent_region_id IS NULL
    ORDER BY cg.name
  `, [worldViewId]);

  respond(res, Regions, result.rows.map(regionOf));
}

/**
 * Get subregions of a region
 */
export async function getSubregions(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));

  const result = await pool.query<RegionRow>(`
    ${REGION_SELECT_SQL}
    WHERE cg.parent_region_id = $1
    ORDER BY cg.name
  `, [regionId]);

  respond(res, Regions, result.rows.map(regionOf));
}

/**
 * Get ancestors of a region (from root to the region itself)
 */
export async function getRegionAncestors(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));

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

  respond(res, Regions, result.rows.map(regionOf));
}

/**
 * Search regions by name within a World View
 * Uses ILIKE with unaccent fallback and fuzzy trigram matching
 */
export async function searchRegions(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const inputQuery = String(req.query.query ?? '').trim();
  const limit = parseInt(String(req.query.limit ?? '50'));

  if (inputQuery.length < 2) {
    respond(res, RegionSearchResults, []);
    return;
  }

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

  respond(res, RegionSearchResults, sorted.map(regionSearchResultOf));
}

/**
 * Create a new region in a World View
 */
export async function createRegion(req: Request, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { name, description, parentRegionId, color, customGeometry } = req.body;
  const parentId = parentRegionId;

  console.log(`[CreateRegion] name=${name}, hasCustomGeometry=${!!customGeometry}, customGeometryType=${customGeometry?.type}`);

  let createdId: number;

  if (customGeometry) {
    // If custom geometry is provided, store it directly and mark as custom boundary
    const geomJson = JSON.stringify(customGeometry);
    console.log(`[CreateRegion] Saving custom geometry with ${geomJson.length} chars, first 200: ${geomJson.substring(0, 200)}`);

    try {
      const inserted = await pool.query<Pick<RegionsRow, 'id'> & { has_geom: boolean; geom_points: number | null }>(`
        INSERT INTO regions (world_view_id, name, description, parent_region_id, color, geom, is_custom_boundary)
        VALUES ($1, $2, $3, $4, $5, validate_multipolygon(ST_GeomFromGeoJSON($6)), true)
        RETURNING id, geom IS NOT NULL AS has_geom, ST_NPoints(geom) AS geom_points
      `, [worldViewId, name, description || null, parentId || null, color || '#3388ff', geomJson]);
      createdId = inserted.rows[0].id;

      console.log(`[CreateRegion] Result: id=${createdId}, hasGeom=${inserted.rows[0].has_geom}, geomPoints=${inserted.rows[0].geom_points}`);
    } catch (err) {
      console.error(`[CreateRegion] SQL Error:`, err);
      throw err;
    }
  } else {
    const inserted = await pool.query<Pick<RegionsRow, 'id'>>(`
      INSERT INTO regions (world_view_id, name, description, parent_region_id, color)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [worldViewId, name, description || null, parentId || null, color || '#3388ff']);
    createdId = inserted.rows[0].id;
  }

  respond(res.status(201), Region, await readRegion(createdId));
}

interface UpdateRegionBody {
  name?: string;
  description?: string;
  parentRegionId?: number | null;
  color?: string;
  usesHull?: boolean;
}

type ScalarValue = string | number | boolean | null;

interface UpdateClauses {
  setClauses: string[];
  values: ScalarValue[];
}

function buildRegionUpdateClauses(body: UpdateRegionBody): UpdateClauses {
  const setClauses: string[] = [];
  const values: ScalarValue[] = [];
  const fieldMap: Array<[keyof UpdateRegionBody, string]> = [
    ['name', 'name'],
    ['description', 'description'],
    ['parentRegionId', 'parent_region_id'],
    ['color', 'color'],
    ['usesHull', 'uses_hull'],
  ];
  let paramIndex = 1;
  for (const [bodyKey, column] of fieldMap) {
    const value = body[bodyKey];
    if (value !== undefined) {
      setClauses.push(`${column} = $${paramIndex++}`);
      values.push(value as ScalarValue);
    }
  }
  return { setClauses, values };
}

async function moveDivisionMembershipsForParentChange(
  oldParentId: number | null,
  newParentId: number | null,
  regionName: string,
): Promise<void> {
  if (oldParentId === null) return;

  // Move all matching memberships in two set-based queries inside one
  // transaction. Pre-refactor this was an N+1 DELETE/INSERT loop on the
  // shared pool, where a mid-loop failure (or a connection-level error
  // between two pool.query() calls) could leave region_members partially
  // migrated.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query(
      `DELETE FROM region_members rm
       USING administrative_divisions ad
       WHERE rm.division_id = ad.id
         AND rm.region_id = $1
         AND ad.name = $2
       RETURNING rm.division_id`,
      [oldParentId, regionName],
    );
    if (newParentId !== null && moved.rows.length > 0) {
      await client.query(
        `INSERT INTO region_members (region_id, division_id)
         SELECT $1, did FROM unnest($2::int[]) AS t(did)
         ON CONFLICT (region_id, division_id) WHERE custom_geom IS NULL DO NOTHING`,
        [newParentId, moved.rows.map(r => r.division_id)],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update a region
 */
export async function updateRegion(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const body = req.body as UpdateRegionBody;
  const newParentId = body.parentRegionId;

  const currentRegion = await pool.query<Pick<RegionsRow, 'name' | 'parent_region_id' | 'uses_hull'>>(`
    SELECT name, parent_region_id, uses_hull
    FROM regions WHERE id = $1
  `, [regionId]);
  if (currentRegion.rows.length === 0) {
    throw notFound(`Region ${regionId} not found`);
  }
  const oldParentId = currentRegion.rows[0].parent_region_id;
  const regionName = currentRegion.rows[0].name;
  const oldUsesHull = Boolean(currentRegion.rows[0].uses_hull);

  const { setClauses, values } = buildRegionUpdateClauses(body);
  if (setClauses.length === 0) {
    respond(res, RegionUpdated, await readRegion(regionId));
    return;
  }

  const idIdx = values.length + 1;
  values.push(regionId);
  const result = await pool.query<Pick<RegionsRow, 'world_view_id'>>(`
    UPDATE regions
    SET ${setClauses.join(', ')}
    WHERE id = $${idIdx}
    RETURNING world_view_id
  `, values);
  if (result.rows.length === 0) {
    throw notFound(`Region ${regionId} not found`);
  }

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
    await moveDivisionMembershipsForParentChange(oldParentId, newParentId, regionName);
    await invalidateRegionGeometry(regionId);
    if (oldParentId) await invalidateRegionGeometry(oldParentId);
    if (newParentId) await invalidateRegionGeometry(newParentId);
  }

  // A uses_hull flip is a geometry write: the flag chooses what the four derived
  // rungs are made of, and trg_regions_geom_3857 rebuilds them on it (rule 19).
  // So it bumps, for the reason migration 037 states: the tiles are built from
  // different geometry at unchanged URLs, and without the bump a reader gets the
  // old shapes back out of Martin's cache, at cache speed, which reads as the
  // change having landed. Bumping is not a rule the writers of geom and hull_geom
  // follow as a class: the two compute paths and the batch progress handler do,
  // and the editing endpoints -- updateRegionGeometry, resetRegionToGADM,
  // saveHullGeometry, createRegion with a drawn boundary -- do not. Which of them
  // should has not been audited; that is #688, and this comment records the gap
  // rather than claiming to close it. Compared against the old value rather
  // than fired on the flag's mere presence, or a form saved unchanged would bust
  // every tile URL of the world view -- and that comparison is against a value
  // read by an earlier statement, so an overlapping request can make it stale.
  // The handler's statements are not in one transaction, which is #689: the
  // membership move above has its own, for the same failure class, and commits
  // independently of the invalidations that follow it.
  if (body.usesHull !== undefined && Boolean(body.usesHull) !== oldUsesHull) {
    const bumped = await pool.query<{ tile_version: number }>(
      'UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1 WHERE id = $1 RETURNING tile_version',
      [result.rows[0].world_view_id],
    );
    respond(res, RegionUpdated, { ...await readRegion(regionId), tileVersion: bumped.rows[0].tile_version });
    return;
  }

  respond(res, RegionUpdated, await readRegion(regionId));
}

/**
 * Delete a region
 * Query params:
 * - moveChildrenToParent: if true, move children to this region's parent instead of deleting them
 */
export async function deleteRegion(req: Request, res: Response): Promise<void> {
  const regionId = parseInt(String(req.params.regionId));
  const moveChildrenToParent = req.query.moveChildrenToParent === 'true';

  // Get region info before deleting
  const regionResult = await pool.query(
    'SELECT parent_region_id FROM regions WHERE id = $1',
    [regionId]
  );

  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const parentRegionId = regionResult.rows[0].parent_region_id;

  if (moveChildrenToParent) {
    // Move all subregions to this region's parent (or to root if no parent)
    await pool.query(
      'UPDATE regions SET parent_region_id = $1 WHERE parent_region_id = $2',
      [parentRegionId, regionId]
    );

    // Also move admin division members to parent (if parent exists)
    if (parentRegionId) {
      // Get all admin division members of this region
      const members = await pool.query(
        'SELECT division_id FROM region_members WHERE region_id = $1',
        [regionId]
      );

      // Add them to parent region
      for (const row of members.rows) {
        await pool.query(`
          INSERT INTO region_members (region_id, division_id)
          VALUES ($1, $2)
          ON CONFLICT (region_id, division_id) WHERE custom_geom IS NULL DO NOTHING
        `, [parentRegionId, row.division_id]);
      }
    }
  } else {
    // Delete all descendants first (since ON DELETE SET NULL won't cascade)
    // This recursively deletes all subregions, grandchildren, etc.
    await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT cg.id FROM regions cg
        JOIN descendants d ON cg.parent_region_id = d.id
      )
      DELETE FROM regions WHERE id IN (SELECT id FROM descendants)
    `, [regionId]);
  }

  await pool.query('DELETE FROM regions WHERE id = $1', [regionId]);

  // Invalidate parent's geometry (and its ancestors)
  if (parentRegionId) {
    await invalidateRegionGeometry(parentRegionId);
  }

  res.status(204).send();
}
