/**
 * Admin WorldView Import — Coverage analysis controller
 *
 * Owns: coverage retrieval (sync + SSE), gap detection, geo-suggest,
 * gap dismiss/undismiss, suggestion approval.
 * See ADR-0009 for the domain-split rationale.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import type { AdministrativeDivisionsRow } from '../../db/schema.generated.js';
import { inRegionTransaction, insertRegion } from '../../db/regionWriter.js';
import type { StreamExchange } from '../../api/route.js';
import { syncImportMatchStatus } from '../worldView/helpers.js';
import {
  type CoverageEvent,
  type CoverageApproved, type CoverageResult, type GapDismissed, type GapUndismissed, type GeoSuggestResult,
  type CoverageSuggestion, type DismissedGap, type GapChild, type RegionContextNode,
} from '../../api/responses/wvImportCoverage.js';
import type { z } from 'zod/v4';
import { notFound } from '../../middleware/errorHandler.js';
import type { divisionIdBodySchema, worldViewIdParamSchema, wvImportApproveCoverageSchema } from '../../types/index.js';

type WorldViewParams = z.output<typeof worldViewIdParamSchema>;
type GapBody = z.output<typeof divisionIdBodySchema>;

// =============================================================================
// Coverage gap children
// =============================================================================

/**
 * The GADM divisions directly under each non-leaf gap, by name, in one query.
 * One level only: every gap's whole subtree runs to megabytes on a large
 * import, most of it under gaps nobody expands, so a deeper level is read when
 * the reviewer expands a node (#1030).
 */
async function fetchGapChildren(nonLeafGapIds: number[]): Promise<Map<number, GapChild[]>> {
  const result = new Map<number, GapChild[]>();
  if (nonLeafGapIds.length === 0) return result;

  const children = await pool.query<Pick<AdministrativeDivisionsRow, 'id' | 'name' | 'parent_id' | 'has_children'>>(`
    SELECT id, name, parent_id, has_children
    FROM administrative_divisions
    WHERE parent_id = ANY($1)
    ORDER BY parent_id, name
  `, [nonLeafGapIds]);

  for (const row of children.rows) {
    // Never null: the query asks for rows under the gaps.
    const parentId = row.parent_id as number;
    const child = { id: row.id, name: row.name, hasChildren: row.has_children };
    const siblings = result.get(parentId);
    if (siblings) siblings.push(child);
    else result.set(parentId, [child]);
  }
  return result;
}

// =============================================================================
// Coverage retrieval
// =============================================================================

interface ActiveGap {
  id: number;
  name: string;
  hasChildren: boolean;
  parentId: number | null;
  parentName: string | null;
}

interface CoverageData {
  activeGaps: ActiveGap[];
  dismissedGaps: DismissedGap[];
  childrenByGapId: Map<number, GapChild[]>;
}

const COVERAGE_GAPS_SQL = `
  WITH RECURSIVE assigned AS (
    SELECT DISTINCT rm.division_id AS id
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE r.world_view_id = $1
  ),
  ancestors AS (
    SELECT a.id AS current_id
    FROM assigned a
    UNION ALL
    SELECT ad.parent_id
    FROM ancestors anc
    JOIN administrative_divisions ad ON ad.id = anc.current_id
    WHERE ad.parent_id IS NOT NULL
  ),
  has_coverage_below AS (
    SELECT DISTINCT current_id AS id FROM ancestors
  ),
  covered_descendants AS (
    SELECT a.id AS current_id
    FROM assigned a
    UNION ALL
    SELECT child.id
    FROM covered_descendants cd
    JOIN administrative_divisions child ON child.parent_id = cd.current_id
  ),
  fully_covered AS (
    SELECT DISTINCT current_id AS id FROM covered_descendants
  )
  SELECT d.id, d.name, d.parent_id, d.has_children, p.name AS parent_name
  FROM administrative_divisions d
  LEFT JOIN administrative_divisions p ON p.id = d.parent_id
  WHERE d.id NOT IN (SELECT id FROM fully_covered)
    AND d.id NOT IN (SELECT id FROM has_coverage_below)
    AND (
      d.parent_id IS NULL
      OR d.parent_id IN (SELECT id FROM has_coverage_below)
    )
  ORDER BY p.name NULLS FIRST, d.name
`;

