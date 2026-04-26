/**
 * Admin WorldView Import — Tree operations controller
 *
 * Owns: destructive tree operations on regions during the review phase.
 * Currently: removeRegionFromImport, renameRegion, dismissChildren, simplifyHierarchy, simplifyChildren.
 * See ADR-0009 for the domain-split rationale.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  undoEntries,
  type ImportStateSnapshot,
  type SuggestionSnapshot,
  type UndoEntry,
} from './wvImportSharedState.js';
import { invalidateRegionGeometry, syncImportMatchStatus } from '../worldView/helpers.js';
import { runSimplifyHierarchy } from './wvImportSimplifyShared.js';

// =============================================================================
// removeRegionFromImport
// =============================================================================

/**
 * Remove a region from the import tree.
 * If reparentChildren=true, moves children up to the region's parent.
 * POST /api/admin/wv-import/matches/:worldViewId/remove-region
 */
export async function removeRegionFromImport(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, reparentChildren, reparentDivisions } = req.body as {
    regionId: number;
    reparentChildren: boolean;
    reparentDivisions?: boolean;
  };
  console.log(`[WV Import] POST /matches/${worldViewId}/remove-region — regionId=${regionId}, reparentChildren=${reparentChildren}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region belongs to this world view
    const region = await client.query(
      'SELECT id, name, parent_region_id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    const regionName = region.rows[0].name as string;
    const parentRegionId = region.rows[0].parent_region_id as number | null;

    // Move divisions to parent if requested
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

      // Delete the region itself (CASCADE cleans up region_import_state, members, etc.)
      await client.query('DELETE FROM regions WHERE id = $1', [regionId]);

      await client.query('COMMIT');
      console.log(`[WV Import] Removed region "${regionName}" (${regionId}), reparented ${reparented.rowCount} children, ${divisionsReparented} divisions`);
      res.json({ removed: true, regionName, childrenReparented: reparented.rowCount, divisionsReparented });
    } else {
      // Delete entire branch: all descendants first, then the region
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
        await client.query('DELETE FROM regions WHERE id = ANY($1)', [descendantIds]);
      }

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

// =============================================================================
// renameRegion
// =============================================================================

/**
 * Rename a region within the import tree.
 * Optionally updates source_url and source_external_id in region_import_state.
 * POST /api/admin/wv-import/matches/:worldViewId/rename-region
 */
export async function renameRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, name, sourceUrl, sourceExternalId } = req.body as {
    regionId: number;
    name: string;
    sourceUrl?: string;
    sourceExternalId?: string;
  };
  console.log(`[WV Import] POST /matches/${worldViewId}/rename-region — regionId=${regionId}, name="${name}"`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region belongs to this world view
    const check = await client.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    const oldName = check.rows[0].name as string;
    await client.query('UPDATE regions SET name = $1 WHERE id = $2', [name.trim(), regionId]);

    // Update enrichment in region_import_state if provided
    if (sourceUrl !== undefined || sourceExternalId !== undefined) {
      const setClauses: string[] = [];
      const values: (string | number)[] = [];
      let paramIdx = 1;

      if (sourceUrl !== undefined) {
        setClauses.push(`source_url = $${paramIdx++}`);
        values.push(sourceUrl);
      }
      if (sourceExternalId !== undefined) {
        setClauses.push(`source_external_id = $${paramIdx++}`);
        values.push(sourceExternalId);
      }
      values.push(regionId);

      await client.query(
        `UPDATE region_import_state SET ${setClauses.join(', ')} WHERE region_id = $${paramIdx}`,
        values,
      );
    }

    await client.query('COMMIT');
    res.json({ renamed: true, regionId, oldName, newName: name.trim() });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =============================================================================
// dismissChildren
// =============================================================================

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
      await client.query('ROLLBACK');
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
      await client.query('ROLLBACK');
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

// =============================================================================
// Simplify hierarchy
// =============================================================================

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
 * Simplify all children of a parent region, one by one.
 * POST /api/admin/wv-import/matches/:worldViewId/simplify-children
 */
export async function simplifyChildren(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/simplify-children — parentRegionId=${regionId}`);

  // Verify region belongs to this world view (mirror simplifyHierarchy's guard
  // so cross-world-view IDs get a 404 instead of a silent 200 with empty results)
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Get child regions that have 2+ divisions (simplification candidates)
  const childrenResult = await pool.query(
    `SELECT r.id, r.name,
       (SELECT count(*)::int FROM region_members rm WHERE rm.region_id = r.id AND rm.custom_geom IS NULL) AS member_count
     FROM regions r
     WHERE r.parent_region_id = $1 AND r.world_view_id = $2
     ORDER BY r.name`,
    [regionId, worldViewId],
  );

  const results: Array<{ regionId: number; regionName: string; replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }>; totalReduced: number }> = [];
  const affectedRegionIds: number[] = [];

  for (const child of childrenResult.rows) {
    if ((child.member_count as number) < 2) continue;

    const { replacements } = await runSimplifyHierarchy(child.id as number, worldViewId);
    if (replacements.length > 0) {
      affectedRegionIds.push(child.id as number);
      const totalReduced = replacements.reduce((sum, r) => sum + r.replacedCount, 0) - replacements.length;
      results.push({ regionId: child.id as number, regionName: child.name as string, replacements, totalReduced });
    }
  }

  // Post-transaction: invalidate geometry and sync match status for affected regions
  for (const id of affectedRegionIds) {
    await invalidateRegionGeometry(id);
    await syncImportMatchStatus(id);
  }

  res.json({ results, totalSimplified: results.length });
}
