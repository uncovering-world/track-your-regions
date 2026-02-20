/**
 * Admin WorldView Import Controller
 *
 * Handles importing region hierarchies and matching
 * leaf regions to GADM divisions.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  startImport,
  getLatestImportStatus,
  cancelImport,
  matchCountryLevel,
  matchChildrenAsCountries,
} from '../../services/worldViewImport/index.js';
import { createInitialProgress, type ImportProgress } from '../../services/worldViewImport/types.js';
import { syncImportMatchStatus } from '../worldView/helpers.js';

// =============================================================================
// Undo infrastructure
// =============================================================================

interface ImportStateSnapshot {
  region_id: number;
  match_status: string;
  needs_manual_fix: boolean;
  fix_note: string | null;
  source_url: string | null;
  source_external_id: string | null;
  region_map_url: string | null;
  map_image_reviewed: boolean;
  import_run_id: number | null;
}

interface SuggestionSnapshot {
  region_id: number;
  division_id: number;
  name: string;
  path: string | null;
  score: number;
  rejected: boolean;
}

interface UndoEntry {
  operation: 'dismiss-children' | 'handle-as-grouping';
  regionId: number;
  timestamp: number;
  // Import state snapshots
  parentImportState: ImportStateSnapshot | null;
  parentMembers: Array<{ region_id: number; division_id: number }>;
  descendantRegions: Array<{
    id: number;
    name: string;
    parent_region_id: number | null;
    is_leaf: boolean;
    world_view_id: number;
  }>;
  descendantImportStates: ImportStateSnapshot[];
  descendantSuggestions: SuggestionSnapshot[];
  descendantMembers: Array<{ region_id: number; division_id: number }>;
  childSnapshots: Array<{
    regionId: number;
    importState: ImportStateSnapshot | null;
    suggestions: SuggestionSnapshot[];
    members: Array<{ region_id: number; division_id: number }>;
  }>;
}

/** One undo entry per world view (last operation only) */
const undoEntries = new Map<number, UndoEntry>();

import {
  startAIMatching,
  getAIMatchProgress,
  cancelAIMatch,
  aiMatchSingleRegion,
  dbSearchSingleRegion,
  geocodeMatchRegion,
} from '../../services/worldViewImport/aiMatcher.js';
import { isOpenAIAvailable } from '../../services/ai/openaiService.js';

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