async function loadCoverageData(worldViewId: number): Promise<CoverageData> {
  const wvResult = await pool.query(
    'SELECT COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]) AS dismissed FROM world_views WHERE id = $1',
    [worldViewId],
  );
  const dismissedIds = new Set<number>((wvResult.rows[0]?.dismissed as number[]) ?? []);

  const result = await pool.query(COVERAGE_GAPS_SQL, [worldViewId]);

  const activeGaps: ActiveGap[] = [];
  const dismissedGaps: DismissedGap[] = [];
  for (const r of result.rows) {
    const gap: ActiveGap = {
      id: r.id as number,
      name: r.name as string,
      hasChildren: r.has_children as boolean,
      parentId: (r.parent_id as number) ?? null,
      parentName: (r.parent_name as string) ?? null,
    };
    if (dismissedIds.has(gap.id)) {
      dismissedGaps.push({ id: gap.id, name: gap.name, parentName: gap.parentName });
    } else {
      activeGaps.push(gap);
    }
  }

  const nonLeafGapIds = activeGaps.filter(g => g.hasChildren).map(g => g.id);
  const childrenByGapId = await fetchGapChildren(nonLeafGapIds);
  return { activeGaps, dismissedGaps, childrenByGapId };
}

async function findSiblingSuggestions(
  gapIds: number[],
  worldViewId: number,
): Promise<Map<number, CoverageSuggestion>> {
  const out = new Map<number, CoverageSuggestion>();
  if (gapIds.length === 0) return out;

  const siblingResult = await pool.query(`
    SELECT DISTINCT ON (gap.id)
      gap.id AS gap_id,
      rm.region_id,
      r.name AS region_name,
      r.parent_region_id
    FROM unnest($1::integer[]) AS gap(id)
    JOIN administrative_divisions gap_div ON gap_div.id = gap.id
    JOIN administrative_divisions sibling
      ON sibling.parent_id = gap_div.parent_id AND sibling.id != gap.id
    JOIN region_members rm ON rm.division_id = sibling.id
    JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
    ORDER BY gap.id, r.id
  `, [gapIds, worldViewId]);

  for (const row of siblingResult.rows) {
    out.set(row.gap_id as number, {
      action: 'add_member',
      targetRegionId: row.region_id as number,
      targetRegionName: row.region_name as string,
    });
  }
  return out;
}

async function findAncestorSuggestion(
  parentId: number,
  worldViewId: number,
): Promise<CoverageSuggestion | null> {
  const ancestorResult = await pool.query(`
    WITH RECURSIVE walk AS (
      SELECT $1::integer AS node_id, 0 AS depth
      UNION ALL
      SELECT ad.parent_id, w.depth + 1
      FROM walk w
      JOIN administrative_divisions ad ON ad.id = w.node_id
      WHERE ad.parent_id IS NOT NULL
    )
    SELECT rm.region_id, r.name AS region_name, r.parent_region_id
    FROM walk w
    JOIN administrative_divisions ad ON ad.id = w.node_id
    JOIN administrative_divisions sibling
      ON sibling.parent_id = ad.parent_id AND sibling.id != ad.id
    JOIN region_members rm ON rm.division_id = sibling.id
    JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
    ORDER BY w.depth
    LIMIT 1
  `, [parentId, worldViewId]);

  if (ancestorResult.rows.length === 0) return null;
  const row = ancestorResult.rows[0];
  const parentRegionId = row.parent_region_id as number | null;
  if (parentRegionId == null) return null;
  return {
    action: 'create_region',
    targetRegionId: parentRegionId,
    targetRegionName: row.region_name as string,
  };
}

