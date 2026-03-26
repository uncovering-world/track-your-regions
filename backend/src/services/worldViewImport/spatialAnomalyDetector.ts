/**
 * Spatial Anomaly Detector
 *
 * Detects spatially disconnected fragments (exclaves) in region assignments.
 * A fragment is a group of divisions assigned to a region that is not spatially
 * connected to the region's main body. For each fragment, suggests which
 * neighboring region it likely belongs to based on adjacency contacts.
 *
 * The core algorithm (detectSpatialAnomalies) is a pure function for testability.
 * Database-dependent helpers (getAdjacencyGraph, detectAnomaliesForRegion) wrap it.
 */

import { pool } from '../../db/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface DivisionAssignment {
  divisionId: number;
  memberRowId: number | null; // null for suggested (not yet committed) assignments
  regionId: number;
  regionName: string;
  divisionName?: string;
}

export interface AdjacencyEdge {
  divA: number;
  divB: number;
}

export interface SpatialAnomalyDivision {
  divisionId: number;
  name: string;
  memberRowId: number | null;
  sourceRegionId: number;
  sourceRegionName: string;
}

export interface SpatialAnomaly {
  divisions: SpatialAnomalyDivision[];
  suggestedTargetRegionId: number;
  suggestedTargetRegionName: string;
  fragmentSize: number;
  totalRegionSize: number;
  score: number; // fragmentSize / totalRegionSize — lower = more suspicious
}

// ─── Pure algorithm ─────────────────────────────────────────────────────────────

/**
 * Detect spatially disconnected fragments in region assignments.
 *
 * Algorithm:
 * 1. Build bidirectional adjacency list from edges
 * 2. Group divisions by regionId
 * 3. For each region with 2+ divisions, find connected components via BFS
 *    using only intra-region edges
 * 4. If region has 1 component, it's clean — skip
 * 5. For each non-largest component (fragment):
 *    - Find cross-region adjacency neighbors, count votes per neighboring region
 *    - Pick the region with most neighbor contacts as suggestedTargetRegionId
 *      (tie-break: lowest regionId)
 *    - If no cross-region neighbors, skip (island case)
 *    - Build SpatialAnomaly with score = fragmentSize / totalRegionSize
 * 6. Sort results by score ascending (most suspicious first)
 */
export function detectSpatialAnomalies(
  assignments: DivisionAssignment[],
  edges: AdjacencyEdge[],
): SpatialAnomaly[] {
  const adjacency = buildAdjacencyList(edges);
  const divisionMap = new Map(assignments.map(a => [a.divisionId, a]));
  const regionGroups = groupByRegion(assignments);

  const anomalies: SpatialAnomaly[] = [];
  for (const [regionId, regionAssignments] of regionGroups) {
    const fragments = findFragments(regionAssignments, adjacency);
    for (const fragment of fragments) {
      const anomaly = buildFragmentAnomaly(
        fragment, regionId, regionAssignments.length, adjacency, divisionMap,
      );
      if (anomaly) anomalies.push(anomaly);
    }
  }

  anomalies.sort((a, b) => a.score - b.score);
  return anomalies;
}

