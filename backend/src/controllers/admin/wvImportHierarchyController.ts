/**
 * Admin WorldView Import — Hierarchy operations controller
 *
 * Owns: non-destructive hierarchy operations during the review phase.
 * Currently: undoLastOperation (rolls back the last destructive op).
 * See ADR-0009 for the domain-split rationale.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { undoEntries } from './wvImportSharedState.js';

// =============================================================================
// undoLastOperation
// =============================================================================

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