async function buildSuggestionsForGaps(
  activeGaps: ActiveGap[],
  worldViewId: number,
  onAncestorStep?: (gap: ActiveGap, index: number, total: number) => void,
): Promise<Map<number, CoverageSuggestion>> {
  const gapIds = activeGaps.map(g => g.id);
  const byId = await findSiblingSuggestions(gapIds, worldViewId);

  const remaining = activeGaps.filter(g => !byId.has(g.id) && g.parentId != null);
  for (let i = 0; i < remaining.length; i++) {
    const gap = remaining[i];
    onAncestorStep?.(gap, i, remaining.length);
    const suggestion = await findAncestorSuggestion(gap.parentId as number, worldViewId);
    if (suggestion) byId.set(gap.id, suggestion);
  }
  return byId;
}

function composeCoverageResponse(
  data: CoverageData,
  suggestionByGapId: Map<number, CoverageSuggestion>,
): CoverageResult {
  return {
    gaps: data.activeGaps.map(g => ({
      id: g.id,
      name: g.name,
      parentName: g.parentName,
      suggestion: suggestionByGapId.get(g.id) ?? null,
      ...(data.childrenByGapId.has(g.id) ? { children: data.childrenByGapId.get(g.id) } : {}),
    })),
    dismissedCount: data.dismissedGaps.length,
    dismissedGaps: data.dismissedGaps,
  };
}

/**
 * Check GADM coverage — find "gap boundaries" at every level.
 *
 * A division is "covered" if it (or any ancestor) is directly assigned as a
 * region_member. A "gap boundary" is an uncovered division whose parent IS
 * covered or is a root with no coverage at all.
 *
 * Response includes spatial proximity suggestions: for each active gap, finds
 * the closest assigned GADM neighbor and suggests adding the gap to that
 * neighbor's region (add_member) or creating a new sibling region (create_region).
 *
 * GET /api/admin/wv-import/matches/:worldViewId/coverage
 */
export async function getCoverage({ params: { worldViewId } }: { params: WorldViewParams }): Promise<CoverageResult> {
  console.log(`[WV Import] GET /matches/${worldViewId}/coverage`);

  const data = await loadCoverageData(worldViewId);
  const suggestionByGapId = await buildSuggestionsForGaps(data.activeGaps, worldViewId);
  return composeCoverageResponse(data, suggestionByGapId);
}

/**
 * The stream's writers, over the `send` the registry opened it with (ADR-0071):
 * each event is held to the stream's schema, as a body is (ADR-0066). CORS is
 * the global middleware's (credentialed, one origin), so the stream sets no
 * header of its own.
 */
function startCoverageSSE(sendEvent: (event: CoverageEvent) => void, worldViewId: number) {
  const startTime = Date.now();
  const logStep = (step: string) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log('[Coverage SSE] WorldView %d: %s (%ss)', worldViewId, step, elapsed.toFixed(1));
    sendEvent({ type: 'progress', step, elapsed });
  };
  const elapsed = () => (Date.now() - startTime) / 1000;

  return { sendEvent, logStep, elapsed };
}

/**
 * Check GADM coverage with SSE progress streaming.
 * Streams progress: gap finding → sibling match (batch) → ancestor walk (remaining).
 * Pure integer joins, no geometry queries.
 * GET /api/admin/wv-import/matches/:worldViewId/coverage-stream
 */
