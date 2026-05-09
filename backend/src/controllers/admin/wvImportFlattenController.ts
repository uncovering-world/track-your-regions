/**
 * Admin WorldView Import — Flatten controller
 *
 * Owns: hierarchy flattening operations during the review phase.
 * - syncInstances: synchronizes regions across multiple instances
 * - handleAsGrouping: collapses a region into its children's grouping
 * See ADR-0009 for the domain-split rationale.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { matchChildrenAsCountries } from '../../services/worldViewImport/index.js';
import {
  undoEntries,
  type ImportStateSnapshot,
  type SuggestionSnapshot,
  type UndoEntry,
} from './wvImportSharedState.js';

// =============================================================================
// Sync operations
// =============================================================================

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
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    const sourceImportState = await client.query(
      `SELECT source_url, match_status FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const sourceUrl = sourceImportState.rows[0]?.source_url as string | undefined;
    if (!sourceUrl) {
      await client.query('ROLLBACK');
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
      await client.query('ROLLBACK');
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

// =============================================================================
// Handle-as-grouping
// =============================================================================

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
