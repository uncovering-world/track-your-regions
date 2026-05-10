/**
 * CvGeoPreviewSection — Geo preview + cluster suggestions sub-section of CvMatchDialog.
 *
 * Shows side-by-side source map / MapLibre division map with cluster-to-region
 * suggestions, AI matching, model picker, and accept/reject actions.
 * Renders when cvMatchDialog.done is true.
 */

import { useCallback, useMemo } from 'react';
import {
  Alert,
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Visibility,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import MapGL, { NavigationControl, Source, Layer } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import {
  acceptBatchMatches,
  aiSuggestClusterRegions,
  type ColorMatchCluster,
  type ClusterGeoInfo,
} from '../../api/admin/worldViewImport';
import { CvMatchMap, CV_MAP_STYLE } from './CvMatchMap';
import type { CvMatchDialogState } from './useCvMatchPipeline';
import { detectSpatialAnomaliesClient } from '../../utils/spatialAnomalyDetector';
import type { AdjacencyEdge as ClientAdjEdge, DivisionAssignment as ClientDivAssignment } from '../../utils/spatialAnomalyDetector';

// ─── Geo Preview (map + source image) ───────────────────────────────────────

export interface CvGeoPreviewSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  highlightClusterId: number | null;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
}

// Collect every [lng,lat] coordinate pair from a GeoJSON FeatureCollection
// (Polygon + MultiPolygon only). Used for fitBounds calculations.
function collectCoordinates(fc: GeoJSON.FeatureCollection): [number, number][] {
  const coords: [number, number][] = [];
  const addRing = (ring: GeoJSON.Position[]) => {
    for (const pt of ring) coords.push(pt as [number, number]);
  };
  for (const f of fc.features) {
    if (f.geometry.type === 'Polygon') {
      for (const ring of (f.geometry as GeoJSON.Polygon).coordinates) addRing(ring);
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of (f.geometry as GeoJSON.MultiPolygon).coordinates) {
        for (const ring of poly) addRing(ring);
      }
    }
  }
  return coords;
}

// Given the Wikivoyage mapshape preview, fit the map bounds around all features.
function fitMapToPreview(map: maplibregl.Map, wvPreview: GeoJSON.FeatureCollection) {
  try {
    const coords = collectCoordinates(wvPreview);
    if (coords.length === 0) return;
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 30, duration: 0 },
    );
  } catch { /* ignore */ }
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

// ─── Cluster Suggestions ────────────────────────────────────────────────────

export interface CvClusterSuggestionsSectionProps {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  highlightClusterId: number | null;
  setHighlightClusterId: React.Dispatch<React.SetStateAction<number | null>>;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
  aiModelOverride: string | null;
  setAiModelOverride: React.Dispatch<React.SetStateAction<string | null>>;
  modelPickerOpen: boolean;
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modelPickerModels: Array<{ id: string }>;
  setModelPickerModels: React.Dispatch<React.SetStateAction<Array<{ id: string }>>>;
  modelPickerGlobal: string;
  setModelPickerGlobal: React.Dispatch<React.SetStateAction<string>>;
  modelPickerSelected: string;
  setModelPickerSelected: React.Dispatch<React.SetStateAction<string>>;
}

// Apply AI cluster-to-region match results to the dialog state.
function applyAISuggestionsToState(
  prev: CvMatchDialogState,
  matches: Array<{ clusterId: number; regionId: number | null }>,
  totalCost: number,
): CvMatchDialogState {
  const matchMap = new Map<number, number>();
  for (const m of matches) {
    if (m.regionId) matchMap.set(m.clusterId, m.regionId);
  }
  const findRegionForCluster = (clusterId: number) => {
    const regionId = matchMap.get(clusterId);
    if (!regionId) return null;
    return prev.childRegions.find(r => r.id === regionId) ?? null;
  };
  const applyToCluster = (c: ColorMatchCluster): ColorMatchCluster => {
    const region = findRegionForCluster(c.clusterId);
    return region ? { ...c, suggestedRegion: region } : c;
  };
  const applyToClusterInfo = (ci: ClusterGeoInfo): ClusterGeoInfo => {
    const region = findRegionForCluster(ci.clusterId);
    return region ? { ...ci, regionId: region.id, regionName: region.name } : ci;
  };
  const applyToFeature = (f: GeoJSON.Feature): GeoJSON.Feature => {
    if (!f.properties?.clusterId) return f;
    const region = findRegionForCluster(f.properties.clusterId);
    if (!region) return f;
    return { ...f, properties: { ...f.properties, regionId: region.id, regionName: region.name } };
  };
  const newClusters = prev.clusters.map(applyToCluster);
  const newGeo = prev.geoPreview ? {
    ...prev.geoPreview,
    clusterInfos: prev.geoPreview.clusterInfos.map(applyToClusterInfo),
    featureCollection: {
      ...prev.geoPreview.featureCollection,
      features: prev.geoPreview.featureCollection.features.map(applyToFeature),
    },
  } : prev.geoPreview;
  return {
    ...prev,
    clusters: newClusters,
    geoPreview: newGeo,
    progressText: `AI matched ${matchMap.size}/${prev.clusters.length} clusters ($${totalCost.toFixed(3)})`,
  };
}

