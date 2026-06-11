/**
 * WorldView Import Hierarchy Controller
 *
 * Undo operations and auto-resolve children matching with geo-similarity validation.
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  trigramSearch,
} from '../../services/worldViewImport/aiMatcher.js';
import { getOrFetchGeoshape, computeIoU } from '../../services/worldViewImport/geoshapeCache.js';
import { computeDivisionCoverage } from '../../services/worldViewImport/geoshapeCoverage.js';
import {
  type UndoEntry,
  type ImportStateSnapshot,
  type SuggestionSnapshot,
  undoEntries,
} from './wvImportUtils.js';
import { touchWorkUnitForRegion } from '../../services/worldViewImport/workUnits.js';

// =============================================================================
// Undo helpers
// =============================================================================

type DbClient = PoolClient;

async function restoreDescendantRegions(
  client: DbClient,
  regions: UndoEntry['descendantRegions'],
): Promise<void> {
  const sorted = [...regions].sort((a, b) => a.id - b.id);
  for (const region of sorted) {
    await client.query(
      `INSERT INTO regions (id, name, parent_region_id, is_leaf, world_view_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [region.id, region.name, region.parent_region_id, region.is_leaf, region.world_view_id],
    );
  }
}

async function insertImportStatesIfMissing(
  client: DbClient,
  states: ImportStateSnapshot[],
): Promise<void> {
  for (const state of states) {
    await client.query(
      `INSERT INTO region_import_state (region_id, match_status, needs_manual_fix, fix_note,
        source_url, source_external_id, region_map_url, map_image_reviewed, import_run_id,
        is_work_unit, hierarchy_confirmed, signoff_status, signed_off_at, assignment_waived, reference_division_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (region_id) DO NOTHING`,
      [state.region_id, state.match_status, state.needs_manual_fix, state.fix_note,
       state.source_url, state.source_external_id, state.region_map_url,
       state.map_image_reviewed, state.import_run_id,
       state.is_work_unit, state.hierarchy_confirmed, state.signoff_status,
       state.signed_off_at, state.assignment_waived, state.reference_division_ids],
    );
  }
}

async function upsertImportState(
  client: DbClient,
  state: ImportStateSnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO region_import_state (region_id, match_status, needs_manual_fix, fix_note,
      source_url, source_external_id, region_map_url, map_image_reviewed, import_run_id,
      is_work_unit, hierarchy_confirmed, signoff_status, signed_off_at, assignment_waived, reference_division_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (region_id) DO UPDATE SET
       match_status = EXCLUDED.match_status,
       needs_manual_fix = EXCLUDED.needs_manual_fix,
       fix_note = EXCLUDED.fix_note,
       is_work_unit = EXCLUDED.is_work_unit,
       hierarchy_confirmed = EXCLUDED.hierarchy_confirmed,
       signoff_status = EXCLUDED.signoff_status,
       signed_off_at = EXCLUDED.signed_off_at,
       assignment_waived = EXCLUDED.assignment_waived,
       reference_division_ids = EXCLUDED.reference_division_ids`,
    [state.region_id, state.match_status, state.needs_manual_fix, state.fix_note,
     state.source_url, state.source_external_id, state.region_map_url,
     state.map_image_reviewed, state.import_run_id,
     state.is_work_unit, state.hierarchy_confirmed, state.signoff_status,
     state.signed_off_at, state.assignment_waived, state.reference_division_ids],
  );
}

async function insertSuggestionsForRegionField(
  client: DbClient,
  suggestions: SuggestionSnapshot[],
): Promise<void> {
  for (const sugg of suggestions) {
    await client.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sugg.region_id, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
    );
  }
}

async function insertSuggestionsForRegionId(
  client: DbClient,
  regionId: number,
  suggestions: SuggestionSnapshot[],
): Promise<void> {
  for (const sugg of suggestions) {
    await client.query(
      `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected, geo_similarity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [regionId, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected, sugg.geo_similarity ?? null],
    );
  }
}

async function insertMembersIgnoreConflict(
  client: DbClient,
  members: Array<{ region_id: number; division_id: number }>,
): Promise<void> {
  for (const member of members) {
    await client.query(
      `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [member.region_id, member.division_id],
    );
  }
}

async function restoreParentImportState(
  client: DbClient,
  regionId: number,
  parentImportState: ImportStateSnapshot | null,
): Promise<void> {
  if (!parentImportState) return;
  await client.query(
    `UPDATE region_import_state
     SET match_status = $1, needs_manual_fix = $2, fix_note = $3,
         is_work_unit = $4, hierarchy_confirmed = $5, signoff_status = $6,
         signed_off_at = $7, assignment_waived = $8, reference_division_ids = $9
     WHERE region_id = $10`,
    [parentImportState.match_status, parentImportState.needs_manual_fix,
     parentImportState.fix_note, parentImportState.is_work_unit,
     parentImportState.hierarchy_confirmed, parentImportState.signoff_status,
     parentImportState.signed_off_at, parentImportState.assignment_waived,
     parentImportState.reference_division_ids, regionId],
  );
}

async function restoreParentMembers(
  client: DbClient,
  regionId: number,
  parentMembers: Array<{ region_id: number; division_id: number }>,
): Promise<void> {
  await client.query('DELETE FROM region_members WHERE region_id = $1', [regionId]);
  await insertMembersIgnoreConflict(client, parentMembers);
}

async function restoreChildSnapshot(
  client: DbClient,
  snap: UndoEntry['childSnapshots'][number],
): Promise<void> {
  await client.query('DELETE FROM region_members WHERE region_id = $1', [snap.regionId]);
  await client.query('DELETE FROM region_match_suggestions WHERE region_id = $1', [snap.regionId]);
  if (snap.importState) {
    await upsertImportState(client, snap.importState);
  }
  await insertSuggestionsForRegionId(client, snap.regionId, snap.suggestions);
  await insertMembersIgnoreConflict(client, snap.members);
}

async function undoDescendantRestoration(
  client: DbClient,
  entry: UndoEntry,
): Promise<void> {
  await restoreDescendantRegions(client, entry.descendantRegions);
  await insertImportStatesIfMissing(client, entry.descendantImportStates);
  await insertSuggestionsForRegionField(client, entry.descendantSuggestions);
  await insertMembersIgnoreConflict(client, entry.descendantMembers);
  await restoreParentImportState(client, entry.regionId, entry.parentImportState);
}

async function undoSmartFlatten(client: DbClient, entry: UndoEntry): Promise<void> {
  await restoreDescendantRegions(client, entry.descendantRegions);
  await insertImportStatesIfMissing(client, entry.descendantImportStates);
  await insertSuggestionsForRegionField(client, entry.descendantSuggestions);
  await insertMembersIgnoreConflict(client, entry.descendantMembers);
  await restoreParentMembers(client, entry.regionId, entry.parentMembers);
  await restoreParentImportState(client, entry.regionId, entry.parentImportState);
}

async function undoHandleAsGrouping(client: DbClient, entry: UndoEntry): Promise<void> {
  for (const snap of entry.childSnapshots) {
    await restoreChildSnapshot(client, snap);
  }
  await restoreParentImportState(client, entry.regionId, entry.parentImportState);
  await restoreParentMembers(client, entry.regionId, entry.parentMembers);
}

async function undoAutoResolveChildrenOp(client: DbClient, entry: UndoEntry): Promise<void> {
  for (const snap of entry.childSnapshots) {
    await restoreChildSnapshot(client, snap);
  }
  await restoreParentMembers(client, entry.regionId, entry.parentMembers);
  await restoreParentImportState(client, entry.regionId, entry.parentImportState);
}

async function undoCollapseToParent(client: DbClient, entry: UndoEntry): Promise<void> {
  // Restore descendants' import states (regions were kept, just data cleared)
  for (const state of entry.descendantImportStates) {
    await client.query(
      `UPDATE region_import_state
       SET match_status = $1, needs_manual_fix = $2, fix_note = $3,
           is_work_unit = $4, hierarchy_confirmed = $5, signoff_status = $6,
           signed_off_at = $7, assignment_waived = $8, reference_division_ids = $9
       WHERE region_id = $10`,
      [state.match_status, state.needs_manual_fix, state.fix_note,
       state.is_work_unit, state.hierarchy_confirmed, state.signoff_status,
       state.signed_off_at, state.assignment_waived, state.reference_division_ids,
       state.region_id],
    );
  }
  await insertSuggestionsForRegionField(client, entry.descendantSuggestions);
  await insertMembersIgnoreConflict(client, entry.descendantMembers);

  // Restore parent: clear new suggestions/members, restore original
  await client.query('DELETE FROM region_match_suggestions WHERE region_id = $1', [entry.regionId]);
  await restoreParentMembers(client, entry.regionId, entry.parentMembers);
  await restoreParentImportState(client, entry.regionId, entry.parentImportState);
}

async function dispatchUndo(client: DbClient, entry: UndoEntry): Promise<void> {
  switch (entry.operation) {
    case 'dismiss-children':
    case 'prune-to-leaves':
      await undoDescendantRestoration(client, entry);
      break;
    case 'smart-flatten':
      await undoSmartFlatten(client, entry);
      break;
    case 'handle-as-grouping':
      await undoHandleAsGrouping(client, entry);
      break;
    case 'auto-resolve-children':
      await undoAutoResolveChildrenOp(client, entry);
      break;
    case 'collapse-to-parent':
      await undoCollapseToParent(client, entry);
      break;
  }
}

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
    await dispatchUndo(client, entry);
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

type LeafRow = { id: number; name: string; source_external_id: string | null };
type TrigramMatch = AutoResolveMatch & { wikidataId: string | null };

async function collectUnmatchedLeafDescendants(
  worldViewId: number,
  regionId: number,
): Promise<LeafRow[]> {
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
  return leafResult.rows as LeafRow[];
}

async function collectIntermediateContainerIds(
  worldViewId: number,
  regionId: number,
): Promise<number[]> {
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
  return intermediateResult.rows.map(r => r.id as number);
}

async function findTrigramCandidatesForLeaves(
  leaves: LeafRow[],
): Promise<{ trigramMatches: TrigramMatch[]; unmatched: Array<{ id: number; name: string }> }> {
  const trigramMatches: TrigramMatch[] = [];
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
  return { trigramMatches, unmatched };
}

async function computeMatchGeoSim(match: TrigramMatch): Promise<number | null> {
  if (!match.wikidataId) return null;
  try {
    const available = await getOrFetchGeoshape(match.wikidataId);
    if (available) {
      return await computeIoU(match.wikidataId, match.divisionId);
    }
  } catch (err) {
    console.warn(`[AutoResolve] Geo-sim failed for ${match.regionName}:`, err instanceof Error ? err.message : err);
  }
  return null;
}

function classifyMatchByGeoSim(
  match: TrigramMatch,
  geoSim: number | null,
  autoMatched: AutoResolveMatch[],
  needsReview: AutoResolveMatch[],
  unmatched: Array<{ id: number; name: string }>,
): void {
  match.geoSimilarity = geoSim;
  if (geoSim === 0) {
    console.log(`[AutoResolve] Rejected ${match.regionName} → ${match.divisionName} (zero geo overlap)`);
    unmatched.push({ id: match.regionId, name: match.regionName });
  } else if (geoSim != null && geoSim >= GEO_SIM_AUTO_THRESHOLD) {
    match.action = 'auto_matched';
    autoMatched.push(match);
  } else {
    match.action = 'needs_review';
    needsReview.push(match);
  }
}

async function partitionMatchesByGeoSim(
  trigramMatches: TrigramMatch[],
  unmatched: Array<{ id: number; name: string }>,
): Promise<{ autoMatched: AutoResolveMatch[]; needsReview: AutoResolveMatch[] }> {
  const autoMatched: AutoResolveMatch[] = [];
  const needsReview: AutoResolveMatch[] = [];
  for (const match of trigramMatches) {
    const geoSim = await computeMatchGeoSim(match);
    classifyMatchByGeoSim(match, geoSim, autoMatched, needsReview, unmatched);
  }
  return { autoMatched, needsReview };
}

async function categorizeParentMembers(
  regionId: number,
  autoMatched: AutoResolveMatch[],
): Promise<{
  kept: Array<{ divisionId: number; name: string }>;
  redundant: Array<{ divisionId: number; name: string; coverage: number }>;
}> {
  const parentMembersResult = await pool.query(`
    SELECT rm.division_id, ad.name
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = $1
  `, [regionId]);

  const kept: Array<{ divisionId: number; name: string }> = [];
  const redundant: Array<{ divisionId: number; name: string; coverage: number }> = [];

  if (parentMembersResult.rows.length === 0 || autoMatched.length === 0) {
    for (const row of parentMembersResult.rows) {
      kept.push({ divisionId: row.division_id as number, name: row.name as string });
    }
    return { kept, redundant };
  }

  const childDivisionIds = autoMatched.map(m => m.divisionId);
  for (const row of parentMembersResult.rows) {
    const divId = row.division_id as number;
    const divName = row.name as string;
    const coverage = await computeDivisionCoverage(divId, childDivisionIds);
    if (coverage != null && coverage > 0.8) {
      redundant.push({ divisionId: divId, name: divName, coverage });
    } else {
      kept.push({ divisionId: divId, name: divName });
    }
  }
  return { kept, redundant };
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
  // Phase 1: Collect unmatched leaf descendants + intermediate containers
  const leaves = await collectUnmatchedLeafDescendants(worldViewId, regionId);
  const intermediateIds = await collectIntermediateContainerIds(worldViewId, regionId);
  const total = leaves.length;

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

  // Phase 2: Trigram-search all unmatched leaves
  const { trigramMatches, unmatched } = await findTrigramCandidatesForLeaves(leaves);

  // Phase 3: Compute geo-similarity and partition matches
  const { autoMatched, needsReview } = await partitionMatchesByGeoSim(trigramMatches, unmatched);

  // Phase 4: Smart parent cleanup — only based on auto-matched divisions
  const parentMembers = await categorizeParentMembers(regionId, autoMatched);

  return {
    autoMatched,
    needsReview,
    unmatched,
    parentMembers,
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

// =============================================================================
// autoResolveChildren helpers
// =============================================================================

async function snapshotAffectedRegions(
  client: DbClient,
  affectedIds: number[],
): Promise<UndoEntry['childSnapshots']> {
  const snapshots: UndoEntry['childSnapshots'] = [];
  for (const descId of affectedIds) {
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
    snapshots.push({
      regionId: descId,
      importState: stateResult.rows[0] as ImportStateSnapshot ?? null,
      suggestions: sugResult.rows as SuggestionSnapshot[],
      members: memResult.rows as Array<{ region_id: number; division_id: number }>,
    });
  }
  return snapshots;
}

async function insertSuggestionIfMissing(
  client: DbClient,
  match: AutoResolveMatch,
): Promise<void> {
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
}

async function applyAutoMatches(
  client: DbClient,
  matches: AutoResolveMatch[],
): Promise<void> {
  for (const match of matches) {
    await client.query(
      `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [match.regionId, match.divisionId],
    );
    await insertSuggestionIfMissing(client, match);
    await client.query(
      `UPDATE region_import_state SET match_status = 'auto_matched' WHERE region_id = $1`,
      [match.regionId],
    );
  }
}

async function applyNeedsReviewMatches(
  client: DbClient,
  matches: AutoResolveMatch[],
): Promise<void> {
  for (const match of matches) {
    await insertSuggestionIfMissing(client, match);
    await client.query(
      `UPDATE region_import_state SET match_status = 'needs_review' WHERE region_id = $1`,
      [match.regionId],
    );
  }
}

async function promoteContainersToChildrenMatched(
  client: DbClient,
  regionId: number,
  intermediateIds: number[],
): Promise<void> {
  for (const intId of intermediateIds) {
    await client.query(
      `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
      [intId],
    );
  }
  await client.query(
    `UPDATE region_import_state SET match_status = 'children_matched' WHERE region_id = $1`,
    [regionId],
  );
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
    const childSnapshots = await snapshotAffectedRegions(client, allAffectedIds);

    // Snapshot parent
    const parentStateResult = await client.query(
      `SELECT * FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const parentMembersResult = await client.query(
      `SELECT region_id, division_id FROM region_members WHERE region_id = $1`,
      [regionId],
    );

    await applyAutoMatches(client, result.autoMatched);
    await applyNeedsReviewMatches(client, result.needsReview);

    // Only promote containers if ALL leaves are auto_matched (no needs_review, no unmatched)
    const allResolved = result.needsReview.length === 0 && result.unmatched.length === 0;
    if (allResolved) {
      await promoteContainersToChildrenMatched(client, regionId, result.intermediateIds);
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

    await touchWorkUnitForRegion(regionId);

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
