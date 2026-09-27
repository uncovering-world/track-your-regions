/**
 * WorldView Import Match Controller
 *
 * Match review endpoints: stats, accept, reject, batch accept, tree, map images, manual fix.
 */

import { pool } from '../../db/index.js';
import { acceptDivisionsRejectRest, rejectDivisions } from './wvImportMatchDecisions.js';
import { matchTreeNodeOf, type MatchTreeRow } from './wvImportAnswerRows.js';
import {
  MatchAccepted,
  MatchAcceptedRestRejected,
  MatchesAccepted,
  MatchStats,
  MatchTree,
  RemainingRejected,
  SuggestionRejected,
  type MatchTreeNode,
} from '../../api/responses/worldViewImport.js';
import { ManualFixMarked, MapImageSelected, MembersCleared } from '../../api/responses/wvImportTreeOps.js';
import type { z } from 'zod/v4';
import { badRequest, notFound } from '../../middleware/errorHandler.js';
import type { worldViewIdParamSchema, wvImportAcceptBatchSchema, wvImportAcceptMatchSchema, wvImportMarkManualFixSchema, wvImportRegionIdSchema, wvImportSelectMapImageSchema } from '../../types/index.js';

// =============================================================================
// Match review endpoints
// =============================================================================

/**
 * Get match statistics for a world view.
 * GET /api/admin/wv-import/matches/:worldViewId/stats
 */
export async function getMatchStats(
  { params: { worldViewId } }: { params: z.output<typeof worldViewIdParamSchema> },
): Promise<MatchStats> {
  console.log(`[WV Import] GET /matches/${worldViewId}/stats`);

  const result = await pool.query<MatchStats>(`
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
      COUNT(*) FILTER (WHERE ris.match_status = 'auto_matched')::int AS auto_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'children_matched')::int AS children_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'needs_review')::int AS needs_review,
      COUNT(*) FILTER (
        WHERE ris.match_status = 'needs_review'
          AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
      )::int AS needs_review_blocking,
      COUNT(*) FILTER (WHERE ris.match_status = 'no_candidates')::int AS no_candidates,
      COUNT(*) FILTER (
        WHERE ris.match_status = 'no_candidates'
          AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
          AND r.id IN (SELECT region_id FROM has_unresolved_desc)
      )::int AS no_candidates_blocking,
      COUNT(*) FILTER (WHERE ris.match_status = 'manual_matched')::int AS manual_matched,
      COUNT(*) FILTER (WHERE ris.match_status = 'suggested')::int AS suggested,
      COUNT(*) FILTER (WHERE ris.match_status IS NOT NULL)::int AS total_matched,
      COUNT(*) FILTER (WHERE r.is_leaf = true)::int AS total_leaves,
      COUNT(*)::int AS total_regions,
      COUNT(*) FILTER (
        WHERE array_length(ris.hierarchy_warnings, 1) > 0
          AND ris.hierarchy_reviewed = false
      )::int AS hierarchy_warnings_count
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.world_view_id = $1
  `, [worldViewId]);

  return result.rows[0];
}

/**
 * Accept a single match (assign division to region).
 * Removes the accepted suggestion and keeps needs_review if more remain.
 * POST /api/admin/wv-import/matches/:worldViewId/accept
 */
export async function acceptMatch(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportAcceptMatchSchema> },
): Promise<MatchAccepted> {
  const { regionId, divisionId } = body;
  console.log(`[WV Import] POST /matches/${worldViewId}/accept — regionId=${regionId}, divisionId=${divisionId}`);

  // Verify region exists and belongs to the specified world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    throw notFound('Region not found in this world view');
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

  return { accepted: true };
}

/**
 * Reject (dismiss) a single suggestion without accepting it.
 * POST /api/admin/wv-import/matches/:worldViewId/reject
 */
