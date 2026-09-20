/**
 * The three panes of `CvMatchDialog`, side by side once the pipeline is done:
 * the region's Wikivoyage map, the source map image the clusters were read
 * from, and the division map they are drawn over — with the anomalies a
 * cluster's assignment leaves behind recomputed as a curator moves one.
 *
 * What a curator then does about those clusters is
 * `CvClusterSuggestionsSection.tsx`, which this dialog renders below the maps.
 */

import { useCallback, useMemo } from 'react';
import { Alert, Box, Typography } from '@mui/material';
// Named rather than inherited: maplibre-gl declared a `maplibregl` UMD global
// through 4.x, and this file leaned on it for the one type it uses. The 6.x
// build is ESM only and declares no global, so the namespace is imported.
import type * as maplibregl from 'maplibre-gl';
import { NavigationControl, Source, Layer } from 'react-map-gl/maplibre';
import { GuardedMap as MapGL } from '../shared/GuardedMap';
import * as turf from '@turf/turf';
import { acceptBatchMatches, type ColorMatchCluster } from '../../api/admin/worldViewImport';
import { CvMatchMap, CV_MAP_STYLE } from './CvMatchMap';
import type { CvMatchDialogState } from './useCvMatchPipeline';
import { detectSpatialAnomaliesClient } from '../../utils/spatialAnomalyDetector';
import type {
  AdjacencyEdge as ClientAdjEdge,
  DivisionAssignment as ClientDivAssignment,
} from '../../utils/spatialAnomalyDetector';
import { frameGeoJson } from '../../utils/mapUtils';

// ─── Geo Preview (map + source image) ───────────────────────────────────────

export interface CvGeoPreviewSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  highlightClusterId: number | null;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
}

// Given the Wikivoyage mapshape preview, frame the map around all features.
function fitMapToPreview(map: maplibregl.Map, wvPreview: GeoJSON.FeatureCollection) {
  frameGeoJson(map, wvPreview, { padding: 30, duration: 0 });
}

// Build a FeatureCollection of centroid points with title properties for
// labeling the Wikivoyage mapshape regions.
function buildWvLabelData(wvPreview: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const labelFeatures: GeoJSON.Feature[] = [];
  for (const f of wvPreview.features) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- turf.centroid's overload signature rejects generic GeoJSON.Feature; runtime accepts it
      const centroid = turf.centroid(f as any);
      labelFeatures.push({
        type: 'Feature',
        geometry: centroid.geometry,
        properties: { title: f.properties?.title ?? '' },
      });
    } catch { /* skip */ }
  }
  return { type: 'FeatureCollection', features: labelFeatures };
}

// Strip a division (by id) from a single cluster's divisions + unsplittable lists.
function stripDivisionFromCluster(divisionId: number) {
  return (c: ColorMatchCluster): ColorMatchCluster => ({
    ...c,
    divisions: c.divisions.filter(d => d.id !== divisionId),
    unsplittable: c.unsplittable.filter(d => d.id !== divisionId),
  });
}

// Remove a division (by id) from every cluster's divisions + unsplittable lists
// and drop clusters that end up empty.
function removeDivisionFromClusters(
  clusters: readonly ColorMatchCluster[],
  divisionId: number,
): ColorMatchCluster[] {
  const hasMembers = (c: ColorMatchCluster) => c.divisions.length > 0 || c.unsplittable.length > 0;
  return clusters.map(stripDivisionFromCluster(divisionId)).filter(hasMembers);
}

// Update a single feature (matched by divisionId) via the provided property patcher.
function updateFeatureForDivision(
  features: GeoJSON.Feature[],
  divisionId: number,
  patchProps: (props: NonNullable<GeoJSON.Feature['properties']>) => GeoJSON.Feature['properties'],
): GeoJSON.Feature[] {
  return features.map(f => {
    if (f.properties?.divisionId !== divisionId) return f;
    const nextProps = patchProps(f.properties);
    return { ...f, properties: nextProps };
  });
}

// Lookup a division's info from clusters, falling back to the feature properties.
function lookupDivisionInfo(
  clusters: readonly ColorMatchCluster[],
  features: GeoJSON.Feature[],
  divisionId: number,
): { id: number; name: string; confidence: number; depth: number; parentDivisionId?: number } | null {
  for (const c of clusters) {
    const found = c.divisions.find(d => d.id === divisionId) ?? c.unsplittable.find(d => d.id === divisionId);
    if (found) {
      return {
        id: found.id,
        name: found.name,
        confidence: found.confidence,
        depth: 'depth' in found ? (found as { depth: number }).depth : 0,
      };
    }
  }
  const feat = features.find(f => f.properties?.divisionId === divisionId);
  if (feat?.properties) {
    return {
      id: divisionId,
      name: feat.properties.name ?? `#${divisionId}`,
      confidence: feat.properties.confidence ?? 0.5,
      depth: 0,
    };
  }
  return null;
}

