/**
 * WorldView Import Match Controller
 *
 * Match review endpoints: stats, accept, reject, batch accept, tree, map images, manual fix.
 */

import { Response } from 'express';
import sharp from 'sharp';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { matchDivisionsByVision } from '../../services/ai/openaiService.js';
import {
  type PointInfo,
  generateDivisionsSvg,
  fetchMarkersForDivisions,
} from './wvImportMatchHelpers.js';
import { invalidateRegionGeometry } from '../worldView/helpers.js';

// Re-export review API for adminRoutes (keeps existing import path working)
export {
  resolveWaterReview,
  getWaterCropImage,
  resolveParkReview,
  getParkCropImage,
  resolveClusterReview,
  getClusterPreviewImage,
  getClusterHighlightImage,
  pendingClusterReviews,
  clusterPreviewImages,
  resolveIcpAdjustment,
} from './wvImportMatchReview.js';

// =============================================================================
// Match review endpoints
// =============================================================================

/**
 * Get match statistics for a world view.
 * GET /api/admin/wv-import/matches/:worldViewId/stats
 */
export async function getMatchStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/stats`);

  const result = await pool.query(`
    WITH RECURSIVE ancestor_walk AS (
      -- Seed: each region's direct parent
      SELECT r.id AS region_id, r.parent_region_id AS ancestor_id
      FROM regions r
      WHERE r.world_view_id = $1 AND r.parent_region_id IS NOT NULL
      UNION ALL
      -- Walk up
      SELECT aw.region_id, reg.parent_region_id
      FROM ancestor_walk aw
      JOIN regions reg ON reg.id = aw.ancestor_id
      WHERE reg.parent_region_id IS NOT NULL
    ),
    covered_by_ancestor AS (
      -- Regions where an ancestor has assigned GADM divisions
      SELECT DISTINCT aw.region_id
      FROM ancestor_walk aw
      JOIN region_members rm ON rm.region_id = aw.ancestor_id
      WHERE aw.ancestor_id IS NOT NULL
    ),
    -- Leaf descendants that are NOT resolved (not matched and not covered by ancestor)
    unresolved_leaves AS (
      SELECT r.id AS region_id
      FROM regions r
      JOIN region_import_state ris ON ris.region_id = r.id
      WHERE r.world_view_id = $1
        AND r.is_leaf = true
        AND ris.match_status NOT IN ('auto_matched', 'manual_matched', 'children_matched')
        AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
    ),
    -- Walk unresolved leaves up to find which ancestors have at least one unresolved leaf
    has_unresolved_desc AS (
      -- Seed: unresolved leaves themselves
      SELECT ul.region_id
      FROM unresolved_leaves ul
      UNION
      -- Walk up: parent of an unresolved region also has unresolved descendants
      SELECT r.parent_region_id
      FROM has_unresolved_desc hud
      JOIN regions r ON r.id = hud.region_id
      WHERE r.parent_region_id IS NOT NULL
    )
    SELECT
      COUNT(*) FILTER (WHERE ris.match_status = 'auto_matched') AS auto_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'children_matched') AS children_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'needs_review') AS needs_review,
      COUNT(*) FILTER (
        WHERE ris.match_status = 'needs_review'
          AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
      ) AS needs_review_blocking,
      COUNT(*) FILTER (WHERE ris.match_status = 'no_candidates') AS no_candidates,
      COUNT(*) FILTER (
        WHERE ris.match_status = 'no_candidates'
          AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
          AND r.id IN (SELECT region_id FROM has_unresolved_desc)
      ) AS no_candidates_blocking,
      COUNT(*) FILTER (WHERE ris.match_status = 'manual_matched') AS manual_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'suggested') AS suggested,
      COUNT(*) FILTER (WHERE ris.match_status IS NOT NULL) AS total_matched,
      COUNT(*) FILTER (WHERE r.is_leaf = true) AS total_leaves,
      COUNT(*) AS total_regions,
      COUNT(*) FILTER (
        WHERE array_length(ris.hierarchy_warnings, 1) > 0
          AND ris.hierarchy_reviewed = false
      ) AS hierarchy_warnings_count
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.world_view_id = $1
  `, [worldViewId]);

  res.json(result.rows[0]);
}

/**
 * Accept a single match (assign division to region).
 * Removes the accepted suggestion and keeps needs_review if more remain.
 * POST /api/admin/wv-import/matches/:worldViewId/accept
 */
export async function acceptMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/accept — regionId=${regionId}, divisionId=${divisionId}`);

  // Verify region exists and belongs to the specified world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Create region member
  await pool.query(
    `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [regionId, divisionId],
  );

  // Remove accepted suggestion
  await pool.query(
    `DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2 AND rejected = false`,
    [regionId, divisionId],
  );

  // Decide new status based on remaining non-rejected suggestions
  const remainingResult = await pool.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  const remainingCount = parseInt(remainingResult.rows[0].count as string);
  const newStatus = remainingCount > 0 ? 'needs_review' : 'manual_matched';

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  res.json({ accepted: true });
}

/**
 * Reject (dismiss) a single suggestion without accepting it.
 * POST /api/admin/wv-import/matches/:worldViewId/reject
 */
export async function rejectMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reject — regionId=${regionId}, divisionId=${divisionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Mark suggestion as rejected (prevents re-suggestion)
  await pool.query(
    `UPDATE region_match_suggestions SET rejected = true WHERE region_id = $1 AND division_id = $2`,
    [regionId, divisionId],
  );

  // Also remove from region_members if it was assigned
  await pool.query(
    'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
    [regionId, divisionId],
  );

  // Determine new status based on remaining non-rejected suggestions and assigned members
  const remainingResult = await pool.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  const remainingCount = parseInt(remainingResult.rows[0].count as string);

  let newStatus: string;
  if (remainingCount > 0) {
    newStatus = 'needs_review';
  } else {
    const memberCount = await pool.query(
      'SELECT COUNT(*) FROM region_members WHERE region_id = $1',
      [regionId],
    );
    const hasMembers = parseInt(memberCount.rows[0].count as string) > 0;
    newStatus = hasMembers ? 'manual_matched' : 'no_candidates';
  }

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  res.json({ rejected: true });
}

/**
 * Reject all remaining suggestions for a region.
 * POST /api/admin/wv-import/matches/:worldViewId/reject-remaining
 */
export async function rejectRemaining(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reject-remaining — regionId=${regionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Count non-rejected suggestions before marking them
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  const suggestionCount = parseInt(countResult.rows[0].count as string);

  if (suggestionCount === 0) {
    res.json({ rejected: 0 });
    return;
  }

  // Mark all non-rejected suggestions as rejected
  await pool.query(
    `UPDATE region_match_suggestions SET rejected = true WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );

  // Determine new status: has assignments -> manual_matched, else no_candidates
  const memberCount = await pool.query(
    'SELECT COUNT(*) FROM region_members WHERE region_id = $1',
    [regionId],
  );
  const hasMembers = parseInt(memberCount.rows[0].count as string) > 0;
  const newStatus = hasMembers ? 'manual_matched' : 'no_candidates';

  await pool.query(
    `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
    [newStatus, regionId],
  );

  res.json({ rejected: suggestionCount });
}

/**
 * Remove all assigned divisions (region_members) for a region, keeping suggestions intact.
 * POST /api/admin/wv-import/matches/:worldViewId/clear-members
 */
export async function clearMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/clear-members — regionId=${regionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  const deleted = await pool.query(
    'DELETE FROM region_members WHERE region_id = $1 RETURNING id',
    [regionId],
  );

  // Update status based on remaining suggestions
  const remaining = await pool.query(
    'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
    [regionId],
  );
  const hasSuggestions = parseInt(remaining.rows[0].count as string) > 0;
  const newStatus = hasSuggestions ? 'needs_review' : 'no_candidates';

  await pool.query(
    'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
    [newStatus, regionId],
  );

  res.json({ cleared: deleted.rowCount });
}

/**
 * Accept a match AND reject all remaining suggestions in a single transaction.
 * Replaces the chained acceptMatch + rejectRemaining calls.
 * POST /api/admin/wv-import/matches/:worldViewId/accept-and-reject
 */
export async function acceptAndRejectRest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-and-reject — regionId=${regionId}, divisionId=${divisionId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region exists and belongs to the specified world view
    const region = await client.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    // Create region member
    await client.query(
      `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [regionId, divisionId],
    );

    // Reject all remaining non-rejected suggestions (except the accepted one, which we delete)
    await client.query(
      `UPDATE region_match_suggestions SET rejected = true
       WHERE region_id = $1 AND division_id != $2 AND rejected = false`,
      [regionId, divisionId],
    );

    // Delete the accepted suggestion itself
    await client.query(
      `DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2 AND rejected = false`,
      [regionId, divisionId],
    );

    // Set status to manual_matched (we accepted one and rejected all others)
    await client.query(
      `UPDATE region_import_state SET match_status = 'manual_matched' WHERE region_id = $1`,
      [regionId],
    );

    await client.query('COMMIT');
    res.json({ accepted: true, rejected: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Accept a batch of matches.
 * POST /api/admin/wv-import/matches/:worldViewId/accept-batch
 */
export async function acceptBatchMatches(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-batch — ${req.body?.assignments?.length ?? 0} assignments`);
  const { assignments } = req.body as {
    assignments: Array<{ regionId: number; divisionId: number }>;
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let accepted = 0;
    for (const { regionId, divisionId } of assignments) {
      // Verify region belongs to this world view
      const check = await client.query(
        'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
        [regionId, worldViewId],
      );
      if (check.rows.length === 0) continue;

      // Create region member
      const result = await client.query(
        `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [regionId, divisionId],
      );

      if (result.rows.length > 0) {
        accepted++;
      }

      // Remove accepted suggestion
      await client.query(
        `DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2 AND rejected = false`,
        [regionId, divisionId],
      );
    }

    // Update import state for each unique region
    const uniqueRegionIds = [...new Set(assignments.map(a => a.regionId))];
    for (const regionId of uniqueRegionIds) {
      const remainingResult = await client.query(
        `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
        [regionId],
      );
      const remainingCount = parseInt(remainingResult.rows[0].count as string);
      const newStatus = remainingCount > 0 ? 'needs_review' : 'manual_matched';
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [newStatus, regionId],
      );
    }

    await client.query('COMMIT');
    res.json({ accepted });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get region tree with match status for hierarchical review.
 * GET /api/admin/wv-import/matches/:worldViewId/tree
 */
export async function getMatchTree(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/tree`);

  const result = await pool.query(`
    SELECT
      r.id,
      r.name,
      r.parent_region_id,
      r.is_leaf,
      ris.match_status,
      ris.source_url,
      ris.region_map_url,
      ris.map_image_reviewed,
      ris.needs_manual_fix,
      ris.fix_note,
      ris.source_external_id AS wikidata_id,
      ris.hierarchy_warnings,
      ris.hierarchy_reviewed,
      ris.marker_points,
      COALESCE(ris.geo_available, (
        SELECT NOT wg.not_available FROM wikidata_geoshapes wg
        WHERE wg.wikidata_id = ris.source_external_id
      )) AS geo_available,
      (SELECT COALESCE(json_agg(json_build_object(
        'divisionId', rms.division_id, 'name', rms.name, 'path', rms.path, 'score', rms.score, 'geoSimilarity', rms.geo_similarity,
        'conflict', CASE WHEN rms.conflict_type IS NOT NULL THEN json_build_object(
          'type', rms.conflict_type, 'donorRegionId', rms.donor_region_id, 'donorRegionName', rms.donor_region_name,
          'donorDivisionId', rms.donor_division_id, 'donorDivisionName', rms.donor_division_name
        ) ELSE NULL END
      ) ORDER BY rms.score DESC), '[]'::json)
      FROM region_match_suggestions rms WHERE rms.region_id = r.id AND rms.rejected = false) AS suggestions,
      (SELECT COALESCE(json_agg(rmi.image_url), '[]'::json)
      FROM region_map_images rmi WHERE rmi.region_id = r.id) AS map_image_candidates,
      (SELECT COUNT(*) FROM region_members rm WHERE rm.region_id = r.id) AS member_count,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'divisionId', ad.id,
          'name', ad.name,
          'path', (
            WITH RECURSIVE div_ancestors AS (
              SELECT ad.id, ad.name, ad.parent_id
              UNION ALL
              SELECT d.id, d.name, d.parent_id
              FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.parent_id
            )
            SELECT string_agg(name, ' > ' ORDER BY id) FROM div_ancestors
          ),
          'hasCustomGeom', rm.custom_geom IS NOT NULL
        ) ORDER BY ad.name), '[]'::json)
        FROM region_members rm
        JOIN administrative_divisions ad ON rm.division_id = ad.id
        WHERE rm.region_id = r.id
      ) AS assigned_divisions
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.world_view_id = $1
    ORDER BY r.name
  `, [worldViewId]);

  // Build tree in memory
  interface TreeNode {
    id: number;
    name: string;
    isLeaf: boolean;
    matchStatus: string | null;
    suggestions: Array<{ divisionId: number; name: string; path: string; score: number; geoSimilarity: number | null; conflict?: { type: string; donorRegionId: number; donorRegionName: string; donorDivisionId: number; donorDivisionName: string } | null }>;
    sourceUrl: string | null;
    regionMapUrl: string | null;
    mapImageCandidates: string[];
    mapImageReviewed: boolean;
    needsManualFix: boolean;
    fixNote: string | null;
    wikidataId: string | null;
    memberCount: number;
    assignedDivisions: Array<{ divisionId: number; name: string; path: string; hasCustomGeom: boolean }>;
    hierarchyWarnings: string[];
    hierarchyReviewed: boolean;
    geoAvailable: boolean | null;
    markerPoints: Array<{ name: string; lat: number; lon: number }> | null;
    children: TreeNode[];
  }

  const nodesById = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];

  // Create all nodes
  for (const row of result.rows) {
    nodesById.set(row.id as number, {
      id: row.id as number,
      name: row.name as string,
      isLeaf: row.is_leaf as boolean,
      matchStatus: row.match_status as string | null,
      suggestions: (row.suggestions as TreeNode['suggestions']) ?? [],
      sourceUrl: row.source_url as string | null,
      regionMapUrl: row.region_map_url as string | null,
      mapImageCandidates: (row.map_image_candidates as string[]) ?? [],
      mapImageReviewed: row.map_image_reviewed === true,
      needsManualFix: row.needs_manual_fix === true,
      fixNote: row.fix_note as string | null,
      wikidataId: row.wikidata_id as string | null,
      memberCount: parseInt(row.member_count as string),
      assignedDivisions: (row.assigned_divisions as TreeNode['assignedDivisions']) ?? [],
      hierarchyWarnings: (row.hierarchy_warnings as string[]) ?? [],
      hierarchyReviewed: row.hierarchy_reviewed === true,
      geoAvailable: (row.geo_available as boolean | null) ?? null,
      markerPoints: (row.marker_points as TreeNode['markerPoints']) ?? null,
      children: [],
    });
  }

  // Wire parent-child relationships
  for (const row of result.rows) {
    const node = nodesById.get(row.id as number)!;
    const parentId = row.parent_region_id as number | null;
    if (parentId && nodesById.has(parentId)) {
      nodesById.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  res.json(roots);
}

/**
 * Select a map image from candidates for a region.
 * POST /api/admin/wv-import/matches/:worldViewId/select-map-image
 */
export async function selectMapImage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, imageUrl } = req.body as { regionId: number; imageUrl: string | null };
  console.log(`[WV Import] POST /matches/${worldViewId}/select-map-image — regionId=${regionId}, imageUrl=${imageUrl ? '(url)' : 'null'}`);

  // Verify region exists and belongs to the specified world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Validate imageUrl is in the candidates list (prevent arbitrary URL injection)
  if (imageUrl !== null) {
    const candidatesResult = await pool.query(
      `SELECT image_url FROM region_map_images WHERE region_id = $1`,
      [regionId],
    );
    const candidates = candidatesResult.rows.map(r => r.image_url as string);
    if (!candidates.includes(imageUrl)) {
      res.status(400).json({ error: 'Image URL is not in the candidates list' });
      return;
    }
  }

  if (imageUrl !== null) {
    await pool.query(
      `UPDATE region_import_state SET region_map_url = $1, map_image_reviewed = true WHERE region_id = $2`,
      [imageUrl, regionId],
    );
  } else {
    await pool.query(
      `UPDATE region_import_state SET region_map_url = NULL, map_image_reviewed = true WHERE region_id = $1`,
      [regionId],
    );
  }

  res.json({ selected: true });
}

