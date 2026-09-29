/**
 * Phase 5 of the CV color-match pipeline: the queries its result is built
 * from, and the sequence that builds it.
 *
 *   - geographic fallback (project region centroids into pixel space)
 *   - the parent's child regions and the divisions' simplified outlines
 *   - spatial anomaly detection on the combined assignment set
 *
 * What is computed from those rows — the votes, the gap filter, the
 * suggestion rows, the preview features and the `complete` payload — is
 * `services/worldViewImport/colorMatch/result/matchResult.ts`.
 */

import { pool } from '../../db/index.js';
import { getAdjacencyGraph, detectSpatialAnomalies } from '../../services/worldViewImport/spatialAnomalyDetector.js';
import type { AdjacencyEdge, SpatialAnomaly } from '../../services/worldViewImport/spatialAnomalyDetector.js';
import type { FinalDivAssignment } from '../../services/worldViewImport/colorMatch/assign/assignment.js';
import type { GridDims } from '../../services/worldViewImport/colorMatch/cluster/clusterComponents.js';
import {
  buildClusterSuggestions,
  buildCombinedAssignments,
  buildDivClusterMap,
  buildDivisionFeature,
  computeClusterRegionVotes,
  computeKnownOrChildOfKnown,
  type CentroidInfo,
  type DivisionFeatureContext,
  type MatchingResult,
} from '../../services/worldViewImport/colorMatch/result/matchResult.js';
import type {
  ColorMatchCluster, ColorMatchResult, CvPreviewFeature,
} from '../../api/responses/wvImportCvMatch.js';

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

interface BuildGeoPreviewParams {
  finalAssignments: FinalDivAssignment[];
  unsplittableDivs: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  cvOutOfBounds: Array<{ id: number; name: string }>;
  gapUnsplittable: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  clusterResult: ColorMatchCluster[];
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

/** Build interactive geo preview data (FeatureCollection + per-cluster info) */
async function buildGeoPreview(p: BuildGeoPreviewParams): Promise<ColorMatchResult['geoPreview']> {
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

  const features: CvPreviewFeature[] = geoRows.map(r => buildDivisionFeature(r, ctx));

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
  cvClusterResult: ColorMatchCluster[];
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
  cvClusterResult: ColorMatchCluster[];
  cvChildRegions: Array<{ id: number; name: string }>;
  geoPreview: ColorMatchResult['geoPreview'];
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
