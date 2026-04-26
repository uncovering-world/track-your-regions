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

type Adjacency = Map<number, Set<number>>;
type NeighborVote = { count: number; name: string };

/** Build bidirectional adjacency list from edge list */
function buildAdjacency(edges: AdjacencyEdge[]): Adjacency {
  const adjacency: Adjacency = new Map();
  for (const { divA, divB } of edges) {
    if (!adjacency.has(divA)) adjacency.set(divA, new Set());
    if (!adjacency.has(divB)) adjacency.set(divB, new Set());
    adjacency.get(divA)!.add(divB);
    adjacency.get(divB)!.add(divA);
  }
  return adjacency;
}

/** Group assignments by regionId */
function groupByRegion(assignments: DivisionAssignment[]): Map<number, DivisionAssignment[]> {
  const groups = new Map<number, DivisionAssignment[]>();
  for (const a of assignments) {
    if (!groups.has(a.regionId)) groups.set(a.regionId, []);
    groups.get(a.regionId)!.push(a);
  }
  return groups;
}

/** Return the index of the largest component in the given list */
function largestComponentIndex(components: Set<number>[]): number {
  let idx = 0;
  for (let i = 1; i < components.length; i++) {
    if (components[i].size > components[idx].size) idx = i;
  }
  return idx;
}

/** Count cross-region neighbor contacts for all divisions in a fragment */
function tallyCrossRegionVotes(
  fragment: Set<number>,
  sourceRegionId: number,
  adjacency: Adjacency,
  divisionMap: Map<number, DivisionAssignment>,
): Map<number, NeighborVote> {
  const votes = new Map<number, NeighborVote>();
  for (const divId of fragment) {
    const neighbors = adjacency.get(divId);
    if (!neighbors) continue;
    for (const neighborDivId of neighbors) {
      const neighborAssignment = divisionMap.get(neighborDivId);
      if (!neighborAssignment) continue;
      if (neighborAssignment.regionId === sourceRegionId) continue;
      const existing = votes.get(neighborAssignment.regionId);
      if (existing) {
        existing.count++;
      } else {
        votes.set(neighborAssignment.regionId, {
          count: 1,
          name: neighborAssignment.regionName,
        });
      }
    }
  }
  return votes;
}

/** Pick the region with most contacts (tie-break: lowest regionId) */
function pickBestNeighbor(votes: Map<number, NeighborVote>): { regionId: number; name: string } | null {
  let bestRegionId = -1;
  let bestCount = -1;
  let bestName = '';
  for (const [candidateRegionId, { count, name }] of votes) {
    if (count > bestCount || (count === bestCount && candidateRegionId < bestRegionId)) {
      bestRegionId = candidateRegionId;
      bestCount = count;
      bestName = name;
    }
  }
  return bestRegionId === -1 ? null : { regionId: bestRegionId, name: bestName };
}

/** Build anomaly entries for non-largest components of a region */
function anomaliesForRegion(
  regionId: number,
  regionAssignments: DivisionAssignment[],
  components: Set<number>[],
  adjacency: Adjacency,
  divisionMap: Map<number, DivisionAssignment>,
): ClientSpatialAnomaly[] {
  const result: ClientSpatialAnomaly[] = [];
  const largestIdx = largestComponentIndex(components);

  for (let i = 0; i < components.length; i++) {
    if (i === largestIdx) continue;
    const fragment = components[i];
    const votes = tallyCrossRegionVotes(fragment, regionId, adjacency, divisionMap);
    if (votes.size === 0) continue;

    const best = pickBestNeighbor(votes);
    if (!best) continue;

    result.push({
      fragmentDivisionIds: [...fragment],
      sourceRegionId: regionId,
      sourceRegionName: regionAssignments[0].regionName,
      suggestedTargetRegionId: best.regionId,
      suggestedTargetRegionName: best.name,
      fragmentSize: fragment.size,
      totalRegionSize: regionAssignments.length,
      score: fragment.size / regionAssignments.length,
    });
  }
  return result;
}

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
  const adjacency = buildAdjacency(edges);

  const divisionMap = new Map<number, DivisionAssignment>();
  for (const a of assignments) divisionMap.set(a.divisionId, a);

  const regionGroups = groupByRegion(assignments);
  const anomalies: ClientSpatialAnomaly[] = [];

  for (const [regionId, regionAssignments] of regionGroups) {
    if (regionAssignments.length < 2) continue;
    const regionDivIds = new Set(regionAssignments.map((a) => a.divisionId));
    const components = findConnectedComponents(regionDivIds, adjacency);
    if (components.length <= 1) continue;
    anomalies.push(
      ...anomaliesForRegion(regionId, regionAssignments, components, adjacency, divisionMap),
    );
  }

  anomalies.sort((a, b) => a.score - b.score);
  return anomalies;
}

/** BFS expansion: walk intra-set edges from a starting division */
function bfsComponent(
  startId: number,
  divisionIds: Set<number>,
  adjacency: Adjacency,
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
      if (!divisionIds.has(neighbor) || visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return component;
}

/** Find connected components within a set of division IDs using BFS */
function findConnectedComponents(
  divisionIds: Set<number>,
  adjacency: Adjacency,
): Set<number>[] {
  const visited = new Set<number>();
  const components: Set<number>[] = [];

  for (const startId of divisionIds) {
    if (visited.has(startId)) continue;
    components.push(bfsComponent(startId, divisionIds, adjacency, visited));
  }
  return components;
}
