/**
 * Smart-simplify endpoints for the WorldView Import.
 *
 * Detects cross-sibling division moves that would allow simplification (read-only
 * detection) and applies a single smart-simplify move followed by recursive
 * simplification of the owner region.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { invalidateRegionGeometry, syncImportMatchStatus } from '../worldView/helpers.js';
import { detectAnomaliesForRegion } from '../../services/worldViewImport/spatialAnomalyDetector.js';

// =============================================================================
// Types
// =============================================================================

type GadmMember = { memberRowId: number; regionId: number; divisionId: number; divisionName: string };

type SmartSimplifyMove = {
  gadmParentId: number;
  gadmParentName: string;
  gadmParentPath: string;
  totalChildren: number;
  ownerRegionId: number;
  ownerRegionName: string;
  divisions: Array<{ divisionId: number; name: string; fromRegionId: number; fromRegionName: string; memberRowId: number }>;
};

// =============================================================================
// Smart-simplify detection helpers
// =============================================================================

async function loadGroupedSiblingMembers(childIds: number[]): Promise<Map<number, GadmMember[]>> {
  const membersResult = await pool.query(`
    SELECT rm.id AS member_row_id, rm.region_id, rm.division_id, ad.name AS division_name, ad.parent_id
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = ANY($1) AND rm.custom_geom IS NULL
  `, [childIds]);

  const byGadmParent = new Map<number, GadmMember[]>();
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
  return byGadmParent;
}

async function loadGadmChildCounts(parentIds: number[]): Promise<Map<number, number>> {
  const countsResult = await pool.query(
    'SELECT parent_id, count(*)::int AS cnt FROM administrative_divisions WHERE parent_id = ANY($1) GROUP BY parent_id',
    [parentIds],
  );
  const counts = new Map<number, number>();
  for (const row of countsResult.rows) {
    counts.set(row.parent_id as number, row.cnt as number);
  }
  return counts;
}

function findCandidateGadmParents(
  byGadmParent: Map<number, GadmMember[]>,
  gadmChildCounts: Map<number, number>,
): number[] {
  const candidates: number[] = [];
  for (const [gadmParentId, members] of byGadmParent) {
    const totalChildren = gadmChildCounts.get(gadmParentId) ?? 0;
    if (members.length !== totalChildren) continue;
    const regionIds = new Set(members.map(m => m.regionId));
    if (regionIds.size < 2) continue;
    candidates.push(gadmParentId);
  }
  return candidates;
}

async function loadGadmPaths(
  candidateParentIds: number[],
): Promise<Map<number, { name: string; path: string }>> {
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

  const paths = new Map<number, { name: string; path: string }>();
  for (const row of pathsResult.rows) {
    const names = row.path_names as string[];
    paths.set(row.root_id as number, {
      name: names[names.length - 1],
      path: names.join(' > '),
    });
  }
  return paths;
}

function pickOwnerRegion(members: GadmMember[]): number {
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
  return ownerRegionId;
}

function buildSmartSimplifyMove(
  gadmParentId: number,
  members: GadmMember[],
  totalChildren: number,
  pathInfo: { name: string; path: string } | undefined,
  childMap: Map<number, string>,
): SmartSimplifyMove | null {
  const ownerRegionId = pickOwnerRegion(members);
  const divisionsToMove = members
    .filter(m => m.regionId !== ownerRegionId)
    .map(m => ({
      divisionId: m.divisionId,
      name: m.divisionName,
      fromRegionId: m.regionId,
      fromRegionName: childMap.get(m.regionId) ?? `Region ${m.regionId}`,
      memberRowId: m.memberRowId,
    }));

  if (divisionsToMove.length === 0) return null;

  return {
    gadmParentId,
    gadmParentName: pathInfo?.name ?? `Division ${gadmParentId}`,
    gadmParentPath: pathInfo?.path ?? '',
    totalChildren,
    ownerRegionId,
    ownerRegionName: childMap.get(ownerRegionId) ?? `Region ${ownerRegionId}`,
    divisions: divisionsToMove,
  };
}

async function runAnomalyDetectionSafely(
  worldViewId: number,
  parentRegionId: number,
): Promise<Awaited<ReturnType<typeof detectAnomaliesForRegion>>> {
  try {
    const anomalies = await detectAnomaliesForRegion(worldViewId, parentRegionId);
    console.log(`[WV Import] Smart-simplify spatial anomalies: ${anomalies.length} found for parent=${parentRegionId}`);
    return anomalies;
  } catch (err) {
    console.error('[WV Import] Spatial anomaly detection failed:', err);
    return [];
  }
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

  try {
    const parentRegion = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [parentRegionId, worldViewId],
    );
    if (parentRegion.rows.length === 0) {
      res.status(404).json({ error: 'Parent region not found in this world view' });
      return;
    }

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

    const byGadmParent = await loadGroupedSiblingMembers(childIds);
    if (byGadmParent.size === 0) {
      const spatialAnomalies = await runAnomalyDetectionSafely(worldViewId, parentRegionId);
      res.json({ moves: [], spatialAnomalies });
      return;
    }

    const gadmChildCounts = await loadGadmChildCounts([...byGadmParent.keys()]);
    const candidateParentIds = findCandidateGadmParents(byGadmParent, gadmChildCounts);

    if (candidateParentIds.length === 0) {
      const spatialAnomalies = await runAnomalyDetectionSafely(worldViewId, parentRegionId);
      res.json({ moves: [], spatialAnomalies });
      return;
    }

    const gadmPaths = await loadGadmPaths(candidateParentIds);
    const moves: SmartSimplifyMove[] = [];
    for (const gadmParentId of candidateParentIds) {
      const members = byGadmParent.get(gadmParentId)!;
      const totalChildren = gadmChildCounts.get(gadmParentId)!;
      const move = buildSmartSimplifyMove(gadmParentId, members, totalChildren, gadmPaths.get(gadmParentId), childMap);
      if (move) moves.push(move);
    }

    moves.sort((a, b) => b.divisions.length - a.divisions.length);

    const spatialAnomalies = await runAnomalyDetectionSafely(worldViewId, parentRegionId);
    res.json({ moves, spatialAnomalies });
  } catch (err) {
    console.error('[WV Import] Smart simplify detect failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Smart simplify detect failed' });
  }
}

/**
 * Apply a single smart-simplify move: reassign divisions to the owner region, then simplify.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-simplify/apply-move
 */
