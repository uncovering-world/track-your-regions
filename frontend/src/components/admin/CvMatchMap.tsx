/**
 * CvMatchMap — Interactive MapLibre map for CV color-match division assignments.
 *
 * Extracted from WorldViewImportTree.tsx to isolate the self-contained map component
 * with paint mode, hover tooltips, and click-to-accept/reject.
 */

import { useState, useRef, useMemo } from 'react';
import { Box, Typography, Button } from '@mui/material';
import maplibregl from 'maplibre-gl';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import type { ClusterGeoInfo, SiblingRegionGeometry } from '../../api/adminWorldViewImport';

/** Merge multiple geometries into one using turf.union. Returns null if no valid geometries. */
export function mergeGeometries(geoms: GeoJSON.Geometry[]): GeoJSON.Geometry | null {
  if (geoms.length === 0) return null;
  try {
    let result = turf.feature(geoms[0] as GeoJSON.Polygon | GeoJSON.MultiPolygon);
    for (let i = 1; i < geoms.length; i++) {
      const merged = turf.union(turf.featureCollection([result, turf.feature(geoms[i] as GeoJSON.Polygon | GeoJSON.MultiPolygon)]));
      if (merged) result = merged;
    }
    return result.geometry;
  } catch {
    // Fallback: return GeometryCollection
    return { type: 'GeometryCollection', geometries: geoms };
  }
}

/** Merge gap geometries into an existing sibling region, returning updated array */
export function mergeGeomsIntoSibling(
  siblings: SiblingRegionGeometry[],
  targetRegionId: number,
  gapGeoms: GeoJSON.Geometry[],
): SiblingRegionGeometry[] {
  if (gapGeoms.length === 0) return siblings;
  return siblings.map(s => {
    if (s.regionId !== targetRegionId) return s;
    const merged = mergeGeometries([s.geometry, ...gapGeoms]);
    return merged ? { ...s, geometry: merged } : s;
  });
}

// Blank map style for CV preview — no basemap tiles that blend with colored divisions
export const CV_MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f5f5f5' } }],
};

export interface CvMatchMapProps {
  geoPreview: { featureCollection: GeoJSON.FeatureCollection; clusterInfos: ClusterGeoInfo[] };
  /** Accept a division: (divisionId, regionId) — persists via API */
  onAccept?: (divisionId: number, regionId: number, regionName: string) => void;
  /** Reject/dismiss a division from the suggestion */
  onReject?: (divisionId: number) => void;
  /** Reassign a division to a different color cluster (local only, no API call) */
  onClusterReassign?: (divisionId: number, clusterId: number, color: string) => void;
  /** Highlight all divisions belonging to this cluster (dim everything else) */
  highlightClusterId?: number | null;
}

