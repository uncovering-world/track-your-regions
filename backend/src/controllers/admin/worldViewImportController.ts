/**
 * Admin WorldView Import Controller
 *
 * Handles importing region hierarchies and matching
 * leaf regions to GADM divisions.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { matchCountryLevel } from '../../services/worldViewImport/index.js';
import { createInitialProgress, type ImportProgress } from '../../services/worldViewImport/types.js';

/**
 * Finalize review — mark the world view as done.
 * Appends '_done' to current source_type (e.g. 'wikivoyage' → 'wikivoyage_done', 'imported' → 'imported_done').
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

  // Derive finalized source_type from current (e.g. 'wikivoyage' → 'wikivoyage_done')
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

/** In-memory progress for re-matching */
const runningRematches = new Map<number, { progress: ImportProgress; startTime: number }>();

/**
 * Re-run country-level matching on an existing world view.
 * Clears all match metadata and region_members, then re-runs the matcher.
 * POST /api/admin/wv-import/matches/:worldViewId/rematch
 */
export async function rematchWorldView(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] POST /matches/${worldViewId}/rematch`);

  // Check world view exists and is import-sourced
  const wvCheck = await pool.query(
    `SELECT id FROM world_views WHERE id = $1 AND source_type IN ('wikivoyage', 'wikivoyage_done', 'imported', 'imported_done')`,
    [worldViewId],
  );
  if (wvCheck.rows.length === 0) {
    res.status(404).json({ error: 'Imported world view not found' });
    return;
  }

  // Check no rematch is already running
  const existing = runningRematches.get(worldViewId);
  if (existing && existing.progress.status === 'matching') {
    res.status(409).json({ error: 'Re-matching is already running for this world view' });
    return;
  }

  const progress = createInitialProgress();
  progress.status = 'matching';
  progress.statusMessage = 'Resetting match data...';
  runningRematches.set(worldViewId, { progress, startTime: Date.now() });

  // Run in background
  runRematch(worldViewId, progress).catch((err) => {
    console.error(`[WV Import] Rematch error for worldView ${worldViewId}:`, err);
    progress.status = 'failed';
    progress.statusMessage = `Re-match failed: ${err instanceof Error ? err.message : String(err)}`;
  }).finally(() => {
    const thisEntry = runningRematches.get(worldViewId);
    setTimeout(() => {
      if (runningRematches.get(worldViewId) === thisEntry) {
        runningRematches.delete(worldViewId);
      }
    }, 300_000);
  });

  res.json({ started: true });
}

async function runRematch(worldViewId: number, progress: ImportProgress): Promise<void> {
  const startTime = Date.now();

  // Step 1: Reset all match metadata and region_members
  console.log(`[WV Import Rematch] Resetting match data for worldView ${worldViewId}...`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete all region_members for this world view
    await client.query(`
      DELETE FROM region_members
      WHERE region_id IN (SELECT id FROM regions WHERE world_view_id = $1)
    `, [worldViewId]);

    // Delete all suggestions for this world view
    await client.query(`
      DELETE FROM region_match_suggestions
      WHERE region_id IN (SELECT id FROM regions WHERE world_view_id = $1)
    `, [worldViewId]);

    // Reset match status (keep source_url, region_map_url, etc.)
    await client.query(`
      UPDATE region_import_state SET match_status = 'no_candidates'
      WHERE region_id IN (SELECT id FROM regions WHERE world_view_id = $1)
    `, [worldViewId]);

    // Clear dismissed coverage gaps (re-match resets all state)
    await client.query(
      `UPDATE world_views SET dismissed_coverage_ids = '{}' WHERE id = $1`,
      [worldViewId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const resetDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[WV Import Rematch] Reset complete in ${resetDuration}s`);

  // Step 2: Re-run country-level matching
  progress.statusMessage = 'Re-matching countries to GADM...';
  await matchCountryLevel(worldViewId, progress);

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  progress.status = 'complete';
  progress.statusMessage = `Re-match complete: ${progress.countriesMatched} countries matched (${progress.subdivisionsDrilled} with subdivisions), ${progress.noCandidates} unmatched. Took ${totalDuration}s.`;
  console.log(`[WV Import Rematch] Complete in ${totalDuration}s: matched=${progress.countriesMatched}, drilldowns=${progress.subdivisionsDrilled}, none=${progress.noCandidates}`);
}

/**
 * Get re-match progress.
 * GET /api/admin/wv-import/matches/:worldViewId/rematch/status
 */
export function getRematchStatus(req: AuthenticatedRequest, res: Response): void {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const entry = runningRematches.get(worldViewId);
  if (entry) {
    res.json({
      status: entry.progress.status,
      statusMessage: entry.progress.statusMessage,
      countriesMatched: entry.progress.countriesMatched,
      totalCountries: entry.progress.totalCountries,
      noCandidates: entry.progress.noCandidates,
    });
  } else {
    res.json({ status: 'idle' });
  }
}

// =============================================================================
// Domain-split barrel (see ADR-0009)
// =============================================================================
export {
  getGeoshape,
  startWorldViewImport,
  getWorldViewImportStatus,
  cancelWorldViewImport,
} from './wvImportLifecycleController.js';
export {
  getMatchStats,
  acceptMatch,
  rejectMatch,
  rejectRemaining,
  acceptAndRejectRest,
  acceptBatchMatches,
  getMatchTree,
  selectMapImage,
  markManualFix,
} from './wvImportMatchController.js';
export {
  getCoverage,
  getCoverageSSE,
  geoSuggestGap,
  dismissCoverageGap,
  undismissCoverageGap,
  approveCoverageSuggestion,
} from './wvImportCoverageController.js';
export {
  startAIMatch,
  getAIMatchStatus,
  cancelAIMatchEndpoint,
  dbSearchOneRegion,
  geocodeMatch,
  resetMatch,
  aiMatchOneRegion,
} from './wvImportAIController.js';
export { dismissChildren } from './wvImportTreeOpsController.js';
export { undoLastOperation } from './wvImportHierarchyController.js';
export { syncInstances, handleAsGrouping } from './wvImportFlattenController.js';