/**
 * Mark/unmark a region as needing manual fixes in WorldEditor.
 * POST /api/admin/wv-import/matches/:worldViewId/mark-manual-fix
 */
export async function markManualFix(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, needsManualFix, fixNote } = req.body as { regionId: number; needsManualFix: boolean; fixNote?: string };

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  await pool.query(
    `UPDATE region_import_state SET needs_manual_fix = $1, fix_note = $2 WHERE region_id = $3`,
    [needsManualFix, needsManualFix ? (fixNote ?? null) : null, regionId],
  );

  res.json({ updated: true });
}

/**
 * Return per-division geometries as a FeatureCollection with assignment info.
 * POST /api/admin/wv-import/matches/:worldViewId/union-geometry
 */
export async function getUnionGeometry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, regionId } = req.body as { divisionIds: number[]; regionId?: number };

  // Check which divisions are already assigned to regions in this world view
  const assignedResult = await pool.query(`
    SELECT rm.division_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.division_id = ANY($1) AND r.world_view_id = $2
  `, [divisionIds, worldViewId]);
  const assignedMap = new Map<number, string>();
  for (const row of assignedResult.rows) {
    assignedMap.set(row.division_id as number, row.region_name as string);
  }

  const result = await pool.query(`
    SELECT ad.id, ad.name, ST_AsGeoJSON(
      ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ad.geom_simplified_medium), 3
      ))
    ) AS geojson
    FROM administrative_divisions ad
    WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
  `, [divisionIds]);

  // Fetch markers when regionId is provided
  const { points, divisionsWithPoints } = regionId
    ? await fetchMarkersForDivisions(regionId, divisionIds)
    : { points: [] as PointInfo[], divisionsWithPoints: new Set<number>() };

  const features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }> = [];
  for (const row of result.rows) {
    if (row.geojson) {
      const divId = row.id as number;
      const assignedTo = assignedMap.get(divId);
      features.push({
        type: 'Feature',
        properties: {
          name: row.name as string,
          divisionId: divId,
          hasPoints: divisionsWithPoints.has(divId),
          ...(assignedTo ? { assignedTo } : {}),
        },
        geometry: JSON.parse(row.geojson as string),
      });
    }
  }

  // Add point markers
  for (const p of points) {
    features.push({
      type: 'Feature',
      properties: { name: p.name, isMarker: true },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    });
  }

  if (features.length === 0) {
    res.status(404).json({ error: 'No geometry found for given divisions' });
    return;
  }
  res.json({ geometry: { type: 'FeatureCollection', features } });
}

