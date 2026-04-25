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
  matchCountryLevel,
  matchChildrenAsCountries,
} from '../../services/worldViewImport/index.js';
import { createInitialProgress, type ImportProgress } from '../../services/worldViewImport/types.js';

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
