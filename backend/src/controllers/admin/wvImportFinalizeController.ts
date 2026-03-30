/**
 * WorldView Import Finalize Controller
 *
 * Finalization, hierarchy review endpoints: finalizeReview, addChildRegion,
 * dismissHierarchyWarnings.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/**
 * Finalize review -- mark the world view as done.
 * Appends '_done' to current source_type (e.g. 'wikivoyage' -> 'wikivoyage_done', 'imported' -> 'imported_done').
 * The world view remains editable from the WorldView Editor.
 * POST /api/admin/wv-import/matches/:worldViewId/finalize
 */
export async function finalizeReview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] POST /matches/${worldViewId}/finalize`);

  // Check for unmatched regions
  // Exclude no_candidates regions where any ancestor has assigned divisions
  // (ancestor geometry covers them)
  const unmatchedResult = await pool.query(`
    WITH RECURSIVE ancestor_walk AS (
      SELECT r.id AS region_id, r.parent_region_id AS ancestor_id
      FROM regions r
      WHERE r.world_view_id = $1 AND r.parent_region_id IS NOT NULL
      UNION ALL
      SELECT aw.region_id, reg.parent_region_id
      FROM ancestor_walk aw
      JOIN regions reg ON reg.id = aw.ancestor_id
      WHERE reg.parent_region_id IS NOT NULL
    ),
    covered_by_ancestor AS (
      SELECT DISTINCT aw.region_id
      FROM ancestor_walk aw
      JOIN region_members rm ON rm.region_id = aw.ancestor_id
      WHERE aw.ancestor_id IS NOT NULL
    ),
    unresolved_leaves AS (
      SELECT r2.id AS region_id
      FROM regions r2
      JOIN region_import_state ris2 ON ris2.region_id = r2.id
      WHERE r2.world_view_id = $1
        AND r2.is_leaf = true
        AND ris2.match_status NOT IN ('auto_matched', 'manual_matched', 'children_matched')
        AND r2.id NOT IN (SELECT region_id FROM covered_by_ancestor)
    ),
    has_unresolved_desc AS (
      SELECT ul.region_id FROM unresolved_leaves ul
      UNION
      SELECT r2.parent_region_id
      FROM has_unresolved_desc hud
      JOIN regions r2 ON r2.id = hud.region_id
      WHERE r2.parent_region_id IS NOT NULL
    )
    SELECT COUNT(*) FILTER (
             WHERE ris.match_status = 'needs_review'
               AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
           ) AS needs_review,
           COUNT(*) FILTER (
             WHERE ris.match_status = 'no_candidates'
               AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
               AND r.id IN (SELECT region_id FROM has_unresolved_desc)
           ) AS no_candidates
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.world_view_id = $1
  `, [worldViewId]);

  const needsReview = parseInt(unmatchedResult.rows[0].needs_review as string);
  const noCandidates = parseInt(unmatchedResult.rows[0].no_candidates as string);
  if (needsReview > 0 || noCandidates > 0) {
    res.status(400).json({
      error: `Cannot finalize: ${needsReview} regions need review, ${noCandidates} have no candidates`,
    });
    return;
  }

  // Derive finalized source_type from current (e.g. 'wikivoyage' -> 'wikivoyage_done')
  const result = await pool.query(
    `UPDATE world_views SET source_type = source_type || '_done', updated_at = NOW()
     WHERE id = $1 AND source_type IN ('wikivoyage', 'imported')
     RETURNING id, name`,
    [worldViewId],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'World view not found or already finalized' });
    return;
  }

  console.log(`[WV Import] Finalized review for worldView ${worldViewId}`);
  res.json({ finalized: true, worldViewId });
}

/**
 * Add a child region under a parent during hierarchy review.
 * POST /api/admin/wv-import/matches/:worldViewId/add-child-region
 */
export async function addChildRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId, name, sourceUrl, sourceExternalId } = req.body as {
    parentRegionId: number;
    name: string;
    sourceUrl?: string;
    sourceExternalId?: string;
  };
  console.log(`[WV Import] POST /matches/${worldViewId}/add-child-region — parent=${parentRegionId}, name="${name}"`);

  // Verify parent belongs to world view
  const parent = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [parentRegionId, worldViewId],
  );
  if (parent.rows.length === 0) {
    res.status(404).json({ error: 'Parent region not found in this world view' });
    return;
  }

  // Get import_run_id from parent's import state
  const parentState = await pool.query(
    'SELECT import_run_id FROM region_import_state WHERE region_id = $1',
    [parentRegionId],
  );
  const importRunId = parentState.rows[0]?.import_run_id ?? null;

  // Create child region
  const result = await pool.query(
    `INSERT INTO regions (world_view_id, name, parent_region_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [worldViewId, name, parentRegionId],
  );
  const regionId = result.rows[0].id as number;

  // Create region_import_state
  await pool.query(
    `INSERT INTO region_import_state (region_id, import_run_id, match_status, source_url, source_external_id)
     VALUES ($1, $2, 'no_candidates', $3, $4)`,
    [regionId, importRunId, sourceUrl ?? null, sourceExternalId ?? null],
  );

  res.json({ created: true, regionId });
}

/**
 * Dismiss hierarchy warnings for a region (mark as reviewed).
 * POST /api/admin/wv-import/matches/:worldViewId/dismiss-hierarchy-warnings
 */
export async function dismissHierarchyWarnings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body as { regionId: number };
  console.log(`[WV Import] POST /matches/${worldViewId}/dismiss-hierarchy-warnings — regionId=${regionId}`);

  // Verify region belongs to world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  await pool.query(
    `UPDATE region_import_state SET hierarchy_reviewed = true WHERE region_id = $1`,
    [regionId],
  );

  res.json({ dismissed: true });
}
