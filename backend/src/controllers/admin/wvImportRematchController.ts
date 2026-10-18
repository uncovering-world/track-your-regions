/**
 * Admin WorldView Import — Rematch controller
 *
 * Owns: re-run the matcher after improvements.
 * - rematchWorldView: starts a background re-match pass for a world view
 * - runRematch: private helper that resets match data and re-runs matching
 * - getRematchStatus: returns the current progress of a running rematch
 * - cancelRematch: stops a running rematch (#1613)
 * See ADR-0009 for the domain-split rationale.
 */

import type { z } from 'zod/v4';
import { pool } from '../../db/index.js';
import type { RematchCancelled, RematchStarted, RematchStatus } from '../../api/responses/worldViewImport.js';
import { createError, notFound } from '../../middleware/errorHandler.js';
import type { worldViewIdParamSchema, wvImportRematchBodySchema } from '../../types/index.js';
import { MATCH_RUN_STEPS, runMatchingPolicy } from '../../services/worldViewImport/index.js';
import { Operation, operationAnswer } from '../../services/operationProgress.js';
import { spatialSentence } from '../../services/worldViewImport/spatialPass.js';
import { createInitialProgress, type ImportProgress, type MatchingPolicy } from '../../services/worldViewImport/types.js';
import { IMPORT_SOURCE_TYPES_ALL, defaultMatchingPolicy } from '../../services/worldViewImport/sourceTypes.js';

// =============================================================================
// Rematch (run + status)
// =============================================================================

/** In-memory progress for re-matching */
const runningRematches = new Map<number, { progress: ImportProgress; startTime: number }>();

/**
 * Re-run matching on an existing world view.
 * Clears all match metadata and region_members, then re-runs the matcher.
 * POST /api/admin/wv-import/matches/:worldViewId/rematch
 *
 * The policy defaults to the one the source type's tree is shaped for, so a
 * re-match reproduces the import rather than quietly switching algorithms.
 * `matchingPolicy` in the body
 * overrides it, which is how one tree gets scored under two policies.
 *
 * Destructive by design: every `region_members` row for the world view is
 * deleted, including manually accepted matches. Hand-resolve *after* a re-match,
 * never before.
 */
export async function rematchWorldView(
  { params: { worldViewId }, body: { matchingPolicy: requested } }: {
    params: z.output<typeof worldViewIdParamSchema>;
    body: z.output<typeof wvImportRematchBodySchema>;
  },
): Promise<RematchStarted> {
  console.log(`[WV Import] POST /matches/${worldViewId}/rematch`);

  // Check world view exists and is import-sourced
  const wvCheck = await pool.query<{ id: number; source_type: string }>(
    `SELECT id, source_type FROM world_views WHERE id = $1 AND source_type = ANY($2)`,
    [worldViewId, IMPORT_SOURCE_TYPES_ALL],
  );
  if (wvCheck.rows.length === 0) {
    throw notFound('Imported world view not found');
  }

  // Check no rematch is already running
  const existing = runningRematches.get(worldViewId);
  if (existing && existing.progress.status === 'matching') {
    throw createError('Re-matching is already running for this world view', 409);
  }

  const policy: MatchingPolicy = requested ?? defaultMatchingPolicy(wvCheck.rows[0].source_type);

  const progress = createInitialProgress();
  progress.status = 'matching';
  progress.statusMessage = 'Resetting match data...';
  progress.operation = new Operation(`[WV Import Rematch] World view ${worldViewId}:`, Object.keys(MATCH_RUN_STEPS).length);
  runningRematches.set(worldViewId, { progress, startTime: Date.now() });

  // Run in background
  runRematch(worldViewId, progress, policy).catch((err) => {
    console.error('[WV Import] Rematch error for worldView %d:', worldViewId, err);
    progress.status = 'failed';
    progress.statusMessage = 'Re-match failed; the server log has the cause.';
    progress.operation?.finish('failed');
  }).finally(() => {
    const thisEntry = runningRematches.get(worldViewId);
    setTimeout(() => {
      if (runningRematches.get(worldViewId) === thisEntry) {
        runningRematches.delete(worldViewId);
      }
    }, 300_000);
  });

  return { started: true, matchingPolicy: policy };
}

async function runRematch(
  worldViewId: number,
  progress: ImportProgress,
  policy: MatchingPolicy,
): Promise<void> {
  const startTime = Date.now();

  // Step 1: Reset all match metadata and region_members
  progress.operation?.step(MATCH_RUN_STEPS.first, 'Resetting the match data');
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

  // Step 2: Re-run matching under the world view's policy
  if (policy === 'none') {
    progress.status = 'complete';
    progress.statusMessage = 'Match data reset; matching skipped (policy=none).';
    progress.operation?.finish(progress.statusMessage);
    return;
  }
  progress.statusMessage = `Re-matching to GADM (policy=${policy})...`;
  const { cancelled, spatial } = await runMatchingPolicy(policy, worldViewId, progress);
  // A cancel the name matcher saw: it wrote nothing, so the world view is as
  // the reset above left it. A cancel during the spatial pass only stopped the
  // scoring, and the run below finishes with where it stopped (`spatialSentence`).
  if (cancelled) {
    progress.status = 'cancelled';
    progress.statusMessage = 'Re-match cancelled while matching by name: nothing was matched, '
      + 'so every region is unmatched, as the reset left it. Re-match again, or match regions by hand.';
    progress.operation?.finish('cancelled while matching by name');
    return;
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  progress.status = 'complete';
  // Only the country policy fills the country-named counters, so only it can be
  // summarised in their terms. Rebuilding this message for every policy is what
  // made a 3831-region hierarchical re-match report "0 countries matched" — the
  // policy's own message is the accurate one, and it is what the review UI
  // renders verbatim.
  progress.statusMessage = policy === 'country-based'
    ? `Re-match complete: ${progress.countriesMatched} countries matched (${progress.subdivisionsDrilled} with subdivisions), ${progress.noCandidates} unmatched. Took ${totalDuration}s.`
    : `${progress.statusMessage} (total ${totalDuration}s)`;
  if (spatial) progress.statusMessage += spatialSentence(spatial);
  progress.operation?.finish(progress.statusMessage);
}

/**
 * Cancel a running re-match of a world view (#1613), which since the spatial
 * pass (#622) can take hours: answers whether one was running to stop.
 * POST /api/admin/wv-import/matches/:worldViewId/rematch/cancel
 */
export async function cancelRematch(
  { params: { worldViewId } }: { params: z.output<typeof worldViewIdParamSchema> },
): Promise<RematchCancelled> {
  const entry = runningRematches.get(worldViewId);
  if (!entry || entry.progress.status !== 'matching') return { cancelled: false };
  entry.progress.cancel = true;
  entry.progress.operation?.cancel();
  return { cancelled: true };
}

/**
 * Get re-match progress.
 * GET /api/admin/wv-import/matches/:worldViewId/rematch/status
 */
export async function getRematchStatus(
  { params: { worldViewId } }: { params: z.output<typeof worldViewIdParamSchema> },
): Promise<RematchStatus> {
  const entry = runningRematches.get(worldViewId);
  if (!entry) return { status: 'idle' };
  return {
    status: entry.progress.status,
    statusMessage: entry.progress.statusMessage,
    countriesMatched: entry.progress.countriesMatched,
    totalCountries: entry.progress.totalCountries,
    noCandidates: entry.progress.noCandidates,
    ...(entry.progress.operation ? { operation: operationAnswer(entry.progress.operation.progress) } : {}),
  };
}
