/**
 * WorldView Import Lifecycle Controller
 *
 * Handles geoshape proxy, starting/stopping/polling imports.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  startImport,
  getLatestImportStatus,
  cancelImport,
} from '../../services/worldViewImport/index.js';

// =============================================================================
// Geoshape proxy
// =============================================================================

/**
 * Proxy Wikidata geoshape GeoJSON for a given Wikidata ID.
 * GET /api/admin/wv-import/geoshape/:wikidataId
 *
 * The maps.wikimedia.org endpoint requires User-Agent + Referer headers
 * that browsers won't send cross-origin, so we proxy through the backend.
 */
export async function getGeoshape(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { wikidataId } = req.params;

  try {
    // Check local cache first (includes composite geoshapes built from children)
    const cached = await pool.query(
      `SELECT ST_AsGeoJSON(geom)::json AS geometry
       FROM wikidata_geoshapes
       WHERE wikidata_id = $1 AND not_available = FALSE AND geom IS NOT NULL`,
      [wikidataId],
    );
    if (cached.rows.length > 0 && cached.rows[0].geometry) {
      res.json({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { id: wikidataId }, geometry: cached.rows[0].geometry }],
      });
      return;
    }

    // Fall back to Wikimedia
    const url = `https://maps.wikimedia.org/geoshape?getgeojson=1&ids=${wikidataId}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions)',
        'Referer': 'https://en.wikivoyage.org/',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Geoshape fetch failed: ${response.statusText}` });
      return;
    }

    const geojson = await response.json();
    res.json(geojson);
  } catch (err) {
    console.error(`[WV Import] Geoshape fetch error for ${wikidataId}:`, err);
    res.status(502).json({ error: 'Failed to fetch geoshape from Wikimedia' });
  }
}

// =============================================================================
// Import endpoints
// =============================================================================

/** Count nodes and max depth in a tree (for size validation) */
function treeStats(node: { children?: unknown[] }, depth = 0): { nodes: number; maxDepth: number } {
  let nodes = 1;
  let maxDepth = depth;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const stats = treeStats(child as { children?: unknown[] }, depth + 1);
    nodes += stats.nodes;
    if (stats.maxDepth > maxDepth) maxDepth = stats.maxDepth;
  }
  return { nodes, maxDepth };
}

const MAX_TREE_NODES = 50_000;
const MAX_TREE_DEPTH = 15;

/**
 * Start a world view import from JSON data.
 * POST /api/admin/wv-import/import
 */
export async function startWorldViewImport(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { name, tree, matchingPolicy } = req.body;
  console.log(`[WV Import] POST /import — name="${name}", children count=${tree?.children?.length ?? 'N/A'}, policy=${matchingPolicy ?? 'country-based'}`);

  // Zod handles structural validation; check size limits
  const stats = treeStats(tree);
  if (stats.nodes > MAX_TREE_NODES) {
    res.status(400).json({ error: `Tree too large: ${stats.nodes} nodes exceeds limit of ${MAX_TREE_NODES}` });
    return;
  }
  if (stats.maxDepth > MAX_TREE_DEPTH) {
    res.status(400).json({ error: `Tree too deep: depth ${stats.maxDepth} exceeds limit of ${MAX_TREE_DEPTH}` });
    return;
  }

  // Check no import is already running
  const existing = getLatestImportStatus();
  if (existing && (existing.progress.status === 'importing' || existing.progress.status === 'matching')) {
    res.status(409).json({ error: 'An import is already running' });
    return;
  }

  const opId = startImport(tree, name, {
    matchingPolicy: matchingPolicy ?? 'country-based',
    sourceType: 'imported',
    source: 'File upload',
  });
  console.log(`[WV Import] POST /import — started opId=${opId}`);
  res.json({ started: true, operationId: opId });
}

/**
 * Get import status.
 * GET /api/admin/wv-import/import/status
 *
 * Returns in-memory progress when an import is running/recently completed,
 * otherwise falls back to querying DB for existing imported world views
 * so the review UI survives page reloads and re-logins.
 */
export async function getWorldViewImportStatus(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const status = getLatestImportStatus();

  // Always fetch existing imported world views from DB (both active and finalized)
  const result = await pool.query(`
    SELECT id, name, source_type FROM world_views
    WHERE source_type IN ('wikivoyage', 'wikivoyage_done', 'imported', 'imported_done')
    ORDER BY id DESC
  `);
  const importedWorldViews = result.rows.length > 0
    ? result.rows.map(r => ({
        id: r.id as number,
        name: r.name as string,
        sourceType: r.source_type as string,
        reviewComplete: (r.source_type as string).endsWith('_done'),
      }))
    : undefined;

  if (status) {
    const isActive = status.progress.status === 'importing' || status.progress.status === 'matching';
    console.log(`[WV Import] GET /import/status — opId=${status.opId}, status=${status.progress.status}, running=${isActive}, regions=${status.progress.createdRegions}/${status.progress.totalRegions}, countries=${status.progress.countriesMatched}/${status.progress.totalCountries}`);
    res.json({ running: isActive, operationId: status.opId, ...status.progress, importedWorldViews });
    return;
  }

  res.json({ running: false, importedWorldViews });
}

/**
 * Cancel a running import.
 * POST /api/admin/wv-import/import/cancel
 */
export async function cancelWorldViewImport(_req: AuthenticatedRequest, res: Response): Promise<void> {
  console.log(`[WV Import] POST /import/cancel`);
  const cancelled = cancelImport();
  console.log(`[WV Import] POST /import/cancel — result: ${cancelled}`);
  res.json({ cancelled });
}
