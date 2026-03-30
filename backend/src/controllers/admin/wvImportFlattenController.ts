/**
 * WorldView Import Flatten Controller
 *
 * Flatten and grouping operations: collapse to parent, smart flatten (preview + execute),
 * sync instances across duplicate regions, handle-as-grouping (country-level matching).
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  matchChildrenAsCountries,
} from '../../services/worldViewImport/index.js';
import {
  dbSearchSingleRegion,
  trigramSearch,
} from '../../services/worldViewImport/aiMatcher.js';
import {
  type UndoEntry,
  type ImportStateSnapshot,
  type SuggestionSnapshot,
  undoEntries,
  computeGeoSimilarityIfNeeded,
} from './wvImportUtils.js';

// =============================================================================
// Flatten and grouping endpoints
// =============================================================================

/**
 * Collapse to parent: clear all descendants' suggestions/assignments (keep the child regions)
 * and generate suggestions for the parent region instead.
 * POST /api/admin/wv-import/matches/:worldViewId/collapse-to-parent
 */
export async function collapseToParent(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/collapse-to-parent — regionId=${regionId}`);

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
      res.status(400).json({ error: 'Region has no children to collapse' });
      return;
    }

    const descendantIds = descendants.rows.map(r => r.id as number);

    // Snapshot for undo: parent import state + members, all descendant import state + suggestions + members
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
    const descImportStatesResult = await client.query(
      `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
              region_map_url, map_image_reviewed, import_run_id
       FROM region_import_state WHERE region_id = ANY($1)`,
      [descendantIds],
    );
    const descSuggestionsResult = await client.query(
      `SELECT region_id, division_id, name, path, score, rejected, geo_similarity
       FROM region_match_suggestions WHERE region_id = ANY($1)`,
      [descendantIds],
    );
    const descMembersResult = await client.query(
      'SELECT region_id, division_id FROM region_members WHERE region_id = ANY($1)',
      [descendantIds],
    );

    // Clear all descendants' suggestions, members, and reset match status
    await client.query(
      'DELETE FROM region_match_suggestions WHERE region_id = ANY($1)',
      [descendantIds],
    );
    await client.query(
      'DELETE FROM region_members WHERE region_id = ANY($1)',
      [descendantIds],
    );
    await client.query(
      `UPDATE region_import_state SET match_status = 'no_candidates', geo_available = NULL
       WHERE region_id = ANY($1)`,
      [descendantIds],
    );

    // Clear parent's own suggestions, members, and reset match status
    await client.query(
      'DELETE FROM region_match_suggestions WHERE region_id = $1',
      [regionId],
    );
    await client.query(
      'DELETE FROM region_members WHERE region_id = $1',
      [regionId],
    );
    await client.query(
      `UPDATE region_import_state SET match_status = 'no_candidates', geo_available = NULL
       WHERE region_id = $1`,
      [regionId],
    );

    await client.query('COMMIT');

    // Store undo entry
    undoEntries.set(worldViewId, {
      operation: 'collapse-to-parent',
      regionId,
      timestamp: Date.now(),
      parentImportState,
      parentMembers: parentMembersResult.rows as Array<{ region_id: number; division_id: number }>,
      descendantRegions: [],
      descendantImportStates: descImportStatesResult.rows as ImportStateSnapshot[],
      descendantSuggestions: descSuggestionsResult.rows as SuggestionSnapshot[],
      descendantMembers: descMembersResult.rows as Array<{ region_id: number; division_id: number }>,
      childSnapshots: [],
    });

    // Now generate suggestions for the parent region (outside transaction)
    try {
      const searchResult = await dbSearchSingleRegion(worldViewId, regionId);
      if (searchResult.found > 0) {
        await computeGeoSimilarityIfNeeded(regionId);
      }
      console.log(`[WV Import] Collapsed ${descendantIds.length} descendants of region ${regionId}, found ${searchResult.found} suggestion(s) for parent`);
      res.json({
        collapsed: descendantIds.length,
        parentSuggestions: searchResult.found,
        undoAvailable: true,
      });
    } catch (searchErr) {
      console.warn(`[WV Import] Collapse succeeded but parent search failed:`, searchErr instanceof Error ? searchErr.message : searchErr);
      res.json({
        collapsed: descendantIds.length,
        parentSuggestions: 0,
        undoAvailable: true,
      });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Smart flatten preview: auto-match children, then return unified geometry for confirmation dialog.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-flatten/preview
 */
export async function smartFlattenPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-flatten/preview — regionId=${regionId}`);

  try {
    // Verify region belongs to this world view and has children
    const region = await pool.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    // Get all descendant region IDs (recursive)
    const descendants = await pool.query(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, name FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT r.id, r.name FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      SELECT id, name FROM desc_regions
    `, [regionId]);

    if (descendants.rows.length === 0) {
      res.status(400).json({ error: 'Region has no children to flatten' });
      return;
    }

    const descendantIds = descendants.rows.map(r => r.id as number);

    // Phase 1: Auto-match unmatched descendants (same logic as smartFlatten)
    const membersCheck = await pool.query(
      `SELECT DISTINCT region_id FROM region_members WHERE region_id = ANY($1)`,
      [descendantIds],
    );
    const matchedIds = new Set(membersCheck.rows.map(r => r.region_id as number));
    const unmatchedDescendants = descendants.rows.filter(r => !matchedIds.has(r.id as number));

    const stillUnmatched: Array<{ id: number; name: string }> = [];
    for (const desc of unmatchedDescendants) {
      const descId = desc.id as number;
      const descName = desc.name as string;
      const candidates = await trigramSearch(descName, 3);

      let autoMatched = false;
      if (candidates.length === 1 && candidates[0].similarity >= 0.5) {
        autoMatched = true;
      } else if (candidates.length > 1 && candidates[0].similarity >= 0.7
        && candidates[0].similarity - candidates[1].similarity >= 0.15) {
        autoMatched = true;
      }

      if (autoMatched) {
        await pool.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [descId, candidates[0].divisionId],
        );
        await pool.query(
          `INSERT INTO region_import_state (region_id, match_status)
           VALUES ($1, 'auto_matched')
           ON CONFLICT (region_id) DO UPDATE SET match_status = 'auto_matched'`,
          [descId],
        );
      } else {
        stillUnmatched.push({ id: descId, name: descName });
      }
    }

    // Phase 2: Block if any remain unmatched
    if (stillUnmatched.length > 0) {
      res.status(400).json({
        error: 'Cannot flatten: some children have no GADM match',
        unmatched: stillUnmatched,
      });
      return;
    }

    // Compute unified geometry of all descendant divisions (simplified for preview)
    const geomResult = await pool.query(`
      SELECT ST_AsGeoJSON(ST_Union(ad.geom_simplified_medium)) AS geojson
      FROM region_members rm
      JOIN administrative_divisions ad ON ad.id = rm.division_id
      WHERE rm.region_id = ANY($1)
    `, [descendantIds]);

    const geojsonStr = geomResult.rows[0]?.geojson as string | null;
    const geometry = geojsonStr ? JSON.parse(geojsonStr) : null;

    // Get parent's region map URL
    const mapUrlResult = await pool.query(
      'SELECT region_map_url FROM region_import_state WHERE region_id = $1',
      [regionId],
    );
    const regionMapUrl = (mapUrlResult.rows[0]?.region_map_url as string | null) ?? null;

    // Count unique divisions
    const divCountResult = await pool.query(
      'SELECT COUNT(DISTINCT division_id) AS cnt FROM region_members WHERE region_id = ANY($1)',
      [descendantIds],
    );
    const divisionCount = parseInt(divCountResult.rows[0]?.cnt as string) || 0;

    console.log(`[WV Import] Smart flatten preview: ${descendantIds.length} descendants, ${divisionCount} divisions`);
    res.json({
      geometry,
      regionMapUrl,
      descendants: descendantIds.length,
      divisions: divisionCount,
    });
  } catch (err) {
    console.error(`[WV Import] Smart flatten preview failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Smart flatten preview failed' });
  }
}