/**
 * Split divisions deeper: replace each given division with its GADM children
 * that intersect the region's geoshape. Returns the new set of division IDs
 * with their coverage and union geometry.
 *
 * POST /api/admin/wv-import/matches/:worldViewId/split-deeper
 */
export async function splitDivisionsDeeper(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, wikidataId, regionId } = req.body as { divisionIds: number[]; wikidataId: string; regionId: number };

  // Check if geoshape is available for spatial filtering
  const geoCheck = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM wikidata_geoshapes WHERE wikidata_id = $1 AND not_available = FALSE AND geom IS NOT NULL) AS available`,
    [wikidataId],
  );
  const hasGeoshape = geoCheck.rows[0]?.available as boolean;

  // For each input division, find its children.
  // When geoshape is available, filter by spatial intersection and compute coverage.
  // When not, return all children (no spatial filter).
  // Divisions without children (leaves) are kept as-is.
  const result = hasGeoshape
    ? await pool.query(`
        WITH wiki AS (
          SELECT ST_ForcePolygonCCW(geom) AS geom
          FROM wikidata_geoshapes
          WHERE wikidata_id = $2 AND not_available = FALSE
        ),
        wiki_area AS (
          SELECT safe_geo_area(geom) AS area FROM wiki
        ),
        parent_children AS (
          SELECT child.id, child.name, child.parent_id,
            safe_geo_area(
              ST_ForcePolygonCCW(ST_CollectionExtract(
                ST_MakeValid(ST_Intersection(w.geom, child.geom_simplified_medium)), 3
              ))
            ) / NULLIF(wa.area, 0) AS coverage
          FROM administrative_divisions child, wiki w, wiki_area wa
          WHERE child.parent_id = ANY($1)
            AND child.geom_simplified_medium IS NOT NULL
            AND ST_Intersects(child.geom_simplified_medium, w.geom)
        ),
        leaf_divisions AS (
          SELECT ad.id, ad.name, ad.parent_id,
            safe_geo_area(
              ST_ForcePolygonCCW(ST_CollectionExtract(
                ST_MakeValid(ST_Intersection(w.geom, ad.geom_simplified_medium)), 3
              ))
            ) / NULLIF(wa.area, 0) AS coverage
          FROM administrative_divisions ad, wiki w, wiki_area wa
          WHERE ad.id = ANY($1)
            AND NOT ad.has_children
            AND ad.geom_simplified_medium IS NOT NULL
        ),
        all_results AS (
          SELECT * FROM parent_children
          UNION ALL
          SELECT * FROM leaf_divisions
        )
        SELECT r.id, r.name, r.parent_id,
          ROUND(r.coverage::numeric, 4) AS coverage,
          (WITH RECURSIVE div_ancestors AS (
            SELECT r.id AS aid, r.name AS aname, r.parent_id AS apid
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
          )
          SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
        FROM all_results r
        WHERE r.coverage > 0.005
        ORDER BY r.coverage DESC
      `, [divisionIds, wikidataId])
    : await pool.query(`
        WITH parent_children AS (
          SELECT child.id, child.name, child.parent_id, NULL::numeric AS coverage
          FROM administrative_divisions child
          WHERE child.parent_id = ANY($1)
            AND child.geom_simplified_medium IS NOT NULL
        ),
        leaf_divisions AS (
          SELECT ad.id, ad.name, ad.parent_id, NULL::numeric AS coverage
          FROM administrative_divisions ad
          WHERE ad.id = ANY($1)
            AND NOT ad.has_children
        ),
        all_results AS (
          SELECT * FROM parent_children
          UNION ALL
          SELECT * FROM leaf_divisions
        )
        SELECT r.id, r.name, r.parent_id, r.coverage,
          (WITH RECURSIVE div_ancestors AS (
            SELECT r.id AS aid, r.name AS aname, r.parent_id AS apid
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.apid
          )
          SELECT string_agg(aname, ' > ' ORDER BY aid) FROM div_ancestors) AS path
        FROM all_results r
        ORDER BY r.name
      `, [divisionIds]);

  // Fetch per-division geometries for rendering individual borders
  const resultIds = result.rows.map(r => r.id as number);
  const features: Array<{ type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }> = [];

  // Check which divisions are already assigned to regions in this world view
  const assignedMap = new Map<number, string>(); // divisionId → regionName
  if (resultIds.length > 0) {
    const assignedResult = await pool.query(`
      SELECT rm.division_id, r.name AS region_name
      FROM region_members rm
      JOIN regions r ON r.id = rm.region_id
      WHERE rm.division_id = ANY($1) AND r.world_view_id = $2
    `, [resultIds, worldViewId]);
    for (const row of assignedResult.rows) {
      assignedMap.set(row.division_id as number, row.region_name as string);
    }
  }

  if (resultIds.length > 0) {
    const geoResult = await pool.query(`
      SELECT ad.id, ad.name, ST_AsGeoJSON(
        ST_ForcePolygonCCW(ST_CollectionExtract(
          ST_MakeValid(ad.geom_simplified_medium), 3
        ))
      ) AS geojson
      FROM administrative_divisions ad
      WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
    `, [resultIds]);
    for (const row of geoResult.rows) {
      if (row.geojson) {
        const divId = row.id as number;
        const assignedTo = assignedMap.get(divId);
        features.push({
          type: 'Feature',
          properties: {
            name: row.name as string,
            divisionId: divId,
            hasPoints: false,
            ...(assignedTo ? { assignedTo } : {}),
          },
          geometry: JSON.parse(row.geojson as string),
        });
      }
    }
  }

  // Fetch Wikivoyage markers and check which divisions contain points
  const { points, divisionsWithPoints } = await fetchMarkersForDivisions(regionId, resultIds);

  // Mark features that contain points
  for (const f of features) {
    if (divisionsWithPoints.has(f.properties.divisionId as number)) {
      f.properties.hasPoints = true;
    }
  }

  // Add point markers as features
  for (const p of points) {
    features.push({
      type: 'Feature',
      properties: { name: p.name, isMarker: true },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    });
  }

  res.json({
    divisions: result.rows.map(r => ({
      divisionId: r.id as number,
      name: r.name as string,
      path: r.path as string,
      parentId: r.parent_id as number | null,
      coverage: r.coverage != null ? parseFloat(r.coverage as string) : null,
      hasPoints: divisionsWithPoints.has(r.id as number),
      assignedTo: assignedMap.get(r.id as number) ?? null,
    })),
    geometry: features.length > 0
      ? { type: 'FeatureCollection', features }
      : null,
    points: points.length > 0 ? points : undefined,
  });
}

/**
 * Use AI vision to suggest which divisions belong to a region based on its map image.
 * POST /api/admin/wv-import/matches/:worldViewId/vision-match
 */
export async function visionMatchDivisions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionIds, regionId, imageUrl } = req.body as { divisionIds: number[]; regionId: number; imageUrl: string };

  // Get the region name
  const regionResult = await pool.query(
    `SELECT name FROM regions WHERE id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );

  if (regionResult.rows.length === 0) {
    res.status(404).json({ error: 'Region not found' });
    return;
  }

  const regionName = regionResult.rows[0].name as string;
  const regionMapUrl = imageUrl;

  // Fetch division SVG paths, centroids, and bounding boxes
  const divResult = await pool.query(`
    SELECT id, name,
      ST_AsSVG(geom_simplified_medium, 0, 2) AS svg_path,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [divisionIds]);

  if (divResult.rows.length === 0) {
    res.status(400).json({ error: 'No valid divisions found' });
    return;
  }

  const divisions = divResult.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    svgPath: r.svg_path as string,
    cx: parseFloat(r.cx as string),
    cy: parseFloat(r.cy as string),
  }));

  // Generate numbered SVG map of all candidate divisions
  const divisionsSvg = generateDivisionsSvg(divisions);
  // Convert SVG to PNG (OpenAI doesn't accept SVG)
  const pngBuffer = await sharp(Buffer.from(divisionsSvg)).flatten({ background: '#f0f2f5' }).png().toBuffer();
  const pngBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;

  // Use a high-res version of the region map image
  const hiresImageUrl = `${regionMapUrl}?width=1280`;

  const result = await matchDivisionsByVision(regionName, hiresImageUrl, pngBase64, divisions);

  res.json({
    suggestedIds: result.suggestedIds,
    rejectedIds: result.rejectedIds,
    unclearIds: result.unclearIds,
    reasoning: result.reasoning,
    cost: result.usage.cost.totalCost,
    debugImages: {
      regionMap: hiresImageUrl,
      divisionsMap: pngBase64,
    },
  });
}

/**
 * Accept divisions with transfer from a donor region.
 * For 'split': removes donor division, re-adds its GADM children minus transferred ones.
 * For 'direct': removes transferred divisions from donor.
 * Both: assigns transferred divisions to target region.
 *
 * POST /api/admin/wv-import/matches/:worldViewId/accept-with-transfer
 */
export async function acceptWithTransfer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionIds, donorRegionId, donorDivisionId, transferType } = req.body as {
    regionId: number; divisionIds: number[]; donorRegionId: number; donorDivisionId: number; transferType: 'direct' | 'split';
  };
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-with-transfer — target=${regionId} donor=${donorRegionId} type=${transferType} divisions=${divisionIds.join(',')}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify both regions belong to this world view
    const regionCheck = await client.query(
      'SELECT id FROM regions WHERE id = ANY($1) AND world_view_id = $2',
      [[regionId, donorRegionId], worldViewId],
    );
    if (regionCheck.rows.length < 2) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region or donor region not found in this world view' });
      return;
    }

    const divisionIdSet = new Set(divisionIds);

    if (transferType === 'split') {
      // 1. Remove donor division from donor region
      await client.query(
        'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
        [donorRegionId, donorDivisionId],
      );

      // 2. Get GADM children of the donor division
      const childrenResult = await client.query(
        'SELECT id FROM administrative_divisions WHERE parent_id = $1',
        [donorDivisionId],
      );

      // 3. Add children NOT being transferred back to donor region
      const keepIds = childrenResult.rows
        .map(r => r.id as number)
        .filter(id => !divisionIdSet.has(id));
      if (keepIds.length > 0) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id)
           SELECT $1, unnest($2::int[])
           ON CONFLICT DO NOTHING`,
          [donorRegionId, keepIds],
        );
      }
    } else {
      // direct: just remove transferred divisions from donor
      await client.query(
        'DELETE FROM region_members WHERE region_id = $1 AND division_id = ANY($2)',
        [donorRegionId, divisionIds],
      );
    }

    // 4. Add transferred divisions to target region
    await client.query(
      `INSERT INTO region_members (region_id, division_id)
       SELECT $1, unnest($2::int[])
       ON CONFLICT DO NOTHING`,
      [regionId, divisionIds],
    );

    // 5. Remove accepted suggestions
    await client.query(
      'DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = ANY($2) AND rejected = false',
      [regionId, divisionIds],
    );

    // 6. Update match status for target region
    const remainingResult = await client.query(
      'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
      [regionId],
    );
    const remainingCount = parseInt(remainingResult.rows[0].count as string);
    const targetStatus = remainingCount > 0 ? 'needs_review' : 'manual_matched';
    await client.query(
      'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
      [targetStatus, regionId],
    );

    await client.query('COMMIT');

    // Post-commit: invalidate geometry for both regions
    await Promise.all([
      invalidateRegionGeometry(regionId),
      invalidateRegionGeometry(donorRegionId),
    ]);

    res.json({ transferred: divisionIds.length, transferType });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Return a 3-layer GeoJSON FeatureCollection for previewing a transfer operation.
 * Features are role-tagged: 'donor' (the division being split), 'moving' (divisions
 * being transferred), and 'target_outline' (the Wikidata geoshape of the target region).
 *
 * POST /api/admin/wv-import/matches/:worldViewId/transfer-preview
 */