export async function getCoverageSSE(
  { params: { worldViewId } }: { params: z.output<typeof worldViewIdParamSchema> },
  { send }: StreamExchange<CoverageEvent>,
): Promise<void> {
  console.log('[WV Import] GET /matches/%d/coverage-stream (SSE)', worldViewId);

  const { sendEvent, logStep, elapsed } = startCoverageSSE(send, worldViewId);

  try {
    logStep('Finding coverage gaps...');
    const data = await loadCoverageData(worldViewId);
    logStep(`Found ${data.activeGaps.length} active gaps, ${data.dismissedGaps.length} dismissed`);

    logStep('Finding sibling matches...');
    const suggestionByGapId = await buildSuggestionsForGaps(
      data.activeGaps,
      worldViewId,
      (gap, i, total) => logStep(`Ancestor walk ${i + 1}/${total}: ${gap.name}...`),
    );

    const addCount = [...suggestionByGapId.values()].filter(s => s.action === 'add_member').length;
    const createCount = [...suggestionByGapId.values()].filter(s => s.action === 'create_region').length;
    const noSuggestion = data.activeGaps.length - suggestionByGapId.size;
    logStep(`Done: ${addCount} add_member, ${createCount} create_region, ${noSuggestion} without suggestion`);

    sendEvent({
      type: 'complete',
      elapsed: elapsed(),
      data: composeCoverageResponse(data, suggestionByGapId),
    });
  } catch (err) {
    console.error('[Coverage SSE] Error for worldView %d:', worldViewId, err);
    sendEvent({ type: 'error', message: 'The coverage check failed; the server log has the cause.', elapsed: elapsed() });
  }
}

// =============================================================================
// Gap operations
// =============================================================================

/**
 * Geographic suggestion for a single coverage gap.
 * KNN-compares the gap's anchor point against the assigned divisions' boundaries
 * (~84ms total).
 * POST /api/admin/wv-import/matches/:worldViewId/geo-suggest-gap
 */