/**
 * Smart flatten: auto-match children -> absorb all descendant divisions into parent -> delete descendants.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-flatten
 */
export async function smartFlatten(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-flatten — regionId=${regionId}`);

  try {
    // Verify region belongs to this world view and has children
    const region = await pool.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    // Get all descendant region IDs (recursive)
    const descendants = await pool.query(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, name FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT r.id, r.name FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      SELECT id, name FROM desc_regions
    `, [regionId]);

    if (descendants.rows.length === 0) {
      res.status(400).json({ error: 'Region has no children to flatten' });
      return;
    }

    const descendantIds = descendants.rows.map(r => r.id as number);

    // Phase 1: Auto-match unmatched descendants (uses pool, not transaction)
    const membersCheck = await pool.query(
      `SELECT DISTINCT region_id FROM region_members WHERE region_id = ANY($1)`,
      [descendantIds],
    );
    const matchedIds = new Set(membersCheck.rows.map(r => r.region_id as number));
    const unmatchedDescendants = descendants.rows.filter(r => !matchedIds.has(r.id as number));

    const stillUnmatched: Array<{ id: number; name: string }> = [];
    for (const desc of unmatchedDescendants) {
      const descId = desc.id as number;
      const descName = desc.name as string;
      const candidates = await trigramSearch(descName, 3);

      let autoMatched = false;
      if (candidates.length === 1 && candidates[0].similarity >= 0.5) {
        autoMatched = true;
      } else if (candidates.length > 1 && candidates[0].similarity >= 0.7
        && candidates[0].similarity - candidates[1].similarity >= 0.15) {
        autoMatched = true;
      }

      if (autoMatched) {
        await pool.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [descId, candidates[0].divisionId],
        );
        await pool.query(
          `INSERT INTO region_import_state (region_id, match_status)
           VALUES ($1, 'auto_matched')
           ON CONFLICT (region_id) DO UPDATE SET match_status = 'auto_matched'`,
          [descId],
        );
      } else {
        stillUnmatched.push({ id: descId, name: descName });
      }
    }

    // Phase 2: Block if any remain unmatched
    if (stillUnmatched.length > 0) {
      res.status(400).json({
        error: 'Cannot flatten: some children have no GADM match',
        unmatched: stillUnmatched,
      });
      return;
    }

    // Phase 3: Snapshot + flatten in transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Snapshot parent import state + members
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

      // Snapshot all descendants
      const descRegionsResult = await client.query(
        `SELECT id, name, parent_region_id, is_leaf, world_view_id
         FROM regions WHERE id = ANY($1) ORDER BY id`,
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

      // Absorb: collect all descendant division IDs -> assign to parent
      const allDescDivisionIds = descMembersResult.rows.map(r => r.division_id as number);
      const uniqueDivisionIds = [...new Set(allDescDivisionIds)];
      for (const divId of uniqueDivisionIds) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [regionId, divId],
        );
      }

      // Delete descendant members first
      await client.query(
        'DELETE FROM region_members WHERE region_id = ANY($1)',
        [descendantIds],
      );

      // Delete descendants (deepest-first via CTE)
      await client.query(`
        WITH RECURSIVE desc_regions AS (
          SELECT id, 1 AS depth FROM regions WHERE parent_region_id = $1
          UNION ALL
          SELECT r.id, d.depth + 1 FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
        )
        DELETE FROM regions WHERE id IN (SELECT id FROM desc_regions ORDER BY depth DESC)
      `, [regionId]);

      // Update parent status
      await client.query(
        `UPDATE region_import_state SET match_status = 'manual_matched' WHERE region_id = $1`,
        [regionId],
      );
      await client.query(
        `DELETE FROM region_match_suggestions WHERE region_id = $1`,
        [regionId],
      );

      await client.query('COMMIT');

      // Store undo entry (same structure as dismiss-children)
      undoEntries.set(worldViewId, {
        operation: 'smart-flatten',
        regionId,
        timestamp: Date.now(),
        parentImportState,
        parentMembers: parentMembersResult.rows as Array<{ region_id: number; division_id: number }>,
        descendantRegions: descRegionsResult.rows as UndoEntry['descendantRegions'],
        descendantImportStates: descImportStatesResult.rows as ImportStateSnapshot[],
        descendantSuggestions: descSuggestionsResult.rows as SuggestionSnapshot[],
        descendantMembers: descMembersResult.rows as Array<{ region_id: number; division_id: number }>,
        childSnapshots: [],
      });

      console.log(`[WV Import] Smart flatten: absorbed ${descendantIds.length} descendants (${uniqueDivisionIds.length} divisions) into region ${regionId}`);
      res.json({
        absorbed: descendantIds.length,
        divisions: uniqueDivisionIds.length,
        undoAvailable: true,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`[WV Import] Smart flatten failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Smart flatten failed' });
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
      `SELECT division_id, name, path, score, rejected, geo_similarity
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
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [siblingId, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
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
 * Drill into a region's children -- match them independently against GADM.
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
        `SELECT division_id, name, path, score, rejected, geo_similarity
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

    // Get parent's currently assigned divisions to scope the matching
    const parentMembers = await pool.query(
      'SELECT division_id FROM region_members WHERE region_id = $1',
      [regionId],
    );
    const scopeDivisionIds = parentMembers.rows.map(r => r.division_id as number);

    const result = await matchChildrenAsCountries(worldViewId, regionId, scopeDivisionIds);

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