export async function getTransferPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { donorDivisionId, movingDivisionIds, wikidataId } = req.body as {
    donorDivisionId: number; movingDivisionIds: number[]; wikidataId: string;
  };

  const result = await pool.query(`
    WITH donor AS (
      SELECT 'donor' AS role, ad.name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ad.geom_simplified_medium), 3)))::json AS geometry
      FROM administrative_divisions ad WHERE ad.id = $1 AND ad.geom_simplified_medium IS NOT NULL
    ),
    moving AS (
      SELECT 'moving' AS role, ad.name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ad.geom_simplified_medium), 3)))::json AS geometry
      FROM administrative_divisions ad WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    ),
    target_outline AS (
      SELECT 'target_outline' AS role, $3::text AS name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(geom), 3)))::json AS geometry
      FROM wikidata_geoshapes WHERE wikidata_id = $3 AND not_available = FALSE
    )
    SELECT role, name, geometry FROM donor
    UNION ALL SELECT role, name, geometry FROM moving
    UNION ALL SELECT role, name, geometry FROM target_outline
  `, [donorDivisionId, movingDivisionIds, wikidataId]);

  const features = result.rows
    .filter(r => r.geometry != null)
    .map(r => ({
      type: 'Feature' as const,
      properties: { role: r.role as string, name: r.name as string },
      geometry: r.geometry,
    }));

  res.json({ type: 'FeatureCollection', features });
}

// Re-export CV pipeline from dedicated module (keeps existing import path working)
export { colorMatchDivisionsSSE } from './wvImportMatchPipeline.js';
