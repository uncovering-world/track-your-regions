/**
 * Admin WorldView Import — Coverage analysis controller
 *
 * Owns: coverage retrieval (sync + SSE), gap detection, geo-suggest,
 * gap dismiss/undismiss, suggestion approval.
 * See ADR-0009 for the domain-split rationale.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { syncImportMatchStatus } from '../worldView/helpers.js';

// =============================================================================
// Coverage gap subtree helper
// =============================================================================

interface SubtreeNode {
  id: number;
  name: string;
  children: SubtreeNode[];
}

/**
 * For non-leaf coverage gaps, fetch the full GADM descendant subtree.
 * Returns a map from gap division ID to its children tree.
 * Single batch recursive CTE — no per-gap queries.
 */
async function fetchGapSubtrees(nonLeafGapIds: number[]): Promise<Map<number, SubtreeNode[]>> {
  const result = new Map<number, SubtreeNode[]>();
  if (nonLeafGapIds.length === 0) return result;

  // Recursive CTE: walk down from each non-leaf gap, collecting descendants
  const treeResult = await pool.query(`
    WITH RECURSIVE tree AS (
      SELECT id, name, parent_id
      FROM administrative_divisions
      WHERE parent_id = ANY($1)
      UNION ALL
      SELECT ad.id, ad.name, ad.parent_id
      FROM tree t
      JOIN administrative_divisions ad ON ad.parent_id = t.id
    )
    SELECT id, name, parent_id FROM tree ORDER BY parent_id, name
  `, [nonLeafGapIds]);

  // Build parent → children map
  const childrenOf = new Map<number, Array<{ id: number; name: string }>>();
  for (const row of treeResult.rows) {
    const parentId = row.parent_id as number;
    const child = { id: row.id as number, name: row.name as string };
    const arr = childrenOf.get(parentId);
    if (arr) arr.push(child);
    else childrenOf.set(parentId, [child]);
  }

  // Recursively build tree structure
  function buildTree(parentId: number): SubtreeNode[] {
    const children = childrenOf.get(parentId);
    if (!children) return [];
    return children.map(c => ({
      id: c.id,
      name: c.name,
      children: buildTree(c.id),
    }));
  }

  for (const gapId of nonLeafGapIds) {
    const tree = buildTree(gapId);
    if (tree.length > 0) {
      result.set(gapId, tree);
    }
  }

  return result;
}

// =============================================================================
// Coverage retrieval
// =============================================================================

/**
 * Check GADM coverage — find "gap boundaries" at every level.
 *
 * A division is "covered" if it (or any ancestor) is directly assigned as a
 * region_member. A "gap boundary" is an uncovered division whose parent IS
 * covered or is a root with no coverage at all. This catches:
 *  - Entire missing countries (root gaps)
 *  - Missing subdivisions within partially-assigned countries
 *  - Missing sub-subdivisions within partially-assigned states, etc.
 *
 * Response includes spatial proximity suggestions: for each active gap, finds
 * the closest assigned GADM neighbor and suggests adding the gap to that
 * neighbor's region (add_member) or creating a new sibling region (create_region).
 *
 * GET /api/admin/wv-import/matches/:worldViewId/coverage
 */
