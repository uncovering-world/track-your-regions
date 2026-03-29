/**
 * WorldView Import Hierarchy Controller
 *
 * Undo operations and auto-resolve children matching with geo-similarity validation.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  trigramSearch,
} from '../../services/worldViewImport/aiMatcher.js';
import { computeDivisionCoverage, getOrFetchGeoshape, computeIoU } from '../../services/worldViewImport/geoshapeCache.js';
import {
  type UndoEntry,
  type ImportStateSnapshot,
  type SuggestionSnapshot,
  undoEntries,
} from './wvImportUtils.js';

// =============================================================================
// Undo
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

    if (entry.operation === 'dismiss-children' || entry.operation === 'prune-to-leaves') {
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
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [sugg.region_id, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
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
    } else if (entry.operation === 'smart-flatten') {
      // Undo: restore descendants + restore parent's original members
      // Re-insert descendant regions in parent-first order
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
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [sugg.region_id, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
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
      // Restore parent: clear absorbed members, restore original
      await client.query('DELETE FROM region_members WHERE region_id = $1', [entry.regionId]);
      for (const member of entry.parentMembers) {
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
            `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [snap.regionId, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
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
    } else if (entry.operation === 'auto-resolve-children') {
      // Undo: restore all descendant import states, suggestions, members + parent members
      for (const snap of entry.childSnapshots) {
        await client.query('DELETE FROM region_members WHERE region_id = $1', [snap.regionId]);
        await client.query('DELETE FROM region_match_suggestions WHERE region_id = $1', [snap.regionId]);
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
        for (const sugg of snap.suggestions) {
          await client.query(
            `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [snap.regionId, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
          );
        }
        for (const member of snap.members) {
          await client.query(
            `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [member.region_id, member.division_id],
          );
        }
      }
      // Restore parent members and import state
      await client.query('DELETE FROM region_members WHERE region_id = $1', [entry.regionId]);
      for (const member of entry.parentMembers) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [member.region_id, member.division_id],
        );
      }
      if (entry.parentImportState) {
        await client.query(
          `UPDATE region_import_state SET match_status = $1, needs_manual_fix = $2, fix_note = $3
           WHERE region_id = $4`,
          [entry.parentImportState.match_status, entry.parentImportState.needs_manual_fix,
           entry.parentImportState.fix_note, entry.regionId],
        );
      }
    } else if (entry.operation === 'collapse-to-parent') {
      // Restore descendants' import states (regions were kept, just data cleared)
      for (const state of entry.descendantImportStates) {
        await client.query(
          `UPDATE region_import_state
           SET match_status = $1, needs_manual_fix = $2, fix_note = $3
           WHERE region_id = $4`,
          [state.match_status, state.needs_manual_fix, state.fix_note, state.region_id],
        );
      }

      // Re-insert descendant suggestions
      for (const sugg of entry.descendantSuggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [sugg.region_id, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
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

      // Restore parent: clear new suggestions/members, restore original
      await client.query('DELETE FROM region_match_suggestions WHERE region_id = $1', [entry.regionId]);
      await client.query('DELETE FROM region_members WHERE region_id = $1', [entry.regionId]);
      for (const member of entry.parentMembers) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [member.region_id, member.division_id],
        );
      }
      if (entry.parentImportState) {
        await client.query(
          `UPDATE region_import_state SET match_status = $1, needs_manual_fix = $2, fix_note = $3
           WHERE region_id = $4`,
          [entry.parentImportState.match_status, entry.parentImportState.needs_manual_fix,
           entry.parentImportState.fix_note, entry.regionId],
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
// Auto-resolve children
// =============================================================================

const GEO_SIM_AUTO_THRESHOLD = 0.5;

interface AutoResolveMatch {
  regionId: number;
  regionName: string;
  wikidataId: string | null;
  divisionId: number;
  divisionName: string;
  divisionPath: string;
  similarity: number;
  geoSimilarity: number | null; // null = no geoshape
  /** 'auto_matched' if geo-sim >= threshold, 'needs_review' otherwise */
  action: 'auto_matched' | 'needs_review';
}