/** Build bidirectional adjacency list from edge pairs */
function buildAdjacencyList(edges: AdjacencyEdge[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (const { divA, divB } of edges) {
    if (!adj.has(divA)) adj.set(divA, new Set());
    if (!adj.has(divB)) adj.set(divB, new Set());
    adj.get(divA)!.add(divB);
    adj.get(divB)!.add(divA);
  }
  return adj;
}

/** Group assignments by region, filtering to regions with 2+ divisions */
function groupByRegion(assignments: DivisionAssignment[]): Map<number, DivisionAssignment[]> {
  const groups = new Map<number, DivisionAssignment[]>();
  for (const a of assignments) {
    if (!groups.has(a.regionId)) groups.set(a.regionId, []);
    groups.get(a.regionId)!.push(a);
  }
  // Remove single-division regions — they can't have fragments
  for (const [id, group] of groups) {
    if (group.length < 2) groups.delete(id);
  }
  return groups;
}

/** Find non-largest connected components (fragments) for a region's divisions */
function findFragments(
  regionAssignments: DivisionAssignment[],
  adjacency: Map<number, Set<number>>,
): Set<number>[] {
  const regionDivIds = new Set(regionAssignments.map(a => a.divisionId));
  const components = findConnectedComponents(regionDivIds, adjacency);
  if (components.length <= 1) return [];

  let largestIdx = 0;
  for (let i = 1; i < components.length; i++) {
    if (components[i].size > components[largestIdx].size) largestIdx = i;
  }
  return components.filter((_, i) => i !== largestIdx);
}

/** Build a SpatialAnomaly for a disconnected fragment, or null if it has no cross-region neighbors */
function buildFragmentAnomaly(
  fragment: Set<number>,
  regionId: number,
  totalRegionSize: number,
  adjacency: Map<number, Set<number>>,
  divisionMap: Map<number, DivisionAssignment>,
): SpatialAnomaly | null {
  const votes = countCrossRegionVotes(fragment, regionId, adjacency, divisionMap);
  if (votes.size === 0) return null; // island — no cross-region neighbors

  const target = pickDominantNeighbor(votes);
  const divisions = buildDivisionList(fragment, regionId, divisionMap);

  return {
    divisions,
    suggestedTargetRegionId: target.id,
    suggestedTargetRegionName: target.name,
    fragmentSize: fragment.size,
    totalRegionSize,
    score: fragment.size / totalRegionSize,
  };
}

/** Count how many adjacency contacts each neighboring region has with the fragment */
function countCrossRegionVotes(
  fragment: Set<number>,
  regionId: number,
  adjacency: Map<number, Set<number>>,
  divisionMap: Map<number, DivisionAssignment>,
): Map<number, { count: number; name: string }> {
  const votes = new Map<number, { count: number; name: string }>();
  for (const divId of fragment) {
    const neighbors = adjacency.get(divId);
    if (!neighbors) continue;
    for (const neighborDivId of neighbors) {
      const na = divisionMap.get(neighborDivId);
      if (!na || na.regionId === regionId) continue;
      const existing = votes.get(na.regionId);
      if (existing) existing.count++;
      else votes.set(na.regionId, { count: 1, name: na.regionName });
    }
  }
  return votes;
}

/** Pick the region with most contacts (tie-break: lowest regionId) */
function pickDominantNeighbor(
  votes: Map<number, { count: number; name: string }>,
): { id: number; name: string } {
  let bestId = -1;
  let bestCount = -1;
  let bestName = '';
  for (const [candidateId, { count, name }] of votes) {
    if (count > bestCount || (count === bestCount && candidateId < bestId)) {
      bestId = candidateId;
      bestCount = count;
      bestName = name;
    }
  }
  return { id: bestId, name: bestName };
}

/** Build the SpatialAnomalyDivision list for a fragment */
function buildDivisionList(
  fragment: Set<number>,
  regionId: number,
  divisionMap: Map<number, DivisionAssignment>,
): SpatialAnomalyDivision[] {
  const divisions: SpatialAnomalyDivision[] = [];
  for (const divId of fragment) {
    const a = divisionMap.get(divId)!;
    divisions.push({
      divisionId: divId,
      name: a.divisionName ?? a.regionName,
      memberRowId: a.memberRowId,
      sourceRegionId: regionId,
      sourceRegionName: a.regionName,
    });
  }
  return divisions;
}

/** Find connected components within a set of division IDs using BFS */
function findConnectedComponents(
  divisionIds: Set<number>,
  adjacency: Map<number, Set<number>>,
): Set<number>[] {
  const visited = new Set<number>();
  const components: Set<number>[] = [];

  for (const startId of divisionIds) {
    if (visited.has(startId)) continue;
    components.push(bfsComponent(startId, divisionIds, adjacency, visited));
  }
  return components;
}

/** BFS from a start node, returning all reachable nodes within the allowed set */
function bfsComponent(
  startId: number,
  allowedIds: Set<number>,
  adjacency: Map<number, Set<number>>,
  visited: Set<number>,
): Set<number> {
  const component = new Set<number>();
  const queue: number[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    component.add(current);

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (allowedIds.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return component;
}

// ─── Database helpers ───────────────────────────────────────────────────────────

/**
 * Build an adjacency graph for the given division IDs using PostGIS spatial
 * relationships. Two divisions are considered adjacent if they touch or are
 * within a tiny tolerance (0.0001 degrees ~11m, handles sliver gaps).
 */
export async function getAdjacencyGraph(
  divisionIds: number[],
): Promise<AdjacencyEdge[]> {
  if (divisionIds.length === 0) return [];

  const { rows } = await pool.query<{ div_a: number; div_b: number }>(
    `SELECT a.id AS div_a, b.id AS div_b
     FROM administrative_divisions a
     JOIN administrative_divisions b ON a.id < b.id
     WHERE a.id = ANY($1) AND b.id = ANY($1)
       AND (ST_Touches(a.geom_simplified_medium, b.geom_simplified_medium)
            OR ST_DWithin(a.geom_simplified_medium, b.geom_simplified_medium, 0.0001))`,
    [divisionIds],
  );

  return rows.map((r) => ({ divA: r.div_a, divB: r.div_b }));
}

/**
 * Convenience wrapper: detect spatial anomalies for all children of a parent
 * region within a world view.
 */
export async function detectAnomaliesForRegion(
  worldViewId: number,
  parentRegionId: number,
): Promise<SpatialAnomaly[]> {
  // Query child regions
  const { rows: childRegions } = await pool.query<{
    id: number;
    name: string;
  }>(
    'SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2',
    [parentRegionId, worldViewId],
  );

  if (childRegions.length < 2) return [];

  const regionIds = childRegions.map((r) => r.id);

  // Query members (excluding custom_geom entries)
  const { rows: members } = await pool.query<{
    member_row_id: number;
    region_id: number;
    division_id: number;
    division_name: string;
  }>(
    `SELECT rm.id AS member_row_id, rm.region_id, rm.division_id,
            ad.name AS division_name
     FROM region_members rm
     JOIN administrative_divisions ad ON ad.id = rm.division_id
     WHERE rm.region_id = ANY($1)
       AND rm.custom_geom IS NULL`,
    [regionIds],
  );

  if (members.length === 0) return [];

  // Build region name lookup
  const regionNameMap = new Map(childRegions.map((r) => [r.id, r.name]));

  // Build DivisionAssignment[]
  const assignments: DivisionAssignment[] = members.map((m) => ({
    divisionId: m.division_id,
    memberRowId: m.member_row_id,
    regionId: m.region_id,
    regionName: regionNameMap.get(m.region_id) ?? '',
    divisionName: m.division_name,
  }));

  // Get adjacency graph
  const divisionIds = assignments.map((a) => a.divisionId);
  const edges = await getAdjacencyGraph(divisionIds);

  return detectSpatialAnomalies(assignments, edges);
}