export async function getCoverage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/coverage`);

  // Get dismissed IDs for this world view
  const wvResult = await pool.query(
    'SELECT COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]) AS dismissed FROM world_views WHERE id = $1',
    [worldViewId],
  );
  const dismissedIds = new Set<number>((wvResult.rows[0]?.dismissed as number[]) ?? []);

  const result = await pool.query(`
    WITH RECURSIVE assigned AS (
      -- All GADM divisions directly assigned as region_members
      SELECT DISTINCT rm.division_id AS id
      FROM region_members rm
      JOIN regions r ON r.id = rm.region_id
      WHERE r.world_view_id = $1
    ),
    -- Walk UP from each assigned division to root, collecting ancestor IDs.
    -- Any ID in this set either IS assigned or HAS an assigned descendant.
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
    -- Walk DOWN from assigned divisions to mark all descendants as covered.
    -- If Russia is assigned, every subdivision under it is fully covered.
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
    -- Gap boundaries: divisions that are neither fully covered (from above)
    -- nor have coverage below, whose parent has partial coverage below
    -- (or is a root with no coverage at all).
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
  `, [worldViewId]);

  // Split into active gaps and dismissed gaps
  const activeGaps: Array<{ id: number; name: string; hasChildren: boolean; parentId: number | null; parentName: string | null }> = [];
  const dismissedGaps: Array<{ id: number; name: string; parentName: string | null }> = [];

  for (const r of result.rows) {
    const gap = {
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

  // For non-leaf gaps, fetch the full GADM subtree so admin can see what's underneath
  const nonLeafGapIds = activeGaps.filter(g => g.hasChildren).map(g => g.id);
  const subtreeByGapId = await fetchGapSubtrees(nonLeafGapIds);

  // Tree-based suggestions: find nearest assigned GADM sibling/cousin per gap.
  // Pure integer joins on parent_id — no geometry, ~8ms for all gaps.
  const gapIds = activeGaps.map(g => g.id);

  const suggestionByGapId = new Map<number, {
    action: 'add_member' | 'create_region';
    targetRegionId: number;
    targetRegionName: string;
  }>();

  if (gapIds.length > 0) {
    // Step 1: Batch sibling match — gaps whose GADM siblings are directly assigned
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
      suggestionByGapId.set(row.gap_id as number, {
        action: 'add_member',
        targetRegionId: row.region_id as number,
        targetRegionName: row.region_name as string,
      });
    }

    // Step 2: Ancestor walk for remaining gaps (no direct siblings assigned).
    // Walk UP the GADM tree from the gap's parent to find the nearest assigned cousin.
    const remainingGaps = activeGaps.filter(g => !suggestionByGapId.has(g.id) && g.parentId != null);
    for (const gap of remainingGaps) {
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
      `, [gap.parentId, worldViewId]);

      if (ancestorResult.rows.length > 0) {
        const row = ancestorResult.rows[0];
        const parentRegionId = row.parent_region_id as number | null;
        if (parentRegionId != null) {
          suggestionByGapId.set(gap.id, {
            action: 'create_region',
            targetRegionId: parentRegionId,
            targetRegionName: row.region_name as string,
          });
        }
      }
    }
  }

  res.json({
    gaps: activeGaps.map(g => ({
      id: g.id,
      name: g.name,
      parentName: g.parentName,
      suggestion: suggestionByGapId.get(g.id) ?? null,
      ...(subtreeByGapId.has(g.id) ? { subtree: subtreeByGapId.get(g.id) } : {}),
    })),
    dismissedCount: dismissedGaps.length,
    dismissedGaps,
  });
}

/**
 * Check GADM coverage with SSE progress streaming.
 * Streams progress: gap finding → sibling match (batch) → ancestor walk (remaining).
 * Pure integer joins, no geometry queries.
 * GET /api/admin/wv-import/matches/:worldViewId/coverage-stream
 */