export async function rejectMatch(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportAcceptMatchSchema> },
): Promise<SuggestionRejected> {
  const { regionId, divisionId } = body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reject — regionId=${regionId}, divisionId=${divisionId}`);

  if (!await rejectDivisions(worldViewId, regionId, [divisionId])) {
    throw notFound('Region not found in this world view');
  }
  return { rejected: true };
}

/**
 * Reject all remaining suggestions for a region.
 * POST /api/admin/wv-import/matches/:worldViewId/reject-remaining
 */
export async function rejectRemaining(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportRegionIdSchema> },
): Promise<RemainingRejected> {
  const { regionId } = body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reject-remaining — regionId=${regionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    throw notFound('Region not found in this world view');
  }

  // Count non-rejected suggestions before marking them
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  const suggestionCount = parseInt(countResult.rows[0].count as string);

  if (suggestionCount === 0) {
    return { rejected: 0 };
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

  return { rejected: suggestionCount };
}

/**
 * Remove all assigned divisions (region_members) for a region, keeping suggestions intact.
 * POST /api/admin/wv-import/matches/:worldViewId/clear-members
 */
export async function clearMembers(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportRegionIdSchema> },
): Promise<MembersCleared> {
  const { regionId } = body;
  console.log(`[WV Import] POST /matches/${worldViewId}/clear-members — regionId=${regionId}`);

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    throw notFound('Region not found in this world view');
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

  return { cleared: deleted.rowCount ?? 0 };
}

/**
 * Accept a match AND reject all remaining suggestions in a single transaction
 * (`acceptDivisionsRejectRest`, which the batch route shares).
 * POST /api/admin/wv-import/matches/:worldViewId/accept-and-reject
 */
export async function acceptAndRejectRest(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportAcceptMatchSchema> },
): Promise<MatchAcceptedRestRejected> {
  const { regionId, divisionId } = body;
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-and-reject — regionId=${regionId}, divisionId=${divisionId}`);

  if (!await acceptDivisionsRejectRest(worldViewId, regionId, [divisionId])) {
    throw notFound('Region not found in this world view');
  }
  return { accepted: true, rejected: true };
}

/**
 * Accept a batch of matches.
 * POST /api/admin/wv-import/matches/:worldViewId/accept-batch
 */
export async function acceptBatchMatches(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportAcceptBatchSchema> },
): Promise<MatchesAccepted> {
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-batch — ${body.assignments?.length ?? 0} assignments`);
  const { assignments } = body;

  let accepted = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Track region IDs whose ownership check passed — only these should have
    // their import status recomputed below. Using all input regionIds (including
    // those rejected by the world-view ownership check) would overwrite the
    // status of regions that belong to a different world view.
    const processedRegionIds = new Set<number>();

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
      processedRegionIds.add(regionId);
    }

    // Update import state for each unique region whose ownership check passed
    for (const regionId of processedRegionIds) {
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
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { accepted };
}

/**
 * Get region tree with match status for hierarchical review.
 * GET /api/admin/wv-import/matches/:worldViewId/tree
 */
export async function getMatchTree(
  { params: { worldViewId } }: { params: z.output<typeof worldViewIdParamSchema> },
): Promise<MatchTree> {
  console.log(`[WV Import] GET /matches/${worldViewId}/tree`);

  const result = await pool.query<MatchTreeRow>(`
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

  const nodesById = new Map<number, MatchTreeNode>();
  for (const row of result.rows) nodesById.set(row.id, matchTreeNodeOf(row));

  // Wire parent-child relationships
  const roots: MatchTreeNode[] = [];
  for (const row of result.rows) {
    const node = nodesById.get(row.id)!;
    const parent = row.parent_region_id === null ? undefined : nodesById.get(row.parent_region_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

/**
 * Select a map image from candidates for a region.
 * POST /api/admin/wv-import/matches/:worldViewId/select-map-image
 */
export async function selectMapImage(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportSelectMapImageSchema> },
): Promise<MapImageSelected> {
  const { regionId, imageUrl } = body;
  console.log(`[WV Import] POST /matches/${worldViewId}/select-map-image — regionId=${regionId}, imageUrl=${imageUrl ? '(url)' : 'null'}`);

  // Verify region exists and belongs to the specified world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    throw notFound('Region not found in this world view');
  }

  // Validate imageUrl is in the candidates list (prevent arbitrary URL injection)
  if (imageUrl !== null) {
    const candidatesResult = await pool.query(
      `SELECT image_url FROM region_map_images WHERE region_id = $1`,
      [regionId],
    );
    const candidates = candidatesResult.rows.map(r => r.image_url as string);
    if (!candidates.includes(imageUrl)) {
      throw badRequest('Image URL is not in the candidates list');
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

  return { selected: true };
}

/**
 * Mark/unmark a region as needing manual fixes in WorldEditor.
 * POST /api/admin/wv-import/matches/:worldViewId/mark-manual-fix
 */
export async function markManualFix(
  { params: { worldViewId }, body }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportMarkManualFixSchema> },
): Promise<ManualFixMarked> {
  const { regionId, needsManualFix, fixNote } = body;

  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    throw notFound('Region not found in this world view');
  }

  await pool.query(
    `UPDATE region_import_state SET needs_manual_fix = $1, fix_note = $2 WHERE region_id = $3`,
    [needsManualFix, needsManualFix ? (fixNote ?? null) : null, regionId],
  );

  return { updated: true };
}
