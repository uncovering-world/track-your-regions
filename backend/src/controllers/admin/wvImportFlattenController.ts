/**
 * WorldView Import Flatten Controller
 *
 * Flatten and grouping operations: collapse to parent, smart flatten (preview + execute),
 * sync instances across duplicate regions, handle-as-grouping (country-level matching).
 */

import { pool, rollbackQuietly } from '../../db/index.js';
import { isVisitedRegionDelete, visitedRegionRefusal, visitsOn } from '../../db/regionVisits.js';
import type { InstancesSynced } from '../../api/responses/worldViewImport.js';
import {
  matchChildrenAsCountries,
} from '../../services/worldViewImport/index.js';
import {
  dbSearchSingleRegion,
  trigramSearch,
} from '../../services/worldViewImport/aiMatcher.js';
import { descendantSearchScopes } from '../../services/worldViewImport/dbSearchMatcher.js';
import {
  type UndoEntry,
  type ImportStateSnapshot,
  type SuggestionSnapshot,
  undoEntries,
  computeGeoSimilarityIfNeeded,
} from './wvImportUtils.js';
import { beginRegionTransaction, deleteRegions, invalidateRegionGeometry, lockSubtree } from '../../db/regionWriter.js';
import type { AreaGeometry } from '../../api/responses/regions.js';
import {
  ChildrenCollapsed, ChildrenGrouped, FlattenPreviewResult, SmartFlattenResult,
  type FlattenDone, type FlattenPreview,
} from '../../api/responses/wvImportTreeOps.js';
import type { z } from 'zod/v4';
import { badRequest, createError, failure, notFound } from '../../middleware/errorHandler.js';
import type { worldViewIdParamSchema, wvImportRegionIdSchema } from '../../types/index.js';

// =============================================================================
// Flatten and grouping endpoints
// =============================================================================

/**
 * Collapse to parent: clear all descendants' suggestions/assignments (keep the child regions)
 * and generate suggestions for the parent region instead.
 * POST /api/admin/wv-import/matches/:worldViewId/collapse-to-parent
 */
export async function collapseToParent(
  { params: { worldViewId }, body: input }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportRegionIdSchema> },
): Promise<ChildrenCollapsed> {
  const { regionId } = input;
  console.log(`[WV Import] POST /matches/${worldViewId}/collapse-to-parent — regionId=${regionId}`);

  let body: ChildrenCollapsed;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region belongs to this world view
    const region = await client.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      throw notFound('Region not found in this world view');
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
      throw badRequest('Region has no children to collapse');
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
      body = {
        collapsed: descendantIds.length,
        parentSuggestions: searchResult.found,
        undoAvailable: true,
      };
    } catch (searchErr) {
      console.warn(`[WV Import] Collapse succeeded but parent search failed:`, searchErr instanceof Error ? searchErr.message : searchErr);
      body = {
        collapsed: descendantIds.length,
        parentSuggestions: 0,
        undoAvailable: true,
      };
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return body;
}

/** A descendant region by id and name. */
type DescendantRow = { id: number; name: string };

/** The division an unmatched descendant's name found, which the flatten absorbs with the rest. */
interface DescendantMatch { regionId: number; divisionId: number }

/**
 * Find a division for each descendant that has none, and store nothing
 * (#1097). The preview draws the shape with these divisions, and the flatten
 * absorbs them into the region with the descendants' members. They are never
 * written onto the descendants, which the flatten deletes, so a preview, a
 * blocked flatten and an undone one all leave the tree as it was. A descendant
 * matches where a single candidate is strong enough, or the top one clearly
 * beats the runner-up.
 */
async function planDescendantMatches(
  descendants: DescendantRow[],
): Promise<{ matches: DescendantMatch[]; stillUnmatched: DescendantRow[] }> {
  const descendantIds = descendants.map(d => d.id);
  const membersCheck = await pool.query(
    `SELECT DISTINCT region_id FROM region_members WHERE region_id = ANY($1)`,
    [descendantIds],
  );
  const matchedIds = new Set(membersCheck.rows.map(r => r.region_id as number));
  const unmatchedDescendants = descendants.filter(d => !matchedIds.has(d.id));

  // Searched inside the matched region above, never worldwide (#1035).
  const scopes = await descendantSearchScopes(unmatchedDescendants.map(d => d.id));
  const matches: DescendantMatch[] = [];
  const stillUnmatched: DescendantRow[] = [];
  for (const desc of unmatchedDescendants) {
    const candidates = await trigramSearch(desc.name, 3, scopes.get(desc.id));
    // Both paths take the same action, so they collapse into one boolean
    // expression (avoids sonarjs/no-duplicated-branches).
    const autoMatched = (candidates.length === 1 && candidates[0].similarity >= 0.5)
      || (candidates.length > 1 && candidates[0].similarity >= 0.7
          && candidates[0].similarity - candidates[1].similarity >= 0.15);
    if (autoMatched) matches.push({ regionId: desc.id, divisionId: candidates[0].divisionId });
    else stillUnmatched.push({ id: desc.id, name: desc.name });
  }
  return { matches, stillUnmatched };
}