export async function getCoverageSSE(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] GET /matches/${worldViewId}/coverage-stream (SSE)`);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  interface CoverageSSEEvent {
    type: 'progress' | 'complete' | 'error';
    step?: string;
    elapsed?: number;
    message?: string;
    data?: unknown;
  }

  const sendEvent = (event: CoverageSSEEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const startTime = Date.now();
  const logStep = (step: string) => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[Coverage SSE] WorldView ${worldViewId}: ${step} (${elapsed.toFixed(1)}s)`);
    sendEvent({ type: 'progress', step, elapsed });
  };

  try {
    // Step 1/3: Finding coverage gaps
    logStep('Finding coverage gaps...');

    const wvResult = await pool.query(
      'SELECT COALESCE(dismissed_coverage_ids, ARRAY[]::integer[]) AS dismissed FROM world_views WHERE id = $1',
      [worldViewId],
    );
    const dismissedIds = new Set<number>((wvResult.rows[0]?.dismissed as number[]) ?? []);

    const result = await pool.query(`
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
    `, [worldViewId]);

    // Split into active gaps and dismissed gaps
    const activeGaps: Array<{ id: number; name: string; hasChildren: boolean; parentId: number | null; parentName: string | null }> = [];
    const dismissedGaps: Array<{ id: number; name: string; parentName: string | null }> = [];

    for (const r of result.rows) {
      const gap = {
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

    // Fetch subtrees for non-leaf gaps
    const nonLeafGapIds = activeGaps.filter(g => g.hasChildren).map(g => g.id);
    const subtreeByGapId = await fetchGapSubtrees(nonLeafGapIds);

    logStep(`Found ${activeGaps.length} active gaps, ${dismissedGaps.length} dismissed`);

    // Step 2: Batch sibling match — pure integer join on parent_id (~8ms)
    logStep('Finding sibling matches...');
    const gapIds = activeGaps.map(g => g.id);
    const suggestionByGapId = new Map<number, {
      action: 'add_member' | 'create_region';
      targetRegionId: number;
      targetRegionName: string;
    }>();

    if (gapIds.length > 0) {
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
        suggestionByGapId.set(row.gap_id as number, {
          action: 'add_member',
          targetRegionId: row.region_id as number,
          targetRegionName: row.region_name as string,
        });
      }

      logStep(`Sibling matches: ${siblingResult.rows.length}/${gapIds.length} gaps`);

      // Step 3: Ancestor walk for remaining gaps (no direct siblings assigned).
      // Walk UP the GADM tree from gap's parent to find nearest assigned cousin.
      const remainingGaps = activeGaps.filter(g => !suggestionByGapId.has(g.id) && g.parentId != null);
      if (remainingGaps.length > 0) {
        for (let i = 0; i < remainingGaps.length; i++) {
          const gap = remainingGaps[i];
          logStep(`Ancestor walk ${i + 1}/${remainingGaps.length}: ${gap.name}...`);

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
          `, [gap.parentId, worldViewId]);

          if (ancestorResult.rows.length > 0) {
            const row = ancestorResult.rows[0];
            const parentRegionId = row.parent_region_id as number | null;
            if (parentRegionId != null) {
              suggestionByGapId.set(gap.id, {
                action: 'create_region',
                targetRegionId: parentRegionId,
                targetRegionName: row.region_name as string,
              });
            }
          }
        }
      }
    }

    const addCount = [...suggestionByGapId.values()].filter(s => s.action === 'add_member').length;
    const createCount = [...suggestionByGapId.values()].filter(s => s.action === 'create_region').length;
    const noSuggestion = gapIds.length - suggestionByGapId.size;
    logStep(`Done: ${addCount} add_member, ${createCount} create_region, ${noSuggestion} without suggestion`);

    // Send complete event with full result
    const coverageResult = {
      gaps: activeGaps.map(g => ({
        id: g.id,
        name: g.name,
        parentName: g.parentName,
        suggestion: suggestionByGapId.get(g.id) ?? null,
        ...(subtreeByGapId.has(g.id) ? { subtree: subtreeByGapId.get(g.id) } : {}),
      })),
      dismissedCount: dismissedGaps.length,
      dismissedGaps,
    };

    sendEvent({
      type: 'complete',
      elapsed: (Date.now() - startTime) / 1000,
      data: coverageResult,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Coverage SSE] Error for worldView ${worldViewId}:`, errorMessage);
    sendEvent({
      type: 'error',
      message: errorMessage,
      elapsed: (Date.now() - startTime) / 1000,
    });
  }

  res.end();
}

// =============================================================================
// Gap operations
// =============================================================================

/**
 * Geographic suggestion for a single coverage gap.
 * Ensures assigned divisions have anchor_points populated, then KNN-compares
 * the gap's centroid against those tiny Point geometries (~84ms total).
 * POST /api/admin/wv-import/matches/:worldViewId/geo-suggest-gap
 */
export async function geoSuggestGap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geo-suggest-gap — divisionId=${divisionId}`);

  // Ensure assigned divisions have anchor_points populated (idempotent, only fills NULLs).
  // Uses a dedicated connection to disable triggers (avoids expensive 3857 recomputation).
  const needsFill = await pool.query(`
    SELECT count(*) AS missing
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $1
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE ad.anchor_point IS NULL
  `, [worldViewId]);

  if (parseInt(needsFill.rows[0].missing as string) > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE administrative_divisions DISABLE TRIGGER trg_admin_div_geom_3857');
      await client.query(`
        UPDATE administrative_divisions ad
        SET anchor_point = ST_Centroid(ST_Envelope(ad.geom))
        FROM region_members rm
        JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $1
        WHERE ad.id = rm.division_id AND ad.anchor_point IS NULL
      `, [worldViewId]);
      await client.query('ALTER TABLE administrative_divisions ENABLE TRIGGER trg_admin_div_geom_3857');
      await client.query('COMMIT');
      console.log(`[WV Import] Populated anchor_points for assigned divisions in WV ${worldViewId}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Boundary-based KNN: finds the nearest assigned region by polygon boundary distance.
  // Uses `geom <->` (GiST bbox-based KNN) to catch large regions whose boundary is
  // close even if their centroid is far (e.g., Antarctica for Heard Island).
  // Then computes exact boundary distance with ST_Distance on geography.
  const result = await pool.query(`
    WITH gap_center AS (
      SELECT ST_Centroid(ST_Envelope(geom)) AS pt
      FROM administrative_divisions WHERE id = $1
    ),
    knn_raw AS (
      SELECT
        rm.region_id, r.name AS region_name,
        rm.division_id AS suggestion_division_id,
        ad_neighbor.name AS suggestion_division_name,
        ST_X(COALESCE(ad_neighbor.anchor_point, ST_Centroid(ad_neighbor.geom))) AS sugg_lng,
        ST_Y(COALESCE(ad_neighbor.anchor_point, ST_Centroid(ad_neighbor.geom))) AS sugg_lat,
        ST_X(gc.pt) AS gap_lng, ST_Y(gc.pt) AS gap_lat,
        COALESCE(ad_neighbor.geom_simplified_low, ad_neighbor.geom) AS neighbor_geom,
        gc.pt AS gap_pt
      FROM administrative_divisions ad_neighbor
      JOIN region_members rm ON rm.division_id = ad_neighbor.id
      JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
      CROSS JOIN gap_center gc
      ORDER BY ad_neighbor.geom <-> gc.pt
      LIMIT 15
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

  if (result.rows.length === 0) {
    res.json({ suggestion: null });
    return;
  }

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
  interface ContextNode {
    id: number;
    name: string;
    children: ContextNode[];
    isSuggested: boolean;
  }

  const ancestors = ancestorResult.rows as Array<{ id: number; name: string; depth: number }>;
  const suggestedChildren: ContextNode[] = childrenResult.rows.map(c => ({
    id: c.id as number,
    name: c.name as string,
    children: [],
    isSuggested: false,
  }));

  // Build from root (first) down to suggested (last)
  let contextTree: ContextNode | null = null;
  let currentParent: ContextNode | null = null;

  for (const ancestor of ancestors) {
    const isSuggested = ancestor.id === regionId;
    const node: ContextNode = {
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

  res.json({
    suggestion: {
      action: 'add_member' as const,
      targetRegionId: regionId,
      targetRegionName: row.region_name as string,
    },
    suggestionDivisionId: row.suggestion_division_id as number,
    suggestionDivisionName: row.suggestion_division_name as string,
    gapCenter: [row.gap_lng as number, row.gap_lat as number],
    suggestionCenter: [row.sugg_lng as number, row.sugg_lat as number],
    distanceKm: Math.round(row.distance_km as number),
    contextTree: contextTree ?? undefined,
  });
}

/**
 * Dismiss a coverage gap (mark a GADM division as irrelevant for coverage).
 * POST /api/admin/wv-import/matches/:worldViewId/dismiss-gap
 */
export async function dismissCoverageGap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId } = req.body;
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

  res.json({ dismissed: true });
}

/**
 * Undismiss a coverage gap (restore a GADM division to active gaps).
 * POST /api/admin/wv-import/matches/:worldViewId/undismiss-gap
 */
export async function undismissCoverageGap(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/undismiss-gap — divisionId=${divisionId}`);

  await pool.query(
    `UPDATE world_views SET dismissed_coverage_ids = array_remove(dismissed_coverage_ids, $2) WHERE id = $1`,
    [worldViewId, divisionId],
  );

  res.json({ undismissed: true });
}

/**
 * Approve a coverage suggestion — add gap division to an existing region,
 * or create a new region and add it there.
 * POST /api/admin/wv-import/matches/:worldViewId/approve-coverage
 */
export async function approveCoverageSuggestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { divisionId, regionId, action, gapName } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/approve-coverage — action=${action}, divisionId=${divisionId}, regionId=${regionId}`);

  let targetRegionId = regionId as number;

  if (action === 'add_member') {
    // Verify region belongs to world view
    const regionCheck = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (regionCheck.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
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
      res.status(404).json({ error: 'Parent region not found in this world view' });
      return;
    }

    // Get division name for the new region if not provided
    let regionName = gapName as string | undefined;
    if (!regionName) {
      const divResult = await pool.query(
        'SELECT name FROM administrative_divisions WHERE id = $1',
        [divisionId],
      );
      regionName = (divResult.rows[0]?.name as string) ?? `Region ${divisionId}`;
    }

    const newRegion = await pool.query(
      `INSERT INTO regions (world_view_id, name, parent_region_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [worldViewId, regionName, regionId],
    );
    targetRegionId = newRegion.rows[0].id as number;

    // Create import state for the new region
    await pool.query(
      `INSERT INTO region_import_state (region_id, match_status) VALUES ($1, 'manual_matched')`,
      [targetRegionId],
    );

    await pool.query(
      'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)',
      [targetRegionId, divisionId],
    );
  }

  // Auto-dismiss the gap
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

  res.json({ approved: true, regionId: targetRegionId });
}
