/**
 * WorldView Import Tree Operations Controller
 *
 * Tree structure manipulation: merge single-child into parent, remove regions,
 * dismiss children, prune to leaves.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  type UndoEntry,
  type ImportStateSnapshot,
  type SuggestionSnapshot,
  undoEntries,
} from './wvImportUtils.js';

// =============================================================================
// Tree structure manipulation endpoints
// =============================================================================

/**
 * Merge a single-child parent's only child into the parent.
 * Reparents grandchildren, moves members/suggestions/images, copies import state, deletes the child.
 * POST /api/admin/wv-import/matches/:worldViewId/merge-child
 */
export async function mergeChildIntoParent(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/merge-child — regionId=${regionId}`);

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

    // Verify exactly 1 child
    const children = await client.query(
      'SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (children.rows.length !== 1) {
      res.status(400).json({ error: `Region has ${children.rows.length} children, expected exactly 1` });
      return;
    }

    const childId = children.rows[0].id as number;
    const childName = children.rows[0].name as string;

    // 1. Reparent grandchildren to the parent
    await client.query(
      'UPDATE regions SET parent_region_id = $1 WHERE parent_region_id = $2',
      [regionId, childId],
    );

    // 2. Move child's region_members to parent
    // First delete any conflicting members (same division already assigned to parent)
    await client.query(`
      DELETE FROM region_members
      WHERE region_id = $1 AND division_id IN (
        SELECT division_id FROM region_members WHERE region_id = $2
      )
    `, [regionId, childId]);
    await client.query(
      'UPDATE region_members SET region_id = $1 WHERE region_id = $2',
      [regionId, childId],
    );

    // 3. Move child's match suggestions to parent (avoid duplicates)
    await client.query(`
      DELETE FROM region_match_suggestions
      WHERE region_id = $1 AND division_id IN (
        SELECT division_id FROM region_match_suggestions WHERE region_id = $2
      )
    `, [regionId, childId]);
    await client.query(
      'UPDATE region_match_suggestions SET region_id = $1 WHERE region_id = $2',
      [regionId, childId],
    );

    // 4. Move child's map images to parent (avoid duplicates)
    await client.query(`
      DELETE FROM region_map_images
      WHERE region_id = $1 AND image_url IN (
        SELECT image_url FROM region_map_images WHERE region_id = $2
      )
    `, [regionId, childId]);
    await client.query(
      'UPDATE region_map_images SET region_id = $1 WHERE region_id = $2',
      [regionId, childId],
    );

    // 5. Copy child's import state to parent where parent has no useful data
    const childState = await client.query(
      `SELECT match_status, source_url, source_external_id, region_map_url, map_image_reviewed
       FROM region_import_state WHERE region_id = $1`,
      [childId],
    );
    if (childState.rows.length > 0) {
      const cs = childState.rows[0];
      const parentState = await client.query(
        `SELECT match_status, source_url, source_external_id, region_map_url
         FROM region_import_state WHERE region_id = $1`,
        [regionId],
      );
      if (parentState.rows.length > 0) {
        const ps = parentState.rows[0];
        // Copy region_map_url if parent doesn't have one
        if (!ps.region_map_url && cs.region_map_url) {
          await client.query(
            'UPDATE region_import_state SET region_map_url = $1, map_image_reviewed = $2 WHERE region_id = $3',
            [cs.region_map_url, cs.map_image_reviewed, regionId],
          );
        }
        // Copy source_external_id (wikidata_id) if parent doesn't have one
        if (!ps.source_external_id && cs.source_external_id) {
          await client.query(
            'UPDATE region_import_state SET source_external_id = $1 WHERE region_id = $2',
            [cs.source_external_id, regionId],
          );
        }
        // Copy match_status if parent has no useful status (null-like container)
        if (!ps.match_status || ps.match_status === 'no_candidates') {
          await client.query(
            'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
            [cs.match_status, regionId],
          );
        }
      }
    }

    // 6. Delete the child (CASCADE handles region_import_state, suggestions, map_images)
    await client.query('DELETE FROM regions WHERE id = $1', [childId]);

    await client.query('COMMIT');

    console.log(`[WV Import] Merged child "${childName}" (${childId}) into parent ${regionId}`);
    res.json({ merged: true, childId, childName });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove a region from the import tree.
 * POST /api/admin/wv-import/matches/:worldViewId/remove-region
 *
 * If reparentChildren=true, children are moved to the removed region's parent.
 * If reparentChildren=false, the entire branch (all descendants) is deleted.
 */
export async function removeRegionFromImport(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, reparentChildren, reparentDivisions } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/remove-region — regionId=${regionId}, reparentChildren=${reparentChildren}, reparentDivisions=${reparentDivisions ?? false}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region belongs to this world view
    const region = await client.query(
      'SELECT id, name, parent_region_id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    const regionName = region.rows[0].name as string;
    const parentRegionId = region.rows[0].parent_region_id as number | null;

    // Move divisions to parent if requested (before deleting the region)
    let divisionsReparented = 0;
    if (reparentDivisions && parentRegionId != null) {
      const moved = await client.query(
        `INSERT INTO region_members (region_id, division_id)
         SELECT $1, division_id FROM region_members WHERE region_id = $2
         ON CONFLICT DO NOTHING`,
        [parentRegionId, regionId],
      );
      divisionsReparented = moved.rowCount ?? 0;
    }

    if (reparentChildren) {
      // Move children up to this region's parent
      const reparented = await client.query(
        'UPDATE regions SET parent_region_id = $1 WHERE parent_region_id = $2 AND world_view_id = $3',
        [parentRegionId, regionId, worldViewId],
      );

      // Delete the region itself (CASCADE cleans up region_import_state, suggestions, map_images, members)
      await client.query('DELETE FROM regions WHERE id = $1', [regionId]);

      await client.query('COMMIT');
      console.log(`[WV Import] Removed region "${regionName}" (${regionId}), reparented ${reparented.rowCount} children, ${divisionsReparented} divisions`);
      res.json({ removed: true, regionName, childrenReparented: reparented.rowCount, divisionsReparented });
    } else {
      // Delete entire branch: all descendants first (depth-ordered), then the region
      const descendants = await client.query(`
        WITH RECURSIVE desc_regions AS (
          SELECT id, 1 AS depth FROM regions WHERE parent_region_id = $1
          UNION ALL
          SELECT r.id, d.depth + 1 FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
        )
        SELECT id FROM desc_regions ORDER BY depth DESC
      `, [regionId]);

      const descendantIds = descendants.rows.map(r => r.id as number);

      if (descendantIds.length > 0) {
        // Delete descendants deepest-first (CASCADE handles related tables)
        await client.query(
          'DELETE FROM regions WHERE id = ANY($1)',
          [descendantIds],
        );
      }

      // Delete the region itself
      await client.query('DELETE FROM regions WHERE id = $1', [regionId]);

      await client.query('COMMIT');
      console.log(`[WV Import] Removed region "${regionName}" (${regionId}) and ${descendantIds.length} descendant(s)`);
      res.json({ removed: true, regionName, descendantsRemoved: descendantIds.length });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
      `SELECT region_id, division_id, name, path, score, rejected, geo_similarity
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

    // Update parent: clear children-related status, assignments, and suggestions
    await client.query(
      'DELETE FROM region_members WHERE region_id = $1',
      [regionId],
    );
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
 * Prune to leaves: keep direct children but delete all grandchildren and deeper descendants.
 * Makes the direct children into leaf nodes. Supports undo.
 * POST /api/admin/wv-import/matches/:worldViewId/prune-to-leaves
 */
export async function pruneToLeaves(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/prune-to-leaves — regionId=${regionId}`);

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

    // Get direct children
    const directChildren = await client.query(
      'SELECT id FROM regions WHERE parent_region_id = $1',
      [regionId],
    );
    if (directChildren.rows.length === 0) {
      res.status(400).json({ error: 'Region has no children to prune' });
      return;
    }
    const childIds = directChildren.rows.map(r => r.id as number);

    // Get grandchildren+ (descendants of the direct children, NOT the children themselves)
    const grandDescendants = await client.query(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, 1 AS depth FROM regions WHERE parent_region_id = ANY($1)
        UNION ALL
        SELECT r.id, d.depth + 1 FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      SELECT id FROM desc_regions
    `, [childIds]);

    if (grandDescendants.rows.length === 0) {
      res.status(400).json({ error: 'Direct children have no descendants to prune' });
      return;
    }

    const grandDescIds = grandDescendants.rows.map(r => r.id as number);

    // Snapshot for undo
    const descRegionsResult = await client.query(
      `SELECT id, name, parent_region_id, is_leaf, world_view_id
       FROM regions WHERE id = ANY($1)
       ORDER BY id`,
      [grandDescIds],
    );
    const descImportStatesResult = await client.query(
      `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
              region_map_url, map_image_reviewed, import_run_id
       FROM region_import_state WHERE region_id = ANY($1)`,
      [grandDescIds],
    );
    const descSuggestionsResult = await client.query(
      `SELECT region_id, division_id, name, path, score, rejected, geo_similarity
       FROM region_match_suggestions WHERE region_id = ANY($1)`,
      [grandDescIds],
    );
    const descMembersResult = await client.query(
      'SELECT region_id, division_id FROM region_members WHERE region_id = ANY($1)',
      [grandDescIds],
    );

    // Delete region_members for grandchildren+
    await client.query(
      'DELETE FROM region_members WHERE region_id = ANY($1)',
      [grandDescIds],
    );

    // Delete grandchildren+ regions (deepest-first via recursive CTE)
    await client.query(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, 1 AS depth FROM regions WHERE parent_region_id = ANY($1)
        UNION ALL
        SELECT r.id, d.depth + 1 FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      DELETE FROM regions WHERE id IN (SELECT id FROM desc_regions ORDER BY depth DESC)
    `, [childIds]);

    await client.query('COMMIT');

    // Store undo entry
    undoEntries.set(worldViewId, {
      operation: 'prune-to-leaves',
      regionId,
      timestamp: Date.now(),
      parentImportState: null,
      parentMembers: [],
      descendantRegions: descRegionsResult.rows as UndoEntry['descendantRegions'],
      descendantImportStates: descImportStatesResult.rows as ImportStateSnapshot[],
      descendantSuggestions: descSuggestionsResult.rows as SuggestionSnapshot[],
      descendantMembers: descMembersResult.rows as Array<{ region_id: number; division_id: number }>,
      childSnapshots: [],
    });

    console.log(`[WV Import] Pruned ${grandDescIds.length} grandchildren+ from region ${regionId} (kept ${childIds.length} direct children)`);
    res.json({ pruned: grandDescIds.length, undoAvailable: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