/** Interactive MapLibre map showing CV color-match division assignments with click-to-accept/reject */
export function CvMatchMap({ geoPreview, onAccept, onReject, onClusterReassign, highlightClusterId }: CvMatchMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Track featureCollection identity — increment key to force Source remount
  // so MapLibre renders fresh tiles from the updated GeoJSON (no stale tile cache).
  const srcKeyRef = useRef({ data: geoPreview.featureCollection, key: 0 });
  if (srcKeyRef.current.data !== geoPreview.featureCollection) {
    srcKeyRef.current = { data: geoPreview.featureCollection, key: srcKeyRef.current.key + 1 };
  }

  // Paint mode: pick a cluster, then click divisions to assign them
  const [paintClusterId, setPaintClusterId] = useState<number | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fillColorExpr: any = ['get', 'color'];

  // Region label points: one per cluster at the centroid of that cluster's divisions
  const regionLabelPoints: GeoJSON.FeatureCollection = useMemo(() => {
    const clusterFeatures = new Map<number, GeoJSON.Feature[]>();
    for (const f of geoPreview.featureCollection.features) {
      const cid = f.properties?.clusterId as number;
      if (cid === -1) continue;
      if (!clusterFeatures.has(cid)) clusterFeatures.set(cid, []);
      clusterFeatures.get(cid)!.push(f);
    }
    const points: GeoJSON.Feature[] = [];
    for (const c of geoPreview.clusterInfos) {
      if (!c.regionName) continue;
      const features = clusterFeatures.get(c.clusterId);
      if (!features || features.length === 0) continue;
      try {
        const fc = turf.featureCollection(features);
        const centroid = turf.centroid(fc);
        centroid.properties = { regionName: c.regionName };
        points.push(centroid);
      } catch { /* skip */ }
    }
    return { type: 'FeatureCollection', features: points };
  }, [geoPreview]);

  // Selected feature details
  const selectedFeature = useMemo(() => {
    if (selectedId == null) return null;
    return geoPreview.featureCollection.features.find(
      f => f.properties?.divisionId === selectedId
    )?.properties ?? null;
  }, [selectedId, geoPreview.featureCollection]);

  // Hovered feature info for tooltip (only when no selection)
  const hoveredFeature = useMemo(() => {
    if (selectedId != null || hoveredId == null) return null;
    return geoPreview.featureCollection.features.find(
      f => f.properties?.divisionId === hoveredId
    )?.properties ?? null;
  }, [hoveredId, selectedId, geoPreview.featureCollection]);

  return (
    <Box sx={{ position: 'relative', height: '100%', minHeight: 350 }}>
      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
        style={{ width: '100%', height: '100%', borderRadius: 4, outline: paintClusterId != null ? `3px solid ${geoPreview.clusterInfos.find(c => c.clusterId === paintClusterId)?.color ?? '#000'}` : undefined }}
        mapStyle={CV_MAP_STYLE}
        interactiveLayerIds={['cv-divisions-fill']}
        onMouseMove={(e) => {
          const f = e.features?.[0];
          setHoveredId(f?.properties?.divisionId ?? null);
        }}
        onMouseLeave={() => setHoveredId(null)}
        onClick={(e) => {
          // Use a tolerance box for feature picking — tiny divisions at low zoom
          // may not register with point-based queryRenderedFeatures
          let f = e.features?.[0];
          if (!f && mapRef.current) {
            const point = e.point;
            const bbox: [[number, number], [number, number]] = [
              [point.x - 5, point.y - 5],
              [point.x + 5, point.y + 5],
            ];
            const hits = mapRef.current.queryRenderedFeatures(bbox, { layers: ['cv-divisions-fill'] });
            if (hits.length > 0) f = hits[0];
          }
          const divId = f?.properties?.divisionId ?? null;
          const isPreAssigned = f?.properties?.preAssigned === true;
          // Skip pre-assigned divisions — they're already accepted region members
          if (isPreAssigned) return;
          // Paint mode: clicking a division reassigns it locally to the active cluster.
          // Always use onClusterReassign (local-only) — onAccept hits the API and can
          // trigger re-renders that revert the color. User saves assignments later.
          if (paintClusterId != null && divId != null) {
            const ci = geoPreview.clusterInfos.find(c => c.clusterId === paintClusterId);
            if (ci && onClusterReassign) {
              onClusterReassign(divId, ci.clusterId, ci.color);
            }
            return;
          }
          setSelectedId(prev => prev === divId ? null : divId);
        }}
        cursor={paintClusterId != null ? 'crosshair' : undefined}
        onLoad={() => {
          if (mapRef.current && geoPreview.featureCollection.features.length > 0) {
            try {
              const bbox = turf.bbox(geoPreview.featureCollection) as [number, number, number, number];
              mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, duration: 0 });
            } catch (e) {
              console.error('Failed to fit CV preview bounds:', e);
            }
          }
        }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <Source key={srcKeyRef.current.key} id="cv-divisions" type="geojson" data={geoPreview.featureCollection}>
          <Layer
            id="cv-divisions-fill"
            type="fill"
            paint={{
              'fill-color': fillColorExpr,
              'fill-opacity': highlightClusterId != null
                ? ['case',
                    ['==', ['get', 'clusterId'], highlightClusterId], 0.75,
                    ['==', ['get', 'divisionId'], selectedId ?? -999], 0.7,
                    ['==', ['get', 'isOutOfBounds'], true], 0.08,
                    ['==', ['get', 'preAssigned'], true], 0.25,
                    0.08,
                  ]
                : ['case',
                    ['==', ['get', 'divisionId'], selectedId ?? -999], 0.95,
                    ['==', ['get', 'preAssigned'], true], 0.25,
                    ['==', ['get', 'dismissed'], true], 0.15,
                    ['==', ['get', 'isOutOfBounds'], true], 0.08,
                    ['==', ['get', 'clusterId'], -1], 0.1,
                    0.9,
                  ],
            }}
          />
          <Layer
            id="cv-divisions-outline"
            type="line"
            paint={{
              'line-color': ['case',
                ['==', ['get', 'divisionId'], selectedId ?? -999], '#1565c0',
                ['==', ['get', 'preAssigned'], true], '#999',
                ['==', ['get', 'dismissed'], true], '#999',
                ['==', ['get', 'isOutOfBounds'], true], '#aaa',
                '#333',
              ],
              'line-width': highlightClusterId != null
                ? ['case',
                    ['==', ['get', 'clusterId'], highlightClusterId], 2,
                    ['==', ['get', 'divisionId'], selectedId ?? -999], 3,
                    ['==', ['get', 'preAssigned'], true], 0.3,
                    ['==', ['get', 'isOutOfBounds'], true], 0.3,
                    0.3,
                  ]
                : ['case',
                    ['==', ['get', 'divisionId'], selectedId ?? -999], 3,
                    ['==', ['get', 'preAssigned'], true], 0.4,
                    ['==', ['get', 'dismissed'], true], 0.5,
                    ['==', ['get', 'isOutOfBounds'], true], 0.5,
                    ['==', ['get', 'isUnsplittable'], true], 1.5,
                    0.8,
                  ],
            }}
          />
          {/* Dashed overlay for unsplittable divisions */}
          <Layer
            id="cv-divisions-unsplittable"
            type="line"
            filter={['==', ['get', 'isUnsplittable'], true]}
            paint={{
              'line-color': '#d32f2f',
              'line-width': 2,
              'line-dasharray': [3, 3],
            }}
          />
          {/* Dashed overlay for out-of-bounds divisions */}
          <Layer
            id="cv-divisions-oob"
            type="line"
            filter={['==', ['get', 'isOutOfBounds'], true]}
            paint={{
              'line-color': '#ff9800',
              'line-width': 1.5,
              'line-dasharray': [4, 4],
            }}
          />
        </Source>
        {/* Region name labels (one point per cluster, placed at geographic centroid) */}
        <Source id="cv-region-labels-src" type="geojson" data={regionLabelPoints}>
          <Layer
            id="cv-region-labels"
            type="symbol"
            layout={{
              'text-field': ['get', 'regionName'],
              'text-size': 13,
              'text-font': ['Open Sans Semibold'],
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#000',
              'text-halo-color': '#fff',
              'text-halo-width': 2,
            }}
          />
        </Source>
      </MapGL>
      {/* Paint mode toolbar — pick a cluster, then click divisions to assign */}
      {(onAccept || onClusterReassign) && geoPreview.clusterInfos.filter(c => c.clusterId !== -1).length > 1 && (
        <Box sx={{
          position: 'absolute', top: 8, right: 8, zIndex: 2,
          bgcolor: 'rgba(255,255,255,0.95)', px: 1, py: 0.75,
          borderRadius: 1, boxShadow: 1,
          display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', maxWidth: 220,
        }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem', width: '100%' }}>
            Paint mode {paintClusterId != null && '(active)'}
          </Typography>
          {geoPreview.clusterInfos.filter(c => c.clusterId !== -1).map(c => (
            <Box
              key={c.clusterId}
              onClick={() => setPaintClusterId(prev => prev === c.clusterId ? null : c.clusterId)}
              title={c.regionName ?? `Cluster ${c.clusterId}`}
              sx={{
                width: 22, height: 22,
                bgcolor: c.color,
                borderRadius: '3px',
                border: paintClusterId === c.clusterId ? '3px solid #000' : c.regionName ? '2px solid rgba(0,0,0,0.2)' : '2px dashed rgba(0,0,0,0.25)',
                cursor: 'pointer',
                transition: 'transform 0.1s',
                transform: paintClusterId === c.clusterId ? 'scale(1.25)' : 'none',
                '&:hover': { transform: 'scale(1.15)' },
              }}
            />
          ))}
          {paintClusterId != null && (
            <Typography
              variant="caption"
              sx={{ cursor: 'pointer', color: 'text.secondary', textDecoration: 'underline', fontSize: '0.7rem' }}
              onClick={() => setPaintClusterId(null)}
            >
              cancel
            </Typography>
          )}
        </Box>
      )}
      {/* Hover tooltip (when nothing selected) */}
      {hoveredFeature && (
        <Box sx={{
          position: 'absolute', top: 8, left: 8,
          bgcolor: 'rgba(255,255,255,0.95)', px: 1.5, py: 0.75,
          borderRadius: 1, boxShadow: 1, pointerEvents: 'none', maxWidth: 280,
        }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{hoveredFeature.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {hoveredFeature.preAssigned ? `Already assigned to ${hoveredFeature.regionName ?? 'parent region'}` :
             hoveredFeature.dismissed ? 'Dismissed' :
             hoveredFeature.isUnsplittable ? `Unsplittable${hoveredFeature.regionName ? ` — suggests ${hoveredFeature.regionName}` : ''} — click to assign` :
             hoveredFeature.clusterId === -1 ? 'Unassigned' :
             `${hoveredFeature.regionName ?? 'Unmatched cluster'} — ${Math.round((hoveredFeature.confidence ?? 0) * 100)}% confidence`}
          </Typography>
        </Box>
      )}
      {/* Selected division action panel */}
      {selectedFeature && (() => {
        const isDismissed = !!selectedFeature.dismissed;
        const needsManualAssign = isDismissed || selectedFeature.isUnsplittable || selectedFeature.clusterId === -1 || selectedFeature.regionId == null;

        // Build cluster options for assignment — show ALL clusters (even unmapped) so user can assign by color
        const clusterOptions: Array<{ clusterId: number; regionId: number | null; regionName: string | null; color: string }> = [];
        if (onAccept || onClusterReassign) {
          for (const ci of geoPreview.clusterInfos) {
            if (ci.clusterId === selectedFeature.clusterId) continue; // skip division's own cluster
            if (ci.clusterId === -1) continue;
            clusterOptions.push(ci);
          }
        }

        const hasAcceptSuggested = onAccept && selectedFeature.regionId != null && selectedFeature.clusterId !== -1 && !selectedFeature.isUnsplittable && !isDismissed;

        return (
          <Box sx={{
            position: 'absolute', bottom: 28, left: 8, right: 8, zIndex: 1,
            bgcolor: 'rgba(255,255,255,0.97)', px: 2, py: 1,
            borderRadius: 1, boxShadow: 2,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 150 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{selectedFeature.name}</Typography>
                <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {isDismissed ? 'Dismissed' :
                   selectedFeature.isUnsplittable ? (<>
                     Unsplittable
                     {selectedFeature.regionName && <> — suggests <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, bgcolor: selectedFeature.color, borderRadius: '2px', border: '1px solid rgba(0,0,0,0.2)', verticalAlign: 'middle' }} /> {selectedFeature.regionName}</>}
                   </>) :
                   selectedFeature.clusterId === -1 ? 'Unassigned' :
                   `→ ${selectedFeature.regionName ?? 'Unmatched'} · ${Math.round((selectedFeature.confidence ?? 0) * 100)}%`}
                </Typography>
              </Box>
              {hasAcceptSuggested && (
                <Button
                  size="small" variant="contained" color="success"
                  onClick={() => {
                    onAccept!(selectedFeature.divisionId, selectedFeature.regionId, selectedFeature.regionName);
                    setSelectedId(null);
                  }}
                >
                  Accept
                </Button>
              )}
              {onReject && !isDismissed && selectedFeature.clusterId !== -1 && (
                <Button
                  size="small" variant="outlined" color="error"
                  onClick={() => {
                    onReject(selectedFeature.divisionId);
                    setSelectedId(null);
                  }}
                >
                  Dismiss
                </Button>
              )}
              <Button size="small" variant="text" onClick={() => setSelectedId(null)}>
                ✕
              </Button>
            </Box>
            {/* Color cluster swatches for assignment/reassignment */}
            {clusterOptions.length > 0 && (
              <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  {isDismissed ? 'Reassign to:' : needsManualAssign ? 'Assign to:' : 'Reassign to:'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {clusterOptions.map(c => (
                    <Box
                      key={c.clusterId}
                      onClick={() => {
                        if (c.regionId != null && c.regionName && onAccept) {
                          onAccept(selectedFeature.divisionId, c.regionId, c.regionName);
                        } else if (onClusterReassign) {
                          onClusterReassign(selectedFeature.divisionId, c.clusterId, c.color);
                        }
                        setSelectedId(null);
                      }}
                      title={c.regionName ?? `Cluster ${c.clusterId}`}
                      sx={{
                        width: 28, height: 28,
                        bgcolor: c.color,
                        borderRadius: '4px',
                        border: c.regionName ? '2px solid rgba(0,0,0,0.3)' : '2px dashed rgba(0,0,0,0.3)',
                        cursor: 'pointer',
                        transition: 'transform 0.1s, box-shadow 0.1s',
                        '&:hover': {
                          transform: 'scale(1.2)',
                          boxShadow: `0 0 0 2px ${c.color}`,
                          border: c.regionName ? '2px solid rgba(0,0,0,0.5)' : '2px dashed rgba(0,0,0,0.5)',
                        },
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        );
      })()}
    </Box>
  );
}
