/**
 * The colour match's result, assembled from the division assignment:
 *   - the Python service's assignments read as the JS branch's
 *   - cluster/region voting (per-cluster best region guess)
 *   - gap-only filter (hide already-assigned divisions)
 *   - per-cluster suggestion rows and the geo preview's features
 *   - the assignments the spatial anomaly check reads
 *   - final `complete` SSE payload construction
 *
 * The queries that feed it — the child regions' centroids for the
 * geographic fallback, the division outlines for the preview, the existing
 * members for the anomaly check — are `controllers/admin/wvImportMatchPhase5.ts`.
 */

import type { DivAssignment, FinalDivAssignment } from '../assign/assignment.js';
import type { AdjacencyEdge, DivisionAssignment, SpatialAnomaly } from '../../spatialAnomalyDetector.js';
import type { AreaGeometry } from '../../../../api/responses/regions.js';
import type {
  ColorMatchCluster, ColorMatchComplete, ColorMatchResult, CvPreviewFeature,
} from '../../../../api/responses/wvImportCvMatch.js';

// =============================================================================
// Shared types
// =============================================================================

export interface CentroidInfo {
  id: number;
  cx: number;
  cy: number;
  assigned: { regionId: number; regionName: string } | null;
}

export interface MatchingResult {
  gadmToPixel: (gx: number, gy: number) => [number, number];
  divAssignments: DivAssignment[];
  finalAssignments: FinalDivAssignment[];
  unsplittableDivs: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  cvOutOfBounds: Array<{ id: number; name: string }>;
  splitDepth: number;
  alignmentSummary: string;
}

// =============================================================================
// The Python service's assignments
// =============================================================================

/** Convert one Python divAssignment to {divAssignment, finalAssignment|unsplittable} */
export function classifyPythonAssignment(
  a: { divisionId: number; clusterId: number; confidence: number; isSplit: boolean; splitClusters?: Array<{ clusterId: number; share: number }> },
): { asDiv: DivAssignment; unsplittable?: MatchingResult['unsplittableDivs'][number]; final?: FinalDivAssignment } {
  const asDiv: DivAssignment = {
    divisionId: a.divisionId,
    clusterId: a.clusterId,
    confidence: a.confidence,
    isSplit: a.isSplit,
    splitClusters: a.splitClusters,
  };
  if (a.isSplit) {
    return {
      asDiv,
      unsplittable: {
        divisionId: a.divisionId,
        clusterId: a.clusterId,
        confidence: a.confidence,
        depth: 0,
        splitClusters: a.splitClusters ?? [],
      },
    };
  }
  return {
    asDiv,
    final: {
      divisionId: a.divisionId,
      clusterId: a.clusterId,
      confidence: a.confidence,
      depth: 0,
    },
  };
}

// =============================================================================
// Cluster/region voting & geo preview
// =============================================================================

/** For each cluster, tally votes (divisions with already-assigned regions) */
export function computeClusterRegionVotes(
  centroids: CentroidInfo[],
  divAssignments: DivAssignment[],
): Map<number, Map<number, { count: number; name: string }>> {
  const clusterRegionVotes = new Map<number, Map<number, { count: number; name: string }>>();
  for (let ci = 0; ci < centroids.length; ci++) {
    const a = divAssignments[ci];
    if (!a) continue;
    const assigned = centroids[ci].assigned;
    if (!assigned || a.clusterId < 0) continue;
    if (!clusterRegionVotes.has(a.clusterId)) clusterRegionVotes.set(a.clusterId, new Map());
    const rv = clusterRegionVotes.get(a.clusterId)!;
    const existing = rv.get(assigned.regionId);
    if (existing) existing.count++;
    else rv.set(assigned.regionId, { count: 1, name: assigned.regionName });
  }
  return clusterRegionVotes;
}

/**
 * Try to inherit a known-division assignment to `a.divisionId` via `a.parentDivisionId`.
 * Returns true if `a.divisionId` is newly added to `knownOrChildOfKnown`.
 */
function inheritKnownFromParent(
  a: FinalDivAssignment,
  knownOrChildOfKnown: Set<number>,
  assignedMap: Map<number, { regionId: number; regionName: string }>,
  parentSet: Set<number>,
): boolean {
  if (!a.parentDivisionId || !parentSet.has(a.parentDivisionId) || knownOrChildOfKnown.has(a.divisionId)) {
    return false;
  }
  knownOrChildOfKnown.add(a.divisionId);
  if (!assignedMap.has(a.divisionId) && assignedMap.has(a.parentDivisionId)) {
    assignedMap.set(a.divisionId, assignedMap.get(a.parentDivisionId)!);
  }
  return true;
}

/**
 * Walk `finalAssignments` parent-links to find all divisions that descend from a known division.
 * Also populates `assignedMap` for any descendant that inherits a parent's assignment.
 */
