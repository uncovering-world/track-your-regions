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
  // 1. Build bidirectional adjacency list
  const adjacency = new Map<number, Set<number>>();
  for (const { divA, divB } of edges) {
    if (!adjacency.has(divA)) adjacency.set(divA, new Set());
    if (!adjacency.has(divB)) adjacency.set(divB, new Set());
    adjacency.get(divA)!.add(divB);
    adjacency.get(divB)!.add(divA);
  }

  // Build division -> assignment lookup
  const divisionMap = new Map<number, DivisionAssignment>();
  for (const a of assignments) {
    divisionMap.set(a.divisionId, a);
  }

  // 2. Group divisions by regionId
  const regionGroups = new Map<number, DivisionAssignment[]>();
  for (const a of assignments) {
    if (!regionGroups.has(a.regionId)) regionGroups.set(a.regionId, []);
    regionGroups.get(a.regionId)!.push(a);
  }

  const anomalies: SpatialAnomaly[] = [];

  // 3. For each region with 2+ divisions, find connected components
  for (const [regionId, regionAssignments] of regionGroups) {
    if (regionAssignments.length < 2) continue;

    const regionDivIds = new Set(regionAssignments.map((a) => a.divisionId));
    const components = findConnectedComponents(regionDivIds, adjacency);

    // 4. Single component = clean region
    if (components.length <= 1) continue;

    // Find the largest component (main body)
    let largestIdx = 0;
    for (let i = 1; i < components.length; i++) {
      if (components[i].size > components[largestIdx].size) {
        largestIdx = i;
      }
    }

    // 5. Process each non-largest component (fragment)
    for (let i = 0; i < components.length; i++) {
      if (i === largestIdx) continue;

      const fragment = components[i];
      const neighborVotes = new Map<number, { count: number; name: string }>();

      // Count cross-region adjacency contacts
      for (const divId of fragment) {
        const neighbors = adjacency.get(divId);
        if (!neighbors) continue;

        for (const neighborDivId of neighbors) {
          const neighborAssignment = divisionMap.get(neighborDivId);
          if (!neighborAssignment) continue;
          if (neighborAssignment.regionId === regionId) continue; // same region, skip

          const existing = neighborVotes.get(neighborAssignment.regionId);
          if (existing) {
            existing.count++;
          } else {
            neighborVotes.set(neighborAssignment.regionId, {
              count: 1,
              name: neighborAssignment.regionName,
            });
          }
        }
      }

      // Skip if no cross-region neighbors (island case)
      if (neighborVotes.size === 0) continue;

      // Pick the region with most contacts (tie-break: lowest regionId)
      let bestRegionId = -1;
      let bestCount = -1;
      let bestName = '';
      for (const [candidateRegionId, { count, name }] of neighborVotes) {
        if (
          count > bestCount ||
          (count === bestCount && candidateRegionId < bestRegionId)
        ) {
          bestRegionId = candidateRegionId;
          bestCount = count;
          bestName = name;
        }
      }

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

      anomalies.push({
        divisions,
        suggestedTargetRegionId: bestRegionId,
        suggestedTargetRegionName: bestName,
        fragmentSize: fragment.size,
        totalRegionSize: regionAssignments.length,
        score: fragment.size / regionAssignments.length,
      });
    }
  }

  // 6. Sort by score ascending (most suspicious first)
  anomalies.sort((a, b) => a.score - b.score);

  return anomalies;
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

    const component = new Set<number>();
    const queue: number[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.add(current);

      const neighbors = adjacency.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (!divisionIds.has(neighbor)) continue; // only intra-region edges
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  return components;
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