// Recompute client-side spatial anomalies after a cluster reassignment.
function recomputeAnomalies(
  features: GeoJSON.Feature[],
  adjacencyEdges: ClientAdjEdge[],
) {
  const assignments: ClientDivAssignment[] = [];
  for (const f of features) {
    const p = f.properties;
    if (p?.divisionId && p?.regionId) {
      assignments.push({
        divisionId: p.divisionId,
        regionId: p.regionId,
        regionName: p.regionName ?? 'Unknown',
      });
    }
  }
  const clientAnomalies = detectSpatialAnomaliesClient(assignments, adjacencyEdges);
  return clientAnomalies.map(a => ({
    divisions: a.fragmentDivisionIds.map(id => ({
      divisionId: id,
      name: `Division ${id}`,
      memberRowId: null,
      sourceRegionId: a.sourceRegionId,
      sourceRegionName: a.sourceRegionName,
    })),
    suggestedTargetRegionId: a.suggestedTargetRegionId,
    suggestedTargetRegionName: a.suggestedTargetRegionName,
    fragmentSize: a.fragmentSize,
    totalRegionSize: a.totalRegionSize,
    score: a.score,
  }));
}

export function CvGeoPreviewSection({ cvMatchDialog, setCVMatchDialog, highlightClusterId, worldViewId, invalidateTree }: CvGeoPreviewSectionProps) {
  const sourceImg = cvMatchDialog.debugImages.find(img => img.label === '__source_map__');
  const wvPreview = cvMatchDialog.wikivoyagePreview;
  const geo = cvMatchDialog.geoPreview;

  const anomalousDivisionIds = useMemo(() => {
    const ids = new Set<number>();
    for (const a of cvMatchDialog.spatialAnomalies ?? []) {
      for (const d of a.divisions) ids.add(d.divisionId);
    }
    return ids;
  }, [cvMatchDialog.spatialAnomalies]);

  const handleMapAccept = useCallback(async (divisionId: number, regionId: number, regionName: string) => {
    try {
      await acceptBatchMatches(worldViewId, [{ regionId, divisionId }]);
      const targetCluster = cvMatchDialog.clusters.find(c => c.suggestedRegion?.id === regionId);
      const targetColor = targetCluster?.color ?? '#999';
      const patchAcceptedProps = (featureProps: NonNullable<GeoJSON.Feature['properties']>) => ({
        ...featureProps,
        regionId,
        regionName,
        color: targetColor,
        isUnsplittable: false,
        clusterId: targetCluster?.clusterId ?? featureProps.clusterId,
        confidence: 1,
        accepted: true,
      });
      setCVMatchDialog(prev => {
        if (!prev) return prev;
        const newClusters = removeDivisionFromClusters(prev.clusters, divisionId);
        const newGeo = prev.geoPreview
          ? {
            ...prev.geoPreview,
            featureCollection: {
              ...prev.geoPreview.featureCollection,
              features: updateFeatureForDivision(prev.geoPreview.featureCollection.features, divisionId, patchAcceptedProps),
            },
          }
          : prev.geoPreview;
        return { ...prev, clusters: newClusters, geoPreview: newGeo };
      });
      invalidateTree(cvMatchDialog.regionId);
    } catch (err) {
      console.error('Accept from map failed:', err);
    }
  }, [worldViewId, cvMatchDialog, setCVMatchDialog, invalidateTree]);

  const handleMapReject = useCallback((divisionId: number) => {
    const patchDismissedProps = (props: NonNullable<GeoJSON.Feature['properties']>) => ({
      ...props,
      dismissed: true,
      color: '#999',
    });
    setCVMatchDialog(prev => {
      if (!prev) return prev;
      const newClusters = removeDivisionFromClusters(prev.clusters, divisionId);
      const newGeo = prev.geoPreview
        ? {
          ...prev.geoPreview,
          featureCollection: {
            ...prev.geoPreview.featureCollection,
            features: updateFeatureForDivision(prev.geoPreview.featureCollection.features, divisionId, patchDismissedProps),
          },
        }
        : prev.geoPreview;
      return { ...prev, clusters: newClusters, geoPreview: newGeo };
    });
  }, [setCVMatchDialog]);

  const handleMapClusterReassign = useCallback((divisionId: number, clusterId: number, color: string) => {
    setCVMatchDialog(prev => {
      if (!prev?.geoPreview) return prev;
      const ci = prev.geoPreview.clusterInfos.find(c => c.clusterId === clusterId);
      const divInfo = lookupDivisionInfo(prev.clusters, prev.geoPreview.featureCollection.features, divisionId);

      // Strip division from all clusters first (keep empty clusters — we may push a new one below)
      let newClusters: ColorMatchCluster[] = prev.clusters.map(stripDivisionFromCluster(divisionId));
      if (divInfo) {
        const targetIdx = newClusters.findIndex(c => c.clusterId === clusterId);
        if (targetIdx >= 0) {
          const appendToTarget = (c: ColorMatchCluster, i: number): ColorMatchCluster =>
            i === targetIdx ? { ...c, divisions: [...c.divisions, divInfo] } : c;
          newClusters = newClusters.map(appendToTarget);
        } else {
          newClusters.push({
            clusterId,
            color,
            pixelShare: 0,
            suggestedRegion: ci?.regionId != null && ci.regionName ? { id: ci.regionId, name: ci.regionName } : null,
            divisions: [divInfo],
            unsplittable: [],
          });
        }
      }
      newClusters = newClusters.filter(c => c.divisions.length > 0 || c.unsplittable.length > 0);

      const patchReassignedProps = (props: NonNullable<GeoJSON.Feature['properties']>) => ({
        ...props,
        clusterId,
        color,
        painted: true,
      });
      const updatedFeatures = updateFeatureForDivision(
        prev.geoPreview.featureCollection.features,
        divisionId,
        patchReassignedProps,
      );

      const updatedGeoPreview = {
        ...prev.geoPreview,
        featureCollection: { ...prev.geoPreview.featureCollection, features: updatedFeatures },
      };

      const updatedAnomalies = prev.adjacencyEdges
        ? recomputeAnomalies(updatedFeatures, prev.adjacencyEdges as ClientAdjEdge[])
        : prev.spatialAnomalies;

      return {
        ...prev,
        clusters: newClusters,
        geoPreview: updatedGeoPreview,
        spatialAnomalies: updatedAnomalies,
      };
    });
  }, [setCVMatchDialog]);

  if (!geo || geo.featureCollection.features.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Region Assignment Preview</Typography>
      {cvMatchDialog.spatialAnomalies && cvMatchDialog.spatialAnomalies.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1, py: 0, fontSize: '0.8rem' }}>
          {cvMatchDialog.spatialAnomalies.length} potential exclave{cvMatchDialog.spatialAnomalies.length > 1 ? 's' : ''} detected
          — divisions that would be disconnected from their region. Review assignments before accepting.
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 10, bgcolor: 'background.paper', pb: 1, maxHeight: '42vh', overflow: 'hidden' }}>
        {/* Wikivoyage mapshape preview (Kartographer geoshapes) */}
        {wvPreview && wvPreview.features.length > 0 && (
          <Box sx={{ flex: '1 1 48%', minWidth: 250, height: 400 }}>
            <Typography variant="caption" color="text.secondary">Wikivoyage map (Kartographer regions)</Typography>
            <MapGL
              initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
              style={{ width: '100%', height: '100%', borderRadius: 4 }}
              mapStyle={CV_MAP_STYLE}
              onLoad={(e) => fitMapToPreview(e.target, wvPreview)}
            >
              <NavigationControl position="top-right" showCompass={false} />
              <Source id="wv-mapshapes" type="geojson" data={wvPreview}>
                <Layer
                  id="wv-mapshapes-fill"
                  type="fill"
                  paint={{
                    'fill-color': ['get', 'color'] as unknown as string,
                    'fill-opacity': 0.45,
                  }}
                />
                <Layer
                  id="wv-mapshapes-outline"
                  type="line"
                  paint={{
                    'line-color': '#333',
                    'line-width': 1.5,
                  }}
                />
              </Source>
              {/* Region name labels */}
              <Source id="wv-labels-src" type="geojson" data={buildWvLabelData(wvPreview)}>
                <Layer
                  id="wv-labels"
                  type="symbol"
                  layout={{
                    'text-field': ['get', 'title'],
                    'text-size': 12,
                    'text-font': ['Open Sans Semibold'],
                    'text-allow-overlap': true,
                  }}
                  paint={{
                    'text-color': '#222',
                    'text-halo-color': '#fff',
                    'text-halo-width': 1.5,
                  }}
                />
              </Source>
            </MapGL>
          </Box>
        )}
        {/* CV source map image — always shown when available so curator can
            compare the original map against the assigned regions side by side. */}
        {sourceImg && (
          <Box sx={{ flex: '1 1 48%', minWidth: 250, maxHeight: '40vh', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="caption" color="text.secondary">Source map</Typography>
            <img src={sourceImg.dataUrl} style={{ maxWidth: '100%', maxHeight: 'calc(40vh - 20px)', objectFit: 'contain', borderRadius: 4 }} />
          </Box>
        )}
        <Box sx={{ flex: '1 1 48%', minWidth: 250, height: Math.min(400, window.innerHeight * 0.4) }}>
          <Typography variant="caption" color="text.secondary">{wvPreview ? 'GADM division assignment' : 'CV region assignment'} (hover for details)</Typography>
          <CvMatchMap
            geoPreview={geo}
            highlightClusterId={highlightClusterId}
            anomalousDivisionIds={anomalousDivisionIds}
            onAccept={handleMapAccept}
            onReject={handleMapReject}
            onClusterReassign={handleMapClusterReassign}
          />
        </Box>
      </Box>
    </Box>
  );
}
