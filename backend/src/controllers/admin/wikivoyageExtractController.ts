/**
 * Admin Wikivoyage Extraction Controller
 *
 * Handles starting, monitoring, and cancelling Wikivoyage extractions.
 */

import type { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  startExtraction,
  getLatestExtractionStatus,
  cancelExtraction,
  getCacheInfo,
} from '../../services/wikivoyageExtract/index.js';

/**
 * Start a Wikivoyage extraction.
 * POST /api/admin/wv-extract/start
 */
export function startWikivoyageExtraction(req: AuthenticatedRequest, res: Response): void {
  const { name, useCache } = req.body as { name?: string; useCache?: boolean };

  // Check nothing is currently running
  const existing = getLatestExtractionStatus();
  if (existing && !isTerminal(existing.progress.status)) {
    res.status(409).json({
      error: 'An extraction is already running',
      operationId: existing.opId,
    });
    return;
  }

  const opId = startExtraction({
    name: name ?? 'Wikivoyage Regions',
    useCache: useCache ?? true,
  });
  res.json({ started: true, operationId: opId });
}

/**
 * Get extraction status (also returns existing imported world views).
 * GET /api/admin/wv-extract/status
 */
export async function getWikivoyageExtractionStatus(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const latest = getLatestExtractionStatus();

  // Query existing imported world views from DB
  const wvResult = await pool.query(`
    SELECT wv.id, wv.name, wv.source_type
    FROM world_views wv
    WHERE wv.source_type IN ('wikivoyage', 'wikivoyage_done', 'imported', 'imported_done')
    ORDER BY wv.id DESC
  `);

  const importedWorldViews = wvResult.rows.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    sourceType: row.source_type as string,
    reviewComplete: (row.source_type as string).endsWith('_done'),
  }));

  const cache = getCacheInfo();

  if (!latest) {
    res.json({ running: false, importedWorldViews, cache });
    return;
  }

  const { progress } = latest;
  const running = !isTerminal(progress.status);

  res.json({
    running,
    operationId: latest.opId,
    status: progress.status,
    statusMessage: progress.statusMessage,
    regionsFetched: progress.regionsFetched,
    estimatedTotal: progress.estimatedTotal,
    currentPage: progress.currentPage,
    apiRequests: progress.apiRequests,
    cacheHits: progress.cacheHits,
    createdRegions: progress.createdRegions,
    totalRegions: progress.totalRegions,
    countriesMatched: progress.countriesMatched,
    totalCountries: progress.totalCountries,
    subdivisionsDrilled: progress.subdivisionsDrilled,
    noCandidates: progress.noCandidates,
    worldViewId: progress.worldViewId,
    importedWorldViews,
    cache,
  });
}

/**
 * Cancel a running extraction.
 * POST /api/admin/wv-extract/cancel
 */
export function cancelWikivoyageExtraction(_req: AuthenticatedRequest, res: Response): void {
  const cancelled = cancelExtraction();
  res.json({ cancelled });
}

function isTerminal(status: string): boolean {
  return status === 'complete' || status === 'failed' || status === 'cancelled';
}
