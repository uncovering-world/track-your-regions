/**
 * WorkspaceMap — Persistent map panel for the country workspace.
 *
 * Shows per-child colored fills, gap overlays, hover/selected highlighting,
 * and supports click-to-assign (gap division → selected region via addDivisionsToRegion).
 *
 * Data:
 *   - getChildrenRegionGeometry → per-child SiblingRegionGeometry[]
 *   - analyzeCoverageGaps       → gap polygons (enabled when verify reports gaps)
 *
 * Click interactions:
 *   - Child region fill → onSelectRegion(regionId)
 *   - Gap feature → confirm popover → addDivisionsToRegion
 *
 * Fit bounds on mount when geometry loads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  NavigationControl,
  Source,
  Layer,
  type MapRef,
  type MapLayerMouseEvent,
} from 'react-map-gl/maplibre';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getChildrenRegionGeometry,
  analyzeCoverageGaps,
  getUnionGeometry,
} from '../../../api/admin/wvImportCoverage';
import { fetchDivisionGeometry } from '../../../api/divisions';
import { addDivisionsToRegion } from '../../../api/regions';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { VerifyResult } from '../../../api/admin/wvImportWorkflow';
import { childColorMap } from './workspaceUtils';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const CHILD_FILL_OPACITY = 0.35;
const CHILD_FILL_OPACITY_ACTIVE = 0.6;

interface WorkspaceMapProps {
  worldViewId: number;
  unit: { regionId: number; referenceDivisionIds: number[] };
  root: MatchTreeNode;
  selectedId: number;
  hoveredId: number | null;
  onSelectRegion: (id: number) => void;
  /** Called with a regionId when hovering a child fill, null when leaving (I5) */
  onHover?: (regionId: number | null) => void;
  verify: VerifyResult | null;
  onMatchChange?: () => void;
}

// ─── Compute bbox from a FeatureCollection ───────────────────────────────────

