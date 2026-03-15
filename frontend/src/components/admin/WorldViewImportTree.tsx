/**
 * WorldView Import Tree View
 *
 * Virtualized hierarchical tree showing match results at the country level.
 * Uses @tanstack/react-virtual to render only visible rows (~40 at a time),
 * keeping the DOM lightweight even when hundreds of nodes are expanded.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Box,
  Typography,
  Button,
  IconButton,
  CircularProgress,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  Autocomplete,
  Checkbox,
  Chip,
  Radio,
  RadioGroup,
  FormControlLabel,
  Select,
  MenuItem,
} from '@mui/material';

import {
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon,
  ErrorOutline as UnresolvedIcon,
  Layers as GapsIcon,
  CallMerge as SingleChildIcon,
  WarningAmber as WarningIcon,
  Close as CloseIcon,
  Psychology as ReviewIcon,
  ExpandMore as ExpandMoreIcon,
  PieChartOutline as CoverageIcon,
  Visibility,
} from '@mui/icons-material';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  getMatchTree,
  smartFlattenPreview,
  aiSuggestChildren as apiAISuggestChildren,
  getChildrenCoverage,
  getCoverageGeometry,
  analyzeCoverageGaps as apiAnalyzeCoverageGaps,
  colorMatchWithProgress,
  respondToWaterReview,
  respondToParkReview,
  parkCropUrl,
  respondToClusterReview,
  clusterPreviewUrl,
  type ClusterReviewCluster,
  mapshapeMatch,
  acceptBatchMatches,
  type ColorMatchSSEEvent,
  type ColorMatchCluster,
  type MatchTreeNode,
  waterCropUrl,
  type AISuggestChildrenResult,
  type CoverageGapDivision,
  type SiblingRegionGeometry,
  type ClusterGeoInfo,
} from '../../api/adminWorldViewImport';
import { searchDivisions } from '../../api/divisions';
import { runHierarchyReview, type HierarchyReviewResult, type ReviewAction } from '../../api/adminAI';
import { MapImagePickerDialog } from './MapImagePickerDialog';
import { SmartFlattenPreviewDialog } from './SmartFlattenPreviewDialog';
import { type ShadowInsertion } from './treeNodeShared';
import { TreeNodeRow } from './TreeNodeRow';
import {
  collectAncestorsOfIds,
  findUnresolvedNodes,
  findSingleChildNodes,
  findNodesWithWarnings,
  flattenVisibleTree,
  type FlatTreeItem,
} from './importTreeUtils';
import { useTreeMutations, type MapPickerState } from './useTreeMutations';
import { ManualFixDialog, RemoveRegionDialog, CoverageCompareDialog } from './ImportTreeDialogs';
import { ShadowCreateRow, NavControls, GapDivisionTree } from './GapAnalysis';
import { linkifyRegionNames } from './importTreeLinkify';
import * as turf from '@turf/turf';

/** Merge multiple geometries into one using turf.union. Returns null if no valid geometries. */
function mergeGeometries(geoms: GeoJSON.Geometry[]): GeoJSON.Geometry | null {
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
function mergeGeomsIntoSibling(
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

const CV_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Interactive MapLibre map showing CV color-match division assignments with click-to-accept/reject */
function CvMatchMap({ geoPreview, onAccept, onReject, onClusterReassign, highlightClusterId }: {
  geoPreview: { featureCollection: GeoJSON.FeatureCollection; clusterInfos: ClusterGeoInfo[] };
  /** Accept a division: (divisionId, regionId) — persists via API */
  onAccept?: (divisionId: number, regionId: number, regionName: string) => void;
  /** Reject/dismiss a division from the suggestion */
  onReject?: (divisionId: number) => void;
  /** Reassign a division to a different color cluster (local only, no API call) */
  onClusterReassign?: (divisionId: number, clusterId: number, color: string) => void;
  /** Highlight all divisions belonging to this cluster (dim everything else) */
  highlightClusterId?: number | null;
}) {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Paint mode: pick a cluster, then click divisions to assign them
  const [paintClusterId, setPaintClusterId] = useState<number | null>(null);

  // Use the per-feature `color` property for division fills
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
          const f = e.features?.[0];
          const divId = f?.properties?.divisionId ?? null;
          // Paint mode: clicking a division assigns it to the active cluster immediately
          if (paintClusterId != null && divId != null) {
            const ci = geoPreview.clusterInfos.find(c => c.clusterId === paintClusterId);
            if (ci) {
              if (ci.regionId != null && ci.regionName && onAccept) {
                onAccept(divId, ci.regionId, ci.regionName);
              } else if (onClusterReassign) {
                onClusterReassign(divId, ci.clusterId, ci.color);
              }
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
        <Source id="cv-divisions" type="geojson" data={geoPreview.featureCollection}>
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
                    0.08,
                  ]
                : ['case',
                    ['==', ['get', 'divisionId'], selectedId ?? -999], 0.7,
                    ['==', ['get', 'dismissed'], true], 0.15,
                    ['==', ['get', 'accepted'], true], 0.55,
                    ['==', ['get', 'isOutOfBounds'], true], 0.08,
                    ['==', ['get', 'clusterId'], -1], 0.1,
                    ['==', ['get', 'isUnsplittable'], true], 0.25,
                    0.4,
                  ],
            }}
          />
          <Layer
            id="cv-divisions-outline"
            type="line"
            paint={{
              'line-color': ['case',
                ['==', ['get', 'divisionId'], selectedId ?? -999], '#1565c0',
                ['==', ['get', 'dismissed'], true], '#999',
                ['==', ['get', 'isOutOfBounds'], true], '#aaa',
                '#333',
              ],
              'line-width': highlightClusterId != null
                ? ['case',
                    ['==', ['get', 'clusterId'], highlightClusterId], 2,
                    ['==', ['get', 'divisionId'], selectedId ?? -999], 3,
                    ['==', ['get', 'isOutOfBounds'], true], 0.3,
                    0.3,
                  ]
                : ['case',
                    ['==', ['get', 'divisionId'], selectedId ?? -999], 3,
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
            {hoveredFeature.dismissed ? 'Dismissed' :
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

interface WorldViewImportTreeProps {
  worldViewId: number;
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean, regionMapLabel?: string, regionName?: string) => void;
  onPreviewUnion?: (regionId: number, divisionIds: number[], context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string }) => void;
  onViewMap?: (regionId: number, context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string; divisionIds: number[] }) => void;
  shadowInsertions?: ShadowInsertion[];
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  /** Called when division assignments change, so parent can mark coverage as stale */
  onMatchChange?: () => void;
}

export function WorldViewImportTree({ worldViewId, onPreview, onPreviewUnion, onViewMap, shadowInsertions, onApproveShadow, onRejectShadow, onMatchChange }: WorldViewImportTreeProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);
  const [fixDialogState, setFixDialogState] = useState<{ regionId: number; regionName: string } | null>(null);
  const [removeDialogState, setRemoveDialogState] = useState<{
    regionId: number;
    regionName: string;
    hasChildren: boolean;
    hasDivisions: boolean;
  } | null>(null);
  const [mapPickerState, setMapPickerState] = useState<MapPickerState | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    regionId: number;
    currentName: string;
    newName: string;
  } | null>(null);
  const [reparentDialog, setReparentDialog] = useState<{
    regionId: number;
    regionName: string;
    selectedParentId: number | null;
  } | null>(null);
  // Persistent per-region AI review reports
  interface StoredReport {
    scope: string;
    regionId: number | null;
    report: string;
    actions: ReviewAction[];
    stats: HierarchyReviewResult['stats'] | null;
    generatedAt: string;
  }
  const [reviewReports, setReviewReports] = useState<Map<string, StoredReport>>(new Map());
  const [activeReviewKey, setActiveReviewKey] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState<{ key: string; passInfo: string } | null>(null);

  // AI suggest children state
  const [suggestChildrenResult, setSuggestChildrenResult] = useState<{
    regionId: number;
    regionName: string;
    result: AISuggestChildrenResult;
    selected: Set<string>;
  } | null>(null);
  const [aiSuggestingRegionId, setAISuggestingRegionId] = useState<number | null>(null);

  // CV color match / Mapshape match dialog state
  const [cvMatchingRegionId, setCVMatchingRegionId] = useState<number | null>(null);
  const [mapshapeMatchingRegionId, setMapshapeMatchingRegionId] = useState<number | null>(null);
  const [cvMatchDialog, setCVMatchDialog] = useState<{
    title: string;
    progressText: string;
    progressColor: string;
    debugImages: Array<{ label: string; dataUrl: string }>;
    clusters: ColorMatchCluster[];
    childRegions: Array<{ id: number; name: string }>;
    outOfBounds: Array<{ id: number; name: string }>;
    regionId: number;
    regionMapUrl: string | null;
    done: boolean;
    /** Saved cluster→region assignments from cluster review (persists after review is cleared) */
    savedRegionAssignments?: Map<number, number>;
    geoPreview?: {
      featureCollection: GeoJSON.FeatureCollection;
      clusterInfos: ClusterGeoInfo[];
    };
    /** Wikivoyage mapshape geoshape boundaries for side-by-side comparison */
    wikivoyagePreview?: GeoJSON.FeatureCollection;
    /** Interactive water review — pipeline paused waiting for user response */
    waterReview?: {
      reviewId: string;
      waterMaskImage: string;
      waterPxPercent: number;
      components: Array<{ id: number; pct: number; cropDataUrl: string; subClusters: Array<{ idx: number; pct: number; cropDataUrl: string }> }>;
      /** Per-component decision: 'water' | 'region' | 'mix' */
      decisions: Map<number, 'water' | 'region' | 'mix'>;
      /** Per-component sub-cluster approvals (only for 'mix' decisions) */
      mixApproved: Map<number, Set<number>>;
    };
    /** Interactive park review — pipeline paused waiting for user response */
    parkReview?: {
      reviewId: string;
      totalParkPct: number;
      components: Array<{ id: number; pct: number; cropUrl: string }>;
      /** Per-component decision: true = park (remove), false = keep */
      decisions: Map<number, boolean>;
    };
    /** Interactive cluster review — merge small artifact clusters before final assignment */
    clusterReview?: {
      reviewId: string;
      clusters: ClusterReviewCluster[];
      previewImage: string;
      /** Map from small cluster label → target cluster label to merge into */
      merges: Map<number, number>;
      /** Cluster labels to exclude (not a real region) */
      excludes: Set<number>;
      /** Map from cluster label → region id (user-assigned during review) */
      regionAssignments: Map<number, number>;
    };
  } | null>(null);
  const [highlightClusterId, setHighlightClusterId] = useState<number | null>(null);

  // Manual division search dialog state
  const [divisionSearchDialog, setDivisionSearchDialog] = useState<{
    regionId: number;
    regionName: string;
  } | null>(null);
  const [divSearchQuery, setDivSearchQuery] = useState('');
  const [divSearchResults, setDivSearchResults] = useState<Awaited<ReturnType<typeof searchDivisions>>>([]);
  const [divSearchLoading, setDivSearchLoading] = useState(false);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
  });

  // Children coverage query (separate from tree to avoid slowing every tree load).
  // staleTime=Infinity: we manage updates manually via setQueryData in refreshCoverage,
  // so prevent TanStack Query from auto-refetching (which would recompute ALL containers).
  const { data: coverageData, isRefetching: coverageRefetching, isLoading: coverageLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'childrenCoverage', worldViewId],
    queryFn: () => getChildrenCoverage(worldViewId),
    staleTime: Infinity,
  });

  // Track which region was last mutated so we only show spinner on affected ancestors
  const [lastMutatedRegionId, setLastMutatedRegionId] = useState<number | null>(null);

  // Clear the dirty marker once coverage refetch completes
  useEffect(() => {
    if (!coverageRefetching && lastMutatedRegionId != null) {
      setLastMutatedRegionId(null);
    }
  }, [coverageRefetching, lastMutatedRegionId]);

  // Compute the set of ancestor IDs for the last mutated region
  const coverageDirtyIds = useMemo<ReadonlySet<number>>(() => {
    if (!coverageRefetching || lastMutatedRegionId == null || !tree) return new Set();
    // Build parent map from tree
    const parentOf = new Map<number, number | null>();
    const walkTree = (nodes: MatchTreeNode[], parentId: number | null) => {
      for (const n of nodes) {
        parentOf.set(n.id, parentId);
        walkTree(n.children, n.id);
      }
    };
    walkTree(tree, null);
    // Walk up from mutated region collecting ancestors
    const dirtyIds = new Set<number>();
    let current: number | null = lastMutatedRegionId;
    while (current != null) {
      dirtyIds.add(current);
      current = parentOf.get(current) ?? null;
    }
    return dirtyIds;
  }, [coverageRefetching, lastMutatedRegionId, tree]);

  // Coverage comparison dialog state
  const [coverageCompare, setCoverageCompare] = useState<{
    regionId: number;
    regionName: string;
    loading: boolean;
    parentGeometry: GeoJSON.Geometry | null;
    childrenGeometry: GeoJSON.Geometry | null;
    geoshapeGeometry?: GeoJSON.Geometry | null;
  } | null>(null);

  const handleCoverageClick = useCallback((regionId: number) => {
    // Find region name
    const findName = (nodes: MatchTreeNode[]): string => {
      for (const n of nodes) {
        if (n.id === regionId) return n.name;
        const found = findName(n.children);
        if (found) return found;
      }
      return '';
    };
    const name = findName(tree ?? []);
    setCoverageCompare({ regionId, regionName: name, loading: true, parentGeometry: null, childrenGeometry: null, geoshapeGeometry: null });

    getCoverageGeometry(worldViewId, regionId).then(data => {
      setCoverageCompare(prev => prev?.regionId === regionId ? { ...prev, loading: false, ...data } : prev);
    }).catch(() => {
      setCoverageCompare(prev => prev?.regionId === regionId ? { ...prev, loading: false } : prev);
    });
  }, [tree, worldViewId]);

  // Coverage gap analysis state
  const [gapAnalysis, setGapAnalysis] = useState<{
    regionId: number;
    regionName: string;
    loading: boolean;
    gapDivisions: CoverageGapDivision[];
    siblingRegions: SiblingRegionGeometry[];
    regionMapUrl: string | null;
  } | null>(null);
  const [highlightedGapId, setHighlightedGapId] = useState<number | null>(null);

  const handleAnalyzeGaps = useCallback(async (regionId: number) => {
    const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
      for (const n of nodes) {
        if (n.id === regionId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    const node = tree ? findNode(tree) : null;
    const regionName = node?.name ?? 'Region';
    const regionMapUrl = node?.regionMapUrl ?? null;
    setGapAnalysis({ regionId, regionName, loading: true, gapDivisions: [], siblingRegions: [], regionMapUrl });

    try {
      const result = await apiAnalyzeCoverageGaps(worldViewId, regionId);
      setGapAnalysis({ regionId, regionName, loading: false, gapDivisions: result.gapDivisions, siblingRegions: result.siblingRegions, regionMapUrl });
    } catch (err) {
      console.error('Coverage gap analysis failed:', err);
      setGapAnalysis(prev => prev ? { ...prev, loading: false } : prev);
    }
  }, [tree, worldViewId]);

  // Ref for mapPickerState — needed by selectMapMutation to read pending preview
  const mapPickerStateRef = useRef(mapPickerState);
  mapPickerStateRef.current = mapPickerState;

  const mutations = useTreeMutations(worldViewId, {
    onPreview,
    mapPickerStateRef,
    setMapPickerState,
    setRemoveDialogState,
    onMatchChange,
  });

  const {
    acceptMutation, rejectMutation, rejectRemainingMutation, acceptAndRejectRestMutation,
    acceptAllMutation, acceptSelectedMutation, acceptSelectedRejectRestMutation, rejectSelectedMutation,
    dbSearchOneMutation, aiMatchOneMutation, geocodeMatchMutation, geoshapeMatchMutation, pointMatchMutation,
    resetMatchMutation, clearMembersMutation, dismissMutation, pruneMutation, syncMutation, groupingMutation, mergeMutation,
    smartFlattenMutation, removeMutation, collapseToParentMutation, autoResolveMutation, undoMutation,
    selectMapMutation, manualFixMutation, addChildMutation,
    dismissWarningsMutation, renameMutation, reparentMutation,
    renamingRegionId, reparentingRegionId,
    geocodeProgress, undoSnackbar, setUndoSnackbar,
    isMutating, invalidateTree,
  } = mutations;

  const handleOpenMapPicker = useCallback((node: MatchTreeNode, pendingPreview?: { divisionId: number; name: string; path?: string; isAssigned: boolean }) => {
    setMapPickerState({
      regionId: node.id,
      regionName: node.name,
      candidates: node.mapImageCandidates,
      currentSelection: node.regionMapUrl,
      wikidataId: node.wikidataId,
      pendingPreview,
    });
  }, []);

  const handleReview = useCallback(async (regionId?: number, forceRegenerate = false) => {
    const key = regionId != null ? `region-${regionId}` : 'full';

    // If report already exists and not forcing regenerate, just open it
    if (!forceRegenerate && reviewReports.has(key) && !reviewLoading) {
      setActiveReviewKey(key);
      return;
    }

    const scope = regionId ? 'Subtree review' : 'Full tree';
    const passInfo = regionId ? 'Analyzing branch...' : 'Pass 1: surveying tree structure...';
    setActiveReviewKey(key);
    setReviewLoading({ key, passInfo });

    try {
      const result = await runHierarchyReview(worldViewId, regionId);
      const stored: StoredReport = {
        scope,
        regionId: regionId ?? null,
        report: result.report,
        actions: (result.actions ?? []).map((a, i) => ({ ...a, id: a.id || `action-${i}`, completed: false })),
        stats: result.stats,
        generatedAt: new Date().toISOString(),
      };
      setReviewReports(prev => new Map(prev).set(key, stored));
    } catch (err) {
      const stored: StoredReport = {
        scope,
        regionId: regionId ?? null,
        report: `Error: ${err instanceof Error ? err.message : 'Review failed'}`,
        actions: [],
        stats: null,
        generatedAt: new Date().toISOString(),
      };
      setReviewReports(prev => new Map(prev).set(key, stored));
    } finally {
      setReviewLoading(null);
    }
  }, [worldViewId, reviewReports, reviewLoading]);

  const handleRenameSubmit = useCallback(() => {
    if (!renameDialog || !renameDialog.newName.trim()) return;
    renameMutation.mutate(
      { regionId: renameDialog.regionId, name: renameDialog.newName.trim() },
      { onSettled: () => setRenameDialog(null) },
    );
  }, [renameDialog, renameMutation]);

  const handleReparentSubmit = useCallback(() => {
    if (!reparentDialog) return;
    reparentMutation.mutate(
      { regionId: reparentDialog.regionId, newParentId: reparentDialog.selectedParentId },
      { onSettled: () => setReparentDialog(null) },
    );
  }, [reparentDialog, reparentMutation]);

  // Compute which sourceUrls appear on multiple nodes (duplicates)
  // and which are already synced (same matchStatus and same division set)
  const { duplicateUrls, syncedUrls } = useMemo(() => {
    if (!tree) return { duplicateUrls: new Set<string>(), syncedUrls: new Set<string>() };
    const urlNodes = new Map<string, MatchTreeNode[]>();
    function walk(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.sourceUrl) {
          const existing = urlNodes.get(node.sourceUrl);
          if (existing) existing.push(node);
          else urlNodes.set(node.sourceUrl, [node]);
        }
        walk(node.children);
      }
    }
    walk(tree);
    const dups = new Set<string>();
    const synced = new Set<string>();
    for (const [url, nodes] of urlNodes) {
      if (nodes.length > 1) {
        dups.add(url);
        // Check if all instances have the same matchStatus and same set of divisionIds
        const refStatus = nodes[0].matchStatus;
        const refDivs = nodes[0].assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',');
        const allSame = nodes.every(n =>
          n.matchStatus === refStatus &&
          n.assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',') === refDivs,
        );
        if (allSame) synced.add(url);
      }
    }
    return { duplicateUrls: dups, syncedUrls: synced };
  }, [tree]);

  // Build maps from node ID → direct parent's regionMapUrl and name (for fallback in preview)
  const { parentRegionMapUrlById, parentRegionMapNameById } = useMemo(() => {
    const urlMap = new Map<number, string>();
    const nameMap = new Map<number, string>();
    if (!tree) return { parentRegionMapUrlById: urlMap, parentRegionMapNameById: nameMap };
    function walk(nodes: MatchTreeNode[], parentMapUrl: string | null, parentMapName: string | null) {
      for (const node of nodes) {
        if (parentMapUrl) urlMap.set(node.id, parentMapUrl);
        if (parentMapName) nameMap.set(node.id, parentMapName);
        // Only pass THIS node's own map to children — don't propagate inherited ancestor maps
        walk(node.children, node.regionMapUrl ?? null, node.regionMapUrl ? node.name : null);
      }
    }
    walk(tree, null, null);
    return { parentRegionMapUrlById: urlMap, parentRegionMapNameById: nameMap };
  }, [tree]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allBranchIds = useMemo(() => {
    if (!tree) return new Set<number>();
    const ids = new Set<number>();
    function walk(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.add(node.id);
          walk(node.children);
        }
      }
    }
    walk(tree);
    return ids;
  }, [tree]);

  // Compute per-region shadow map
  const shadowsByRegionId = useMemo(() => {
    const map = new Map<number, ShadowInsertion[]>();
    for (const s of shadowInsertions ?? []) {
      const arr = map.get(s.targetRegionId) ?? [];
      arr.push(s);
      map.set(s.targetRegionId, arr);
    }
    return map;
  }, [shadowInsertions]);

  // Flatten tree into visible items for the virtualizer
  const flatItems = useMemo<FlatTreeItem[]>(() => {
    if (!tree) return [];
    return flattenVisibleTree(tree, expanded, shadowsByRegionId);
  }, [tree, expanded, shadowsByRegionId]);

  // Virtualizer for the flat list
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 15,
    getItemKey: (index) => {
      const item = flatItems[index];
      if (item.kind === 'node') {
        const n = item.node;
        // Include content-affecting fields so the virtualizer discards stale cached
        // heights when row content changes (e.g., suggestions removed after accept).
        // Without this, ResizeObserver intermittently misses height changes, leaving
        // blank space where removed content used to be.
        return `${n.id}:${n.matchStatus}:${n.suggestions.length}:${n.assignedDivisions.length}:${n.hierarchyReviewed}`;
      }
      return `shadow-${item.shadow.gapDivisionId}`;
    },
  });

  /** Pending scroll target — useEffect on flatItems will scroll when the target becomes visible */
  const pendingScrollRef = useRef<number | null>(null);
  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  /** Request scroll to a node. Scrolls immediately if visible, else defers to useEffect. */
  const requestScrollTo = useCallback((targetId: number) => {
    const items = flatItemsRef.current;
    const index = items.findIndex(item => item.kind === 'node' && item.node.id === targetId);
    if (index >= 0) {
      virtualizerRef.current.scrollToIndex(index, { align: 'center' });
      pendingScrollRef.current = null;
    } else {
      pendingScrollRef.current = targetId;
    }
  }, []);

  // When flatItems changes (expanded set updated), execute pending scroll
  useEffect(() => {
    if (pendingScrollRef.current == null) return;
    const targetId = pendingScrollRef.current;
    const index = flatItems.findIndex(item => item.kind === 'node' && item.node.id === targetId);
    if (index >= 0) {
      pendingScrollRef.current = null;
      virtualizer.scrollToIndex(index, { align: 'center' });
    }
  }, [flatItems, virtualizer]);

  const expandAll = useCallback(() => {
    setExpanded(new Set(allBranchIds));
  }, [allBranchIds]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const expandToShadows = useCallback(() => {
    if (!tree || !shadowInsertions?.length) return;
    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    setExpanded(new Set([...ancestorIds, ...targetIds]));
    requestScrollTo(shadowInsertions[0].targetRegionId);
  }, [tree, shadowInsertions, requestScrollTo]);

  // Flat list of all regions for reparent dialog Autocomplete
  const flatRegionList = useMemo(() => {
    if (!tree) return [];
    const list: Array<{ id: number; name: string; depth: number }> = [];
    function walk(nodes: MatchTreeNode[], depth: number) {
      for (const node of nodes) {
        list.push({ id: node.id, name: node.name, depth });
        if (node.children.length > 0) walk(node.children, depth + 1);
      }
    }
    walk(tree, 0);
    return list;
  }, [tree]);

  // Name → ID map for clickable region names in review text
  const regionNameToId = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of flatRegionList) {
      // First occurrence wins (higher in tree = more likely intended)
      if (!map.has(r.name)) map.set(r.name, r.id);
    }
    return map;
  }, [flatRegionList]);

  // Navigate to a specific region by ID (expand ancestors, scroll, highlight)
  const navigateToRegion = useCallback((regionId: number) => {
    if (!tree) return;
    setActiveNav(null);
    setReviewHighlightId(regionId);
    const ancestorIds = collectAncestorsOfIds(tree, new Set([regionId]));
    setExpanded(prev => new Set([...prev, ...ancestorIds, regionId]));
    requestScrollTo(regionId);
  }, [tree, requestScrollTo]);

  // Regex matching any region name (longest first to avoid partial matches)
  const regionNameRegex = useMemo(() => {
    if (regionNameToId.size === 0) return null;
    const names = [...regionNameToId.keys()]
      .filter(n => n.length >= 3) // skip very short names to avoid false positives
      .sort((a, b) => b.length - a.length); // longest first
    if (names.length === 0) return null;
    const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from escaped region names, not user input
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'g');
  }, [regionNameToId]);

  // Category ID lists for navigation
  const unresolvedIds = useMemo(() => tree ? findUnresolvedNodes(tree) : [], [tree]);
  const singleChildIds = useMemo(() => tree ? findSingleChildNodes(tree) : [], [tree]);
  const warningIds = useMemo(() => tree ? findNodesWithWarnings(tree) : [], [tree]);

  // Regions with children coverage < 99% (only containers with coverage data)
  const incompleteCoverageIds = useMemo(() => {
    if (!coverageData?.coverage) return [];
    const ids: number[] = [];
    for (const [key, pct] of Object.entries(coverageData.coverage)) {
      if (pct < 0.99) ids.push(Number(key));
    }
    return ids;
  }, [coverageData?.coverage]);

  // Unified category navigation state
  type NavCategory = 'unresolved' | 'warnings' | 'single-child' | 'incomplete-coverage';

  const [activeNav, setActiveNav] = useState<{ category: NavCategory; idx: number } | null>(null);

  const navIdsMap: Record<NavCategory, number[]> = useMemo(() => ({
    unresolved: unresolvedIds,
    warnings: warningIds,
    'single-child': singleChildIds,
    'incomplete-coverage': incompleteCoverageIds,
  }), [unresolvedIds, warningIds, singleChildIds, incompleteCoverageIds]);

  // Region clicked from review drawer
  const [reviewHighlightId, setReviewHighlightId] = useState<number | null>(null);

  const highlightedRegionId = activeNav
    ? navIdsMap[activeNav.category][activeNav.idx] ?? null
    : reviewHighlightId;

  const navigateTo = useCallback((category: NavCategory, idx: number) => {
    const ids = navIdsMap[category];
    if (!tree || idx < 0 || idx >= ids.length) return;
    setActiveNav({ category, idx });
    const targetId = ids[idx];
    const ancestorIds = collectAncestorsOfIds(tree, new Set([targetId]));
    setExpanded(prev => new Set([...prev, ...ancestorIds, targetId]));
    requestScrollTo(targetId);
  }, [tree, navIdsMap, requestScrollTo]);

  // When the nav list changes (item dismissed/resolved), clamp index and scroll to new current.
  // Compare by content length, not reference — optimistic updates create new array refs
  // with the same content, and reference comparison would trigger spurious scroll cycles.
  const prevNavLengthRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeNav) {
      prevNavLengthRef.current = null;
      return;
    }
    const ids = navIdsMap[activeNav.category];
    const prevLength = prevNavLengthRef.current;
    prevNavLengthRef.current = ids.length;

    if (ids.length === 0) {
      setActiveNav(null);
      return;
    }

    // List content actually changed (length changed after accept/reject/dismiss)
    if (prevLength != null && prevLength !== ids.length) {
      const clampedIdx = Math.min(activeNav.idx, ids.length - 1);
      if (clampedIdx !== activeNav.idx) {
        setActiveNav({ category: activeNav.category, idx: clampedIdx });
      }
      // Scroll to the (possibly new) item at this index
      const targetId = ids[clampedIdx];
      if (tree) {
        const ancestorIds = collectAncestorsOfIds(tree, new Set([targetId]));
        setExpanded(prev => new Set([...prev, ...ancestorIds, targetId]));
        requestScrollTo(targetId);
      }
    } else if (activeNav.idx >= ids.length) {
      setActiveNav({ category: activeNav.category, idx: ids.length - 1 });
    }
  }, [activeNav, navIdsMap, tree, requestScrollTo]);

  const [flattenPreview, setFlattenPreview] = useState<{
    regionId: number;
    regionName: string;
    geometry: GeoJSON.Geometry | null;
    regionMapUrl: string | null;
    descendants: number;
    divisions: number;
  } | null>(null);
  const [flattenPreviewLoading, setFlattenPreviewLoading] = useState<number | null>(null);

  const handleSmartFlatten = useCallback(async (regionId: number) => {
    const findName = (nodes: MatchTreeNode[]): string => {
      for (const n of nodes) {
        if (n.id === regionId) return n.name;
        const found = findName(n.children);
        if (found) return found;
      }
      return '';
    };
    const regionName = tree ? findName(tree) : 'Region';

    setFlattenPreviewLoading(regionId);
    try {
      const data = await smartFlattenPreview(worldViewId, regionId);
      if (data.unmatched) {
        const names = data.unmatched.map(u => u.name).join(', ');
        setUndoSnackbar({
          open: true,
          message: `Cannot flatten: ${data.unmatched.length} unmatched: ${names}`,
          worldViewId,
        });
        invalidateTree();
        return;
      }
      setFlattenPreview({
        regionId,
        regionName,
        geometry: data.geometry ?? null,
        regionMapUrl: data.regionMapUrl ?? null,
        descendants: data.descendants ?? 0,
        divisions: data.divisions ?? 0,
      });
    } catch (err) {
      console.error('Smart flatten preview failed:', err);
      setUndoSnackbar({
        open: true,
        message: `Preview failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        worldViewId,
      });
    } finally {
      setFlattenPreviewLoading(null);
    }
  }, [tree, worldViewId, invalidateTree, setUndoSnackbar]);

  const [addChildDialogRegionId, setAddChildDialogRegionId] = useState<number | null>(null);

  const handleRemoveRegion = useCallback((regionId: number) => {
    const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
      for (const n of nodes) {
        if (n.id === regionId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    const node = tree ? findNode(tree) : null;
    if (!node) return;
    setRemoveDialogState({
      regionId,
      regionName: node.name,
      hasChildren: node.children.length > 0,
      hasDivisions: node.memberCount > 0,
    });
  }, [tree]);

  const handleAddChild = useCallback((parentRegionId: number) => {
    setAddChildDialogRegionId(parentRegionId);
  }, []);

  const handleAISuggestChildren = useCallback(async (regionId: number) => {
    const findName = (nodes: MatchTreeNode[]): string => {
      for (const n of nodes) {
        if (n.id === regionId) return n.name;
        const found = findName(n.children);
        if (found) return found;
      }
      return '';
    };
    const regionName = tree ? findName(tree) : 'Region';

    setAISuggestingRegionId(regionId);
    try {
      const result = await apiAISuggestChildren(worldViewId, regionId);
      setSuggestChildrenResult({
        regionId,
        regionName,
        result,
        selected: new Set(result.suggestions.map(s => s.name)),
      });
    } catch (err) {
      console.error('AI suggest children failed:', err);
      setUndoSnackbar({
        open: true,
        message: `Suggest children failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        worldViewId,
      });
    } finally {
      setAISuggestingRegionId(null);
    }
  }, [tree, worldViewId, setUndoSnackbar]);

  // CV color match handler — opens dialog immediately with SSE progress
  const handleCVMatch = useCallback(async (regionId: number, method: 'classical' | 'meanshift' = 'classical') => {
    // Find tree node to get the original region map URL
    const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
      for (const n of nodes) {
        if (n.id === regionId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    const node = tree ? findNode(tree) : null;

    // Pre-populate childRegions from tree so they're available during cluster review
    const childRegions = node?.children?.map(c => ({ id: c.id, name: c.name })) ?? [];

    setCVMatchingRegionId(regionId);
    setCVMatchDialog({
      title: method === 'meanshift' ? 'CV Mean-Shift Match' : 'CV Color Match',
      progressText: 'Connecting...',
      progressColor: '#666',
      debugImages: [],
      clusters: [],
      childRegions,
      outOfBounds: [],
      regionId,
      regionMapUrl: node?.regionMapUrl ?? null,
      done: false,
    });

    try {
      await colorMatchWithProgress(worldViewId, regionId, (event: ColorMatchSSEEvent) => {
        if (event.type === 'progress' && event.step) {
          setCVMatchDialog(prev => prev ? { ...prev, progressText: `${event.step} (${event.elapsed?.toFixed(1)}s)` } : prev);
        }

        if (event.type === 'debug_image' && event.debugImage) {
          const img = event.debugImage;
          setCVMatchDialog(prev => prev ? { ...prev, debugImages: [...prev.debugImages, img] } : prev);
        }

        if (event.type === 'water_review' && event.reviewId) {
          console.log(`[CV SSE] water_review: ${event.waterComponents?.length ?? 0} components, reviewId=${event.reviewId}`);
          const rid = event.reviewId;
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            const waterImg = [...prev.debugImages].reverse().find(img => img.label.startsWith('Water mask'));
            // Build crop URLs pointing to the backend GET endpoint (no SSE bloat)
            const components = (event.waterComponents ?? []).map(c => ({
              ...c,
              cropDataUrl: waterCropUrl(rid, c.id, -1),
              subClusters: (c.subClusters ?? []).map(sc => ({
                ...sc,
                cropDataUrl: waterCropUrl(rid, c.id, sc.idx),
              })),
            }));
            // Default: all components marked as water
            const decisions = new Map<number, 'water' | 'region' | 'mix'>();
            for (const c of components) decisions.set(c.id, 'water');
            return {
              ...prev,
              waterReview: {
                reviewId: rid,
                waterMaskImage: waterImg?.dataUrl ?? '',
                waterPxPercent: event.waterPxPercent ?? 0,
                components,
                decisions,
                mixApproved: new Map<number, Set<number>>(),
              },
              progressText: 'Water detection — review needed',
              progressColor: '#ed6c02',
            };
          });
        }

        if (event.type === 'park_review' && event.reviewId) {
          console.log(`[CV SSE] park_review: ${event.data?.components?.length ?? 0} components, reviewId=${event.reviewId}`);
          const rid = event.reviewId;
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            const components = (event.data?.components ?? []).map(c => ({
              id: c.id,
              pct: c.pct,
              cropUrl: parkCropUrl(rid, c.id),
            }));
            // Default: all components marked as parks (to be removed)
            const decisions = new Map<number, boolean>();
            for (const c of components) decisions.set(c.id, true);
            return {
              ...prev,
              parkReview: {
                reviewId: rid,
                totalParkPct: event.data?.totalParkPct ?? 0,
                components,
                decisions,
              },
              progressText: 'Park overlay detection — review needed',
              progressColor: '#2e7d32',
            };
          });
        }

        if (event.type === 'cluster_review' && event.reviewId) {
          console.log(`[CV SSE] cluster_review: ${event.data?.clusters?.length ?? 0} clusters, reviewId=${event.reviewId}`);
          const rid = event.reviewId;
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            const clusters = event.data?.clusters ?? [];
            // Auto-exclude near-gray clusters (low saturation, likely artifacts)
            const autoExcludes = new Set<number>();
            for (const c of clusters) {
              const m = c.color.match(/rgb\((\d+),(\d+),(\d+)\)/);
              if (m) {
                const r = +m[1], g = +m[2], b = +m[3];
                const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
                const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
                if (sat < 0.15 && c.isSmall) autoExcludes.add(c.label);
              }
            }
            return {
              ...prev,
              clusterReview: {
                reviewId: rid,
                clusters,
                previewImage: clusterPreviewUrl(rid),
                merges: new Map(),
                excludes: autoExcludes,
                regionAssignments: new Map(),
              },
              progressText: 'Cluster review — merge small artifacts before assignment',
              progressColor: '#1565c0',
            };
          });
        }

        if (event.type === 'complete' && event.data?.stats) {
          const stats = event.data.stats;
          const clusters = event.data.clusters ?? [];
          const title = stats.countryName
            ? `CV Match — ${stats.countryName} (${stats.cvAssignedDivisions ?? 0} divisions → ${stats.cvClusters ?? 0} clusters)`
            : 'CV Match';
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            // Apply region assignments from cluster review (user picked regions during review)
            const savedAssignments = prev.savedRegionAssignments ?? prev.clusterReview?.regionAssignments;
            const finalClusters = savedAssignments && savedAssignments.size > 0
              ? clusters.map(c => {
                  const assignedRegionId = savedAssignments.get(c.clusterId);
                  if (assignedRegionId == null) return c;
                  const childRegions = event.data?.childRegions ?? prev.childRegions;
                  const region = childRegions.find(r => r.id === assignedRegionId);
                  return region ? { ...c, suggestedRegion: region } : c;
                })
              : clusters;
            return {
              ...prev,
              title,
              clusters: finalClusters,
              childRegions: event.data?.childRegions ?? prev.childRegions,
              outOfBounds: event.data?.outOfBounds ?? prev.outOfBounds,
              geoPreview: event.data?.geoPreview,
              progressText: `Done in ${event.elapsed?.toFixed(1)}s — ${stats.cvUnsplittable ?? 0} unsplittable${stats.cvOutOfBounds ? `, ${stats.cvOutOfBounds} outside map` : ''}`,
              progressColor: '#2e7d32',
              done: true,
            };
          });
        }

        if (event.type === 'error') {
          setCVMatchDialog(prev => prev ? {
            ...prev,
            progressText: `Error: ${event.message}`,
            progressColor: '#d32f2f',
            done: true,
          } : prev);
        }
      }, method);
    } catch (err) {
      console.error('CV match failed:', err);
      setCVMatchDialog(prev => prev ? {
        ...prev,
        progressText: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        progressColor: '#d32f2f',
        done: true,
      } : prev);
    } finally {
      setCVMatchingRegionId(null);
    }
  }, [worldViewId, tree]);

  // Mapshape match handler — fetches Kartographer mapshape data from Wikivoyage page,
  // maps to GADM divisions, and opens the same dialog as CV match
  const handleMapshapeMatch = useCallback(async (regionId: number) => {
    setMapshapeMatchingRegionId(regionId);
    setCVMatchDialog({
      title: 'Mapshape Match',
      progressText: 'Fetching Wikivoyage mapshape data...',
      progressColor: '#666',
      debugImages: [],
      clusters: [],
      childRegions: [],
      outOfBounds: [],
      regionId,
      regionMapUrl: null,
      done: false,
    });

    try {
      const result = await mapshapeMatch(worldViewId, regionId);

      if (!result.found || !result.mapshapes || result.mapshapes.length === 0) {
        setCVMatchDialog(prev => prev ? {
          ...prev,
          progressText: result.message ?? 'No mapshape templates found on this page',
          progressColor: '#ed6c02',
          done: true,
        } : prev);
        return;
      }

      // Convert mapshape results to ColorMatchCluster format for the shared dialog
      const clusters: ColorMatchCluster[] = result.mapshapes.map((ms, i) => ({
        clusterId: i,
        color: ms.color,
        pixelShare: 1 / result.mapshapes!.length,
        suggestedRegion: ms.matchedRegion,
        divisions: ms.divisions.map(d => ({
          id: d.id,
          name: d.name,
          confidence: d.coverage,
          depth: 0,
        })),
        unsplittable: [],
      }));

      const stats = result.stats!;
      setCVMatchDialog(prev => prev ? {
        ...prev,
        title: `Mapshape Match — ${stats.totalDivisions} divisions → ${stats.totalMapshapes} regions (${stats.matchedMapshapes} matched)`,
        clusters,
        childRegions: result.childRegions ?? [],
        geoPreview: result.geoPreview,
        wikivoyagePreview: result.wikivoyagePreview,
        progressText: `Found ${stats.totalMapshapes} mapshape regions with ${stats.totalDivisions} GADM divisions`,
        progressColor: '#2e7d32',
        done: true,
      } : prev);
    } catch (err) {
      console.error('Mapshape match failed:', err);
      setCVMatchDialog(prev => prev ? {
        ...prev,
        progressText: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        progressColor: '#d32f2f',
        done: true,
      } : prev);
    } finally {
      setMapshapeMatchingRegionId(null);
    }
  }, [worldViewId]);

  // Manual division search handler
  const handleManualDivisionSearch = useCallback((regionId: number) => {
    const findName = (nodes: MatchTreeNode[]): string => {
      for (const n of nodes) {
        if (n.id === regionId) return n.name;
        const found = findName(n.children);
        if (found) return found;
      }
      return '';
    };
    const regionName = tree ? findName(tree) : 'Region';
    setDivisionSearchDialog({ regionId, regionName });
    setDivSearchQuery('');
    setDivSearchResults([]);
  }, [tree]);

  // Debounced division search
  const divSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDivSearchInput = useCallback((_e: unknown, value: string) => {
    setDivSearchQuery(value);
    if (divSearchTimerRef.current) clearTimeout(divSearchTimerRef.current);
    if (value.length < 2) {
      setDivSearchResults([]);
      setDivSearchLoading(false);
      return;
    }
    setDivSearchLoading(true);
    divSearchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchDivisions(value, worldViewId, 30);
        setDivSearchResults(results);
      } catch (err) {
        console.error('Division search failed:', err);
      } finally {
        setDivSearchLoading(false);
      }
    }, 300);
  }, [worldViewId]);

  // Add child dialog state
  const [addChildName, setAddChildName] = useState('');

  // Auto-expand tree ancestors when shadow insertions appear
  const prevShadowCount = useRef(0);
  useEffect(() => {
    if (!tree || !shadowInsertions?.length) {
      prevShadowCount.current = 0;
      return;
    }
    if (prevShadowCount.current === shadowInsertions.length) return;
    prevShadowCount.current = shadowInsertions.length;

    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    // Also expand the target nodes themselves (for create_region, shadows appear as children)
    setExpanded(prev => new Set([...prev, ...ancestorIds, ...targetIds]));

    requestScrollTo(shadowInsertions[0].targetRegionId);
  }, [tree, shadowInsertions, requestScrollTo]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!tree || tree.length === 0) {
    return <Typography color="text.secondary">No regions found.</Typography>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 250px)' }}>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" startIcon={<ExpandAllIcon />} onClick={expandAll}>
          Expand All
        </Button>
        <Button size="small" startIcon={<CollapseAllIcon />} onClick={collapseAll}>
          Collapse All
        </Button>
        {unresolvedIds.length > 0 && (
          activeNav?.category === 'unresolved' ? (
            <NavControls
              label="unresolved"
              idx={activeNav.idx}
              total={unresolvedIds.length}
              onPrev={() => navigateTo('unresolved', activeNav.idx - 1)}
              onNext={() => navigateTo('unresolved', activeNav.idx + 1)}
              onClose={() => setActiveNav(null)}
            />
          ) : (
            <Button size="small" startIcon={<UnresolvedIcon />}
              onClick={() => navigateTo('unresolved', 0)} color="warning">
              {unresolvedIds.length} Unresolved
            </Button>
          )
        )}
        {shadowInsertions && shadowInsertions.length > 0 && (
          <Button size="small" startIcon={<GapsIcon />} onClick={expandToShadows} color="info">
            Show {shadowInsertions.length} Gap{shadowInsertions.length !== 1 ? 's' : ''} to Review
          </Button>
        )}
        {warningIds.length > 0 && (
          activeNav?.category === 'warnings' ? (
            <NavControls
              label="warnings"
              idx={activeNav.idx}
              total={warningIds.length}
              onPrev={() => navigateTo('warnings', activeNav.idx - 1)}
              onNext={() => navigateTo('warnings', activeNav.idx + 1)}
              onClose={() => setActiveNav(null)}
            />
          ) : (
            <Button
              size="small"
              startIcon={<WarningIcon />}
              onClick={() => navigateTo('warnings', 0)}
              sx={{ color: 'warning.main' }}
            >
              {warningIds.length} Hierarchy Warning{warningIds.length !== 1 ? 's' : ''}
            </Button>
          )
        )}
        {singleChildIds.length > 0 && (
          activeNav?.category === 'single-child' ? (
            <NavControls
              label="single-child"
              idx={activeNav.idx}
              total={singleChildIds.length}
              onPrev={() => navigateTo('single-child', activeNav.idx - 1)}
              onNext={() => navigateTo('single-child', activeNav.idx + 1)}
              onClose={() => setActiveNav(null)}
            />
          ) : (
            <Button
              size="small"
              startIcon={<SingleChildIcon />}
              onClick={() => navigateTo('single-child', 0)}
              color="secondary"
            >
              {singleChildIds.length} Single-Child
            </Button>
          )
        )}
        {incompleteCoverageIds.length > 0 && (
          activeNav?.category === 'incomplete-coverage' ? (
            <NavControls
              label="incomplete coverage"
              idx={activeNav.idx}
              total={incompleteCoverageIds.length}
              onPrev={() => navigateTo('incomplete-coverage', activeNav.idx - 1)}
              onNext={() => navigateTo('incomplete-coverage', activeNav.idx + 1)}
              onClose={() => setActiveNav(null)}
            />
          ) : (
            <Button
              size="small"
              startIcon={<CoverageIcon />}
              onClick={() => navigateTo('incomplete-coverage', 0)}
              color="error"
            >
              {incompleteCoverageIds.length} Incomplete Coverage
            </Button>
          )
        )}
        <Button
          size="small"
          startIcon={reviewLoading ? <CircularProgress size={14} /> : <ReviewIcon />}
          onClick={() => handleReview()}
          disabled={!!reviewLoading}
        >
          AI Review
        </Button>
      </Box>

      {/* Virtualized scroll container */}
      <Box ref={parentRef} sx={{ flex: 1, overflow: 'auto' }}>
        <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualRow => {
            const item = flatItems[virtualRow.index];
            return (
              <Box
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.kind === 'node' ? (
                  <TreeNodeRow
                    node={item.node}
                    depth={item.depth}
                    expanded={expanded}
                    ancestorIsMatched={item.ancestorIsMatched}
                    highlightedRegionId={highlightedRegionId}
                    onToggle={toggleExpand}
                    onAccept={(regionId, divisionId) => { setLastMutatedRegionId(regionId); acceptMutation.mutate({ regionId, divisionId }); }}
                    onAcceptAndRejectRest={(regionId, divisionId) => { setLastMutatedRegionId(regionId); acceptAndRejectRestMutation.mutate({ regionId, divisionId }); }}
                    onReject={(regionId, divisionId) => rejectMutation.mutate({ regionId, divisionId })}
                    onDBSearch={(regionId) => dbSearchOneMutation.mutate(regionId)}
                    onAIMatch={(regionId) => aiMatchOneMutation.mutate(regionId)}
                    onDismissChildren={(regionId) => dismissMutation.mutate(regionId)}
                    onSync={(regionId) => syncMutation.mutate(regionId)}
                    onHandleAsGrouping={(regionId) => groupingMutation.mutate(regionId)}
                    onGeocodeMatch={(regionId) => geocodeMatchMutation.mutate(regionId)}
                    onGeoshapeMatch={(regionId) => geoshapeMatchMutation.mutate(regionId)}
                    onPointMatch={(regionId) => pointMatchMutation.mutate(regionId)}
                    onResetMatch={(regionId) => resetMatchMutation.mutate(regionId)}
                    onRejectRemaining={(regionId) => rejectRemainingMutation.mutate(regionId)}
                    onAcceptAll={(assignments) => { if (assignments[0]) setLastMutatedRegionId(assignments[0].regionId); acceptAllMutation.mutate(assignments); }}
                    onPreviewUnion={onPreviewUnion}
                    onAcceptSelected={(regionId, divisionIds) => {
                      setLastMutatedRegionId(regionId);
                      acceptSelectedMutation.mutate({ regionId, divisionIds });
                    }}
                    onAcceptSelectedRejectRest={(regionId, divisionIds) => {
                      setLastMutatedRegionId(regionId);
                      acceptSelectedRejectRestMutation.mutate({ regionId, divisionIds });
                    }}
                    onRejectSelected={(regionId, divisionIds) => {
                      rejectSelectedMutation.mutate({ regionId, divisionIds });
                    }}
                    onPreview={onPreview}
                    onOpenMapPicker={handleOpenMapPicker}
                    onMergeChild={(regionId) => mergeMutation.mutate(regionId)}
                    mergingRegionId={mergeMutation.isPending ? (mergeMutation.variables ?? null) : null}
                    onSmartFlatten={handleSmartFlatten}
                    flatteningRegionId={flattenPreviewLoading ?? (smartFlattenMutation.isPending ? (smartFlattenMutation.variables ?? null) : null)}
                    onDismissHierarchyWarnings={(regionId) => dismissWarningsMutation.mutate(regionId)}
                    onAddChild={handleAddChild}
                    onRemoveRegion={handleRemoveRegion}
                    removingRegionId={removeMutation.isPending ? (removeMutation.variables?.regionId ?? null) : null}
                    onCollapseToParent={(regionId) => collapseToParentMutation.mutate(regionId)}
                    collapsingRegionId={collapseToParentMutation.isPending ? (collapseToParentMutation.variables ?? null) : null}
                    onAutoResolve={(regionId) => autoResolveMutation.mutate(regionId)}
                    autoResolvingRegionId={autoResolveMutation.isPending ? (autoResolveMutation.variables ?? null) : null}
                    onReviewSubtree={(regionId) => handleReview(regionId)}
                    reviewingRegionId={reviewLoading?.key.startsWith('region-') ? Number(reviewLoading.key.replace('region-', '')) : null}
                    onRename={(regionId, currentName) => setRenameDialog({ regionId, currentName, newName: currentName })}
                    renamingRegionId={renamingRegionId}
                    onReparent={(regionId) => {
                      const region = flatRegionList.find(r => r.id === regionId);
                      setReparentDialog({ regionId, regionName: region?.name ?? '', selectedParentId: null });
                    }}
                    reparentingRegionId={reparentingRegionId}
                    onAISuggestChildren={handleAISuggestChildren}
                    aiSuggestingRegionId={aiSuggestingRegionId}
                    onManualDivisionSearch={handleManualDivisionSearch}
                    onPruneToLeaves={(regionId) => pruneMutation.mutate(regionId)}
                    pruningRegionId={pruneMutation.isPending ? (pruneMutation.variables ?? null) : null}
                    onViewMap={onViewMap}
                    onCVMatch={handleCVMatch}
                    cvMatchingRegionId={cvMatchingRegionId}
                    onMapshapeMatch={handleMapshapeMatch}
                    mapshapeMatchingRegionId={mapshapeMatchingRegionId}
                    onClearMembers={(regionId) => clearMembersMutation.mutate(regionId)}
                    clearingMembersRegionId={clearMembersMutation.isPending ? (clearMembersMutation.variables ?? null) : null}
                    coverageData={coverageData?.coverage}
                    coverageLoading={coverageLoading}
                    coverageDirtyIds={coverageDirtyIds}
                    onCoverageClick={handleCoverageClick}
                    onManualFix={(regionId, needsManualFix) => {
                      if (needsManualFix) {
                        // Find the node name for the dialog title
                        const findName = (nodes: MatchTreeNode[]): string => {
                          for (const n of nodes) {
                            if (n.id === regionId) return n.name;
                            const found = findName(n.children);
                            if (found) return found;
                          }
                          return '';
                        };
                        setFixDialogState({ regionId, regionName: findName(tree!) });
                      } else {
                        manualFixMutation.mutate({ regionId, needsManualFix: false });
                      }
                    }}
                    isMutating={isMutating}
                    dbSearchingRegionId={dbSearchOneMutation.isPending ? (dbSearchOneMutation.variables ?? null) : null}
                    aiMatchingRegionId={aiMatchOneMutation.isPending ? (aiMatchOneMutation.variables ?? null) : null}
                    dismissingRegionId={dismissMutation.isPending ? (dismissMutation.variables ?? null) : null}
                    syncingRegionId={syncMutation.isPending ? (syncMutation.variables ?? null) : null}
                    groupingRegionId={groupingMutation.isPending ? (groupingMutation.variables ?? null) : null}
                    geocodeMatchingRegionId={geocodeMatchMutation.isPending ? (geocodeMatchMutation.variables ?? null) : null}
                    geoshapeMatchingRegionId={geoshapeMatchMutation.isPending ? (geoshapeMatchMutation.variables ?? null) : null}
                    pointMatchingRegionId={pointMatchMutation.isPending ? (pointMatchMutation.variables ?? null) : null}
                    parentRegionMapUrl={parentRegionMapUrlById.get(item.node.id)}
                    parentRegionMapName={parentRegionMapNameById.get(item.node.id)}
                    geocodeProgress={geocodeProgress}
                    duplicateUrls={duplicateUrls}
                    syncedUrls={syncedUrls}
                    shadowsByRegionId={shadowsByRegionId}
                    onApproveShadow={onApproveShadow}
                    onRejectShadow={onRejectShadow}
                  />
                ) : (
                  <ShadowCreateRow
                    shadow={item.shadow}
                    depth={item.depth}
                    onApproveShadow={onApproveShadow}
                    onRejectShadow={onRejectShadow}
                    isMutating={isMutating}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Dialogs rendered outside the scroll container */}
      {mapPickerState && (
        <MapImagePickerDialog
          open
          regionName={mapPickerState.regionName}
          candidates={mapPickerState.candidates}
          currentSelection={mapPickerState.currentSelection}
          onSelect={(imageUrl) => selectMapMutation.mutate({ regionId: mapPickerState.regionId, imageUrl })}
          onClose={() => setMapPickerState(null)}
          loading={selectMapMutation.isPending}
        />
      )}
      <Snackbar
        open={!!undoSnackbar?.open}
        autoHideDuration={15000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setUndoSnackbar(null);
        }}
        message={undoSnackbar?.message}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => undoMutation.mutate()}
            disabled={undoMutation.isPending}
          >
            Undo
          </Button>
        }
      />
      <ManualFixDialog
        state={fixDialogState}
        onClose={() => setFixDialogState(null)}
        onSubmit={(regionId, note) => manualFixMutation.mutate({ regionId, needsManualFix: true, fixNote: note })}
        isPending={manualFixMutation.isPending}
      />
      <RemoveRegionDialog
        state={removeDialogState}
        onClose={() => setRemoveDialogState(null)}
        onConfirm={(regionId, reparentChildren, reparentDivisions) => removeMutation.mutate({ regionId, reparentChildren, reparentDivisions })}
        isPending={removeMutation.isPending}
      />
      {/* CV color match dialog with SSE progress + suggestions */}
      <Dialog
        open={cvMatchDialog != null}
        onClose={() => { if (cvMatchDialog?.done) { setCVMatchDialog(null); setHighlightClusterId(null); } }}
        maxWidth="lg"
        fullWidth
        slotProps={{ paper: { sx: { maxHeight: '90vh' } } }}
      >
        {cvMatchDialog && (
          <>
            <DialogTitle>{cvMatchDialog.title}</DialogTitle>
            <DialogContent dividers sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                {!cvMatchDialog.done && <CircularProgress size={18} />}
                <Typography
                  variant="body2"
                  sx={{ color: cvMatchDialog.progressColor, fontWeight: cvMatchDialog.done ? 600 : 400 }}
                >
                  {cvMatchDialog.progressText}
                </Typography>
              </Box>
              {/* Interactive per-component water review — pipeline paused waiting for user approval */}
              {cvMatchDialog.waterReview && (() => {
                const wr = cvMatchDialog.waterReview!;
                const cycleDecision = (id: number) => {
                  setCVMatchDialog(prev => {
                    if (!prev?.waterReview) return prev;
                    const next = new Map(prev.waterReview.decisions);
                    const cur = next.get(id) ?? 'water';
                    const comp = prev.waterReview.components.find(c => c.id === id);
                    const hasSubs = comp && comp.subClusters.length >= 2;
                    // Cycle: water → region → mix (if sub-clusters available) → water
                    next.set(id, cur === 'water' ? 'region' : cur === 'region' && hasSubs ? 'mix' : 'water');
                    // Initialize sub-cluster approvals when entering mix
                    const mixApproved = new Map(prev.waterReview.mixApproved);
                    if (next.get(id) === 'mix' && !mixApproved.has(id) && comp) {
                      mixApproved.set(id, new Set(comp.subClusters.map(s => s.idx)));
                    }
                    return { ...prev, waterReview: { ...prev.waterReview, decisions: next, mixApproved } };
                  });
                };
                const toggleSubCluster = (compId: number, subIdx: number) => {
                  setCVMatchDialog(prev => {
                    if (!prev?.waterReview) return prev;
                    const mixApproved = new Map(prev.waterReview.mixApproved);
                    const subs = new Set(mixApproved.get(compId) ?? []);
                    if (subs.has(subIdx)) subs.delete(subIdx); else subs.add(subIdx);
                    mixApproved.set(compId, subs);
                    return { ...prev, waterReview: { ...prev.waterReview, mixApproved } };
                  });
                };
                const borderColor = (d: string) => d === 'water' ? 'info.main' : d === 'region' ? 'error.main' : 'warning.main';
                const bgColor = (d: string) => d === 'water' ? 'info.50' : d === 'region' ? 'error.50' : 'warning.50';
                const label = (d: string) => d === 'water' ? 'Water' : d === 'region' ? 'Region' : 'Mix';
                return (
                  <Box sx={{ mb: 2, p: 2, bgcolor: 'warning.50', borderRadius: 1, border: '1px solid', borderColor: 'warning.200' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Water detection — classify each area
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Click to cycle: Water → Region → Mix (split into sub-clusters). {wr.waterPxPercent}% of image detected.
                    </Typography>
                    {wr.waterMaskImage && (
                      <Box sx={{ mb: 1.5 }}>
                        <img src={wr.waterMaskImage} style={{ maxWidth: '100%', maxHeight: 350, borderRadius: 4, border: '1px solid #ccc' }} />
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1.5 }}>
                      {wr.components.map(comp => {
                        const dec = wr.decisions.get(comp.id) ?? 'water';
                        return (
                          <Box key={comp.id}>
                            <Box sx={{
                              border: '2px solid', borderColor: borderColor(dec),
                              borderRadius: 1, p: 0.5, display: 'inline-block', textAlign: 'center', cursor: 'pointer',
                              bgcolor: bgColor(dec), '&:hover': { opacity: 0.85 },
                            }} onClick={() => cycleDecision(comp.id)}>
                              <img src={comp.cropDataUrl} style={{ maxWidth: 400, maxHeight: 250, borderRadius: 2 }} />
                              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontWeight: 600, color: borderColor(dec) }}>
                                {label(dec)} ({comp.pct}%)
                              </Typography>
                            </Box>
                            {/* Sub-cluster crops when "Mix" is selected */}
                            {dec === 'mix' && comp.subClusters.length >= 2 && (
                              <Box sx={{ ml: 3, mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {comp.subClusters.map(sc => {
                                  const approved = wr.mixApproved.get(comp.id)?.has(sc.idx) ?? false;
                                  return (
                                    <Box key={sc.idx} sx={{
                                      border: '2px solid', borderColor: approved ? 'info.main' : 'error.main',
                                      borderRadius: 1, p: 0.5, textAlign: 'center', cursor: 'pointer',
                                      bgcolor: approved ? 'info.50' : 'error.50', '&:hover': { opacity: 0.85 },
                                    }} onClick={() => toggleSubCluster(comp.id, sc.idx)}>
                                      <img src={sc.cropDataUrl} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 2 }} />
                                      <Typography variant="caption" sx={{ display: 'block', mt: 0.3, fontWeight: 600, color: approved ? 'info.main' : 'error.main' }}>
                                        {approved ? 'Water' : 'Region'} ({sc.pct}%)
                                      </Typography>
                                    </Box>
                                  );
                                })}
                              </Box>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                    <Button
                      size="small" variant="contained" color="primary"
                      onClick={async () => {
                        const approvedIds: number[] = [];
                        const mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }> = [];
                        for (const comp of wr.components) {
                          const dec = wr.decisions.get(comp.id) ?? 'water';
                          if (dec === 'water') approvedIds.push(comp.id);
                          else if (dec === 'mix') {
                            const subs = wr.mixApproved.get(comp.id);
                            mixDecisions.push({ componentId: comp.id, approvedSubClusters: subs ? [...subs] : [] });
                          }
                        }
                        console.log(`[Water Review] Submitting: reviewId=${wr.reviewId} approved=[${approvedIds}] mix=[${mixDecisions.map(m => `${m.componentId}:[${m.approvedSubClusters}]`)}] all_components=[${wr.components.map(c => c.id)}]`);
                        setCVMatchDialog(prev => prev ? { ...prev, waterReview: undefined, progressText: 'Applying water decisions...' } : prev);
                        try {
                          await respondToWaterReview(wr.reviewId, { approvedIds, mixDecisions });
                          console.log('[Water Review] POST succeeded');
                        } catch (e) {
                          console.error('[Water Review] POST failed:', e);
                        }
                      }}
                    >
                      Confirm selection
                    </Button>
                  </Box>
                );
              })()}
              {/* Interactive park review — pipeline paused waiting for user confirmation */}
              {cvMatchDialog.parkReview && (() => {
                const pr = cvMatchDialog.parkReview!;
                const togglePark = (id: number) => {
                  setCVMatchDialog(prev => {
                    if (!prev?.parkReview) return prev;
                    const next = new Map(prev.parkReview.decisions);
                    next.set(id, !next.get(id));
                    return { ...prev, parkReview: { ...prev.parkReview, decisions: next } };
                  });
                };
                return (
                  <Box sx={{ p: 1.5, mb: 2, border: '2px solid', borderColor: 'success.main', borderRadius: 1, bgcolor: 'success.50' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'success.dark' }}>
                      Park Overlay Detection ({pr.totalParkPct}% of image)
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Click to toggle: green border = remove (park), red border = keep (not a park).
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
                      {pr.components.map(comp => {
                        const isPark = pr.decisions.get(comp.id) ?? true;
                        return (
                          <Box
                            key={comp.id}
                            onClick={() => togglePark(comp.id)}
                            sx={{
                              cursor: 'pointer', borderRadius: 1, overflow: 'hidden',
                              border: '3px solid', borderColor: isPark ? 'success.main' : 'error.main',
                              opacity: isPark ? 1 : 0.6,
                              transition: 'all 0.2s',
                              '&:hover': { transform: 'scale(1.05)' },
                            }}
                          >
                            <img src={comp.cropUrl} style={{ display: 'block', maxWidth: 180, maxHeight: 120 }} />
                            <Box sx={{ px: 0.5, py: 0.25, bgcolor: isPark ? 'success.light' : 'error.light', textAlign: 'center' }}>
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                {comp.pct}% — {isPark ? 'Remove' : 'Keep'}
                              </Typography>
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                    <Button
                      size="small" variant="contained" color="success"
                      onClick={async () => {
                        const confirmedIds: number[] = [];
                        for (const comp of pr.components) {
                          if (pr.decisions.get(comp.id)) confirmedIds.push(comp.id);
                        }
                        console.log(`[Park Review] Submitting: reviewId=${pr.reviewId} confirmed=[${confirmedIds}]`);
                        setCVMatchDialog(prev => prev ? { ...prev, parkReview: undefined, progressText: 'Removing park overlays...' } : prev);
                        try {
                          await respondToParkReview(pr.reviewId, { confirmedIds });
                          console.log('[Park Review] POST succeeded');
                        } catch (e) {
                          console.error('[Park Review] POST failed:', e);
                        }
                      }}
                    >
                      Confirm park removal
                    </Button>
                  </Box>
                );
              })()}
              {cvMatchDialog.clusterReview && (() => {
                const cr = cvMatchDialog.clusterReview!;
                const sourceImg = cvMatchDialog.debugImages.find(img => img.label === '__source_map__');
                const sorted = [...cr.clusters].sort((a, b) => b.pct - a.pct);
                // Targets for "merge into" = non-excluded, non-small clusters
                const mergeTargets = sorted.filter(c => !c.isSmall && !cr.excludes.has(c.label));
                const setAction = (label: number, value: string) => {
                  setCVMatchDialog(prev => {
                    if (!prev?.clusterReview) return prev;
                    const nextMerges = new Map(prev.clusterReview.merges);
                    const nextExcludes = new Set(prev.clusterReview.excludes);
                    nextMerges.delete(label);
                    nextExcludes.delete(label);
                    if (value === 'exclude') {
                      nextExcludes.add(label);
                    } else if (value !== '' && value !== 'keep') {
                      nextMerges.set(label, Number(value));
                    }
                    return { ...prev, clusterReview: { ...prev.clusterReview, merges: nextMerges, excludes: nextExcludes } };
                  });
                };
                const getAction = (label: number): string => {
                  if (cr.excludes.has(label)) return 'exclude';
                  const m = cr.merges.get(label);
                  return m !== undefined ? String(m) : 'keep';
                };
                return (
                  <Box sx={{ p: 1.5, mb: 2, border: '2px solid', borderColor: 'info.main', borderRadius: 1, bgcolor: 'info.50' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'info.dark' }}>
                      Cluster Review
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Review detected color clusters. Exclude artifacts (gray/noise), merge small leftovers into real regions, or keep as-is.
                    </Typography>
                    {/* Side-by-side: region map + source map + cluster preview */}
                    <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
                      {cvMatchDialog.regionMapUrl && (
                        <Box sx={{ flex: '1 1 30%', textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary">Region map</Typography>
                          <img src={cvMatchDialog.regionMapUrl} style={{ width: '100%', borderRadius: 4, border: '1px solid #ccc' }} />
                        </Box>
                      )}
                      {sourceImg && (
                        <Box sx={{ flex: '1 1 30%', textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary">Processed</Typography>
                          <img src={sourceImg.dataUrl} style={{ width: '100%', borderRadius: 4, border: '1px solid #ccc' }} />
                        </Box>
                      )}
                      {cr.previewImage && (
                        <Box sx={{ flex: '1 1 30%', textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary">Detected clusters</Typography>
                          <img src={cr.previewImage} style={{ width: '100%', borderRadius: 4, border: '1px solid #ccc' }} />
                        </Box>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {sorted.map(c => {
                        const action = getAction(c.label);
                        const isExcluded = action === 'exclude';
                        const isMerged = action !== 'keep' && action !== 'exclude';
                        const isKept = action === 'keep';
                        // Already-assigned region IDs (by other clusters)
                        const usedRegionIds = new Set<number>();
                        for (const [lbl, rid] of cr.regionAssignments) {
                          if (lbl !== c.label) usedRegionIds.add(rid);
                        }
                        return (
                          <Box key={c.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: isExcluded || isMerged ? 0.5 : 1 }}>
                            <Box sx={{ width: 20, height: 20, bgcolor: c.color, borderRadius: '50%', border: '1px solid #999', flexShrink: 0 }} />
                            <Typography variant="body2" sx={{ minWidth: 55, fontWeight: c.isSmall ? 400 : 600 }}>
                              {c.pct.toFixed(1)}%
                            </Typography>
                            <Select
                              size="small"
                              value={action}
                              onChange={(e) => setAction(c.label, e.target.value)}
                              sx={{ minWidth: 160, fontSize: '0.8rem', height: 30 }}
                            >
                              <MenuItem value="keep">Keep as region</MenuItem>
                              <MenuItem value="exclude" sx={{ color: 'error.main' }}>Exclude (not a region)</MenuItem>
                              {c.isSmall && mergeTargets.map(t => (
                                <MenuItem key={t.label} value={String(t.label)}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                    <Box sx={{ width: 12, height: 12, bgcolor: t.color, borderRadius: '50%', border: '1px solid #ccc' }} />
                                    <span>Merge into {t.pct.toFixed(1)}%</span>
                                  </Box>
                                </MenuItem>
                              ))}
                            </Select>
                            {isKept && cvMatchDialog.childRegions.length > 0 && (
                              <Select
                                size="small"
                                displayEmpty
                                value={cr.regionAssignments.get(c.label) ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setCVMatchDialog(prev => {
                                    if (!prev?.clusterReview) return prev;
                                    const next = new Map(prev.clusterReview.regionAssignments);
                                    if (val === '') next.delete(c.label);
                                    else next.set(c.label, Number(val));
                                    return { ...prev, clusterReview: { ...prev.clusterReview, regionAssignments: next } };
                                  });
                                }}
                                sx={{ minWidth: 140, flex: 1, fontSize: '0.8rem', height: 30 }}
                              >
                                <MenuItem value=""><em>Region...</em></MenuItem>
                                {cvMatchDialog.childRegions.map(r => (
                                  <MenuItem key={r.id} value={r.id} disabled={usedRegionIds.has(r.id)}>
                                    {r.name}
                                  </MenuItem>
                                ))}
                              </Select>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                    <Button
                      size="small" variant="contained" color="info"
                      sx={{ mt: 1.5 }}
                      onClick={async () => {
                        const merges: Record<number, number> = {};
                        for (const [from, to] of cr.merges) merges[from] = to;
                        const excludes = [...cr.excludes];
                        console.log(`[Cluster Review] Submitting: reviewId=${cr.reviewId} merges=`, merges, 'excludes=', excludes);
                        setCVMatchDialog(prev => prev ? {
                          ...prev,
                          clusterReview: undefined,
                          savedRegionAssignments: cr.regionAssignments.size > 0 ? new Map(cr.regionAssignments) : undefined,
                          progressText: 'Applying cluster decisions...',
                        } : prev);
                        try {
                          await respondToClusterReview(cr.reviewId, { merges, excludes });
                          console.log('[Cluster Review] POST succeeded');
                        } catch (e) {
                          console.error('[Cluster Review] POST failed:', e);
                        }
                      }}
                    >
                      Confirm clusters
                    </Button>
                    {/* Re-cluster options */}
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                      {([
                        { preset: 'more_clusters' as const, label: 'More clusters' },
                        { preset: 'different_seed' as const, label: 'Different seed' },
                        { preset: 'boost_chroma' as const, label: 'Boost colors' },
                      ]).map(opt => (
                        <Button
                          key={opt.preset}
                          size="small"
                          variant="outlined"
                          color="warning"
                          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
                          title={opt.label}
                          onClick={async () => {
                            setCVMatchDialog(prev => prev ? {
                              ...prev,
                              clusterReview: undefined,
                              progressText: `Re-clustering (${opt.label.toLowerCase()})...`,
                            } : prev);
                            try {
                              await respondToClusterReview(cr.reviewId, {
                                merges: {},
                                recluster: { preset: opt.preset },
                              });
                            } catch (e) {
                              console.error('[Recluster] POST failed:', e);
                            }
                          }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </Box>
                  </Box>
                );
              })()}
              {/* Interactive geo preview: side-by-side source map + MapLibre division map */}
              {cvMatchDialog.done && (() => {
                const sourceImg = cvMatchDialog.debugImages.find(img => img.label === '__source_map__');
                const wvPreview = cvMatchDialog.wikivoyagePreview;
                const geo = cvMatchDialog.geoPreview;
                if (!geo || geo.featureCollection.features.length === 0) return null;

                return (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Region Assignment Preview</Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {/* Wikivoyage mapshape preview (Kartographer geoshapes) */}
                      {wvPreview && wvPreview.features.length > 0 && (
                        <Box sx={{ flex: '1 1 48%', minWidth: 250, height: 400 }}>
                          <Typography variant="caption" color="text.secondary">Wikivoyage map (Kartographer regions)</Typography>
                          <MapGL
                            initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                            style={{ width: '100%', height: '100%', borderRadius: 4 }}
                            mapStyle={CV_MAP_STYLE}
                            onLoad={(e) => {
                              const map = e.target;
                              try {
                                const coords: [number, number][] = [];
                                for (const f of wvPreview.features) {
                                  if (f.geometry.type === 'Polygon') {
                                    for (const ring of (f.geometry as GeoJSON.Polygon).coordinates) {
                                      for (const pt of ring) coords.push(pt as [number, number]);
                                    }
                                  } else if (f.geometry.type === 'MultiPolygon') {
                                    for (const poly of (f.geometry as GeoJSON.MultiPolygon).coordinates) {
                                      for (const ring of poly) {
                                        for (const pt of ring) coords.push(pt as [number, number]);
                                      }
                                    }
                                  }
                                }
                                if (coords.length > 0) {
                                  const lngs = coords.map(c => c[0]);
                                  const lats = coords.map(c => c[1]);
                                  map.fitBounds(
                                    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                                    { padding: 30, duration: 0 },
                                  );
                                }
                              } catch { /* ignore */ }
                            }}
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
                            {(() => {
                              const labelFeatures: GeoJSON.Feature[] = [];
                              for (const f of wvPreview.features) {
                                try {
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  const centroid = turf.centroid(f as any);
                                  labelFeatures.push({
                                    type: 'Feature',
                                    geometry: centroid.geometry,
                                    properties: { title: f.properties?.title ?? '' },
                                  });
                                } catch { /* skip */ }
                              }
                              const labelData: GeoJSON.FeatureCollection = {
                                type: 'FeatureCollection',
                                features: labelFeatures,
                              };
                              return (
                                <Source id="wv-labels-src" type="geojson" data={labelData}>
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
                              );
                            })()}
                          </MapGL>
                        </Box>
                      )}
                      {/* CV source map image (for CV match only) */}
                      {sourceImg && !wvPreview && (
                        <Box sx={{ flex: '1 1 48%', minWidth: 250 }}>
                          <Typography variant="caption" color="text.secondary">Source map</Typography>
                          <img src={sourceImg.dataUrl} style={{ width: '100%', border: '1px solid #ccc', borderRadius: 4 }} />
                        </Box>
                      )}
                      <Box sx={{ flex: '1 1 48%', minWidth: 250, height: 400 }}>
                        <Typography variant="caption" color="text.secondary">{wvPreview ? 'GADM division assignment' : 'CV region assignment'} (hover for details)</Typography>
                        <CvMatchMap
                          geoPreview={geo}
                          highlightClusterId={highlightClusterId}
                          onAccept={async (divisionId, regionId, regionName) => {
                            try {
                              await acceptBatchMatches(worldViewId, [{ regionId, divisionId }]);
                              // Find the target cluster's color
                              const targetCluster = cvMatchDialog!.clusters.find(c => c.suggestedRegion?.id === regionId);
                              const targetColor = targetCluster?.color ?? '#999';
                              // Update feature to show new region color; remove from cluster lists
                              setCVMatchDialog(prev => {
                                if (!prev) return prev;
                                const newClusters = prev.clusters.map(c => ({
                                  ...c,
                                  divisions: c.divisions.filter(d => d.id !== divisionId),
                                  unsplittable: c.unsplittable.filter(d => d.id !== divisionId),
                                })).filter(c => c.divisions.length > 0 || c.unsplittable.length > 0);
                                const newGeo = prev.geoPreview ? {
                                  ...prev.geoPreview,
                                  featureCollection: {
                                    ...prev.geoPreview.featureCollection,
                                    features: prev.geoPreview.featureCollection.features.map(f =>
                                      f.properties?.divisionId === divisionId
                                        ? { ...f, properties: { ...f.properties, regionId, regionName, color: targetColor, isUnsplittable: false, clusterId: targetCluster?.clusterId ?? f.properties?.clusterId, confidence: 1, accepted: true } }
                                        : f
                                    ),
                                  },
                                } : prev.geoPreview;
                                return { ...prev, clusters: newClusters, geoPreview: newGeo };
                              });
                              invalidateTree(cvMatchDialog!.regionId);
                            } catch (err) {
                              console.error('Accept from map failed:', err);
                            }
                          }}
                          onReject={(divisionId) => {
                            // Mark division as dismissed — keep on map but dimmed
                            setCVMatchDialog(prev => {
                              if (!prev) return prev;
                              const newClusters = prev.clusters.map(c => ({
                                ...c,
                                divisions: c.divisions.filter(d => d.id !== divisionId),
                                unsplittable: c.unsplittable.filter(d => d.id !== divisionId),
                              })).filter(c => c.divisions.length > 0 || c.unsplittable.length > 0);
                              const newGeo = prev.geoPreview ? {
                                ...prev.geoPreview,
                                featureCollection: {
                                  ...prev.geoPreview.featureCollection,
                                  features: prev.geoPreview.featureCollection.features.map(f =>
                                    f.properties?.divisionId === divisionId
                                      ? { ...f, properties: { ...f.properties, dismissed: true, color: '#999' } }
                                      : f
                                  ),
                                },
                              } : prev.geoPreview;
                              return { ...prev, clusters: newClusters, geoPreview: newGeo };
                            });
                          }}
                          onClusterReassign={(divisionId, clusterId, color) => {
                            // Local-only reassignment — move division between clusters + update map
                            setCVMatchDialog(prev => {
                              if (!prev?.geoPreview) return prev;
                              const ci = prev.geoPreview.clusterInfos.find(c => c.clusterId === clusterId);
                              // Find the division info from its current cluster
                              let divInfo: { id: number; name: string; confidence: number; depth: number; parentDivisionId?: number } | null = null;
                              for (const c of prev.clusters) {
                                const found = c.divisions.find(d => d.id === divisionId) ?? c.unsplittable.find(d => d.id === divisionId);
                                if (found) { divInfo = { id: found.id, name: found.name, confidence: found.confidence, depth: 'depth' in found ? (found as { depth: number }).depth : 0 }; break; }
                              }
                              // Fall back to feature properties if not in clusters yet
                              if (!divInfo) {
                                const feat = prev.geoPreview.featureCollection.features.find(f => f.properties?.divisionId === divisionId);
                                if (feat?.properties) divInfo = { id: divisionId, name: feat.properties.name ?? `#${divisionId}`, confidence: feat.properties.confidence ?? 0.5, depth: 0 };
                              }
                              // Move between clusters: remove from old, add to target
                              let newClusters = prev.clusters.map(c => ({
                                ...c,
                                divisions: c.divisions.filter(d => d.id !== divisionId),
                                unsplittable: c.unsplittable.filter(d => d.id !== divisionId),
                              }));
                              if (divInfo) {
                                const targetIdx = newClusters.findIndex(c => c.clusterId === clusterId);
                                if (targetIdx >= 0) {
                                  newClusters = newClusters.map((c, i) =>
                                    i === targetIdx ? { ...c, divisions: [...c.divisions, divInfo!] } : c
                                  );
                                } else {
                                  // Create new cluster entry if it doesn't exist in the list yet
                                  newClusters.push({
                                    clusterId, color, pixelShare: 0,
                                    suggestedRegion: ci?.regionId != null && ci.regionName ? { id: ci.regionId, name: ci.regionName } : null,
                                    divisions: [divInfo],
                                    unsplittable: [],
                                  });
                                }
                              }
                              // Remove empty clusters
                              newClusters = newClusters.filter(c => c.divisions.length > 0 || c.unsplittable.length > 0);
                              return {
                                ...prev,
                                clusters: newClusters,
                                geoPreview: {
                                  ...prev.geoPreview,
                                  featureCollection: {
                                    ...prev.geoPreview.featureCollection,
                                    features: prev.geoPreview.featureCollection.features.map(f =>
                                      f.properties?.divisionId === divisionId
                                        ? { ...f, properties: { ...f.properties, clusterId, color, regionId: ci?.regionId ?? null, regionName: ci?.regionName ?? null, isUnsplittable: false } }
                                        : f
                                    ),
                                  },
                                },
                              };
                            });
                          }}
                        />
                      </Box>
                    </Box>
                  </Box>
                );
              })()}
              {/* Cluster suggestions (shown when complete) */}
              {cvMatchDialog.done && cvMatchDialog.clusters.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
                    Suggested Assignments ({cvMatchDialog.clusters.reduce((s, c) => s + c.divisions.length, 0)} divisions → {cvMatchDialog.clusters.length} regions)
                  </Typography>
                  {cvMatchDialog.clusters.map(cluster => (
                    <Box
                      key={cluster.clusterId}
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
                        {cluster.suggestedRegion && cluster.divisions.length > 0 && (
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={async () => {
                              const regionId = cluster.suggestedRegion!.id;
                              const assignments = cluster.divisions.map(d => ({ regionId, divisionId: d.id }));
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
                            Accept all ({cluster.divisions.length})
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
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    {/* Accept well-fitting only (>80% confidence, excludes unsplittable) */}
                    {(() => {
                      const MIN_CONFIDENCE = 0.95;
                      const wellFittingDivs = cvMatchDialog.clusters
                        .filter(c => c.suggestedRegion && c.divisions.length > 0)
                        .flatMap(c => c.divisions.filter(d => d.confidence >= MIN_CONFIDENCE).map(d => ({ regionId: c.suggestedRegion!.id, divisionId: d.id })));
                      const totalCount = cvMatchDialog.clusters
                        .filter(c => c.suggestedRegion)
                        .reduce((s, c) => s + c.divisions.length + c.unsplittable.length, 0);
                      if (wellFittingDivs.length === 0 || wellFittingDivs.length === totalCount) return null;
                      return (
                        <Button
                          variant="contained"
                          color="success"
                          sx={{ flex: 1 }}
                          onClick={async () => {
                            if (wellFittingDivs.length === 0) return;
                            try {
                              const acceptedIds = new Set(wellFittingDivs.map(a => a.divisionId));
                              await acceptBatchMatches(worldViewId, wellFittingDivs);
                              setCVMatchDialog(prev => prev ? {
                                ...prev,
                                clusters: prev.clusters.map(c => ({
                                  ...c,
                                  divisions: c.divisions.filter(d => !acceptedIds.has(d.id)),
                                })).filter(c => c.divisions.length > 0 || c.unsplittable.length > 0),
                              } : prev);
                              invalidateTree(cvMatchDialog.regionId);
                            } catch (err) {
                              console.error('Accept well-fitting failed:', err);
                            }
                          }}
                        >
                          Accept well-fitting ({wellFittingDivs.length} divisions, &gt;95%)
                        </Button>
                      );
                    })()}
                    {/* Accept all matched (including unsplittable associations) */}
                    {cvMatchDialog.clusters.some(c => c.suggestedRegion && c.divisions.length > 0) && (
                      <Button
                        variant="contained"
                        color="success"
                        sx={{ flex: 1 }}
                        onClick={async () => {
                          const allAssignments: Array<{ regionId: number; divisionId: number }> = [];
                          for (const cluster of cvMatchDialog.clusters) {
                            if (!cluster.suggestedRegion || cluster.divisions.length === 0) continue;
                            for (const div of cluster.divisions) {
                              allAssignments.push({ regionId: cluster.suggestedRegion.id, divisionId: div.id });
                            }
                          }
                          if (allAssignments.length === 0) return;
                          try {
                            await acceptBatchMatches(worldViewId, allAssignments);
                            setCVMatchDialog(prev => prev ? {
                              ...prev,
                              clusters: prev.clusters.filter(c => !c.suggestedRegion || c.divisions.length === 0),
                            } : prev);
                            invalidateTree(cvMatchDialog.regionId);
                          } catch (err) {
                            console.error('Accept all failed:', err);
                          }
                        }}
                      >
                        Accept all matched ({cvMatchDialog.clusters
                          .filter(c => c.suggestedRegion && c.divisions.length > 0)
                          .reduce((s, c) => s + c.divisions.length, 0)} divisions)
                      </Button>
                    )}
                  </Box>
                </Box>
              )}
              {/* Debug images — collapsible */}
              {cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).length > 0 && (
                <Accordion sx={{ mt: 2, '&:before': { display: 'none' } }} disableGutters>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'grey.50' }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Debug images ({cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 1 }}>
                    {cvMatchDialog.debugImages.filter(img => !img.label.startsWith('__')).map((img, i) => (
                      <Box key={i} sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>{img.label}</Typography>
                        <img src={img.dataUrl} style={{ maxWidth: '100%', border: '1px solid #ccc' }} />
                      </Box>
                    ))}
                  </AccordionDetails>
                </Accordion>
              )}
            </DialogContent>
            <DialogActions>
              {cvMatchDialog.waterReview && !cvMatchDialog.done && (
                <Button
                  color="warning"
                  onClick={async () => {
                    const wr = cvMatchDialog.waterReview!;
                    setCVMatchDialog(prev => prev ? { ...prev, waterReview: undefined, progressText: 'Approving all water (cancelled)...' } : prev);
                    try { await respondToWaterReview(wr.reviewId, { approvedIds: wr.components.map(c => c.id), mixDecisions: [] }); } catch { /* ignore */ }
                  }}
                >
                  Skip Water Review
                </Button>
              )}
              {cvMatchDialog.parkReview && !cvMatchDialog.done && (
                <Button
                  color="warning"
                  onClick={async () => {
                    const pr = cvMatchDialog.parkReview!;
                    setCVMatchDialog(prev => prev ? { ...prev, parkReview: undefined, progressText: 'Confirming all parks (skipped)...' } : prev);
                    try { await respondToParkReview(pr.reviewId, { confirmedIds: pr.components.map(c => c.id) }); } catch { /* ignore */ }
                  }}
                >
                  Skip Park Review
                </Button>
              )}
              {cvMatchDialog.clusterReview && !cvMatchDialog.done && (
                <Button
                  color="warning"
                  onClick={async () => {
                    setCVMatchDialog(prev => prev ? { ...prev, clusterReview: undefined, progressText: 'Skipping cluster review...' } : prev);
                    try { await respondToClusterReview(cvMatchDialog.clusterReview!.reviewId, { merges: {} }); } catch { /* ignore */ }
                  }}
                >
                  Skip Cluster Review
                </Button>
              )}
              <Button onClick={() => setCVMatchDialog(null)} disabled={!cvMatchDialog.done}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
      {/* Add child dialog (from toolbar button) */}
      <Dialog open={addChildDialogRegionId != null} onClose={() => { setAddChildDialogRegionId(null); setAddChildName(''); }}>
        <DialogTitle>Add Child Region</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Region name"
            value={addChildName}
            onChange={(e) => setAddChildName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && addChildName.trim() && addChildDialogRegionId) {
                addChildMutation.mutate({ parentRegionId: addChildDialogRegionId, name: addChildName.trim() });
                setAddChildDialogRegionId(null);
                setAddChildName('');
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddChildDialogRegionId(null); setAddChildName(''); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (addChildDialogRegionId && addChildName.trim()) {
                addChildMutation.mutate({ parentRegionId: addChildDialogRegionId, name: addChildName.trim() });
                setAddChildDialogRegionId(null);
                setAddChildName('');
              }
            }}
            disabled={!addChildName.trim() || addChildMutation.isPending}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
      <SmartFlattenPreviewDialog
        open={flattenPreview != null}
        regionName={flattenPreview?.regionName ?? ''}
        geometry={flattenPreview?.geometry ?? null}
        regionMapUrl={flattenPreview?.regionMapUrl ?? null}
        descendants={flattenPreview?.descendants ?? 0}
        divisions={flattenPreview?.divisions ?? 0}
        onConfirm={() => {
          if (flattenPreview) {
            smartFlattenMutation.mutate(flattenPreview.regionId);
            setFlattenPreview(null);
          }
        }}
        onCancel={() => setFlattenPreview(null)}
        confirming={smartFlattenMutation.isPending}
      />
      {/* AI Suggest Children Dialog */}
      <Dialog
        open={suggestChildrenResult != null}
        onClose={() => setSuggestChildrenResult(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Suggested Children for &quot;{suggestChildrenResult?.regionName}&quot;</DialogTitle>
        <DialogContent>
          {suggestChildrenResult?.result.analysis && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {suggestChildrenResult.result.analysis}
            </Typography>
          )}
          {suggestChildrenResult?.result.suggestions.length === 0 && (
            <Typography variant="body2">No missing children found.</Typography>
          )}
          {suggestChildrenResult?.result.suggestions.map((s) => (
            <Box key={s.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
              <Checkbox
                size="small"
                checked={suggestChildrenResult.selected.has(s.name)}
                onChange={() => {
                  setSuggestChildrenResult(prev => {
                    if (!prev) return prev;
                    const next = new Set(prev.selected);
                    if (next.has(s.name)) next.delete(s.name);
                    else next.add(s.name);
                    return { ...prev, selected: next };
                  });
                }}
                sx={{ p: 0.25 }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2">
                  {s.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">{s.reason}</Typography>
              </Box>
            </Box>
          ))}
          {suggestChildrenResult?.result.stats && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              {(suggestChildrenResult.result.stats.inputTokens + suggestChildrenResult.result.stats.outputTokens).toLocaleString()} tokens
              {' \u00b7 '}${suggestChildrenResult.result.stats.cost.toFixed(4)}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuggestChildrenResult(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!suggestChildrenResult?.selected.size || addChildMutation.isPending}
            onClick={() => {
              if (!suggestChildrenResult) return;
              const names = [...suggestChildrenResult.selected];
              for (const name of names) {
                addChildMutation.mutate({ parentRegionId: suggestChildrenResult.regionId, name });
              }
              setSuggestChildrenResult(null);
            }}
          >
            Create {suggestChildrenResult?.selected.size ?? 0} Selected
          </Button>
        </DialogActions>
      </Dialog>
      {/* Coverage Comparison Dialog */}
      <CoverageCompareDialog
        data={coverageCompare}
        onClose={() => setCoverageCompare(null)}
        onAnalyzeGaps={handleAnalyzeGaps}
      />
      {/* Coverage Gap Analysis Dialog */}
      {gapAnalysis && (
        <Dialog
          open
          onClose={() => { setGapAnalysis(null); invalidateTree(); }}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>Coverage Gap Analysis: {gapAnalysis.regionName}</DialogTitle>
          {gapAnalysis.regionMapUrl && (
            <Box sx={{ px: 3, pb: 1 }}>
              <Box
                component="img"
                src={`${gapAnalysis.regionMapUrl}?width=800`}
                alt={`${gapAnalysis.regionName} region map`}
                sx={{ maxWidth: '100%', maxHeight: 250, objectFit: 'contain', borderRadius: 1, border: 1, borderColor: 'divider' }}
              />
            </Box>
          )}
          <DialogContent>
            {gapAnalysis.loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : gapAnalysis.gapDivisions.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 2 }}>
                No gap divisions found. Children fully cover the parent&apos;s territory.
              </Typography>
            ) : (
              <GapDivisionTree
                gapDivisions={gapAnalysis.gapDivisions}
                parentRegionId={gapAnalysis.regionId}
                worldViewId={worldViewId}
                subtreeRegions={(() => {
                  if (!tree) return [];
                  const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
                    for (const n of nodes) {
                      if (n.id === gapAnalysis.regionId) return n;
                      const found = findNode(n.children);
                      if (found) return found;
                    }
                    return null;
                  };
                  const parent = findNode(tree);
                  if (!parent) return [];
                  const result: Array<{ id: number; name: string; depth: number }> = [];
                  const walk = (nodes: MatchTreeNode[], depth: number) => {
                    for (const n of nodes) {
                      result.push({ id: n.id, name: n.name, depth });
                      walk(n.children, depth + 1);
                    }
                  };
                  walk(parent.children, 0);
                  return result;
                })()}
                siblingRegions={gapAnalysis.siblingRegions}
                highlightedGapId={highlightedGapId}
                onHighlight={setHighlightedGapId}
                isMutating={isMutating}
                onAssign={(gap, descendantIds, targetRegionId) => {
                  setLastMutatedRegionId(targetRegionId);
                  acceptAllMutation.mutate([{
                    regionId: targetRegionId,
                    divisionId: gap.divisionId,
                  }]);
                  const removeIds = new Set([gap.divisionId, ...descendantIds]);
                  // Collect geometries of removed gaps to merge into target sibling
                  const removedGeoms = gapAnalysis.gapDivisions
                    .filter(d => removeIds.has(d.divisionId) && d.geometry)
                    .map(d => d.geometry!);
                  setGapAnalysis(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      gapDivisions: prev.gapDivisions.filter(d => !removeIds.has(d.divisionId)),
                      siblingRegions: mergeGeomsIntoSibling(prev.siblingRegions, targetRegionId, removedGeoms),
                    };
                  });
                }}
                onNewRegion={(gap, descendantIds) => {
                  if (!gapAnalysis) return;
                  addChildMutation.mutate(
                    { parentRegionId: gapAnalysis.regionId, name: gap.name },
                    {
                      onSuccess: (newRegion) => {
                        if (newRegion?.regionId) {
                          setLastMutatedRegionId(newRegion.regionId);
                          acceptAllMutation.mutate([{
                            regionId: newRegion.regionId,
                            divisionId: gap.divisionId,
                          }]);
                        }
                        const removeIds = new Set([gap.divisionId, ...descendantIds]);
                        const removedGeoms = gapAnalysis.gapDivisions
                          .filter(d => removeIds.has(d.divisionId) && d.geometry)
                          .map(d => d.geometry!);
                        const mergedGeom = mergeGeometries(removedGeoms);
                        setGapAnalysis(prev => {
                          if (!prev) return prev;
                          const newSiblings = mergedGeom && newRegion?.regionId
                            ? [...prev.siblingRegions, { regionId: newRegion.regionId, name: gap.name, geometry: mergedGeom }]
                            : prev.siblingRegions;
                          return {
                            ...prev,
                            gapDivisions: prev.gapDivisions.filter(d => !removeIds.has(d.divisionId)),
                            siblingRegions: newSiblings,
                          };
                        });
                      },
                    },
                  );
                }}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setGapAnalysis(null); invalidateTree(); }}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
      {/* Manual Division Search Dialog */}
      <Dialog
        open={divisionSearchDialog != null}
        onClose={() => setDivisionSearchDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Assign Division to &quot;{divisionSearchDialog?.regionName}&quot;</DialogTitle>
        <DialogContent>
          <Autocomplete
            size="small"
            options={divSearchResults}
            getOptionLabel={(opt) => `${opt.name} (${opt.path})`}
            filterOptions={(x) => x}
            inputValue={divSearchQuery}
            onInputChange={handleDivSearchInput}
            loading={divSearchLoading}
            onChange={(_e, val) => {
              if (val && divisionSearchDialog) {
                setLastMutatedRegionId(divisionSearchDialog.regionId);
                acceptAllMutation.mutate([{
                  regionId: divisionSearchDialog.regionId,
                  divisionId: val.id,
                }]);
                setDivisionSearchDialog(null);
              }
            }}
            renderOption={(props, opt) => (
              <li {...props} key={opt.id}>
                <Box>
                  <Typography variant="body2">{opt.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{opt.path}</Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search GADM divisions"
                placeholder="Type at least 2 characters..."
                autoFocus
                sx={{ mt: 1 }}
              />
            )}
            noOptionsText={divSearchQuery.length < 2 ? 'Type at least 2 characters' : 'No divisions found'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDivisionSearchDialog(null)} size="small">Cancel</Button>
        </DialogActions>
      </Dialog>
      {/* Rename Region Dialog */}
      <Dialog open={renameDialog != null} onClose={() => setRenameDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename Region</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Region name"
            value={renameDialog?.newName ?? ''}
            onChange={(e) => setRenameDialog(prev => prev ? { ...prev, newName: e.target.value } : prev)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog(null)} size="small">Cancel</Button>
          <Button onClick={handleRenameSubmit} variant="contained" size="small"
            disabled={!renameDialog?.newName.trim() || renameDialog?.newName.trim() === renameDialog?.currentName}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>
      {/* Reparent Region Dialog */}
      <Dialog open={reparentDialog != null} onClose={() => setReparentDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Move &quot;{reparentDialog?.regionName}&quot;</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Select new parent region:
          </Typography>
          <Autocomplete
            size="small"
            options={flatRegionList.filter(r => r.id !== reparentDialog?.regionId)}
            getOptionLabel={(opt) => '\u00A0'.repeat(opt.depth * 2) + opt.name}
            value={flatRegionList.find(r => r.id === reparentDialog?.selectedParentId) ?? null}
            onChange={(_e, val) => setReparentDialog(prev => prev ? { ...prev, selectedParentId: val?.id ?? null } : prev)}
            renderInput={(params) => <TextField {...params} label="Parent region" placeholder="Search regions..." />}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReparentDialog(null)} size="small">Cancel</Button>
          <Button onClick={handleReparentSubmit} variant="contained" size="small"
            disabled={reparentDialog?.selectedParentId == null}>
            Move
          </Button>
        </DialogActions>
      </Dialog>
      {/* AI Hierarchy Review Drawer */}
      {(() => {
        const activeReport = activeReviewKey ? reviewReports.get(activeReviewKey) : null;
        const isReviewOpen = activeReviewKey != null;
        const isLoading = reviewLoading?.key === activeReviewKey;
        return (
          <Drawer
            anchor="right"
            open={isReviewOpen}
            onClose={() => setActiveReviewKey(null)}
            variant="persistent"
            sx={{ '& .MuiDrawer-paper': { width: 420, p: 0, boxSizing: 'border-box' } }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>Hierarchy Review</Typography>
                <Typography variant="caption" color="text.secondary">{activeReport?.scope ?? reviewLoading?.passInfo}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button
                  size="small"
                  onClick={() => {
                    const regionId = activeReviewKey === 'full' ? undefined : Number(activeReviewKey?.replace('region-', ''));
                    handleReview(regionId, true);
                  }}
                  disabled={!!reviewLoading}
                >
                  Regenerate
                </Button>
                <IconButton size="small" onClick={() => setActiveReviewKey(null)}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
              {isLoading ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, gap: 2 }}>
                  <CircularProgress />
                  <Typography variant="body2" color="text.secondary">{reviewLoading?.passInfo}</Typography>
                </Box>
              ) : (
                <>
                  <Box sx={{ '& h2': { mt: 2, mb: 1, fontSize: '1.1rem' }, '& h3': { mt: 1.5, mb: 0.5, fontSize: '0.95rem' }, '& ul': { pl: 2 }, '& p': { my: 0.5 }, fontSize: '0.8rem', lineHeight: 1.5 }}>
                    <ReactMarkdown components={regionNameRegex ? {
                      // Override text-containing elements to linkify region names
                      p: ({ children }) => <p>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</p>,
                      li: ({ children }) => <li>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</li>,
                      h2: ({ children }) => <h2>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</h2>,
                      h3: ({ children }) => <h3>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</h3>,
                      strong: ({ children }) => <strong>{linkifyRegionNames(children, regionNameRegex, regionNameToId, navigateToRegion)}</strong>,
                    } : undefined}>{activeReport?.report ?? ''}</ReactMarkdown>
                  </Box>
                  {/* Actions checklist */}
                  {activeReport && activeReport.actions.length > 0 && (
                    <Box sx={{ mt: 3, borderTop: 1, borderColor: 'divider', pt: 2 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Recommended Actions ({activeReport.actions.filter(a => a.completed).length}/{activeReport.actions.length} completed)
                      </Typography>
                      {activeReport.actions.map((action) => (
                        <Box key={action.id} sx={{ display: 'flex', alignItems: 'flex-start', mb: 1, opacity: action.completed ? 0.5 : 1 }}>
                          <Checkbox
                            size="small"
                            checked={action.completed}
                            onChange={() => {
                              if (!activeReviewKey) return;
                              setReviewReports(prev => {
                                const next = new Map(prev);
                                const report = next.get(activeReviewKey);
                                if (!report) return prev;
                                const updatedActions = report.actions.map(a =>
                                  a.id === action.id ? { ...a, completed: !a.completed } : a,
                                );
                                next.set(activeReviewKey, { ...report, actions: updatedActions });
                                return next;
                              });
                            }}
                            sx={{ p: 0.25, mr: 1, mt: 0.25 }}
                          />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ textDecoration: action.completed ? 'line-through' : 'none', fontSize: '0.8rem' }}>
                              <Chip label={action.type} size="small" sx={{ height: 18, fontSize: '0.65rem', mr: 0.5 }} />
                              {action.regionName && (
                                <Typography component="span" variant="body2" sx={{
                                  fontWeight: 600, fontSize: '0.8rem', mr: 0.5,
                                  color: regionNameToId.has(action.regionName) ? '#1976d2' : 'text.primary',
                                  cursor: regionNameToId.has(action.regionName) ? 'pointer' : 'default',
                                  textDecoration: regionNameToId.has(action.regionName) ? 'underline dotted' : 'none',
                                  textUnderlineOffset: '2px',
                                }}
                                  onClick={() => {
                                    const id = regionNameToId.get(action.regionName);
                                    if (id != null) navigateToRegion(id);
                                  }}
                                >
                                  {action.regionName}:
                                </Typography>
                              )}
                              {regionNameRegex
                                ? linkifyRegionNames([action.description], regionNameRegex, regionNameToId, navigateToRegion)
                                : action.description}
                            </Typography>
                            {action.choices && action.choices.length > 0 && !action.completed && (
                              <RadioGroup
                                value={action.selectedChoice ?? ''}
                                onChange={(e) => {
                                  if (!activeReviewKey) return;
                                  setReviewReports(prev => {
                                    const next = new Map(prev);
                                    const report = next.get(activeReviewKey);
                                    if (!report) return prev;
                                    const updatedActions = report.actions.map(a =>
                                      a.id === action.id ? { ...a, selectedChoice: e.target.value } : a,
                                    );
                                    next.set(activeReviewKey, { ...report, actions: updatedActions });
                                    return next;
                                  });
                                }}
                                sx={{ ml: 1 }}
                              >
                                {action.choices.map((choice) => (
                                  <FormControlLabel
                                    key={choice.value}
                                    value={choice.value}
                                    control={<Radio size="small" sx={{ p: 0.25 }} />}
                                    label={<Typography variant="caption">{regionNameRegex
                                      ? linkifyRegionNames([choice.label], regionNameRegex, regionNameToId, navigateToRegion)
                                      : choice.label}</Typography>}
                                  />
                                ))}
                              </RadioGroup>
                            )}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </>
              )}
            </Box>
            <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                {activeReport?.stats
                  ? `${activeReport.stats.passes} pass${activeReport.stats.passes > 1 ? 'es' : ''} · ${(activeReport.stats.inputTokens + activeReport.stats.outputTokens).toLocaleString()} tokens · $${activeReport.stats.cost.toFixed(4)}`
                  : ''}
                {activeReport && activeReport.actions.length > 0 && (
                  ` · ${activeReport.actions.filter(a => a.completed).length}/${activeReport.actions.length} done`
                )}
              </Typography>
              <Button onClick={() => setActiveReviewKey(null)} variant="outlined" size="small">Close</Button>
            </Box>
          </Drawer>
        );
      })()}
    </Box>
  );
}
