/**
 * Admin WorldView Import — AI Match controller
 *
 * Owns: AI-assisted matching endpoints (start/status/cancel), single-region
 * fallbacks (DB search, geocode), reset, and AI-match-one-region.
 * See ADR-0009 for the domain-split rationale.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  startAIMatching,
  getAIMatchProgress,
  cancelAIMatch,
  aiMatchSingleRegion,
  dbSearchSingleRegion,
  geocodeMatchRegion,
} from '../../services/worldViewImport/aiMatcher.js';
import { isOpenAIAvailable } from '../../services/ai/openaiService.js';
import { geoshapeMatchRegion, computeGeoSimilarityForRegion } from '../../services/worldViewImport/geoshapeCache.js';
import { pointMatchRegion } from '../../services/worldViewImport/pointMatcher.js';

// =============================================================================
// AI match orchestration
// =============================================================================

/**
 * Start AI-assisted re-matching for unresolved leaves.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-match
 */
export async function startAIMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-match`);

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI API is not configured' });
    return;
  }

  // Check no AI match is already running for this world view
  const existing = getAIMatchProgress(worldViewId);
  if (existing && existing.status === 'running') {
    res.status(409).json({ error: 'AI matching is already running for this world view' });
    return;
  }

  const progress = startAIMatching(worldViewId);
  res.json({ started: true, ...progress });
}

/**
 * Get AI matching progress.
 * GET /api/admin/wv-import/matches/:worldViewId/ai-match/status
 */
export function getAIMatchStatus(req: AuthenticatedRequest, res: Response): void {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const progress = getAIMatchProgress(worldViewId);
  if (progress) {
    res.json(progress);
  } else {
    res.json({ status: 'idle' });
  }
}

/**
 * Cancel AI matching.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-match/cancel
 */
export function cancelAIMatchEndpoint(req: AuthenticatedRequest, res: Response): void {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const cancelled = cancelAIMatch(worldViewId);
  res.json({ cancelled });
}

// =============================================================================
// Single-region operations
// =============================================================================

/**
 * DB search a single region using trigram similarity.
 * POST /api/admin/wv-import/matches/:worldViewId/db-search-one
 */
export async function dbSearchOneRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/db-search-one — regionId=${regionId}`);

  try {
    const result = await dbSearchSingleRegion(worldViewId, regionId);
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] DB search one failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB search failed' });
  }
}

/**
 * Geocode-match a single region: name → Nominatim coordinates → ST_Contains on GADM.
 * POST /api/admin/wv-import/matches/:worldViewId/geocode-match
 */
export async function geocodeMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geocode-match — regionId=${regionId}`);

  try {
    const result = await geocodeMatchRegion(worldViewId, regionId);
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Geocode match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Geocode match failed' });
  }
}

/**
 * Reset match state for a single region (clear suggestions, rejections, status).
 * POST /api/admin/wv-import/matches/:worldViewId/reset-match
 */
export async function resetMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reset-match — regionId=${regionId}`);

  // Verify region belongs to this world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Also remove any region_members assignments for this region
  await pool.query(`DELETE FROM region_members WHERE region_id = $1`, [regionId]);

  // Delete all suggestions (both accepted and rejected)
  await pool.query(
    `DELETE FROM region_match_suggestions WHERE region_id = $1`,
    [regionId],
  );

  // Reset match status
  await pool.query(
    `UPDATE region_import_state SET match_status = 'no_candidates' WHERE region_id = $1`,
    [regionId],
  );

  res.json({ reset: true });
}

/**
 * AI-match a single region.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-match-one
 */
export async function aiMatchOneRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-match-one — regionId=${regionId}`);

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI API is not configured' });
    return;
  }

  try {
    const result = await aiMatchSingleRegion(worldViewId, regionId);
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] AI match one failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI matching failed' });
  }
}

// =============================================================================
// Geo similarity helper
// =============================================================================

/**
 * Compute geo similarity if the region now has multiple suggestions.
 * Called after geoshape/point match to score and auto-accept/reject candidates.
 */
async function computeGeoSimilarityIfNeeded(regionId: number): Promise<void> {
  const sugResult = await pool.query(
    `SELECT division_id AS "divisionId" FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  if (sugResult.rows.length <= 1) return;

  const client = await pool.connect();
  try {
    await computeGeoSimilarityForRegion(client, regionId, sugResult.rows as Array<{ divisionId: number }>);
  } finally {
    client.release();
  }
}

// =============================================================================
// Geoshape and point matching
// =============================================================================

/**
 * Match a region by comparing its Wikidata geoshape geometry against GADM divisions.
 * Scopes search to the relevant GADM subtree for performance.
 * POST /api/admin/wv-import/matches/:worldViewId/geoshape-match
 */
export async function geoshapeMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, scopeAncestorId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geoshape-match — regionId=${regionId}${scopeAncestorId ? ` scopeAncestorId=${scopeAncestorId}` : ''}`);

  try {
    const result = await geoshapeMatchRegion(worldViewId, regionId, scopeAncestorId);
    // Compute geo similarity if region now has multiple suggestions
    if (result.found > 0) {
      await computeGeoSimilarityIfNeeded(regionId);
    }
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Geoshape match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Geoshape match failed' });
  }
}

/**
 * Match a region using Wikivoyage marker coordinates → GADM point containment.
 * POST /api/admin/wv-import/matches/:worldViewId/point-match
 */
export async function pointMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/point-match — regionId=${regionId}`);

  try {
    const result = await pointMatchRegion(worldViewId, regionId);
    if (result.found > 0) {
      await computeGeoSimilarityIfNeeded(regionId);
    }
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Point match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Point match failed' });
  }
}