// Plan-4: make computeBbox antimeridian-aware (west>east crossing)
function computeBbox(
  features: Array<{ geometry: GeoJSON.Geometry }>
): [number, number, number, number] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

  function processCoord(coord: number[]) {
    const [lon, lat] = coord;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  function processCoords(coords: unknown): void {
    if (!coords) return;
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      processCoord(coords as number[]);
    } else if (Array.isArray(coords)) {
      for (const c of coords) processCoords(c);
    }
  }

  function processGeom(geom: GeoJSON.Geometry): void {
    if (geom.type === 'GeometryCollection') {
      for (const g of geom.geometries) processGeom(g);
    } else {
      processCoords(geom.coordinates);
    }
  }

  for (const f of features) {
    processGeom(f.geometry);
  }

  if (!isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

// M6: cursor helper — avoids nested ternary (sonarjs/no-nested-conditional)
function mapCursor(hasPopover: boolean, overInteractive: boolean): string {
  if (hasPopover) return 'default';
  if (overInteractive) return 'pointer';
  return 'grab';
}

// ─── WorkspaceMap ─────────────────────────────────────────────────────────────

export function WorkspaceMap({
  worldViewId,
  unit,
  root,
  selectedId,
  hoveredId,
  onSelectRegion,
  onHover,
  verify,
  onMatchChange,
}: WorkspaceMapProps) {
  const queryClient = useQueryClient();
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [boundsSet, setBoundsSet] = useState(false);
  const [gapPopover, setGapPopover] = useState<{
    anchor: { top: number; left: number };
    divisionId: number;
    divisionName: string;
  } | null>(null);
  // M6: track whether pointer is over an interactive feature for cursor
  const [overInteractive, setOverInteractive] = useState(false);

  // Per-child color map
  const colors = useMemo(() => childColorMap(root), [root]);

  // ── Data queries ─────────────────────────────────────────────────────────

  const { data: childrenData, isLoading: childrenLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'childrenGeometry', worldViewId, unit.regionId],
    queryFn: () => getChildrenRegionGeometry(worldViewId, unit.regionId),
  });

  const hasGaps = verify != null && verify.coverageGaps.length > 0;
  const { data: gapData } = useQuery({
    queryKey: ['admin', 'wvImport', 'gapAnalysis', worldViewId, unit.regionId, verify?.verifiedAt ?? ''],
    queryFn: () => analyzeCoverageGaps(worldViewId, unit.regionId),
    enabled: hasGaps,
  });

  // Reference outline: fetch union geometry of referenceDivisionIds (no regionId —
  // marker points are unused by the line layer)
  const hasReference = unit.referenceDivisionIds.length > 0;
  const { data: referenceGeomData } = useQuery({
    queryKey: ['admin', 'wvImport', 'referenceOutline', worldViewId, unit.regionId],
    queryFn: () => getUnionGeometry(worldViewId, unit.referenceDivisionIds),
    enabled: hasReference,
    staleTime: Infinity,
  });

  // Overlap divisions: shown when verify reports overlaps. Gaps and overlaps are
  // disjoint sets — fetch each overlap division's geometry independently.
  const overlapDivisionIds = useMemo(
    () => (verify?.overlaps ?? []).map(o => o.divisionId),
    [verify],
  );
  const hasOverlaps = overlapDivisionIds.length > 0;

  const { data: overlapGeoms } = useQuery({
    queryKey: ['admin', 'wvImport', 'overlapGeoms', worldViewId, unit.regionId, overlapDivisionIds.join(',')],
    queryFn: async () => {
      const results: Array<{ divisionId: number; geometry: GeoJSON.Geometry }> = [];
      await Promise.all(overlapDivisionIds.map(async (divId) => {
        const geom = await fetchDivisionGeometry(divId, worldViewId, { detail: 'low' });
        if (geom?.geometry) results.push({ divisionId: divId, geometry: geom.geometry as GeoJSON.Geometry });
      }));
      return results;
    },
    enabled: hasOverlaps,
    staleTime: 5 * 60 * 1000,
  });
  // ── Build FeatureCollections ──────────────────────────────────────────────

  // Per-child colored fills + outlines
  const childFC = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = (childrenData?.childRegions ?? []).map(cr => ({
      type: 'Feature',
      properties: {
        regionId: cr.regionId,
        color: colors.get(cr.regionId) ?? '#808080',
        active: cr.regionId === selectedId || cr.regionId === hoveredId,
      },
      geometry: cr.geometry,
    }));
    return { type: 'FeatureCollection', features };
  }, [childrenData, colors, selectedId, hoveredId]);

  // Gap fills (red)
  const gapFC = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = (gapData?.gapDivisions ?? [])
      .filter(g => g.geometry)
      .map(g => ({
        type: 'Feature',
        properties: { divisionId: g.divisionId, divisionName: g.name },
        geometry: g.geometry!,
      }));
    return { type: 'FeatureCollection', features };
  }, [gapData]);

  // Reference outline FeatureCollection (from union geometry of referenceDivisionIds)
  const referenceFC = useMemo((): GeoJSON.FeatureCollection => {
    if (!referenceGeomData) return { type: 'FeatureCollection', features: [] };
    return referenceGeomData.geometry;
  }, [referenceGeomData]);

  // Overlap fills (orange) — distinct from gap fills (red)
  const overlapFC = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = (overlapGeoms ?? []).map(og => ({
      type: 'Feature',
      properties: { divisionId: og.divisionId },
      geometry: og.geometry,
    }));
    return { type: 'FeatureCollection', features };
  }, [overlapGeoms]);

  // ── Fit bounds on first load ─────────────────────────────────────────────

  useEffect(() => {
    if (mapReady && !boundsSet && childrenData && childrenData.childRegions.length > 0) {
      const bbox = computeBbox(childrenData.childRegions);
      if (bbox) {
        mapRef.current?.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: 40, duration: 500 },
        );
        setBoundsSet(true);
      }
    }
  }, [mapReady, boundsSet, childrenData]);

  // ── Interactions ─────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    const hasInteractive = !!feature;
    setOverInteractive(hasInteractive);
    // I5: propagate hover regionId to tree so it can highlight the row
    if (onHover) {
      const regionId = feature?.properties?.regionId as number | undefined;
      onHover(regionId ?? null);
    }
  }, [onHover]);

  const handleChildClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const regionId = feature.properties?.regionId as number | undefined;
    if (regionId != null) onSelectRegion(regionId);
  }, [onSelectRegion]);

  const handleGapClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const divisionId = feature.properties?.divisionId as number | undefined;
    const divisionName = feature.properties?.divisionName as string ?? 'Unknown division';
    if (divisionId == null) return;
    setGapPopover({
      anchor: { top: e.point.y + 60, left: e.point.x + 10 },
      divisionId,
      divisionName,
    });
  }, []);

  // Assign division to selected region
  const assignMutation = useMutation({
    mutationFn: ({ divisionId }: { divisionId: number }) =>
      addDivisionsToRegion(selectedId, [divisionId]),
    onSuccess: () => {
      setGapPopover(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'workflowDashboard', worldViewId] }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'verify', worldViewId] }).catch(() => {});
      onMatchChange?.();
    },
  });

  // ── Selected region node name ────────────────────────────────────────────

  const selectedName = useMemo(() => {
    function find(node: MatchTreeNode): string | null {
      if (node.id === selectedId) return node.name;
      for (const child of node.children) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    }
    return find(root) ?? `Region ${selectedId}`;
  }, [root, selectedId]);

  // ── Legend ────────────────────────────────────────────────────────────────

  const legendItems = useMemo(() => {
    const items = root.children.slice(0, 8).map(c => ({
      name: c.name,
      color: colors.get(c.id) ?? '#808080',
    }));
    const overflow = root.children.length > 8 ? root.children.length - 8 : 0;
    return { items, overflow };
  }, [root.children, colors]);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      {childrenLoading && (
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)', zIndex: 10,
        }}>
          <CircularProgress />
        </Box>
      )}

      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={hasGaps ? ['child-fill', 'gap-fill'] : ['child-fill']}
        onClick={(e) => {
          const layers = e.features?.map(f => f.layer?.id) ?? [];
          if (layers.includes('child-fill')) handleChildClick(e);
          else if (layers.includes('gap-fill')) handleGapClick(e);
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { setOverInteractive(false); onHover?.(null); }}
        onLoad={() => setMapReady(true)}
        cursor={mapCursor(gapPopover !== null, overInteractive)}
      >
        <NavigationControl position="top-left" showCompass={false} />

        {/* Child region fills */}
        <Source id="children" type="geojson" data={childFC}>
          <Layer
            id="child-fill"
            type="fill"
            paint={{
              'fill-color': ['get', 'color'],
              'fill-opacity': [
                'case',
                ['get', 'active'], CHILD_FILL_OPACITY_ACTIVE,
                CHILD_FILL_OPACITY,
              ],
            }}
          />
          <Layer
            id="child-outline"
            type="line"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 1.5,
              'line-opacity': 0.8,
            }}
          />
        </Source>

        {/* Gap fills (red) — beforeId keeps fills below the reference outline */}
        {hasGaps && (
          <Source id="gaps" type="geojson" data={gapFC}>
            <Layer
              id="gap-fill"
              type="fill"
              beforeId={hasReference ? 'reference-outline' : undefined}
              paint={{ 'fill-color': '#ef5350', 'fill-opacity': 0.4 }}
            />
            <Layer
              id="gap-outline"
              type="line"
              beforeId={hasReference ? 'reference-outline' : undefined}
              paint={{ 'line-color': '#c62828', 'line-width': 2 }}
            />
          </Source>
        )}

        {/* Reference outline (dashed) — drawn from referenceDivisionIds union geometry */}
        {hasReference && (
          <Source id="reference" type="geojson" data={referenceFC}>
            <Layer
              id="reference-outline"
              type="line"
              paint={{
                'line-color': '#1565c0',
                'line-width': 2,
                'line-dasharray': [4, 3],
                'line-opacity': 0.9,
              }}
            />
          </Source>
        )}

        {/* Overlap fills (orange) — beforeId keeps fills below the reference outline */}
        {hasOverlaps && (
          <Source id="overlaps" type="geojson" data={overlapFC}>
            <Layer
              id="overlap-fill"
              type="fill"
              beforeId={hasReference ? 'reference-outline' : undefined}
              paint={{ 'fill-color': '#ff9800', 'fill-opacity': 0.35 }}
            />
            <Layer
              id="overlap-outline"
              type="line"
              beforeId={hasReference ? 'reference-outline' : undefined}
              paint={{
                'line-color': '#e65100',
                'line-width': 2,
                'line-dasharray': [3, 2],
              }}
            />
          </Source>
        )}
      </MapGL>

      {/* Legend */}
      <Paper
        elevation={2}
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          p: 1,
          maxWidth: 160,
          zIndex: 5,
        }}
      >
        <Stack spacing={0.5}>
          {legendItems.items.map(item => (
            <Stack key={item.color + item.name} direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 12, height: 12, bgcolor: item.color, borderRadius: '2px', flexShrink: 0 }} />
              <Typography variant="caption" noWrap>{item.name}</Typography>
            </Stack>
          ))}
          {legendItems.overflow > 0 && (
            <Typography variant="caption" color="text.secondary">+{legendItems.overflow} more</Typography>
          )}
          {hasGaps && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 12, height: 12, bgcolor: '#ef5350', borderRadius: '2px', flexShrink: 0, opacity: 0.7 }} />
              <Typography variant="caption">Gap</Typography>
            </Stack>
          )}
          {hasReference && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              {/* Dashed line swatch for reference outline */}
              <Box sx={{
                width: 22, height: 3, flexShrink: 0,
                borderTop: '2px dashed #1565c0',
              }} />
              <Typography variant="caption">Reference</Typography>
            </Stack>
          )}
          {hasOverlaps && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 12, height: 12, bgcolor: '#ff9800', borderRadius: '2px', flexShrink: 0, opacity: 0.7 }} />
              <Typography variant="caption">Overlap</Typography>
            </Stack>
          )}
        </Stack>
      </Paper>

      {/* Gap assign popover */}
      {gapPopover && (
        <Popover
          open
          anchorReference="anchorPosition"
          anchorPosition={gapPopover.anchor}
          onClose={() => setGapPopover(null)}
          PaperProps={{ sx: { p: 1.5 } }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Assign <strong>{gapPopover.divisionName}</strong> to <strong>{selectedName}</strong>?
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={() => assignMutation.mutate({ divisionId: gapPopover.divisionId })}
              disabled={assignMutation.isPending}
            >
              Assign
            </Button>
            <Tooltip title="Select the target region in the tree first">
              <Button size="small" onClick={() => setGapPopover(null)}>Cancel</Button>
            </Tooltip>
          </Stack>
        </Popover>
      )}
    </Box>
  );
}