/**
 * Start a world view import from JSON data.
 * POST /api/admin/wv-import/import
 */
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
      COUNT(*) AS total_regions
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

      // Update import state
      await client.query(
        `UPDATE region_import_state SET match_status = 'manual_matched' WHERE region_id = $1`,
        [regionId],
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
      (SELECT COALESCE(json_agg(json_build_object(
        'divisionId', rms.division_id, 'name', rms.name, 'path', rms.path, 'score', rms.score
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
    suggestions: Array<{ divisionId: number; name: string; path: string; score: number }>;
    sourceUrl: string | null;
    regionMapUrl: string | null;
    mapImageCandidates: string[];
    mapImageReviewed: boolean;
    needsManualFix: boolean;
    fixNote: string | null;
    wikidataId: string | null;
    memberCount: number;
    assignedDivisions: Array<{ divisionId: number; name: string; path: string; hasCustomGeom: boolean }>;
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
 * Dismiss all child regions, making the parent a leaf.
 * POST /api/admin/wv-import/matches/:worldViewId/dismiss-children
 */
export async function dismissChildren(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/dismiss-children — regionId=${regionId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region belongs to this world view
    const region = await client.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    // Get all descendant region IDs (recursive)
    const descendants = await client.query(`
      WITH RECURSIVE desc_regions AS (
        SELECT id FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT r.id FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      SELECT id FROM desc_regions
    `, [regionId]);

    if (descendants.rows.length === 0) {
      res.status(400).json({ error: 'Region has no children to dismiss' });
      return;
    }

    const descendantIds = descendants.rows.map(r => r.id as number);

    // Snapshot for undo: parent import state + members, all descendant regions + import state + suggestions + members
    const parentImportStateResult = await client.query(
      `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
              region_map_url, map_image_reviewed, import_run_id
       FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const parentImportState = parentImportStateResult.rows.length > 0
      ? parentImportStateResult.rows[0] as ImportStateSnapshot
      : null;
    const parentMembersResult = await client.query(
      'SELECT region_id, division_id FROM region_members WHERE region_id = $1',
      [regionId],
    );
    const descRegionsResult = await client.query(
      `SELECT id, name, parent_region_id, is_leaf, world_view_id
       FROM regions WHERE id = ANY($1)
       ORDER BY id`,
      [descendantIds],
    );
    const descImportStatesResult = await client.query(
      `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
              region_map_url, map_image_reviewed, import_run_id
       FROM region_import_state WHERE region_id = ANY($1)`,
      [descendantIds],
    );
    const descSuggestionsResult = await client.query(
      `SELECT region_id, division_id, name, path, score, rejected
       FROM region_match_suggestions WHERE region_id = ANY($1)`,
      [descendantIds],
    );
    const descMembersResult = await client.query(
      'SELECT region_id, division_id FROM region_members WHERE region_id = ANY($1)',
      [descendantIds],
    );

    // Remove region_members for all descendants (CASCADE on region_import_state/suggestions handles the rest)
    await client.query(
      'DELETE FROM region_members WHERE region_id = ANY($1)',
      [descendantIds],
    );

    // Delete descendant regions (children first due to FK — recursive CTE already gives us all)
    // CASCADE deletes region_import_state, region_match_suggestions, region_map_images
    await client.query(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, 1 AS depth FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT r.id, d.depth + 1 FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      DELETE FROM regions WHERE id IN (SELECT id FROM desc_regions ORDER BY depth DESC)
    `, [regionId]);

    // Update parent: clear children-related status, set to no_candidates
    await client.query(
      `UPDATE region_import_state SET match_status = 'no_candidates' WHERE region_id = $1`,
      [regionId],
    );
    await client.query(
      `DELETE FROM region_match_suggestions WHERE region_id = $1`,
      [regionId],
    );

    await client.query('COMMIT');

    // Store undo entry
    undoEntries.set(worldViewId, {
      operation: 'dismiss-children',
      regionId,
      timestamp: Date.now(),
      parentImportState: parentImportState,
      parentMembers: parentMembersResult.rows as Array<{ region_id: number; division_id: number }>,
      descendantRegions: descRegionsResult.rows as UndoEntry['descendantRegions'],
      descendantImportStates: descImportStatesResult.rows as ImportStateSnapshot[],
      descendantSuggestions: descSuggestionsResult.rows as SuggestionSnapshot[],
      descendantMembers: descMembersResult.rows as Array<{ region_id: number; division_id: number }>,
      childSnapshots: [],
    });

    console.log(`[WV Import] Dismissed ${descendantIds.length} descendants of region ${regionId}`);
    res.json({ dismissed: descendantIds.length, undoAvailable: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sync match decisions to other instances of the same imported region.
 * Copies matchStatus, suggestions, and region_members from the source
 * to all other regions with the same sourceUrl in this world view.
 * POST /api/admin/wv-import/matches/:worldViewId/sync-instances
 */
export async function syncInstances(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/sync-instances — regionId=${regionId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get source region's import state
    const source = await client.query(
      `SELECT r.id FROM regions r WHERE r.id = $1 AND r.world_view_id = $2`,
      [regionId, worldViewId],
    );
    if (source.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    const sourceImportState = await client.query(
      `SELECT source_url, match_status FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const sourceUrl = sourceImportState.rows[0]?.source_url as string | undefined;
    if (!sourceUrl) {
      res.status(400).json({ error: 'Region has no sourceUrl' });
      return;
    }
    const matchStatus = sourceImportState.rows[0].match_status as string;

    // Find other instances (same sourceUrl, different id)
    const siblings = await client.query(
      `SELECT r.id FROM regions r
       JOIN region_import_state ris ON ris.region_id = r.id
       WHERE r.world_view_id = $1 AND r.id != $2 AND ris.source_url = $3`,
      [worldViewId, regionId, sourceUrl],
    );

    if (siblings.rows.length === 0) {
      res.json({ synced: 0 });
      return;
    }

    // Get source region_members and suggestions
    const sourceMembers = await client.query(
      `SELECT division_id FROM region_members WHERE region_id = $1`,
      [regionId],
    );
    const divisionIds = sourceMembers.rows.map(r => r.division_id as number);

    const sourceSuggestions = await client.query(
      `SELECT division_id, name, path, score, rejected
       FROM region_match_suggestions WHERE region_id = $1`,
      [regionId],
    );

    // Copy to each sibling
    for (const sibling of siblings.rows) {
      const siblingId = sibling.id as number;

      // Update import state
      await client.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [matchStatus, siblingId],
      );

      // Sync suggestions: delete old, insert copies from source
      await client.query(
        `DELETE FROM region_match_suggestions WHERE region_id = $1`,
        [siblingId],
      );
      for (const sugg of sourceSuggestions.rows) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [siblingId, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected],
        );
      }

      // Sync region_members: remove existing, insert source's members
      await client.query(
        `DELETE FROM region_members WHERE region_id = $1`,
        [siblingId],
      );
      for (const divId of divisionIds) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [siblingId, divId],
        );
      }
    }

    await client.query('COMMIT');

    const syncedCount = siblings.rows.length;
    console.log(`[WV Import] Synced ${syncedCount} instances of ${sourceUrl}`);
    res.json({ synced: syncedCount });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Drill into a region's children — match them independently against GADM.
 * Clears the parent's own match, marks as children_matched, and runs
 * country-level matching on each child.
 * POST /api/admin/wv-import/matches/:worldViewId/handle-as-grouping
 */
export async function handleAsGrouping(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/handle-as-grouping — regionId=${regionId}`);

  // Verify region exists and belongs to this world view
  const region = await pool.query(
    'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Verify it has children
  const childCount = await pool.query(
    'SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (parseInt(childCount.rows[0].count as string) === 0) {
    res.status(400).json({ error: 'Region has no children to match as countries' });
    return;
  }

  try {
    // Snapshot for undo: parent import state + members, children import state + suggestions + members
    const parentImportStateResult = await pool.query(
      `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
              region_map_url, map_image_reviewed, import_run_id
       FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const parentImportState = parentImportStateResult.rows.length > 0
      ? parentImportStateResult.rows[0] as ImportStateSnapshot
      : null;
    const parentMembersSnap = await pool.query(
      'SELECT region_id, division_id FROM region_members WHERE region_id = $1',
      [regionId],
    );
    const childRegions = await pool.query(
      'SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    const childSnaps: UndoEntry['childSnapshots'] = [];
    for (const child of childRegions.rows) {
      const childId = child.id as number;
      const childImportStateResult = await pool.query(
        `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
                region_map_url, map_image_reviewed, import_run_id
         FROM region_import_state WHERE region_id = $1`,
        [childId],
      );
      const childSuggestionsResult = await pool.query(
        `SELECT division_id, name, path, score, rejected
         FROM region_match_suggestions WHERE region_id = $1`,
        [childId],
      );
      const childMembers = await pool.query(
        'SELECT region_id, division_id FROM region_members WHERE region_id = $1',
        [childId],
      );
      childSnaps.push({
        regionId: childId,
        importState: childImportStateResult.rows.length > 0
          ? childImportStateResult.rows[0] as ImportStateSnapshot
          : null,
        suggestions: childSuggestionsResult.rows as SuggestionSnapshot[],
        members: childMembers.rows as Array<{ region_id: number; division_id: number }>,
      });
    }

    const result = await matchChildrenAsCountries(worldViewId, regionId);

    // Store undo entry after successful matching
    undoEntries.set(worldViewId, {
      operation: 'handle-as-grouping',
      regionId,
      timestamp: Date.now(),
      parentImportState: parentImportState,
      parentMembers: parentMembersSnap.rows as Array<{ region_id: number; division_id: number }>,
      descendantRegions: [],
      descendantImportStates: [],
      descendantSuggestions: [],
      descendantMembers: [],
      childSnapshots: childSnaps,
    });

    console.log(`[WV Import] handle-as-grouping result: ${result.matched}/${result.total} children matched`);
    res.json({ ...result, undoAvailable: true });
  } catch (err) {
    console.error(`[WV Import] handle-as-grouping failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Matching failed' });
  }
}

/**
 * Undo the last dismiss-children or handle-as-grouping operation.
 * POST /api/admin/wv-import/matches/:worldViewId/undo
 */
export async function undoLastOperation(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] POST /matches/${worldViewId}/undo`);

  const entry = undoEntries.get(worldViewId);
  if (!entry) {
    res.status(404).json({ error: 'No undo available' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (entry.operation === 'dismiss-children') {
      // Re-insert descendant regions in parent-first order (sorted by id)
      const sorted = [...entry.descendantRegions].sort((a, b) => a.id - b.id);
      for (const region of sorted) {
        await client.query(
          `INSERT INTO regions (id, name, parent_region_id, is_leaf, world_view_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [region.id, region.name, region.parent_region_id, region.is_leaf, region.world_view_id],
        );
      }

      // Re-insert descendant import states
      for (const state of entry.descendantImportStates) {
        await client.query(
          `INSERT INTO region_import_state (region_id, match_status, needs_manual_fix, fix_note,
            source_url, source_external_id, region_map_url, map_image_reviewed, import_run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (region_id) DO NOTHING`,
          [state.region_id, state.match_status, state.needs_manual_fix, state.fix_note,
           state.source_url, state.source_external_id, state.region_map_url,
           state.map_image_reviewed, state.import_run_id],
        );
      }

      // Re-insert descendant suggestions
      for (const sugg of entry.descendantSuggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sugg.region_id, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected],
        );
      }

      // Re-insert descendant members
      for (const member of entry.descendantMembers) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [member.region_id, member.division_id],
        );
      }

      // Restore parent import state
      if (entry.parentImportState) {
        await client.query(
          `UPDATE region_import_state SET match_status = $1, needs_manual_fix = $2, fix_note = $3
           WHERE region_id = $4`,
          [entry.parentImportState.match_status, entry.parentImportState.needs_manual_fix,
           entry.parentImportState.fix_note, entry.regionId],
        );
      }
    } else if (entry.operation === 'handle-as-grouping') {
      // Restore children: delete their new members/suggestions/import state, restore old ones
      for (const snap of entry.childSnapshots) {
        // Clear current state
        await client.query(
          'DELETE FROM region_members WHERE region_id = $1',
          [snap.regionId],
        );
        await client.query(
          'DELETE FROM region_match_suggestions WHERE region_id = $1',
          [snap.regionId],
        );

        // Restore import state
        if (snap.importState) {
          await client.query(
            `INSERT INTO region_import_state (region_id, match_status, needs_manual_fix, fix_note,
              source_url, source_external_id, region_map_url, map_image_reviewed, import_run_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (region_id) DO UPDATE SET
               match_status = EXCLUDED.match_status,
               needs_manual_fix = EXCLUDED.needs_manual_fix,
               fix_note = EXCLUDED.fix_note`,
            [snap.importState.region_id, snap.importState.match_status,
             snap.importState.needs_manual_fix, snap.importState.fix_note,
             snap.importState.source_url, snap.importState.source_external_id,
             snap.importState.region_map_url, snap.importState.map_image_reviewed,
             snap.importState.import_run_id],
          );
        }

        // Restore suggestions
        for (const sugg of snap.suggestions) {
          await client.query(
            `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [snap.regionId, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected],
          );
        }

        // Restore members
        for (const member of snap.members) {
          await client.query(
            `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [member.region_id, member.division_id],
          );
        }
      }

      // Restore parent import state
      if (entry.parentImportState) {
        await client.query(
          `UPDATE region_import_state SET match_status = $1, needs_manual_fix = $2, fix_note = $3
           WHERE region_id = $4`,
          [entry.parentImportState.match_status, entry.parentImportState.needs_manual_fix,
           entry.parentImportState.fix_note, entry.regionId],
        );
      }
      // Clear parent's current members (matchChildrenAsCountries clears them)
      // and restore original ones
      await client.query(
        'DELETE FROM region_members WHERE region_id = $1',
        [entry.regionId],
      );
      for (const member of entry.parentMembers) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [member.region_id, member.division_id],
        );
      }
    }

    await client.query('COMMIT');

    // Remove undo entry after successful undo
    undoEntries.delete(worldViewId);
    console.log(`[WV Import] Undo ${entry.operation} for region ${entry.regionId} successful`);
    res.json({ undone: true, operation: entry.operation });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================================
// AI-assisted matching endpoints
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

/**
 * Check GADM coverage — find "gap boundaries" at every level.
 *
 * A division is "covered" if it (or any ancestor) is directly assigned as a
 * region_member. A "gap boundary" is an uncovered division whose parent IS
 * covered or is a root with no coverage at all. This catches:
 *  - Entire missing countries (root gaps)
 *  - Missing subdivisions within partially-assigned countries
 *  - Missing sub-subdivisions within partially-assigned states, etc.
 *
 * Response includes spatial proximity suggestions: for each active gap, finds
 * the closest assigned GADM neighbor and suggests adding the gap to that
 * neighbor's region (add_member) or creating a new sibling region (create_region).
 *
 * GET /api/admin/wv-import/matches/:worldViewId/coverage
 */

interface SubtreeNode {
  id: number;
  name: string;
  children: SubtreeNode[];
}

/**
 * For non-leaf coverage gaps, fetch the full GADM descendant subtree.
 * Returns a map from gap division ID to its children tree.
 * Single batch recursive CTE — no per-gap queries.
 */
async function fetchGapSubtrees(nonLeafGapIds: number[]): Promise<Map<number, SubtreeNode[]>> {
  const result = new Map<number, SubtreeNode[]>();
  if (nonLeafGapIds.length === 0) return result;

  // Recursive CTE: walk down from each non-leaf gap, collecting descendants
  const treeResult = await pool.query(`
    WITH RECURSIVE tree AS (
      SELECT id, name, parent_id
      FROM administrative_divisions
      WHERE parent_id = ANY($1)
      UNION ALL
      SELECT ad.id, ad.name, ad.parent_id
      FROM tree t
      JOIN administrative_divisions ad ON ad.parent_id = t.id
    )
    SELECT id, name, parent_id FROM tree ORDER BY parent_id, name
  `, [nonLeafGapIds]);

  // Build parent → children map
  const childrenOf = new Map<number, Array<{ id: number; name: string }>>();
  for (const row of treeResult.rows) {
    const parentId = row.parent_id as number;
    const child = { id: row.id as number, name: row.name as string };
    const arr = childrenOf.get(parentId);
    if (arr) arr.push(child);
    else childrenOf.set(parentId, [child]);
  }

  // Recursively build tree structure
  function buildTree(parentId: number): SubtreeNode[] {
    const children = childrenOf.get(parentId);
    if (!children) return [];
    return children.map(c => ({
      id: c.id,
      name: c.name,
      children: buildTree(c.id),
    }));
  }

  for (const gapId of nonLeafGapIds) {
    const tree = buildTree(gapId);
    if (tree.length > 0) {
      result.set(gapId, tree);
    }
  }

  return result;
}

export async function getCoverage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/coverage`);

  // Get dismissed IDs for this world view
  const wvResult = await pool.query(
    'SELECT COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]) AS dismissed FROM world_views WHERE id = $1',
    [worldViewId],
  );
  const dismissedIds = new Set<number>((wvResult.rows[0]?.dismissed as number[]) ?? []);

  const result = await pool.query(`
    WITH RECURSIVE assigned AS (
      -- All GADM divisions directly assigned as region_members
      SELECT DISTINCT rm.division_id AS id
      FROM region_members rm
      JOIN regions r ON r.id = rm.region_id
      WHERE r.world_view_id = $1
    ),
    -- Walk UP from each assigned division to root, collecting ancestor IDs.
    -- Any ID in this set either IS assigned or HAS an assigned descendant.
    ancestors AS (
      SELECT a.id AS current_id
      FROM assigned a
      UNION ALL
      SELECT ad.parent_id
      FROM ancestors anc
      JOIN administrative_divisions ad ON ad.id = anc.current_id
      WHERE ad.parent_id IS NOT NULL
    ),
    has_coverage_below AS (
      SELECT DISTINCT current_id AS id FROM ancestors
    ),
    -- Walk DOWN from assigned divisions to mark all descendants as covered.
    -- If Russia is assigned, every subdivision under it is fully covered.
    covered_descendants AS (
      SELECT a.id AS current_id
      FROM assigned a
      UNION ALL
      SELECT child.id
      FROM covered_descendants cd
      JOIN administrative_divisions child ON child.parent_id = cd.current_id
    ),
    fully_covered AS (
      SELECT DISTINCT current_id AS id FROM covered_descendants
    )
    -- Gap boundaries: divisions that are neither fully covered (from above)
    -- nor have coverage below, whose parent has partial coverage below
    -- (or is a root with no coverage at all).
    SELECT d.id, d.name, d.parent_id, d.has_children, p.name AS parent_name
    FROM administrative_divisions d
    LEFT JOIN administrative_divisions p ON p.id = d.parent_id
    WHERE d.id NOT IN (SELECT id FROM fully_covered)
      AND d.id NOT IN (SELECT id FROM has_coverage_below)
      AND (
        d.parent_id IS NULL
        OR d.parent_id IN (SELECT id FROM has_coverage_below)
      )
    ORDER BY p.name NULLS FIRST, d.name
  `, [worldViewId]);

  // Split into active gaps and dismissed gaps
  const activeGaps: Array<{ id: number; name: string; hasChildren: boolean; parentId: number | null; parentName: string | null }> = [];
  const dismissedGaps: Array<{ id: number; name: string; parentName: string | null }> = [];

  for (const r of result.rows) {
    const gap = {
      id: r.id as number,
      name: r.name as string,
      hasChildren: r.has_children as boolean,
      parentId: (r.parent_id as number) ?? null,
      parentName: (r.parent_name as string) ?? null,
    };
    if (dismissedIds.has(gap.id)) {
      dismissedGaps.push({ id: gap.id, name: gap.name, parentName: gap.parentName });
    } else {
      activeGaps.push(gap);
    }
  }

  // For non-leaf gaps, fetch the full GADM subtree so admin can see what's underneath
  const nonLeafGapIds = activeGaps.filter(g => g.hasChildren).map(g => g.id);
  const subtreeByGapId = await fetchGapSubtrees(nonLeafGapIds);

  // Tree-based suggestions: find nearest assigned GADM sibling/cousin per gap.
  // Pure integer joins on parent_id — no geometry, ~8ms for all gaps.
  const gapIds = activeGaps.map(g => g.id);

  const suggestionByGapId = new Map<number, {
    action: 'add_member' | 'create_region';
    targetRegionId: number;
    targetRegionName: string;
  }>();

  if (gapIds.length > 0) {
    // Step 1: Batch sibling match — gaps whose GADM siblings are directly assigned
    const siblingResult = await pool.query(`
      SELECT DISTINCT ON (gap.id)
        gap.id AS gap_id,
        rm.region_id,
        r.name AS region_name,
        r.parent_region_id
      FROM unnest($1::integer[]) AS gap(id)
      JOIN administrative_divisions gap_div ON gap_div.id = gap.id
      JOIN administrative_divisions sibling
        ON sibling.parent_id = gap_div.parent_id AND sibling.id != gap.id
      JOIN region_members rm ON rm.division_id = sibling.id
      JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
      ORDER BY gap.id, r.id
    `, [gapIds, worldViewId]);

    for (const row of siblingResult.rows) {
      suggestionByGapId.set(row.gap_id as number, {
        action: 'add_member',
        targetRegionId: row.region_id as number,
        targetRegionName: row.region_name as string,
      });
    }

    // Step 2: Ancestor walk for remaining gaps (no direct siblings assigned).
    // Walk UP the GADM tree from the gap's parent to find the nearest assigned cousin.
    const remainingGaps = activeGaps.filter(g => !suggestionByGapId.has(g.id) && g.parentId != null);
    for (const gap of remainingGaps) {
      const ancestorResult = await pool.query(`
        WITH RECURSIVE walk AS (
          SELECT $1::integer AS node_id, 0 AS depth
          UNION ALL
          SELECT ad.parent_id, w.depth + 1
          FROM walk w
          JOIN administrative_divisions ad ON ad.id = w.node_id
          WHERE ad.parent_id IS NOT NULL
        )
        SELECT rm.region_id, r.name AS region_name, r.parent_region_id
        FROM walk w
        JOIN administrative_divisions ad ON ad.id = w.node_id
        JOIN administrative_divisions sibling
          ON sibling.parent_id = ad.parent_id AND sibling.id != ad.id
        JOIN region_members rm ON rm.division_id = sibling.id
        JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
        ORDER BY w.depth
        LIMIT 1
      `, [gap.parentId, worldViewId]);

      if (ancestorResult.rows.length > 0) {
        const row = ancestorResult.rows[0];
        const parentRegionId = row.parent_region_id as number | null;
        if (parentRegionId != null) {
          suggestionByGapId.set(gap.id, {
            action: 'create_region',
            targetRegionId: parentRegionId,
            targetRegionName: row.region_name as string,
          });
        }
      }
    }
  }

  res.json({
    gaps: activeGaps.map(g => ({
      id: g.id,
      name: g.name,
      parentName: g.parentName,
      suggestion: suggestionByGapId.get(g.id) ?? null,
      ...(subtreeByGapId.has(g.id) ? { subtree: subtreeByGapId.get(g.id) } : {}),
    })),
    dismissedCount: dismissedGaps.length,
    dismissedGaps,
  });
}

/**
 * Check GADM coverage with SSE progress streaming.
 * Streams progress: gap finding → sibling match (batch) → ancestor walk (remaining).
 * Pure integer joins, no geometry queries.
 * GET /api/admin/wv-import/matches/:worldViewId/coverage-stream
 */
export async function getCoverageSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/coverage-stream (SSE)`);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  interface CoverageSSEEvent {
    type: 'progress' | 'complete' | 'error';
    step?: string;
    elapsed?: number;
    message?: string;
    data?: unknown;
  }

  const sendEvent = (event: CoverageSSEEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const startTime = Date.now();
  const logStep = (step: string) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[Coverage SSE] WorldView ${worldViewId}: ${step} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed });
  };

  try {
    // Step 1/3: Finding coverage gaps
    logStep('Finding coverage gaps...');

    const wvResult = await pool.query(
      'SELECT COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]) AS dismissed FROM world_views WHERE id = $1',
      [worldViewId],
    );
    const dismissedIds = new Set<number>((wvResult.rows[0]?.dismissed as number[]) ?? []);

    const result = await pool.query(`
      WITH RECURSIVE assigned AS (
        SELECT DISTINCT rm.division_id AS id
        FROM region_members rm
        JOIN regions r ON r.id = rm.region_id
        WHERE r.world_view_id = $1
      ),
      ancestors AS (
        SELECT a.id AS current_id
        FROM assigned a
        UNION ALL
        SELECT ad.parent_id
        FROM ancestors anc
        JOIN administrative_divisions ad ON ad.id = anc.current_id
        WHERE ad.parent_id IS NOT NULL
      ),
      has_coverage_below AS (
        SELECT DISTINCT current_id AS id FROM ancestors
      ),
      covered_descendants AS (
        SELECT a.id AS current_id
        FROM assigned a
        UNION ALL
        SELECT child.id
        FROM covered_descendants cd
        JOIN administrative_divisions child ON child.parent_id = cd.current_id
      ),
      fully_covered AS (
        SELECT DISTINCT current_id AS id FROM covered_descendants
      )
      SELECT d.id, d.name, d.parent_id, d.has_children, p.name AS parent_name
      FROM administrative_divisions d
      LEFT JOIN administrative_divisions p ON p.id = d.parent_id
      WHERE d.id NOT IN (SELECT id FROM fully_covered)
        AND d.id NOT IN (SELECT id FROM has_coverage_below)
        AND (
          d.parent_id IS NULL
          OR d.parent_id IN (SELECT id FROM has_coverage_below)
        )
      ORDER BY p.name NULLS FIRST, d.name
    `, [worldViewId]);

    // Split into active gaps and dismissed gaps
    const activeGaps: Array<{ id: number; name: string; hasChildren: boolean; parentId: number | null; parentName: string | null }> = [];
    const dismissedGaps: Array<{ id: number; name: string; parentName: string | null }> = [];

    for (const r of result.rows) {
      const gap = {
        id: r.id as number,
        name: r.name as string,
        hasChildren: r.has_children as boolean,
        parentId: (r.parent_id as number) ?? null,
        parentName: (r.parent_name as string) ?? null,
      };
      if (dismissedIds.has(gap.id)) {
        dismissedGaps.push({ id: gap.id, name: gap.name, parentName: gap.parentName });
      } else {
        activeGaps.push(gap);
      }
    }

    // Fetch subtrees for non-leaf gaps
    const nonLeafGapIds = activeGaps.filter(g => g.hasChildren).map(g => g.id);
    const subtreeByGapId = await fetchGapSubtrees(nonLeafGapIds);

    logStep(`Found ${activeGaps.length} active gaps, ${dismissedGaps.length} dismissed`);

    // Step 2: Batch sibling match — pure integer join on parent_id (~8ms)
    logStep('Finding sibling matches...');
    const gapIds = activeGaps.map(g => g.id);
    const suggestionByGapId = new Map<number, {
      action: 'add_member' | 'create_region';
      targetRegionId: number;
      targetRegionName: string;
    }>();

    if (gapIds.length > 0) {
      const siblingResult = await pool.query(`
        SELECT DISTINCT ON (gap.id)
          gap.id AS gap_id,
          rm.region_id,
          r.name AS region_name,
          r.parent_region_id
        FROM unnest($1::integer[]) AS gap(id)
        JOIN administrative_divisions gap_div ON gap_div.id = gap.id
        JOIN administrative_divisions sibling
          ON sibling.parent_id = gap_div.parent_id AND sibling.id != gap.id
        JOIN region_members rm ON rm.division_id = sibling.id
        JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
        ORDER BY gap.id, r.id
      `, [gapIds, worldViewId]);

      for (const row of siblingResult.rows) {
        suggestionByGapId.set(row.gap_id as number, {
          action: 'add_member',
          targetRegionId: row.region_id as number,
          targetRegionName: row.region_name as string,
        });
      }

      logStep(`Sibling matches: ${siblingResult.rows.length}/${gapIds.length} gaps`);

      // Step 3: Ancestor walk for remaining gaps (no direct siblings assigned).
      // Walk UP the GADM tree from gap's parent to find nearest assigned cousin.
      const remainingGaps = activeGaps.filter(g => !suggestionByGapId.has(g.id) && g.parentId != null);
      if (remainingGaps.length > 0) {
        for (let i = 0; i < remainingGaps.length; i++) {
          const gap = remainingGaps[i];
          logStep(`Ancestor walk ${i + 1}/${remainingGaps.length}: ${gap.name}...`);

          const ancestorResult = await pool.query(`
            WITH RECURSIVE walk AS (
              SELECT $1::integer AS node_id, 0 AS depth
              UNION ALL
              SELECT ad.parent_id, w.depth + 1
              FROM walk w
              JOIN administrative_divisions ad ON ad.id = w.node_id
              WHERE ad.parent_id IS NOT NULL
            )
            SELECT rm.region_id, r.name AS region_name, r.parent_region_id
            FROM walk w
            JOIN administrative_divisions ad ON ad.id = w.node_id
            JOIN administrative_divisions sibling
              ON sibling.parent_id = ad.parent_id AND sibling.id != ad.id
            JOIN region_members rm ON rm.division_id = sibling.id
            JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
            ORDER BY w.depth
            LIMIT 1
          `, [gap.parentId, worldViewId]);

          if (ancestorResult.rows.length > 0) {
            const row = ancestorResult.rows[0];
            const parentRegionId = row.parent_region_id as number | null;
            if (parentRegionId != null) {
              suggestionByGapId.set(gap.id, {
                action: 'create_region',
                targetRegionId: parentRegionId,
                targetRegionName: row.region_name as string,
              });
            }
          }
        }
      }
    }

    const addCount = [...suggestionByGapId.values()].filter(s => s.action === 'add_member').length;
    const createCount = [...suggestionByGapId.values()].filter(s => s.action === 'create_region').length;
    const noSuggestion = gapIds.length - suggestionByGapId.size;
    logStep(`Done: ${addCount} add_member, ${createCount} create_region, ${noSuggestion} without suggestion`);

    // Send complete event with full result
    const coverageResult = {
      gaps: activeGaps.map(g => ({
        id: g.id,
        name: g.name,
        parentName: g.parentName,
        suggestion: suggestionByGapId.get(g.id) ?? null,
        ...(subtreeByGapId.has(g.id) ? { subtree: subtreeByGapId.get(g.id) } : {}),
      })),
      dismissedCount: dismissedGaps.length,
      dismissedGaps,
    };

    sendEvent({
      type: 'complete',
      elapsed: (Date.now() - startTime) / 1000,
      data: coverageResult,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Coverage SSE] Error for worldView ${worldViewId}:`, errorMessage);
    sendEvent({
      type: 'error',
      message: errorMessage,
      elapsed: (Date.now() - startTime) / 1000,
    });
  }

  res.end();
}

/**
 * Geographic suggestion for a single coverage gap.
 * Ensures assigned divisions have anchor_points populated, then KNN-compares
 * the gap's centroid against those tiny Point geometries (~84ms total).
 * POST /api/admin/wv-import/matches/:worldViewId/geo-suggest-gap
 */
export async function geoSuggestGap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geo-suggest-gap — divisionId=${divisionId}`);

  // Ensure assigned divisions have anchor_points populated (idempotent, only fills NULLs).
  // Uses a dedicated connection to disable triggers (avoids expensive 3857 recomputation).
  const needsFill = await pool.query(`
    SELECT count(*) AS missing
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $1
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE ad.anchor_point IS NULL
  `, [worldViewId]);

  if (parseInt(needsFill.rows[0].missing as string) > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE administrative_divisions DISABLE TRIGGER trg_admin_div_geom_3857');
      await client.query(`
        UPDATE administrative_divisions ad
        SET anchor_point = ST_Centroid(ST_Envelope(ad.geom))
        FROM region_members rm
        JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $1
        WHERE ad.id = rm.division_id AND ad.anchor_point IS NULL
      `, [worldViewId]);
      await client.query('ALTER TABLE administrative_divisions ENABLE TRIGGER trg_admin_div_geom_3857');
      await client.query('COMMIT');
      console.log(`[WV Import] Populated anchor_points for assigned divisions in WV ${worldViewId}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Boundary-based KNN: finds the nearest assigned region by polygon boundary distance.
  // Uses `geom <->` (GiST bbox-based KNN) to catch large regions whose boundary is
  // close even if their centroid is far (e.g., Antarctica for Heard Island).
  // Then computes exact boundary distance with ST_Distance on geography.
  const result = await pool.query(`
    WITH gap_center AS (
      SELECT ST_Centroid(ST_Envelope(geom)) AS pt
      FROM administrative_divisions WHERE id = $1
    ),
    knn_raw AS (
      SELECT
        rm.region_id, r.name AS region_name,
        rm.division_id AS suggestion_division_id,
        ad_neighbor.name AS suggestion_division_name,
        ST_X(COALESCE(ad_neighbor.anchor_point, ST_Centroid(ad_neighbor.geom))) AS sugg_lng,
        ST_Y(COALESCE(ad_neighbor.anchor_point, ST_Centroid(ad_neighbor.geom))) AS sugg_lat,
        ST_X(gc.pt) AS gap_lng, ST_Y(gc.pt) AS gap_lat,
        COALESCE(ad_neighbor.geom_simplified_low, ad_neighbor.geom) AS neighbor_geom,
        gc.pt AS gap_pt
      FROM administrative_divisions ad_neighbor
      JOIN region_members rm ON rm.division_id = ad_neighbor.id
      JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
      CROSS JOIN gap_center gc
      ORDER BY ad_neighbor.geom <-> gc.pt
      LIMIT 15
    ),
    per_region AS (
      SELECT DISTINCT ON (region_id)
        region_id, region_name,
        suggestion_division_id, suggestion_division_name,
        sugg_lng, sugg_lat, gap_lng, gap_lat,
        ST_Distance(gap_pt::geography, neighbor_geom::geography) / 1000.0 AS distance_km
      FROM knn_raw
      ORDER BY region_id, ST_Distance(gap_pt::geography, neighbor_geom::geography)
    )
    SELECT * FROM per_region ORDER BY distance_km LIMIT 1
  `, [divisionId, worldViewId]);

  if (result.rows.length === 0) {
    res.json({ suggestion: null });
    return;
  }

  const row = result.rows[0];
  const regionId = row.region_id as number;

  // Fetch ancestor chain (suggested region → root) and children of the suggested region.
  // Ancestors let admin pick where in the hierarchy to add the gap.
  // Children let admin pick a more specific child (e.g., "South Ocean Islands" under "Antarctica").
  const [ancestorResult, childrenResult] = await Promise.all([
    pool.query(`
      WITH RECURSIVE chain AS (
        SELECT id, name, parent_region_id, 0 AS depth
        FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id, r.name, r.parent_region_id, c.depth + 1
        FROM regions r JOIN chain c ON r.id = c.parent_region_id
      )
      SELECT id, name, depth FROM chain ORDER BY depth DESC
    `, [regionId]),
    pool.query(`
      SELECT id, name FROM regions
      WHERE parent_region_id = $1 AND world_view_id = $2
      ORDER BY name
    `, [regionId, worldViewId]),
  ]);

  // Build nested contextTree: root → ... → suggested (with children attached)
  // ancestorResult is ordered root-first (depth DESC), suggested region is last
  interface ContextNode {
    id: number;
    name: string;
    children: ContextNode[];
    isSuggested: boolean;
  }

  const ancestors = ancestorResult.rows as Array<{ id: number; name: string; depth: number }>;
  const suggestedChildren: ContextNode[] = childrenResult.rows.map(c => ({
    id: c.id as number,
    name: c.name as string,
    children: [],
    isSuggested: false,
  }));

  // Build from root (first) down to suggested (last)
  let contextTree: ContextNode | null = null;
  let currentParent: ContextNode | null = null;

  for (const ancestor of ancestors) {
    const isSuggested = ancestor.id === regionId;
    const node: ContextNode = {
      id: ancestor.id,
      name: ancestor.name,
      children: isSuggested ? suggestedChildren : [],
      isSuggested,
    };

    if (!contextTree) {
      contextTree = node;
    } else if (currentParent) {
      currentParent.children = [node];
    }
    currentParent = node;
  }

  res.json({
    suggestion: {
      action: 'add_member' as const,
      targetRegionId: regionId,
      targetRegionName: row.region_name as string,
    },
    suggestionDivisionId: row.suggestion_division_id as number,
    suggestionDivisionName: row.suggestion_division_name as string,
    gapCenter: [row.gap_lng as number, row.gap_lat as number],
    suggestionCenter: [row.sugg_lng as number, row.sugg_lat as number],
    distanceKm: Math.round(row.distance_km as number),
    contextTree: contextTree ?? undefined,
  });
}

/**
 * Dismiss a coverage gap (mark a GADM division as irrelevant for coverage).
 * POST /api/admin/wv-import/matches/:worldViewId/dismiss-gap
 */
export async function dismissCoverageGap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/dismiss-gap — divisionId=${divisionId}`);

  await pool.query(
    `UPDATE world_views
     SET dismissed_coverage_ids = array_append(
       COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]),
       $2
     )
     WHERE id = $1
       AND NOT ($2 = ANY(COALESCE(dismissed_coverage_ids, ARRAY[]::integer[])))`,
    [worldViewId, divisionId],
  );

  res.json({ dismissed: true });
}

/**
 * Undismiss a coverage gap (restore a GADM division to active gaps).
 * POST /api/admin/wv-import/matches/:worldViewId/undismiss-gap
 */
export async function undismissCoverageGap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/undismiss-gap — divisionId=${divisionId}`);

  await pool.query(
    `UPDATE world_views SET dismissed_coverage_ids = array_remove(dismissed_coverage_ids, $2) WHERE id = $1`,
    [worldViewId, divisionId],
  );

  res.json({ undismissed: true });
}

/**
 * Approve a coverage suggestion — add gap division to an existing region,
 * or create a new region and add it there.
 * POST /api/admin/wv-import/matches/:worldViewId/approve-coverage
 */
export async function approveCoverageSuggestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId, regionId, action, gapName } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/approve-coverage — action=${action}, divisionId=${divisionId}, regionId=${regionId}`);

  let targetRegionId = regionId as number;

  if (action === 'add_member') {
    // Verify region belongs to world view
    const regionCheck = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (regionCheck.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    await pool.query(
      'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [regionId, divisionId],
    );
    await syncImportMatchStatus(regionId);
  } else {
    // create_region: regionId is the parent region
    const parentCheck = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (parentCheck.rows.length === 0) {
      res.status(404).json({ error: 'Parent region not found in this world view' });
      return;
    }

    // Get division name for the new region if not provided
    let regionName = gapName as string | undefined;
    if (!regionName) {
      const divResult = await pool.query(
        'SELECT name FROM administrative_divisions WHERE id = $1',
        [divisionId],
      );
      regionName = (divResult.rows[0]?.name as string) ?? `Region ${divisionId}`;
    }

    const newRegion = await pool.query(
      `INSERT INTO regions (world_view_id, name, parent_region_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [worldViewId, regionName, regionId],
    );
    targetRegionId = newRegion.rows[0].id as number;

    // Create import state for the new region
    await pool.query(
      `INSERT INTO region_import_state (region_id, match_status) VALUES ($1, 'manual_matched')`,
      [targetRegionId],
    );

    await pool.query(
      'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)',
      [targetRegionId, divisionId],
    );
  }

  // Auto-dismiss the gap
  await pool.query(
    `UPDATE world_views
     SET dismissed_coverage_ids = array_append(
       COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]),
       $2
     )
     WHERE id = $1
       AND NOT ($2 = ANY(COALESCE(dismissed_coverage_ids, ARRAY[]::integer[])))`,
    [worldViewId, divisionId],
  );

  res.json({ approved: true, regionId: targetRegionId });
}

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
    )
    SELECT COUNT(*) FILTER (WHERE ris.match_status = 'needs_review') AS needs_review,
           COUNT(*) FILTER (
             WHERE ris.match_status = 'no_candidates'
               AND r.id NOT IN (SELECT region_id FROM covered_by_ancestor)
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