export function CvClusterSuggestionsSection({
  cvMatchDialog, setCVMatchDialog,
  highlightClusterId, setHighlightClusterId,
  worldViewId, invalidateTree,
  aiModelOverride, setAiModelOverride,
  modelPickerOpen, setModelPickerOpen,
  modelPickerModels, setModelPickerModels,
  modelPickerGlobal, setModelPickerGlobal,
  modelPickerSelected, setModelPickerSelected,
}: CvClusterSuggestionsSectionProps) {
  const handleAISuggest = useCallback(async () => {
    const prevText = cvMatchDialog.progressText;
    setCVMatchDialog(prev => prev ? { ...prev, progressText: 'AI suggesting region matches...' } : prev);
    try {
      const clusterData = cvMatchDialog.clusters.map(c => ({
        clusterId: c.clusterId,
        color: c.color,
        pixelShare: c.pixelShare,
        divisionNames: [
          ...c.divisions.map(d => d.name),
          ...c.unsplittable.map(d => d.name),
        ],
      }));
      const result = await aiSuggestClusterRegions(
        worldViewId, clusterData, cvMatchDialog.childRegions, aiModelOverride || undefined,
      );
      setCVMatchDialog(prev => prev ? applyAISuggestionsToState(prev, result.matches, result.stats.cost) : prev);
    } catch (err) {
      console.error('AI suggest failed:', err);
      setCVMatchDialog(prev => prev ? { ...prev, progressText: prevText } : prev);
    }
  }, [cvMatchDialog, worldViewId, aiModelOverride, setCVMatchDialog]);

  const handleOpenModelPicker = useCallback(async () => {
    try {
      const { getAISettings } = await import('../../api/admin/ai');
      const { settings, models } = await getAISettings();
      const current = settings['model.cv_cluster_match'] || 'o4-mini';
      setModelPickerModels(models);
      setModelPickerGlobal(current);
      setModelPickerSelected(aiModelOverride || current);
      setModelPickerOpen(true);
    } catch (err) {
      console.error('Failed to load AI models:', err);
    }
  }, [aiModelOverride, setModelPickerModels, setModelPickerGlobal, setModelPickerSelected, setModelPickerOpen]);

  const handleSaveGlobalModel = useCallback(async () => {
    try {
      const { updateAISetting } = await import('../../api/admin/ai');
      await updateAISetting('model.cv_cluster_match', modelPickerSelected);
      setAiModelOverride(null);
      setModelPickerOpen(false);
      setCVMatchDialog(prev => prev ? { ...prev, progressText: `Global model → ${modelPickerSelected}` } : prev);
    } catch (err) {
      console.error('Failed to save:', err);
    }
  }, [modelPickerSelected, setAiModelOverride, setModelPickerOpen, setCVMatchDialog]);

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Suggested Assignments ({cvMatchDialog.clusters.reduce((s, c) => s + c.divisions.length, 0)} divisions → {cvMatchDialog.clusters.length} regions)
        </Typography>
        <Button
          size="small"
          variant="outlined"
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75, textTransform: 'none' }}
          disabled={!cvMatchDialog.sourceUrl}
          onClick={() => cvMatchDialog.sourceUrl && window.open(cvMatchDialog.sourceUrl, '_blank')}
          title={cvMatchDialog.sourceUrl ? 'Open Wikivoyage page to see region names' : 'No source URL available'}
        >
          View source page
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="primary"
          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75, textTransform: 'none' }}
          disabled={cvMatchDialog.clusters.length === 0 || cvMatchDialog.childRegions.length === 0}
          title="Use AI to match clusters to region names based on division geography"
          onClick={handleAISuggest}
        >
          AI Suggest
        </Button>
        <IconButton
          size="small"
          title={aiModelOverride ? `Model: ${aiModelOverride} (local override)` : 'Change AI model'}
          sx={{ width: 24, height: 24 }}
          onClick={handleOpenModelPicker}
        >
          <SettingsIcon sx={{ fontSize: 14, color: aiModelOverride ? 'primary.main' : 'text.secondary' }} />
        </IconButton>
        <Dialog open={modelPickerOpen} onClose={() => setModelPickerOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ pb: 1, fontSize: '1rem' }}>AI Model — Cluster Match</DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Global: {modelPickerGlobal}{aiModelOverride ? ` · Local override: ${aiModelOverride}` : ''}
            </Typography>
            <Select
              size="small"
              fullWidth
              value={modelPickerSelected}
              onChange={e => setModelPickerSelected(e.target.value)}
              sx={{ fontSize: '0.85rem' }}
            >
              {modelPickerModels.map(m => (
                <MenuItem key={m.id} value={m.id}>{m.id}</MenuItem>
              ))}
            </Select>
          </DialogContent>
          <DialogActions>
            {aiModelOverride && (
              <Button size="small" color="warning" onClick={() => { setAiModelOverride(null); setModelPickerOpen(false); }}>
                Clear override
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setModelPickerOpen(false)}>Cancel</Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => { setAiModelOverride(modelPickerSelected); setModelPickerOpen(false); }}
            >
              Use locally
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleSaveGlobalModel}
            >
              Save global
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
      {cvMatchDialog.clusters.map(cluster => (
        <ClusterCard
          key={cluster.clusterId}
          cluster={cluster}
          cvMatchDialog={cvMatchDialog}
          setCVMatchDialog={setCVMatchDialog}
          highlightClusterId={highlightClusterId}
          setHighlightClusterId={setHighlightClusterId}
          worldViewId={worldViewId}
          invalidateTree={invalidateTree}
        />
      ))}
      {/* Unmatched child regions — no cluster found for these */}
      {(() => {
        const matchedRegionIds = new Set(cvMatchDialog.clusters.map(c => c.suggestedRegion?.id).filter(Boolean));
        const unmatched = cvMatchDialog.childRegions.filter(r => !matchedRegionIds.has(r.id));
        if (unmatched.length === 0) return null;
        return (
          <Box sx={{ mb: 2, p: 1.5, border: '1px dashed', borderColor: 'warning.main', borderRadius: 1, bgcolor: 'warning.50' }}>
            <Typography variant="subtitle2" color="warning.main" sx={{ mb: 0.5 }}>
              Unmatched regions ({unmatched.length}) — reassign a cluster above using its dropdown
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              Each cluster has a region dropdown — pick one of these unmatched regions to assign its divisions.
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {unmatched.map(r => (
                <Chip key={r.id} label={r.name} size="small" variant="outlined" color="warning" />
              ))}
            </Box>
          </Box>
        );
      })()}
      {/* Out-of-bounds divisions — centroids outside source map coverage */}
      {(cvMatchDialog.outOfBounds?.length ?? 0) > 0 && (
        <Box sx={{ mb: 2, p: 1.5, border: '1px dashed', borderColor: 'info.main', borderRadius: 1, bgcolor: 'info.50' }}>
          <Typography variant="subtitle2" color="info.main" sx={{ mb: 0.5 }}>
            Outside map coverage ({cvMatchDialog.outOfBounds.length} divisions)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            These divisions fall outside the source map image. Assign them manually in the tree.
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {cvMatchDialog.outOfBounds.map(d => (
              <Chip key={d.id} label={d.name} size="small" variant="outlined" color="info" />
            ))}
          </Box>
        </Box>
      )}
      {/* Action buttons */}
      <AcceptActionButtons
        cvMatchDialog={cvMatchDialog}
        setCVMatchDialog={setCVMatchDialog}
        worldViewId={worldViewId}
        invalidateTree={invalidateTree}
      />
    </Box>
  );
}