export async function geoSuggestGap(
  { params: { worldViewId }, body: { divisionId } }: { params: WorldViewParams; body: GapBody },
): Promise<GeoSuggestResult> {
  console.log(`[WV Import] POST /matches/${worldViewId}/geo-suggest-gap — divisionId=${divisionId}`);

  // A division's anchor_point is the focus trigger's (#674): every row with
  // geometry has one, written from geometry_focus(). The gap is placed there
  // too, as the neighbours are: the centre of its envelope lies on the other
  // side of the world for a division over the dateline, Chukot's at longitude
  // 0 rather than 174 (#1029). A row without one falls back to its centroid.

  // Boundary-based KNN: finds the nearest assigned region by polygon boundary distance.
  // Uses `geom <->` (GiST bbox-based KNN) to catch large regions whose boundary is
  // close even if their centroid is far (e.g., Antarctica for Heard Island).
  // Then computes exact boundary distance with ST_Distance on geography.
  //
  // `<->` measures planar degrees and does not wrap, so a neighbour just across
  // the dateline -- Tonga from Fiji, Alaska from Chukotka -- is some 350
  // degrees away in it and can miss the candidates. A second pass from the
  // point shifted by 360 degrees collects that side; the geography distance
  // then ranks both.
  const result = await pool.query(`
    WITH gap_center AS (
      SELECT pt, ST_Translate(pt, CASE WHEN ST_X(pt) >= 0 THEN -360 ELSE 360 END, 0) AS pt_across
      FROM (
        SELECT COALESCE(anchor_point, ST_Centroid(geom)) AS pt
        FROM administrative_divisions WHERE id = $1
      ) gap
    ),
    candidates AS (
      (SELECT rm.region_id, rm.division_id
       FROM administrative_divisions ad
       JOIN region_members rm ON rm.division_id = ad.id
       JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
       CROSS JOIN gap_center gc
       ORDER BY ad.geom <-> gc.pt
       LIMIT 15)
      UNION
      (SELECT rm.region_id, rm.division_id
       FROM administrative_divisions ad
       JOIN region_members rm ON rm.division_id = ad.id
       JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
       CROSS JOIN gap_center gc
       ORDER BY ad.geom <-> gc.pt_across
       LIMIT 15)
    ),
    knn_raw AS (
      SELECT
        c.region_id, r.name AS region_name,
        c.division_id AS suggestion_division_id,
        ad_neighbor.name AS suggestion_division_name,
        ST_X(COALESCE(ad_neighbor.anchor_point, ST_Centroid(ad_neighbor.geom))) AS sugg_lng,
        ST_Y(COALESCE(ad_neighbor.anchor_point, ST_Centroid(ad_neighbor.geom))) AS sugg_lat,
        ST_X(gc.pt) AS gap_lng, ST_Y(gc.pt) AS gap_lat,
        COALESCE(ad_neighbor.geom_simplified_low, ad_neighbor.geom) AS neighbor_geom,
        gc.pt AS gap_pt
      FROM candidates c
      JOIN administrative_divisions ad_neighbor ON ad_neighbor.id = c.division_id
      JOIN regions r ON r.id = c.region_id
      CROSS JOIN gap_center gc
    ),
    per_region AS (
      SELECT DISTINCT ON (region_id)
        region_id, region_name,
        suggestion_division_id, suggestion_division_name,
        sugg_lng, sugg_lat, gap_lng, gap_lat,
        ST_Distance(gap_pt::geography, neighbor_geom::geography) / 1000.0 AS distance_km
      FROM knn_raw
      ORDER BY region_id, ST_Distance(gap_pt::geography, neighbor_geom::geography)
    )
    SELECT * FROM per_region ORDER BY distance_km LIMIT 1
  `, [divisionId, worldViewId]);

  if (result.rows.length === 0) return { suggestion: null };

  const row = result.rows[0];
  const regionId = row.region_id as number;

  // Fetch ancestor chain (suggested region → root) and children of the suggested region.
  // Ancestors let admin pick where in the hierarchy to add the gap.
  // Children let admin pick a more specific child (e.g., "South Ocean Islands" under "Antarctica").
  const [ancestorResult, childrenResult] = await Promise.all([
    pool.query(`
      WITH RECURSIVE chain AS (
        SELECT id, name, parent_region_id, 0 AS depth
        FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id, r.name, r.parent_region_id, c.depth + 1
        FROM regions r JOIN chain c ON r.id = c.parent_region_id
      )
      SELECT id, name, depth FROM chain ORDER BY depth DESC
    `, [regionId]),
    pool.query(`
      SELECT id, name FROM regions
      WHERE parent_region_id = $1 AND world_view_id = $2
      ORDER BY name
    `, [regionId, worldViewId]),
  ]);

  // Build nested contextTree: root → ... → suggested (with children attached)
  // ancestorResult is ordered root-first (depth DESC), suggested region is last
  const ancestors = ancestorResult.rows as Array<{ id: number; name: string; depth: number }>;
  const suggestedChildren: RegionContextNode[] = childrenResult.rows.map(c => ({
    id: c.id as number,
    name: c.name as string,
    children: [],
    isSuggested: false,
  }));

  // Build from root (first) down to suggested (last)
  let contextTree: RegionContextNode | null = null;
  let currentParent: RegionContextNode | null = null;

  for (const ancestor of ancestors) {
    const isSuggested = ancestor.id === regionId;
    const node: RegionContextNode = {
      id: ancestor.id,
      name: ancestor.name,
      children: isSuggested ? suggestedChildren : [],
      isSuggested,
    };

    if (!contextTree) {
      contextTree = node;
    } else if (currentParent) {
      currentParent.children = [node];
    }
    currentParent = node;
  }

  return {
    suggestion: {
      action: 'add_member',
      targetRegionId: regionId,
      targetRegionName: row.region_name as string,
    },
    suggestionDivisionId: row.suggestion_division_id as number,
    suggestionDivisionName: row.suggestion_division_name as string,
    gapCenter: [row.gap_lng as number, row.gap_lat as number] as [number, number],
    suggestionCenter: [row.sugg_lng as number, row.sugg_lat as number] as [number, number],
    distanceKm: Math.round(row.distance_km as number),
    ...(contextTree ? { contextTree } : {}),
  };
}

/**
 * Dismiss a coverage gap (mark a GADM division as irrelevant for coverage).
 * POST /api/admin/wv-import/matches/:worldViewId/dismiss-gap
 */