export function computeKnownOrChildOfKnown(
  finalAssignments: FinalDivAssignment[],
  knownDivisionIds: Set<number>,
  assignedMap: Map<number, { regionId: number; regionName: string }>,
): Set<number> {
  const knownOrChildOfKnown = new Set(knownDivisionIds);
  // First pass: direct children of known divisions
  for (const a of finalAssignments) inheritKnownFromParent(a, knownOrChildOfKnown, assignedMap, knownDivisionIds);
  // Iterative: walk deeper until no new descendants are found
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of finalAssignments) {
      if (inheritKnownFromParent(a, knownOrChildOfKnown, assignedMap, knownOrChildOfKnown)) changed = true;
    }
  }
  return knownOrChildOfKnown;
}

/** Resolve a cluster's suggested region: prefer votes, then geo-fallback */
function resolveSuggestedRegion(
  clusterId: number,
  clusterRegionVotes: Map<number, Map<number, { count: number; name: string }>>,
  geoClusterRegion: Map<number, { id: number; name: string }>,
): { id: number; name: string } | null {
  const regionVotes = clusterRegionVotes.get(clusterId);
  if (regionVotes) {
    let bestCount = 0;
    let best: { id: number; name: string } | null = null;
    for (const [rId, { count, name }] of regionVotes) {
      if (count > bestCount) { bestCount = count; best = { id: rId, name }; }
    }
    if (best) return best;
  }
  return geoClusterRegion.get(clusterId) ?? null;
}

interface BuildClusterSuggestionsParams {
  postReviewClusters: Map<number, number>;
  colorCentroids: Array<[number, number, number] | null>;
  clusterRegionVotes: Map<number, Map<number, { count: number; name: string }>>;
  geoClusterRegion: Map<number, { id: number; name: string }>;
  gapAssignments: FinalDivAssignment[];
  gapUnsplittable: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  divNameMap: Map<number, string>;
}

/** Build per-cluster suggestion rows with divisions + unsplittable children */
export function buildClusterSuggestions(p: BuildClusterSuggestionsParams): ColorMatchCluster[] {
  const totalCountryPixels = [...p.postReviewClusters.values()].reduce((a, b) => a + b, 0);
  return [...p.postReviewClusters].map(([clusterId, pixelCount]) => {
    const c = p.colorCentroids[clusterId]!;
    const hex = `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
    const suggestedRegion = resolveSuggestedRegion(clusterId, p.clusterRegionVotes, p.geoClusterRegion);
    return {
      clusterId,
      color: hex,
      pixelShare: Math.round((pixelCount / totalCountryPixels) * 100) / 100,
      suggestedRegion,
      divisions: p.gapAssignments.filter(a => a.clusterId === clusterId).map(d => ({
        id: d.divisionId,
        name: p.divNameMap.get(d.divisionId) ?? `#${d.divisionId}`,
        confidence: d.confidence,
        depth: d.depth,
        ...(d.parentDivisionId ? { parentDivisionId: d.parentDivisionId } : {}),
      })),
      unsplittable: p.gapUnsplittable.filter(a => a.clusterId === clusterId).map(u => ({
        id: u.divisionId,
        name: p.divNameMap.get(u.divisionId) ?? `#${u.divisionId}`,
        confidence: u.confidence,
        splitClusters: u.splitClusters,
      })),
    };
  }).filter(c => c.divisions.length > 0 || c.unsplittable.length > 0);
}

/** Build a division→cluster map merging final + unsplittable assignments */
export function buildDivClusterMap(
  finalAssignments: FinalDivAssignment[],
  unsplittableDivs: FinalDivAssignment[],
): Map<number, { clusterId: number; confidence: number }> {
  const divClusterMap = new Map<number, { clusterId: number; confidence: number }>();
  for (const a of finalAssignments) {
    divClusterMap.set(a.divisionId, { clusterId: a.clusterId, confidence: a.confidence });
  }
  for (const u of unsplittableDivs) {
    if (!divClusterMap.has(u.divisionId)) {
      divClusterMap.set(u.divisionId, { clusterId: u.clusterId, confidence: u.confidence });
    }
  }
  return divClusterMap;
}

export interface DivisionFeatureContext {
  divClusterMap: Map<number, { clusterId: number; confidence: number }>;
  clusterColorMap: Map<number, string>;
  clusterRegionMap: Map<number, { id: number; name: string } | null>;
  unsplittableSet: Set<number>;
  outOfBoundsIdSet: Set<number>;
  knownOrChildOfKnown: Set<number>;
  assignedMap: Map<number, { regionId: number; regionName: string }>;
  divNameMap: Map<number, string>;
}