interface AutoResolveResult {
  autoMatched: AutoResolveMatch[];
  needsReview: AutoResolveMatch[];
  unmatched: Array<{ id: number; name: string }>;
  parentMembers: {
    kept: Array<{ divisionId: number; name: string }>;
    redundant: Array<{ divisionId: number; name: string; coverage: number }>;
  };
  intermediateIds: number[];
  total: number;
}

/**
 * Shared helper: collect unmatched leaf descendants, trigram-search all of them,
 * compute geo-similarity for validation, and check parent member coverage.
 *
 * Matches with geo-sim >= 0.5 → auto_matched (assigned directly).
 * Matches with 0 < geo-sim < 0.5 or no geoshape → needs_review (suggestion only).
 * Matches with geo-sim = 0 → rejected (no geographic overlap at all).
 */
async function findAutoResolveMatches(
  worldViewId: number,
  regionId: number,
): Promise<AutoResolveResult> {
  // Phase 1: Collect unmatched leaf descendants
  const leafResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
      UNION ALL
      SELECT r.id, r.name FROM regions r
      JOIN descendants d ON r.parent_region_id = d.id WHERE r.world_view_id = $2
    )
    SELECT d.id, d.name, ris.source_external_id
    FROM descendants d
    JOIN region_import_state ris ON ris.region_id = d.id
    WHERE NOT EXISTS (
      SELECT 1 FROM regions c WHERE c.parent_region_id = d.id AND c.world_view_id = $2
    ) AND ris.match_status = 'no_candidates'
  `, [regionId, worldViewId]);

  const leaves = leafResult.rows as Array<{ id: number; name: string; source_external_id: string | null }>;
  const total = leaves.length;

  // Collect intermediate container IDs (descendants that have children = not leaves)
  const intermediateResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
      UNION ALL
      SELECT r.id FROM regions r
      JOIN descendants d ON r.parent_region_id = d.id WHERE r.world_view_id = $2
    )
    SELECT d.id FROM descendants d
    WHERE EXISTS (
      SELECT 1 FROM regions c WHERE c.parent_region_id = d.id AND c.world_view_id = $2
    )
  `, [regionId, worldViewId]);
  const intermediateIds = intermediateResult.rows.map(r => r.id as number);

  if (total === 0) {
    return {
      autoMatched: [],
      needsReview: [],
      unmatched: [],
      parentMembers: { kept: [], redundant: [] },
      intermediateIds,
      total: 0,
    };
  }

  // Phase 2: Search all unmatched leaves via trigram
  const trigramMatches: Array<AutoResolveMatch & { wikidataId: string | null }> = [];
  const unmatched: Array<{ id: number; name: string }> = [];
  const usedDivisionIds = new Set<number>();

  for (const leaf of leaves) {
    const candidates = await trigramSearch(leaf.name, 5);
    const best = candidates.find(c => c.similarity >= 0.5 && !usedDivisionIds.has(c.divisionId));

    if (!best) {
      unmatched.push({ id: leaf.id, name: leaf.name });
      continue;
    }

    usedDivisionIds.add(best.divisionId);
    trigramMatches.push({
      regionId: leaf.id,
      regionName: leaf.name,
      wikidataId: leaf.source_external_id,
      divisionId: best.divisionId,
      divisionName: best.name,
      divisionPath: best.path,
      similarity: best.similarity,
      geoSimilarity: null,
      action: 'needs_review', // default until geo-sim computed
    });
  }

  // Phase 3: Compute geo-similarity for each trigram match
  const autoMatched: AutoResolveMatch[] = [];
  const needsReview: AutoResolveMatch[] = [];

  for (const match of trigramMatches) {
    let geoSim: number | null = null;

    if (match.wikidataId) {
      try {
        const available = await getOrFetchGeoshape(match.wikidataId);
        if (available) {
          geoSim = await computeIoU(match.wikidataId, match.divisionId);
        }
      } catch (err) {
        console.warn(`[AutoResolve] Geo-sim failed for ${match.regionName}:`, err instanceof Error ? err.message : err);
      }
    }

    match.geoSimilarity = geoSim;

    if (geoSim === 0) {
      // Zero geographic overlap — reject this match entirely (e.g., Labrador → Asian division)
      console.log(`[AutoResolve] Rejected ${match.regionName} → ${match.divisionName} (zero geo overlap)`);
      unmatched.push({ id: match.regionId, name: match.regionName });
    } else if (geoSim != null && geoSim >= GEO_SIM_AUTO_THRESHOLD) {
      match.action = 'auto_matched';
      autoMatched.push(match);
    } else {
      // geoSim < threshold, or no geoshape available — needs human review
      match.action = 'needs_review';
      needsReview.push(match);
    }
  }

  // Phase 4: Smart parent cleanup — only based on auto-matched divisions
  const parentMembersResult = await pool.query(`
    SELECT rm.division_id, ad.name
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = $1
  `, [regionId]);

  const parentMembersKept: Array<{ divisionId: number; name: string }> = [];
  const parentMembersRedundant: Array<{ divisionId: number; name: string; coverage: number }> = [];

  if (parentMembersResult.rows.length > 0 && autoMatched.length > 0) {
    const childDivisionIds = autoMatched.map(m => m.divisionId);
    for (const row of parentMembersResult.rows) {
      const divId = row.division_id as number;
      const divName = row.name as string;
      const coverage = await computeDivisionCoverage(divId, childDivisionIds);
      if (coverage != null && coverage > 0.8) {
        parentMembersRedundant.push({ divisionId: divId, name: divName, coverage });
      } else {
        parentMembersKept.push({ divisionId: divId, name: divName });
      }
    }
  } else {
    for (const row of parentMembersResult.rows) {
      parentMembersKept.push({ divisionId: row.division_id as number, name: row.name as string });
    }
  }

  return {
    autoMatched,
    needsReview,
    unmatched,
    parentMembers: { kept: parentMembersKept, redundant: parentMembersRedundant },
    intermediateIds,
    total,
  };
}