export async function dismissCoverageGap(
  { params: { worldViewId }, body: { divisionId } }: { params: WorldViewParams; body: GapBody },
): Promise<GapDismissed> {
  console.log(`[WV Import] POST /matches/${worldViewId}/dismiss-gap — divisionId=${divisionId}`);

  await pool.query(
    `UPDATE world_views
     SET dismissed_coverage_ids = array_append(
       COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]),
       $2
     )
     WHERE id = $1
       AND NOT ($2 = ANY(COALESCE(dismissed_coverage_ids, ARRAY[]::integer[])))`,
    [worldViewId, divisionId],
  );

  return { dismissed: true };
}

/**
 * Undismiss a coverage gap (restore a GADM division to active gaps).
 * POST /api/admin/wv-import/matches/:worldViewId/undismiss-gap
 */
export async function undismissCoverageGap(
  { params: { worldViewId }, body: { divisionId } }: { params: WorldViewParams; body: GapBody },
): Promise<GapUndismissed> {
  console.log(`[WV Import] POST /matches/${worldViewId}/undismiss-gap — divisionId=${divisionId}`);

  await pool.query(
    `UPDATE world_views SET dismissed_coverage_ids = array_remove(dismissed_coverage_ids, $2) WHERE id = $1`,
    [worldViewId, divisionId],
  );

  return { undismissed: true };
}

// =============================================================================
// Gap operations
// =============================================================================

/**
 * Approve a coverage suggestion — add gap division to an existing region,
 * or create a new region and add it there.
 * POST /api/admin/wv-import/matches/:worldViewId/approve-coverage
 */
export async function approveCoverageSuggestion(
  { params: { worldViewId }, body: { divisionId, regionId, action, gapName } }: {
    params: WorldViewParams;
    body: z.output<typeof wvImportApproveCoverageSchema>;
  },
): Promise<CoverageApproved> {
  console.log(`[WV Import] POST /matches/${worldViewId}/approve-coverage — action=${action}, divisionId=${divisionId}, regionId=${regionId}`);

  let targetRegionId = regionId;

  if (action === 'add_member') {
    // Verify region belongs to world view
    const regionCheck = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (regionCheck.rows.length === 0) {
      throw notFound('Region not found in this world view');
    }

    await pool.query(
      'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [regionId, divisionId],
    );
    await syncImportMatchStatus(regionId);
  } else {
    // create_region: regionId is the parent region
    const parentCheck = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (parentCheck.rows.length === 0) {
      throw notFound('Parent region not found in this world view');
    }

    // Get division name for the new region if not provided
    let regionName = gapName;
    if (!regionName) {
      const divResult = await pool.query(
        'SELECT name FROM administrative_divisions WHERE id = $1',
        [divisionId],
      );
      regionName = (divResult.rows[0]?.name as string) ?? `Region ${divisionId}`;
    }

    // The region, its import state, its member and the gap's dismissal land
    // together: a region created with the gap still offered would be offered
    // to create again.
    const name = regionName;
    targetRegionId = await inRegionTransaction(async (tx) => {
      const created = (await insertRegion(tx, { worldViewId, name, parentRegionId: regionId, color: null })).id;
      await tx.query(
        `INSERT INTO region_import_state (region_id, match_status) VALUES ($1, 'manual_matched')`,
        [created],
      );
      await tx.query(
        'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)',
        [created, divisionId],
      );
      await dismissGap(tx, worldViewId, divisionId);
      return created;
    });
    return { approved: true, regionId: targetRegionId };
  }

  await dismissGap(pool, worldViewId, divisionId);
  return { approved: true, regionId: targetRegionId };
}

/** Take a GADM division off the world view's coverage gaps, once. */
async function dismissGap(db: Pick<PoolClient, 'query'>, worldViewId: number, divisionId: number): Promise<void> {
  await db.query(
    `UPDATE world_views
     SET dismissed_coverage_ids = array_append(
       COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]),
       $2
     )
     WHERE id = $1
       AND NOT ($2 = ANY(COALESCE(dismissed_coverage_ids, ARRAY[]::integer[])))`,
    [worldViewId, divisionId],
  );
}
