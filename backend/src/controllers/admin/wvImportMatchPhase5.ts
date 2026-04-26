/**
 * Phase 5 helpers for the CV color-match pipeline.
 *
 * Converts the raw cluster→division assignment into user-facing results:
 *   - cluster/region voting (per-cluster best region guess)
 *   - geographic fallback (project region centroids into pixel space)
 *   - gap-only filter (hide already-assigned divisions)
 *   - per-cluster suggestion rows + geo preview FeatureCollection
 *   - spatial anomaly detection on the combined assignment set
 *   - final `complete` SSE payload construction
 */

import { pool } from '../../db/index.js';
import type { DivAssignment, FinalDivAssignment } from './wvImportMatchAssignment.js';
import { getAdjacencyGraph, detectSpatialAnomalies } from '../../services/worldViewImport/spatialAnomalyDetector.js';
import type { AdjacencyEdge, DivisionAssignment, SpatialAnomaly } from '../../services/worldViewImport/spatialAnomalyDetector.js';
import type { GridDims } from './wvImportMatchClusterReview.js';

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

export interface ClusterSuggestion {
  clusterId: number;
  color: string;
  pixelShare: number;
  suggestedRegion: { id: number; name: string } | null;
  divisions: Array<{ id: number; name: string; confidence: number; depth: number; parentDivisionId?: number }>;
  unsplittable: Array<{ id: number; name: string; confidence: number; splitClusters: Array<{ clusterId: number; share: number }> }>;
}

export interface GeoPreviewData {
  featureCollection: GeoJSON.FeatureCollection;
  clusterInfos: Array<{ clusterId: number; color: string; regionId: number | null; regionName: string | null }>;
}

// =============================================================================
// Cluster/region voting & geo preview
// =============================================================================

/** For each cluster, tally votes (divisions with already-assigned regions) */
function computeClusterRegionVotes(
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

/** Geographic fallback: assign clusters by projecting each child-region centroid into pixel space */
async function computeGeoClusterFallback(
  regionId: number,
  worldViewId: number,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  pixelLabels: Uint8Array,
  dims: GridDims,
): Promise<Map<number, { id: number; name: string }>> {
  const childRegionsResult = await pool.query<{ id: number; name: string; cx: string; cy: string }>(`
    SELECT id, name,
      ST_X(ST_Centroid(geom)) AS cx,
      ST_Y(ST_Centroid(geom)) AS cy
    FROM regions
    WHERE parent_region_id = $1 AND world_view_id = $2 AND geom IS NOT NULL
  `, [regionId, worldViewId]);
  const geoClusterRegion = new Map<number, { id: number; name: string }>();
  for (const r of childRegionsResult.rows) {
    const rcx = parseFloat(r.cx), rcy = parseFloat(r.cy);
    const [px, py] = gadmToPixel(rcx, -rcy);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix >= 0 && ix < dims.TW && iy >= 0 && iy < dims.TH) {
      const cl = pixelLabels[iy * dims.TW + ix];
      if (cl < 255 && !geoClusterRegion.has(cl)) {
        geoClusterRegion.set(cl, { id: r.id, name: r.name });
      }
    }
  }
  return geoClusterRegion;
}