/**
 * Preview auto-resolve for a container's unmatched leaf descendants.
 * POST /api/admin/wv-import/matches/:worldViewId/auto-resolve-children/preview
 */
export async function autoResolveChildrenPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/auto-resolve-children/preview — regionId=${regionId}`);

  const result = await findAutoResolveMatches(worldViewId, regionId);

  const formatMatch = (m: AutoResolveMatch) => ({
    regionId: m.regionId,
    regionName: m.regionName,
    divisionId: m.divisionId,
    divisionName: m.divisionName,
    similarity: m.similarity,
    geoSimilarity: m.geoSimilarity,
    action: m.action,
  });

  res.json({
    autoMatched: result.autoMatched.map(formatMatch),
    needsReview: result.needsReview.map(formatMatch),
    unmatched: result.unmatched,
    parentMembers: {
      kept: result.parentMembers.kept,
      redundant: result.parentMembers.redundant,
    },
    total: result.total,
  });
}

/**
 * Execute auto-resolve for a container's unmatched leaf descendants.
 * POST /api/admin/wv-import/matches/:worldViewId/auto-resolve-children
 */
export async function autoResolveChildren(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/auto-resolve-children — regionId=${regionId}`);

  const result = await findAutoResolveMatches(worldViewId, regionId);

  if (result.autoMatched.length === 0 && result.needsReview.length === 0) {
    res.status(400).json({
      error: 'No matches found for any leaf descendants',
      failed: result.unmatched,
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Snapshot for undo: all affected descendants + parent
    const allAffectedIds = [
      ...result.autoMatched.map(m => m.regionId),
      ...result.needsReview.map(m => m.regionId),
      ...result.intermediateIds,
    ];
    const childSnapshots: UndoEntry['childSnapshots'] = [];

    for (const descId of allAffectedIds) {
      const stateResult = await client.query(
        `SELECT * FROM region_import_state WHERE region_id = $1`,
        [descId],
      );
      const sugResult = await client.query(
        `SELECT region_id, division_id, name, path, score, rejected, geo_similarity FROM region_match_suggestions WHERE region_id = $1`,
        [descId],
      );
      const memResult = await client.query(
        `SELECT region_id, division_id FROM region_members WHERE region_id = $1`,
        [descId],
      );
      childSnapshots.push({
        regionId: descId,
        importState: stateResult.rows[0] as ImportStateSnapshot ?? null,
        suggestions: sugResult.rows as SuggestionSnapshot[],
        members: memResult.rows as Array<{ region_id: number; division_id: number }>,
      });
    }

    // Snapshot parent
    const parentStateResult = await client.query(
      `SELECT * FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const parentMembersResult = await client.query(
      `SELECT region_id, division_id FROM region_members WHERE region_id = $1`,
      [regionId],
    );

    // Apply auto-matched leaves: assign division + set auto_matched
    for (const match of result.autoMatched) {
      await client.query(
        `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [match.regionId, match.divisionId],
      );
      const existing = await client.query(
        `SELECT 1 FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2`,
        [match.regionId, match.divisionId],
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, geo_similarity)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [match.regionId, match.divisionId, match.divisionName, match.divisionPath,
           Math.round(match.similarity * 1000), match.geoSimilarity],
        );
      }
      await client.query(
        `UPDATE region_import_state SET match_status = 'auto_matched' WHERE region_id = $1`,
        [match.regionId],
      );
    }

    // Apply needs-review leaves: add suggestion only, set needs_review
    for (const match of result.needsReview) {
      const existing = await client.query(
        `SELECT 1 FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2`,
        [match.regionId, match.divisionId],
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, geo_similarity)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [match.regionId, match.divisionId, match.divisionName, match.divisionPath,
           Math.round(match.similarity * 1000), match.geoSimilarity],
        );
      }
      await client.query(
        `UPDATE region_import_state SET match_status = 'needs_review' WHERE region_id = $1`,
        [match.regionId],
      );
    }

    // Only promote containers if ALL leaves are auto_matched (no needs_review, no unmatched)
    const allResolved = result.needsReview.length === 0 && result.unmatched.length === 0;
    if (allResolved) {
      for (const intId of result.intermediateIds) {
        await client.query(
          `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
          [intId],
        );
      }
      await client.query(
        `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
        [regionId],
      );

      // Keep parent's division assignments — children get sub-divisions,
      // but the parent's own GADM mapping defines its geographic area
    }

    await client.query('COMMIT');

    // Store undo entry
    undoEntries.set(worldViewId, {
      operation: 'auto-resolve-children',
      regionId,
      timestamp: Date.now(),
      parentImportState: parentStateResult.rows[0] as ImportStateSnapshot ?? null,
      parentMembers: parentMembersResult.rows as Array<{ region_id: number; division_id: number }>,
      descendantRegions: [],
      descendantImportStates: [],
      descendantSuggestions: [],
      descendantMembers: [],
      childSnapshots,
    });

    console.log(`[WV Import] Auto-resolved ${result.autoMatched.length} auto-matched, ${result.needsReview.length} needs-review, ${result.unmatched.length} unmatched under region ${regionId}`);

    res.json({
      resolved: result.autoMatched.length,
      review: result.needsReview.length,
      total: result.total,
      failed: result.unmatched,
      parentMembersKept: result.parentMembers.kept.length + result.parentMembers.redundant.length,
      parentMembersRemoved: 0,
      undoAvailable: true,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