export async function applySmartSimplifyMove(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId, ownerRegionId, memberRowIds } = req.body;
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
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Parent region not found in this world view' });
      return;
    }

    const ownerCheck = await client.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [ownerRegionId, worldViewId],
    );
    if (ownerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
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
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Owner region is not a child of the parent region' });
      return;
    }

    // 3. Verify all memberRowIds belong to children of parentRegionId (security check)
    const memberCheck = await client.query(
      'SELECT id, region_id, division_id FROM region_members WHERE id = ANY($1)',
      [memberRowIds],
    );
    if (memberCheck.rows.length !== memberRowIds.length) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Some memberRowIds were not found' });
      return;
    }
    const affectedRegionIds = new Set<number>();
    for (const row of memberCheck.rows) {
      const regionId = row.region_id as number;
      if (!childIds.has(regionId)) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: `Member row ${row.id} belongs to region ${regionId} which is not a child of the parent` });
        return;
      }
      affectedRegionIds.add(regionId);
    }
    affectedRegionIds.add(ownerRegionId);

    // 4. Remove members whose division_id already exists in the owner region
    //    (avoids unique constraint violation on idx_region_members_unique_no_custom)
    const movingDivisionIds = memberCheck.rows.map((r) => r.division_id as number);
    const existingInOwner = await client.query(
      'SELECT division_id FROM region_members WHERE region_id = $1 AND division_id = ANY($2) AND custom_geom IS NULL',
      [ownerRegionId, movingDivisionIds],
    );
    const alreadyOwned = new Set(existingInOwner.rows.map((r) => r.division_id as number));
    const duplicateRowIds = memberCheck.rows
      .filter((r) => alreadyOwned.has(r.division_id as number))
      .map((r) => r.id as number);
    if (duplicateRowIds.length > 0) {
      await client.query('DELETE FROM region_members WHERE id = ANY($1)', [duplicateRowIds]);
    }

    // 5. Move remaining members to the owner region
    const duplicateSet = new Set(duplicateRowIds);
    const idsToMove = memberRowIds.filter((id: number) => !duplicateSet.has(id));
    let moveCount = duplicateRowIds.length; // count deleted duplicates as "moved"
    if (idsToMove.length > 0) {
      const moveResult = await client.query(
        'UPDATE region_members SET region_id = $1 WHERE id = ANY($2)',
        [ownerRegionId, idsToMove],
      );
      moveCount += moveResult.rowCount ?? 0;
    }

    await client.query('COMMIT');

    // 6. Invalidate geometry + sync match status for all affected regions.
    //    The post-move "simplify hierarchy" pass used to run here automatically
    //    has been removed — it's now an explicit operator action via the
    //    dedicated simplify icon on the tree row. The operator wanted to
    //    decouple "move divisions" from "fold identical members into a single
    //    parent-division row".
    for (const regionId of affectedRegionIds) {
      await invalidateRegionGeometry(regionId);
      await syncImportMatchStatus(regionId);
    }

    console.log(`[WV Import] Smart-simplify applied: moved ${moveCount} members to region ${ownerRegionId}`);
    res.json({ moved: moveCount });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