/** Build one GeoJSON Feature from a division geometry row + all the lookup maps */
export function buildDivisionFeature(
  r: { id: number; geojson: string },
  ctx: DivisionFeatureContext,
): CvPreviewFeature {
  const divId = r.id;
  const assignment = ctx.divClusterMap.get(divId);
  const clusterId = assignment?.clusterId ?? -1;
  const region = ctx.clusterRegionMap.get(clusterId);
  const isOob = ctx.outOfBoundsIdSet.has(divId);
  const isPreAssigned = ctx.knownOrChildOfKnown.has(divId);
  const existingAssignment = ctx.assignedMap.get(divId);
  const suggestedRegionId = isOob ? null : (region?.id ?? null);
  const suggestedRegionName = isOob ? null : (region?.name ?? null);
  const preAssignedWithData = isPreAssigned && existingAssignment;
  return {
    type: 'Feature',
    properties: {
      divisionId: divId,
      name: ctx.divNameMap.get(divId) ?? `#${divId}`,
      clusterId: isOob ? -1 : clusterId,
      confidence: isOob ? 0 : (assignment?.confidence ?? 0),
      isUnsplittable: ctx.unsplittableSet.has(divId),
      isOutOfBounds: isOob,
      preAssigned: isPreAssigned,
      color: isOob ? '#888888' : (ctx.clusterColorMap.get(clusterId) ?? '#cccccc'),
      regionId: preAssignedWithData ? existingAssignment.regionId : suggestedRegionId,
      regionName: preAssignedWithData ? existingAssignment.regionName : suggestedRegionName,
    },
    geometry: JSON.parse(r.geojson) as AreaGeometry,
  };
}

// =============================================================================
// Spatial anomaly input and the complete payload
// =============================================================================

/** Merge existing member assignments + CV suggestions into a flat DivisionAssignment list */
export function buildCombinedAssignments(
  existingRows: Array<{ member_row_id: number; region_id: number; division_id: number; division_name: string }>,
  cvChildRegions: Array<{ id: number; name: string }>,
  cvClusterResult: ColorMatchCluster[],
): DivisionAssignment[] {
  const regionNameMap = new Map(cvChildRegions.map(r => [r.id, r.name]));
  const allAssignments: DivisionAssignment[] = existingRows.map(m => ({
    divisionId: m.division_id,
    memberRowId: m.member_row_id,
    regionId: m.region_id,
    regionName: regionNameMap.get(m.region_id) ?? 'Unknown',
    divisionName: m.division_name,
  }));
  const existingDivIds = new Set(allAssignments.map(a => a.divisionId));
  for (const cluster of cvClusterResult) {
    if (!cluster.suggestedRegion) continue;
    for (const div of cluster.divisions) {
      if (existingDivIds.has(div.id)) continue;
      allAssignments.push({
        divisionId: div.id,
        memberRowId: null,
        regionId: cluster.suggestedRegion.id,
        regionName: cluster.suggestedRegion.name,
        divisionName: div.name,
      });
    }
  }
  return allAssignments;
}

export interface BuildCompletePayloadParams {
  cvClusterResult: ColorMatchCluster[];
  cvChildRegions: Array<{ id: number; name: string }>;
  cvOutOfBounds: Array<{ id: number; name: string }>;
  debugImages: Array<{ label: string; dataUrl: string }>;
  geoPreview: ColorMatchResult['geoPreview'];
  spatialAnomalies: SpatialAnomaly[];
  adjacencyEdges: AdjacencyEdge[];
  centroids: CentroidInfo[];
  assignedCount: number;
  countryName: string;
  startTime: number;
}

/** Build the final `complete` SSE payload for matchDivisionsFromClusters */
export function buildCompletePayload(p: BuildCompletePayloadParams): ColorMatchComplete {
  return {
    type: 'complete',
    elapsed: (Date.now() - p.startTime) / 1000,
    data: {
      clusters: p.cvClusterResult,
      childRegions: p.cvChildRegions,
      outOfBounds: p.cvOutOfBounds.length > 0 ? p.cvOutOfBounds : undefined,
      debugImages: p.debugImages,
      geoPreview: p.geoPreview,
      spatialAnomalies: p.spatialAnomalies.length > 0 ? p.spatialAnomalies : undefined,
      adjacencyEdges: p.adjacencyEdges.length > 0 ? p.adjacencyEdges : undefined,
      stats: {
        totalDivisions: p.centroids.length,
        assignedDivisions: p.assignedCount,
        cvClusters: p.cvClusterResult.length,
        cvAssignedDivisions: p.cvClusterResult.reduce((sum, c) => sum + c.divisions.length, 0),
        cvUnsplittable: p.cvClusterResult.reduce((sum, c) => sum + c.unsplittable.length, 0),
        cvOutOfBounds: p.cvOutOfBounds.length,
        countryName: p.countryName,
      },
    },
  };
}