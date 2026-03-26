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
import { invalidateRegionGeometry, syncImportMatchStatus } from '../worldView/helpers.js';
import { detectAnomaliesForRegion } from '../../services/worldViewImport/spatialAnomalyDetector.js';

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

    // Update parent: if it has its own divisions, keep them and mark as matched;
    // otherwise clear to no_candidates so the user can re-match at this level.
    const parentHasDivisions = parentMembersResult.rows.length > 0;
    if (parentHasDivisions) {
      // Keep existing divisions — just update status to reflect it's now a leaf with assignments
      await client.query(
        `UPDATE region_import_state SET match_status = 'auto_matched' WHERE region_id = $1`,
        [regionId],
      );
    } else {
      await client.query(
        `UPDATE region_import_state SET match_status = 'no_candidates' WHERE region_id = $1`,
        [regionId],
      );
    }
    // Always clear suggestions (stale after hierarchy change)
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

/**
 * Core simplification logic: merge child divisions into parents when 100% coverage is found.
 * Recursive: keeps merging upward until no more simplifications possible.
 * Opens its own connection and transaction. Returns the list of replacements made.
 */
async function runSimplifyHierarchy(
  regionId: number,
  _worldViewId: number,
): Promise<{ replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const allReplacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> = [];

    // Recursive simplification loop
    for (;;) {
      // Get all full-coverage members (no custom_geom) with their GADM parent
      const members = await client.query(`
        SELECT rm.id AS member_id, rm.division_id, ad.parent_id
        FROM region_members rm
        JOIN administrative_divisions ad ON ad.id = rm.division_id
        WHERE rm.region_id = $1 AND rm.custom_geom IS NULL
      `, [regionId]);

      // Group by parent_id (skip nulls — root divisions can't merge further)
      const byParent = new Map<number, Array<{ memberId: number; divisionId: number }>>();
      for (const row of members.rows) {
        if (row.parent_id == null) continue;
        const parentId = row.parent_id as number;
        if (!byParent.has(parentId)) byParent.set(parentId, []);
        byParent.get(parentId)!.push({ memberId: row.member_id, divisionId: row.division_id });
      }

      // Check which parents are fully covered
      const replacements: Array<{ parentId: number; memberIds: number[]; count: number }> = [];
      for (const [parentId, children] of byParent) {
        const totalResult = await client.query(
          'SELECT count(*)::int AS cnt FROM administrative_divisions WHERE parent_id = $1',
          [parentId],
        );
        const totalChildren = totalResult.rows[0].cnt as number;
        if (children.length === totalChildren) {
          replacements.push({
            parentId,
            memberIds: children.map(c => c.memberId),
            count: children.length,
          });
        }
      }

      if (replacements.length === 0) break;

      // Execute replacements
      for (const rep of replacements) {
        // Delete child members
        await client.query(
          'DELETE FROM region_members WHERE id = ANY($1::int[])',
          [rep.memberIds],
        );

        // Check if parent is already a member (avoid duplicates)
        const existing = await client.query(
          'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
          [regionId, rep.parentId],
        );
        if (existing.rows.length === 0) {
          await client.query(
            'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)',
            [regionId, rep.parentId],
          );
        }

        // Build parent path using recursive ancestor query
        const pathResult = await client.query(`
          WITH RECURSIVE ancestors AS (
            SELECT id, name, parent_id, 1 AS depth
            FROM administrative_divisions WHERE id = $1
            UNION ALL
            SELECT ad.id, ad.name, ad.parent_id, a.depth + 1
            FROM administrative_divisions ad
            JOIN ancestors a ON ad.id = a.parent_id
          )
          SELECT name FROM ancestors ORDER BY depth DESC
        `, [rep.parentId]);
        const names = pathResult.rows.map(r => r.name as string);
        const parentPath = names.join(' > ');
        const parentName = names[names.length - 1];

        allReplacements.push({ parentName, parentPath, replacedCount: rep.count });
      }
    }

    await client.query('COMMIT');
    return { replacements: allReplacements };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Simplify hierarchy by merging child divisions into parents when 100% coverage is found.
 * Recursive: keeps merging upward until no more simplifications possible.
 * POST /api/admin/wv-import/matches/:worldViewId/simplify-hierarchy
 */
export async function simplifyHierarchy(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/simplify-hierarchy — regionId=${regionId}`);

  // Verify region belongs to this world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  const { replacements } = await runSimplifyHierarchy(regionId, worldViewId);

  // Post-transaction: invalidate geometry and sync match status
  if (replacements.length > 0) {
    await invalidateRegionGeometry(regionId);
    await syncImportMatchStatus(regionId);
  }

  const totalReduced = replacements.reduce((sum, r) => sum + r.replacedCount, 0) - replacements.length;
  res.json({ replacements, totalReduced });
}

/**
 * Detect cross-sibling division moves that would allow simplification.
 * READ-ONLY — no mutations. Finds GADM parents whose children are fully present
 * across sibling regions but split among multiple siblings.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-simplify
 */
export async function detectSmartSimplify(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-simplify — parentRegionId=${parentRegionId}`);

  // 1. Verify parentRegionId belongs to this world view
  const parentRegion = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [parentRegionId, worldViewId],
  );
  if (parentRegion.rows.length === 0) {
    res.status(404).json({ error: 'Parent region not found in this world view' });
    return;
  }

  // 2. Get all child regions of parentRegionId
  const childrenResult = await pool.query(
    'SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
    [parentRegionId, worldViewId],
  );
  if (childrenResult.rows.length === 0) {
    res.json({ moves: [], spatialAnomalies: [] });
    return;
  }

  const childMap = new Map<number, string>();
  const childIds: number[] = [];
  for (const row of childrenResult.rows) {
    childIds.push(row.id as number);
    childMap.set(row.id as number, row.name as string);
  }

  // 3. Get all full-coverage members (no custom_geom) across ALL children
  const membersResult = await pool.query(`
    SELECT rm.id AS member_row_id, rm.region_id, rm.division_id, ad.name AS division_name, ad.parent_id
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = ANY($1) AND rm.custom_geom IS NULL
  `, [childIds]);

  // 4. Group members by GADM parent_id
  const byGadmParent = new Map<number, Array<{
    memberRowId: number; regionId: number; divisionId: number; divisionName: string;
  }>>();
  for (const row of membersResult.rows) {
    if (row.parent_id == null) continue;
    const gadmParentId = row.parent_id as number;
    if (!byGadmParent.has(gadmParentId)) byGadmParent.set(gadmParentId, []);
    byGadmParent.get(gadmParentId)!.push({
      memberRowId: row.member_row_id as number,
      regionId: row.region_id as number,
      divisionId: row.division_id as number,
      divisionName: row.division_name as string,
    });
  }

  if (byGadmParent.size === 0) {
    const spatialAnomalies = await detectAnomaliesForRegion(worldViewId, parentRegionId);
    res.json({ moves: [], spatialAnomalies });
    return;
  }

  // 5. Batch-fetch child counts for all GADM parents
  const gadmParentIds = [...byGadmParent.keys()];
  const countsResult = await pool.query(
    'SELECT parent_id, count(*)::int AS cnt FROM administrative_divisions WHERE parent_id = ANY($1) GROUP BY parent_id',
    [gadmParentIds],
  );
  const gadmChildCounts = new Map<number, number>();
  for (const row of countsResult.rows) {
    gadmChildCounts.set(row.parent_id as number, row.cnt as number);
  }

  // 6. Find GADM parents where ALL children are present AND split across multiple siblings
  const candidateParentIds: number[] = [];
  for (const [gadmParentId, members] of byGadmParent) {
    const totalChildren = gadmChildCounts.get(gadmParentId) ?? 0;
    if (members.length !== totalChildren) continue;

    // Check if split across multiple sibling regions
    const regionIds = new Set(members.map(m => m.regionId));
    if (regionIds.size < 2) continue;

    candidateParentIds.push(gadmParentId);
  }

  if (candidateParentIds.length === 0) {
    const spatialAnomalies = await detectAnomaliesForRegion(worldViewId, parentRegionId);
    res.json({ moves: [], spatialAnomalies });
    return;
  }

  // 7. Batch-fetch GADM parent names + paths via recursive ancestor CTE
  const pathsResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, 1 AS depth, id AS root_id
      FROM administrative_divisions WHERE id = ANY($1)
      UNION ALL
      SELECT ad.id, ad.name, ad.parent_id, a.depth + 1, a.root_id
      FROM administrative_divisions ad
      JOIN ancestors a ON ad.id = a.parent_id
    )
    SELECT root_id, array_agg(name ORDER BY depth DESC) AS path_names
    FROM ancestors
    GROUP BY root_id
  `, [candidateParentIds]);

  const gadmPaths = new Map<number, { name: string; path: string }>();
  for (const row of pathsResult.rows) {
    const names = row.path_names as string[];
    gadmPaths.set(row.root_id as number, {
      name: names[names.length - 1],
      path: names.join(' > '),
    });
  }

  // 8. Build moves
  const moves: Array<{
    gadmParentId: number;
    gadmParentName: string;
    gadmParentPath: string;
    totalChildren: number;
    ownerRegionId: number;
    ownerRegionName: string;
    divisions: Array<{
      divisionId: number;
      name: string;
      fromRegionId: number;
      fromRegionName: string;
      memberRowId: number;
    }>;
  }> = [];

  for (const gadmParentId of candidateParentIds) {
    const members = byGadmParent.get(gadmParentId)!;
    const totalChildren = gadmChildCounts.get(gadmParentId)!;
    const pathInfo = gadmPaths.get(gadmParentId);

    // Count members per region to find the owner (most members, tie-break: lowest region ID)
    const countByRegion = new Map<number, number>();
    for (const m of members) {
      countByRegion.set(m.regionId, (countByRegion.get(m.regionId) ?? 0) + 1);
    }
    let ownerRegionId = 0;
    let ownerCount = 0;
    for (const [regionId, count] of countByRegion) {
      if (count > ownerCount || (count === ownerCount && regionId < ownerRegionId)) {
        ownerRegionId = regionId;
        ownerCount = count;
      }
    }

    // Divisions NOT in the owner are move suggestions
    const divisionsToMove = members
      .filter(m => m.regionId !== ownerRegionId)
      .map(m => ({
        divisionId: m.divisionId,
        name: m.divisionName,
        fromRegionId: m.regionId,
        fromRegionName: childMap.get(m.regionId) ?? `Region ${m.regionId}`,
        memberRowId: m.memberRowId,
      }));

    if (divisionsToMove.length === 0) continue;

    moves.push({
      gadmParentId,
      gadmParentName: pathInfo?.name ?? `Division ${gadmParentId}`,
      gadmParentPath: pathInfo?.path ?? '',
      totalChildren,
      ownerRegionId,
      ownerRegionName: childMap.get(ownerRegionId) ?? `Region ${ownerRegionId}`,
      divisions: divisionsToMove,
    });
  }

  // Sort by number of divisions to move (most impactful first)
  moves.sort((a, b) => b.divisions.length - a.divisions.length);

  // Spatial anomaly detection (exclaves & disconnected fragments)
  let spatialAnomalies: Awaited<ReturnType<typeof detectAnomaliesForRegion>> = [];
  try {
    spatialAnomalies = await detectAnomaliesForRegion(worldViewId, parentRegionId);
    console.log(`[WV Import] Smart-simplify spatial anomalies: ${spatialAnomalies.length} found for parent=${parentRegionId}`);
  } catch (err) {
    console.error('[WV Import] Spatial anomaly detection failed:', err);
  }

  res.json({ moves, spatialAnomalies });
}

/**
 * Apply a single smart-simplify move: reassign divisions to the owner region, then simplify.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-simplify/apply-move
 */
export async function applySmartSimplifyMove(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId, ownerRegionId, memberRowIds, skipSimplify } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-simplify/apply-move — parent=${parentRegionId} owner=${ownerRegionId} rows=${memberRowIds.length}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Verify parentRegionId and ownerRegionId belong to this world view
    const parentCheck = await client.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [parentRegionId, worldViewId],
    );
    if (parentCheck.rows.length === 0) {
      res.status(404).json({ error: 'Parent region not found in this world view' });
      return;
    }

    const ownerCheck = await client.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [ownerRegionId, worldViewId],
    );
    if (ownerCheck.rows.length === 0) {
      res.status(404).json({ error: 'Owner region not found in this world view' });
      return;
    }

    // 2. Get child regions of parentRegionId
    const childrenResult = await client.query(
      'SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
      [parentRegionId, worldViewId],
    );
    const childIds = new Set(childrenResult.rows.map(r => r.id as number));

    // Verify ownerRegionId is a child of parentRegionId
    if (!childIds.has(ownerRegionId)) {
      res.status(400).json({ error: 'Owner region is not a child of the parent region' });
      return;
    }

    // 3. Verify all memberRowIds belong to children of parentRegionId (security check)
    const memberCheck = await client.query(
      'SELECT id, region_id FROM region_members WHERE id = ANY($1)',
      [memberRowIds],
    );
    if (memberCheck.rows.length !== memberRowIds.length) {
      res.status(400).json({ error: 'Some memberRowIds were not found' });
      return;
    }
    const affectedRegionIds = new Set<number>();
    for (const row of memberCheck.rows) {
      const regionId = row.region_id as number;
      if (!childIds.has(regionId)) {
        res.status(400).json({ error: `Member row ${row.id} belongs to region ${regionId} which is not a child of the parent` });
        return;
      }
      affectedRegionIds.add(regionId);
    }
    affectedRegionIds.add(ownerRegionId);

    // 4. Move members to the owner region
    const moveResult = await client.query(
      'UPDATE region_members SET region_id = $1 WHERE id = ANY($2)',
      [ownerRegionId, memberRowIds],
    );

    await client.query('COMMIT');

    // 5. Post-commit: simplify the owner region (skip if applying a spatial anomaly fix)
    let replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> = [];
    if (!skipSimplify) {
      const simplifyResult = await runSimplifyHierarchy(ownerRegionId, worldViewId);
      replacements = simplifyResult.replacements;
    }

    // 6. Invalidate geometry + sync match status for all affected regions
    for (const regionId of affectedRegionIds) {
      await invalidateRegionGeometry(regionId);
      await syncImportMatchStatus(regionId);
    }

    console.log(`[WV Import] Smart-simplify applied: moved ${moveResult.rowCount} members to region ${ownerRegionId}, ${replacements.length} simplifications`);
    res.json({
      moved: moveResult.rowCount,
      simplification: {
        replacements,
        totalReduced: replacements.reduce((sum, r) => sum + r.replacedCount, 0) - replacements.length,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