/** Load all child regions of the parent (for result-output shape) */
async function loadChildRegions(regionId: number, worldViewId: number): Promise<Array<{ id: number; name: string }>> {
  const result = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  return result.rows;
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
function computeKnownOrChildOfKnown(
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
function buildClusterSuggestions(p: BuildClusterSuggestionsParams): ClusterSuggestion[] {
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

interface BuildGeoPreviewParams {
  finalAssignments: FinalDivAssignment[];
  unsplittableDivs: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  cvOutOfBounds: Array<{ id: number; name: string }>;
  gapUnsplittable: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  clusterResult: ClusterSuggestion[];
  knownOrChildOfKnown: Set<number>;
  assignedMap: Map<number, { regionId: number; regionName: string }>;
  divNameMap: Map<number, string>;
}

/** Load simplified division geometries for all ids in the result set */
async function loadDivisionGeometries(divIds: number[]): Promise<Array<{ id: number; geojson: string }>> {
  const result = await pool.query<{ id: number; geojson: string }>(`
    SELECT id, ST_AsGeoJSON(geom_simplified_medium, 5) AS geojson
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [divIds]);
  return result.rows;
}

/** Build a division→cluster map merging final + unsplittable assignments */
function buildDivClusterMap(
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

interface DivisionFeatureContext {
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
function buildDivisionFeature(
  r: { id: number; geojson: string },
  ctx: DivisionFeatureContext,
): GeoJSON.Feature {
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
    geometry: JSON.parse(r.geojson),
  };
}

/** Build interactive geo preview data (FeatureCollection + per-cluster info) */
async function buildGeoPreview(p: BuildGeoPreviewParams): Promise<GeoPreviewData> {
  const divClusterMap = buildDivClusterMap(p.finalAssignments, p.unsplittableDivs);
  const unsplittableSet = new Set(p.gapUnsplittable.map(u => u.divisionId));
  const outOfBoundsIdSet = new Set(p.cvOutOfBounds.map(o => o.id));

  const allFinalIds = [...new Set([
    ...p.finalAssignments.map(a => a.divisionId),
    ...p.unsplittableDivs.map(u => u.divisionId),
    ...p.cvOutOfBounds.map(o => o.id),
  ])];

  const geoRows = await loadDivisionGeometries(allFinalIds);

  const ctx: DivisionFeatureContext = {
    divClusterMap,
    clusterColorMap: new Map(p.clusterResult.map(c => [c.clusterId, c.color])),
    clusterRegionMap: new Map(p.clusterResult.map(c => [c.clusterId, c.suggestedRegion])),
    unsplittableSet,
    outOfBoundsIdSet,
    knownOrChildOfKnown: p.knownOrChildOfKnown,
    assignedMap: p.assignedMap,
    divNameMap: p.divNameMap,
  };

  const features: GeoJSON.Feature[] = geoRows.map(r => buildDivisionFeature(r, ctx));

  const clusterInfos = p.clusterResult.map(c => ({
    clusterId: c.clusterId,
    color: c.color,
    regionId: c.suggestedRegion?.id ?? null,
    regionName: c.suggestedRegion?.name ?? null,
  }));

  console.log(`  [GeoPreview] ${features.length} features, ${clusterInfos.length} cluster infos, ${allFinalIds.length} division IDs queried, ${geoRows.length} geom rows returned`);
  return {
    featureCollection: { type: 'FeatureCollection', features },
    clusterInfos,
  };
}

// =============================================================================
// Spatial anomaly detection
// =============================================================================

export interface RunSpatialAnomalyParams {
  regionId: number;
  worldViewId: number;
  cvChildRegions: Array<{ id: number; name: string }>;
  cvClusterResult: ClusterSuggestion[];
}

/** Merge existing member assignments + CV suggestions into a flat DivisionAssignment list */
function buildCombinedAssignments(
  existingRows: Array<{ member_row_id: number; region_id: number; division_id: number; division_name: string }>,
  cvChildRegions: Array<{ id: number; name: string }>,
  cvClusterResult: ClusterSuggestion[],
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

/** Run spatial anomaly detection on suggested + existing assignments (non-fatal) */
export async function runSpatialAnomalyDetection(p: RunSpatialAnomalyParams): Promise<{
  spatialAnomalies: SpatialAnomaly[];
  adjacencyEdges: AdjacencyEdge[];
}> {
  try {
    const existingMembers = await pool.query<{
      member_row_id: number; region_id: number; division_id: number; division_name: string;
    }>(
      `SELECT rm.id AS member_row_id, rm.region_id, rm.division_id, ad.name AS division_name
       FROM region_members rm
       JOIN administrative_divisions ad ON ad.id = rm.division_id
       WHERE rm.region_id IN (SELECT id FROM regions WHERE parent_region_id = (
         SELECT parent_region_id FROM regions WHERE id = $1
       ) AND world_view_id = $2)
       AND rm.custom_geom IS NULL`,
      [p.regionId, p.worldViewId],
    );

    const allAssignments = buildCombinedAssignments(existingMembers.rows, p.cvChildRegions, p.cvClusterResult);
    if (allAssignments.length < 2) return { spatialAnomalies: [], adjacencyEdges: [] };

    const allDivIds = allAssignments.map(a => a.divisionId);
    const adjacencyEdges = await getAdjacencyGraph(allDivIds);
    const spatialAnomalies = detectSpatialAnomalies(allAssignments, adjacencyEdges);
    return { spatialAnomalies, adjacencyEdges };
  } catch (err) {
    console.warn('Spatial anomaly detection failed:', err);
    return { spatialAnomalies: [], adjacencyEdges: [] };
  }
}

export interface BuildCompletePayloadParams {
  cvClusterResult: ClusterSuggestion[];
  cvChildRegions: Array<{ id: number; name: string }>;
  cvOutOfBounds: Array<{ id: number; name: string }>;
  debugImages: Array<{ label: string; dataUrl: string }>;
  geoPreview: GeoPreviewData;
  spatialAnomalies: SpatialAnomaly[];
  adjacencyEdges: AdjacencyEdge[];
  centroids: CentroidInfo[];
  assignedCount: number;
  countryName: string;
  startTime: number;
}

/** Build the final `complete` SSE payload for matchDivisionsFromClusters */
export function buildCompletePayload(p: BuildCompletePayloadParams): Record<string, unknown> {
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

export interface BuildResultsParams {
  regionId: number;
  worldViewId: number;
  knownDivisionIds: Set<number>;
  assignedMap: Map<number, { regionId: number; regionName: string }>;
  divNameMap: Map<number, string>;
  centroids: CentroidInfo[];
  colorCentroids: Array<[number, number, number] | null>;
  postReviewClusters: Map<number, number>;
  matchResult: MatchingResult;
  pixelLabels: Uint8Array;
  dims: GridDims;
}

export interface Phase5Results {
  cvClusterResult: ClusterSuggestion[];
  cvChildRegions: Array<{ id: number; name: string }>;
  geoPreview: GeoPreviewData;
  gadmToPixel: (gx: number, gy: number) => [number, number];
}

/**
 * Phase 5: compute votes + geo fallback, filter to gap-only results, build per-cluster
 * suggestions and the geo preview feature collection.
 */
export async function buildPhase5Results(p: BuildResultsParams): Promise<Phase5Results> {
  const { matchResult, regionId, worldViewId, pixelLabels, dims, assignedMap, knownDivisionIds,
    divNameMap, centroids, colorCentroids, postReviewClusters } = p;
  const { gadmToPixel, divAssignments, finalAssignments, unsplittableDivs, cvOutOfBounds, splitDepth } = matchResult;

  const clusterRegionVotes = computeClusterRegionVotes(centroids, divAssignments);
  const geoClusterRegion = await computeGeoClusterFallback(regionId, worldViewId, gadmToPixel, pixelLabels, dims);
  const cvChildRegions = await loadChildRegions(regionId, worldViewId);

  // Filter out already-assigned divisions from results — only show gap divisions.
  const knownOrChildOfKnown = computeKnownOrChildOfKnown(finalAssignments, knownDivisionIds, assignedMap);
  const gapAssignments = finalAssignments.filter(a => !knownOrChildOfKnown.has(a.divisionId));
  const gapUnsplittable = unsplittableDivs.filter(u => !knownOrChildOfKnown.has(u.divisionId));
  console.log(`  Gap filter: ${finalAssignments.length} total → ${gapAssignments.length} gap divisions (${knownOrChildOfKnown.size} already assigned)`);

  const cvClusterResult = buildClusterSuggestions({
    postReviewClusters, colorCentroids, clusterRegionVotes, geoClusterRegion,
    gapAssignments, gapUnsplittable, divNameMap,
  });
  console.log(`  Assignment: ${finalAssignments.length} resolved, ${unsplittableDivs.length} unsplittable, ${splitDepth} depth levels, ${postReviewClusters.size} clusters`);

  const geoPreview = await buildGeoPreview({
    finalAssignments, unsplittableDivs, cvOutOfBounds, gapUnsplittable,
    clusterResult: cvClusterResult, knownOrChildOfKnown, assignedMap, divNameMap,
  });

  return { cvClusterResult, cvChildRegions, geoPreview, gadmToPixel };
}