/**
 * What a flatten would leave the region: its descendants' divisions, with the
 * ones the flatten would match them to, unified beside its source map.
 */
async function flattenPreviewOf(
  regionId: number, descendantIds: number[], matches: readonly DescendantMatch[],
): Promise<FlattenPreview> {
  const plannedDivisionIds = matches.map(m => m.divisionId);
  // Compute unified geometry of all descendant divisions (simplified for preview)
  const geomResult = await pool.query(`
    WITH divisions AS (
      SELECT division_id FROM region_members WHERE region_id = ANY($1)
      UNION
      SELECT unnest($2::int[])
    )
    SELECT ST_AsGeoJSON(ST_Union(ad.geom_simplified_medium)) AS geojson
    FROM divisions d
    JOIN administrative_divisions ad ON ad.id = d.division_id
  `, [descendantIds, plannedDivisionIds]);

  const geojsonStr = geomResult.rows[0]?.geojson as string | null;
  const geometry = geojsonStr ? JSON.parse(geojsonStr) as AreaGeometry : null;

  // Get parent's region map URL
  const mapUrlResult = await pool.query(
    'SELECT region_map_url FROM region_import_state WHERE region_id = $1',
    [regionId],
  );
  const regionMapUrl = (mapUrlResult.rows[0]?.region_map_url as string | null) ?? null;

  // Count unique divisions
  const divCountResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT division_id FROM region_members WHERE region_id = ANY($1)
       UNION
       SELECT unnest($2::int[])
     ) d`,
    [descendantIds, plannedDivisionIds],
  );
  const divisionCount = parseInt(divCountResult.rows[0]?.cnt as string) || 0;

  console.log(`[WV Import] Smart flatten preview: ${descendantIds.length} descendants, ${divisionCount} divisions`);
  return {
    blocked: false,
    geometry,
    regionMapUrl,
    descendants: descendantIds.length,
    divisions: divisionCount,
  };
}

/**
 * Absorb every descendant's divisions into the region and delete the
 * descendants, in one transaction, keeping an undo entry.
 */
async function absorbDescendants(
  worldViewId: number, regionId: number, descendantIds: number[], matches: readonly DescendantMatch[],
): Promise<FlattenDone> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    const tx = await beginRegionTransaction(client);

    // The branch was read before auto-matching, outside this transaction.
    // Locked now, it is what gets absorbed; one that changed in between is
    // refused rather than half-absorbed (#689).
    const branch = (await lockSubtree(tx, [regionId], false)).map((row) => row.id);
    const read = new Set(descendantIds);
    if (branch.length !== read.size || branch.some((id) => !read.has(id))) {
      throw createError('The region\'s subregions changed while it was being flattened; flatten it again', 409);
    }

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

    // Absorb: every descendant's divisions, with the ones the plan matched to
    // descendants that had none, go to the region
    const allDescDivisionIds = [
      ...descMembersResult.rows.map(r => r.division_id as number),
      ...matches.map(m => m.divisionId),
    ];
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

    // Delete every descendant
    await deleteRegions(tx, descendantIds);

    // Update parent status
    await client.query(
      `UPDATE region_import_state SET match_status = 'manual_matched' WHERE region_id = $1`,
      [regionId],
    );
    await client.query(
      `DELETE FROM region_match_suggestions WHERE region_id = $1`,
      [regionId],
    );

    // The region absorbed the divisions of the descendants it deleted, so
    // its union is neither what it was nor what the descendants drew. The
    // divisions it gained cleared it through the member trigger (ADR-0068);
    // named here as well because deleting the branch is structural, and
    // inside the transaction, so a failure rolls the flatten back rather than
    // answering an error for one that committed (#1026).
    await invalidateRegionGeometry(tx, regionId);

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
    return {
      blocked: false,
      absorbed: descendantIds.length,
      divisions: uniqueDivisionIds.length,
      undoAvailable: true,
    };
  } catch (err) {
    unusable = await rollbackQuietly(client);
    throw err;
  } finally {
    client.release(unusable);
  }
}

/**
 * Smart flatten preview: the shape a flatten would give, with the divisions it would match the
 * region's unmatched descendants to, for the confirmation dialog. It writes nothing.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-flatten/preview
 */
export async function smartFlattenPreview(
  { params: { worldViewId }, body: input }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportRegionIdSchema> },
): Promise<FlattenPreviewResult> {
  const { regionId } = input;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-flatten/preview — regionId=${regionId}`);

  let body: FlattenPreviewResult;
  try {
    // Verify region belongs to this world view and has children
    const region = await pool.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      throw notFound('Region not found in this world view');
    }

    // Get all descendant region IDs (recursive)
    const descendants = await pool.query<DescendantRow>(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, name FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT r.id, r.name FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      SELECT id, name FROM desc_regions
    `, [regionId]);

    if (descendants.rows.length === 0) {
      throw badRequest('Region has no children to flatten');
    }

    const descendantIds = descendants.rows.map(r => r.id);

    // A preview reads: the matches it would make are shown, not stored (#1097).
    const { matches, stillUnmatched } = await planDescendantMatches(descendants.rows);
    body = stillUnmatched.length > 0
      ? { blocked: true, unmatched: stillUnmatched }
      : await flattenPreviewOf(regionId, descendantIds, matches);
  } catch (err) {
    if (typeof (err as { statusCode?: unknown }).statusCode === 'number') throw err;
    console.error(`[WV Import] Smart flatten preview failed:`, err);
    throw failure('Smart flatten preview failed', 500);
  }
  return body;
}

/**
 * Smart flatten: match the unmatched descendants by name, absorb every descendant division into
 * the region, delete the descendants.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-flatten
 */
export async function smartFlatten(
  { params: { worldViewId }, body: input }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportRegionIdSchema> },
): Promise<SmartFlattenResult> {
  const { regionId } = input;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-flatten — regionId=${regionId}`);

  let body: SmartFlattenResult;
  try {
    // Verify region belongs to this world view and has children
    const region = await pool.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      throw notFound('Region not found in this world view');
    }

    // Get all descendant region IDs (recursive)
    const descendants = await pool.query<DescendantRow>(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, name FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT r.id, r.name FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      SELECT id, name FROM desc_regions
    `, [regionId]);

    if (descendants.rows.length === 0) {
      throw badRequest('Region has no children to flatten');
    }

    const descendantIds = descendants.rows.map(r => r.id);

    // Before the name search, which is the slow part: a visited descendant
    // refuses the flatten whatever it would match (#764).
    const visits = await visitsOn(descendantIds);
    if (visits > 0) {
      throw createError(visitedRegionRefusal(visits), 409);
    }

    // The matched divisions are absorbed by the transaction that deletes the
    // descendants, so a flatten that is blocked or fails writes none (#1097).
    const { matches, stillUnmatched } = await planDescendantMatches(descendants.rows);
    body = stillUnmatched.length > 0
      ? { blocked: true, unmatched: stillUnmatched }
      : await absorbDescendants(worldViewId, regionId, descendantIds, matches);
  } catch (err) {
    // absorbDescendants has rolled back; a visited descendant is errorHandler's
    // 409, not this handler's 500 with the driver's text (#764).
    if (isVisitedRegionDelete(err)) throw err;
    // Its own refusals (a missing region, no children, a visited descendant)
    // carry their status; only an unexpected failure becomes the 500.
    if (typeof (err as { statusCode?: unknown }).statusCode === 'number') throw err;
    console.error(`[WV Import] Smart flatten failed:`, err);
    throw failure('Smart flatten failed', 500);
  }
  return body;
}

/**
 * Sync match decisions to other instances of the same imported region.
 * Copies matchStatus, suggestions, and region_members from the source
 * to all other regions with the same sourceUrl in this world view.
 * POST /api/admin/wv-import/matches/:worldViewId/sync-instances
 */
export async function syncInstances(
  { params: { worldViewId }, body: { regionId } }: {
    params: z.output<typeof worldViewIdParamSchema>;
    body: z.output<typeof wvImportRegionIdSchema>;
  },
): Promise<InstancesSynced> {
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
      throw notFound('Region not found in this world view');
    }

    const sourceImportState = await client.query(
      `SELECT source_url, match_status FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const sourceUrl = sourceImportState.rows[0]?.source_url as string | undefined;
    if (!sourceUrl) {
      throw badRequest('Region has no sourceUrl');
    }
    const matchStatus = sourceImportState.rows[0].match_status as string;

    // Find other instances (same sourceUrl, different id)
    const siblings = await client.query(
      `SELECT r.id FROM regions r
       JOIN region_import_state ris ON ris.region_id = r.id
       WHERE r.world_view_id = $1 AND r.id != $2 AND ris.source_url = $3`,
      [worldViewId, regionId, sourceUrl],
    );

    // Nothing to copy to: the transaction wrote nothing, and is closed here
    // rather than left open on a connection going back to the pool.
    if (siblings.rows.length === 0) {
      await client.query('ROLLBACK');
      return { synced: 0 };
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
    return { synced: syncedCount };
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
export async function handleAsGrouping(
  { params: { worldViewId }, body: input }: { params: z.output<typeof worldViewIdParamSchema>; body: z.output<typeof wvImportRegionIdSchema> },
): Promise<ChildrenGrouped> {
  const { regionId } = input;
  console.log(`[WV Import] POST /matches/${worldViewId}/handle-as-grouping — regionId=${regionId}`);

  // Verify region exists and belongs to this world view
  const region = await pool.query(
    'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    throw notFound('Region not found in this world view');
  }

  // Verify it has children
  const childCount = await pool.query(
    'SELECT COUNT(*) FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (parseInt(childCount.rows[0].count as string) === 0) {
    throw badRequest('Region has no children to match as countries');
  }

  let body: ChildrenGrouped;
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
    body = { matched: result.matched, total: result.total, undoAvailable: true };
  } catch (err) {
    console.error(`[WV Import] handle-as-grouping failed:`, err);
    throw failure('Matching failed', 500);
  }
  return body;
}