// ─── ClusterCard ────────────────────────────────────────────────────────────

function ClusterCard({
  cluster, cvMatchDialog, setCVMatchDialog,
  highlightClusterId, setHighlightClusterId,
  worldViewId, invalidateTree,
}: {
  cluster: ColorMatchCluster;
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  highlightClusterId: number | null;
  setHighlightClusterId: React.Dispatch<React.SetStateAction<number | null>>;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
}) {
  return (
    <Box
      sx={{ mb: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, borderLeft: `4px solid ${cluster.color}` }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 16, height: 16, bgcolor: cluster.color, borderRadius: '2px', border: '1px solid rgba(0,0,0,0.2)', flexShrink: 0 }} />
          <Select
            size="small"
            displayEmpty
            value={cluster.suggestedRegion?.id ?? ''}
            sx={{ minWidth: 150, fontSize: '0.85rem', height: 28 }}
            onChange={(e) => {
              const rid = Number(e.target.value);
              const region = cvMatchDialog.childRegions.find(r => r.id === rid);
              if (!region) return;
              const cid = cluster.clusterId;
              setCVMatchDialog(prev => {
                if (!prev) return prev;
                const newClusters = prev.clusters.map(c =>
                  c.clusterId === cid ? { ...c, suggestedRegion: region } : c
                );
                // Propagate mapping to geoPreview so the map reflects it immediately
                const newGeo = prev.geoPreview ? {
                  ...prev.geoPreview,
                  clusterInfos: prev.geoPreview.clusterInfos.map(ci =>
                    ci.clusterId === cid ? { ...ci, regionId: rid, regionName: region.name } : ci
                  ),
                  featureCollection: {
                    ...prev.geoPreview.featureCollection,
                    features: prev.geoPreview.featureCollection.features.map(f =>
                      f.properties?.clusterId === cid
                        ? { ...f, properties: { ...f.properties, regionId: rid, regionName: region.name } }
                        : f
                    ),
                  },
                } : prev.geoPreview;
                return { ...prev, clusters: newClusters, geoPreview: newGeo };
              });
            }}
          >
            <MenuItem value="" disabled>
              Assign to region...
            </MenuItem>
            {(cvMatchDialog.childRegions ?? []).map(r => (
              <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
            ))}
          </Select>
          <Typography variant="body2" color="text.secondary">
            {Math.round(cluster.pixelShare * 100)}% · {cluster.divisions.length} div
            {cluster.unsplittable.length > 0 && ` · ${cluster.unsplittable.length} unsplittable`}
          </Typography>
          <IconButton
            size="small"
            title="Highlight on map"
            onClick={() => setHighlightClusterId(prev => prev === cluster.clusterId ? null : cluster.clusterId)}
            sx={{
              bgcolor: highlightClusterId === cluster.clusterId ? cluster.color : 'transparent',
              color: highlightClusterId === cluster.clusterId ? '#fff' : 'text.secondary',
              border: '1px solid',
              borderColor: highlightClusterId === cluster.clusterId ? cluster.color : 'divider',
              width: 26, height: 26,
              '&:hover': { bgcolor: cluster.color, color: '#fff' },
            }}
          >
            <Visibility sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        {(cluster.divisions.length > 0 || cluster.unsplittable.length > 0) && (
          <Button
            size="small"
            variant="contained"
            color="success"
            disabled={!cluster.suggestedRegion}
            title={!cluster.suggestedRegion ? 'Select a region from the dropdown first' : `Accept all ${cluster.divisions.length + cluster.unsplittable.length} divisions into ${cluster.suggestedRegion.name}`}
            onClick={async () => {
              if (!cluster.suggestedRegion) return;
              const regionId = cluster.suggestedRegion!.id;
              const assignments = [
                ...cluster.divisions.map(d => ({ regionId, divisionId: d.id })),
                ...cluster.unsplittable.map(d => ({ regionId, divisionId: d.id })),
              ];
              try {
                await acceptBatchMatches(worldViewId, assignments);
                setCVMatchDialog(prev => prev ? {
                  ...prev,
                  clusters: prev.clusters.filter(c => c.clusterId !== cluster.clusterId),
                } : prev);
                invalidateTree(cvMatchDialog.regionId);
              } catch (err) {
                console.error('Accept batch failed:', err);
              }
            }}
          >
            Accept all ({cluster.divisions.length + cluster.unsplittable.length})
          </Button>
        )}
      </Box>
      {/* Division list */}
      <Box sx={{ pl: 1 }}>
        {cluster.divisions.map(div => (
          <Typography key={div.id} variant="body2" sx={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
            {div.name || `#${div.id}`}
            <Typography component="span" variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              {' '}({Math.round(div.confidence * 100)}%{div.depth > 0 ? `, depth ${div.depth}` : ''})
            </Typography>
          </Typography>
        ))}
        {cluster.unsplittable.map(div => (
          <Typography key={div.id} variant="body2" sx={{ fontSize: '0.8rem', lineHeight: 1.6, color: 'warning.main' }}>
            {div.name || `#${div.id}`}
            <Typography component="span" variant="body2" sx={{ fontSize: '0.75rem' }}>
              {' '}({Math.round(div.confidence * 100)}%, unsplittable)
            </Typography>
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

// ─── Accept Action Buttons ──────────────────────────────────────────────────

function AcceptActionButtons({
  cvMatchDialog, setCVMatchDialog,
  worldViewId, invalidateTree,
}: {
  cvMatchDialog: CvMatchDialogState;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  worldViewId: number;
  invalidateTree: (regionId?: number) => void;
}) {
  const MIN_CONFIDENCE = 0.95;

  const wellFittingDivs = useMemo(() => {
    return cvMatchDialog.clusters
      .filter(c => c.suggestedRegion && c.divisions.length > 0)
      .flatMap(c => c.divisions
        .filter(d => d.confidence >= MIN_CONFIDENCE)
        .map(d => ({ regionId: c.suggestedRegion!.id, divisionId: d.id })));
  }, [cvMatchDialog.clusters]);

  const totalMatchedCount = useMemo(() => {
    return cvMatchDialog.clusters
      .filter(c => c.suggestedRegion)
      .reduce((s, c) => s + c.divisions.length + c.unsplittable.length, 0);
  }, [cvMatchDialog.clusters]);

  const hasAnyMatched = cvMatchDialog.clusters.some(
    c => c.suggestedRegion && (c.divisions.length > 0 || c.unsplittable.length > 0),
  );
  const showWellFittingButton = wellFittingDivs.length > 0 && wellFittingDivs.length !== totalMatchedCount;

  const handleAcceptWellFitting = useCallback(async () => {
    if (wellFittingDivs.length === 0) return;
    try {
      const acceptedIds = new Set(wellFittingDivs.map(a => a.divisionId));
      await acceptBatchMatches(worldViewId, wellFittingDivs);
      const stripAccepted = (c: ColorMatchCluster): ColorMatchCluster => ({
        ...c,
        divisions: c.divisions.filter(d => !acceptedIds.has(d.id)),
      });
      const hasMembers = (c: ColorMatchCluster) => c.divisions.length > 0 || c.unsplittable.length > 0;
      setCVMatchDialog(prev => prev ? {
        ...prev,
        clusters: prev.clusters.map(stripAccepted).filter(hasMembers),
      } : prev);
      invalidateTree(cvMatchDialog.regionId);
    } catch (err) {
      console.error('Accept well-fitting failed:', err);
    }
  }, [wellFittingDivs, worldViewId, setCVMatchDialog, invalidateTree, cvMatchDialog.regionId]);

  const handleAcceptAllMatched = useCallback(async () => {
    const allAssignments: Array<{ regionId: number; divisionId: number }> = [];
    for (const cluster of cvMatchDialog.clusters) {
      if (!cluster.suggestedRegion) continue;
      for (const div of cluster.divisions) {
        allAssignments.push({ regionId: cluster.suggestedRegion.id, divisionId: div.id });
      }
      for (const div of cluster.unsplittable) {
        allAssignments.push({ regionId: cluster.suggestedRegion.id, divisionId: div.id });
      }
    }
    if (allAssignments.length === 0) return;
    try {
      await acceptBatchMatches(worldViewId, allAssignments);
      setCVMatchDialog(prev => prev ? {
        ...prev,
        clusters: prev.clusters.filter(c => !c.suggestedRegion),
      } : prev);
      invalidateTree(cvMatchDialog.regionId);
    } catch (err) {
      console.error('Accept all failed:', err);
    }
  }, [cvMatchDialog.clusters, cvMatchDialog.regionId, worldViewId, setCVMatchDialog, invalidateTree]);

  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
      {showWellFittingButton && (
        <Button
          variant="contained"
          color="success"
          sx={{ flex: 1 }}
          onClick={handleAcceptWellFitting}
        >
          Accept well-fitting ({wellFittingDivs.length} divisions, &gt;95%)
        </Button>
      )}
      {hasAnyMatched && (
        <Button
          variant="contained"
          color="success"
          sx={{ flex: 1 }}
          onClick={handleAcceptAllMatched}
        >
          Accept all matched ({totalMatchedCount} divisions)
        </Button>
      )}
    </Box>
  );
}
