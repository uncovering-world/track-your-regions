/**
 * WorldView Import Rematch Controller
 *
 * Re-run country-level matching on an existing world view.
 * Clears all match metadata and region_members, then re-runs the matcher.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  matchCountryLevel,
} from '../../services/worldViewImport/index.js';
import { createInitialProgress, type ImportProgress } from '../../services/worldViewImport/types.js';

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
