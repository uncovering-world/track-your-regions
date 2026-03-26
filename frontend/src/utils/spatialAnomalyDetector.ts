/**
 * Client-side spatial anomaly detector.
 *
 * Lightweight copy of the backend's pure detection function
 * (backend/src/services/worldViewImport/spatialAnomalyDetector.ts).
 * Runs in the browser for instant re-checks when the admin reassigns
 * divisions in paint mode.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface AdjacencyEdge {
  divA: number;
  divB: number;
}

export interface DivisionAssignment {
  divisionId: number;
  regionId: number;
  regionName: string;
}

export interface ClientSpatialAnomaly {
  fragmentDivisionIds: number[];
  sourceRegionId: number;
  sourceRegionName: string;
  suggestedTargetRegionId: number;
  suggestedTargetRegionName: string;
  fragmentSize: number;
  totalRegionSize: number;
  score: number;
}

// ─── Pure algorithm ─────────────────────────────────────────────────────────────

/**
 * Detect spatially disconnected fragments (exclaves) in region assignments.
 *
 * Same BFS connected-component algorithm as the backend:
 * 1. Build bidirectional adjacency list from edges
 * 2. Group divisions by regionId
 * 3. For each region with 2+ divisions, BFS to find connected components
 *    using only intra-region edges
 * 4. For each non-largest component, find dominant neighboring region
 *    via cross-region adjacency
 * 5. Skip fragments with no cross-region neighbors
 * 6. Score = fragmentSize / totalRegionSize, sort ascending
 */
export function detectSpatialAnomaliesClient(
  assignments: DivisionAssignment[],
  edges: AdjacencyEdge[],
): ClientSpatialAnomaly[] {
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

  const anomalies: ClientSpatialAnomaly[] = [];

  // 3. For each region with 2+ divisions, find connected components
  for (const [regionId, regionAssignments] of regionGroups) {
    if (regionAssignments.length < 2) continue;

    const regionDivIds = new Set(regionAssignments.map(a => a.divisionId));
    const components = findConnectedComponents(regionDivIds, adjacency);

    // Single component = clean region
    if (components.length <= 1) continue;

    // Find the largest component (main body)
    let largestIdx = 0;
    for (let i = 1; i < components.length; i++) {
      if (components[i].size > components[largestIdx].size) {
        largestIdx = i;
      }
    }

    // 4. Process each non-largest component (fragment)
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
          if (neighborAssignment.regionId === regionId) continue; // same region

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

      // 5. Skip if no cross-region neighbors (island case)
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

      const regionAssignment = regionAssignments[0];

      anomalies.push({
        fragmentDivisionIds: [...fragment],
        sourceRegionId: regionId,
        sourceRegionName: regionAssignment.regionName,
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
