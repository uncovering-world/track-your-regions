import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  TextField,
  CircularProgress,
} from '@mui/material';
import {
  NavigateBefore as PrevIcon,
  NavigateNext as NextIcon,
  Close as CloseNavIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import type maplibregl from 'maplibre-gl';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import {
  getChildrenRegionGeometry,
  type CoverageGapDivision,
  type SiblingRegionGeometry,
} from '../../api/adminWorldViewImport';
import { Tooltip, type ShadowInsertion } from './treeNodeShared';
import { COVERAGE_MAP_STYLE } from './ImportTreeDialogs';

/** Shadow create_region row — rendered as a synthetic child in the flat list */
export function ShadowCreateRow({ shadow, depth, onApproveShadow, onRejectShadow, isMutating }: {
  shadow: ShadowInsertion;
  depth: number;
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  isMutating: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        pl: depth * 3,
        py: 0.3,
        borderBottom: '1px solid',
        borderColor: 'divider',
        borderLeft: '2px dashed',
        borderLeftColor: 'warning.main',
        bgcolor: 'rgba(237, 108, 2, 0.06)',
        minHeight: 32,
      }}
    >
      <Box sx={{ width: 28, flexShrink: 0 }} />
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        + {shadow.gapDivisionName}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        (new region)
      </Typography>
      <Tooltip title="Approve — create region and add member">
        <IconButton size="small" color="success" onClick={() => onApproveShadow?.(shadow)} disabled={isMutating} sx={{ p: 0.25 }}>
          <CheckIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Reject">
        <IconButton size="small" color="error" onClick={() => onRejectShadow?.(shadow)} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** Reusable prev/counter/next/close controls for category navigation */
export function NavControls({ label, idx, total, onPrev, onNext, onClose }: {
  label: string; idx: number; total: number;
  onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  return (
    <>
      <Button size="small" startIcon={<PrevIcon />} onClick={onPrev} disabled={idx <= 0}>
        Prev
      </Button>
      <Typography variant="body2" sx={{ mx: 0.5, whiteSpace: 'nowrap' }}>
        {idx + 1} / {total} {label}
      </Typography>
      <Button size="small" endIcon={<NextIcon />} onClick={onNext} disabled={idx >= total - 1}>
        Next
      </Button>
      <IconButton size="small" onClick={onClose} sx={{ p: 0.25 }}>
        <CloseNavIcon fontSize="small" />
      </IconButton>
    </>
  );
}

/** Inline select for assigning a gap division to an existing region in the subtree */
export function GapAssignSelect({ subtreeRegions, defaultRegionId, mapSelectedRegionId, isMutating, hasGapChildren, onSelect }: {
  subtreeRegions: Array<{ id: number; name: string; depth: number; isLast?: boolean }>;
  /** Pre-select the suggested target if available */
  defaultRegionId?: number;
  /** Region selected from the map — overrides local selection */
  mapSelectedRegionId?: number | null;
  isMutating: boolean;
  hasGapChildren: boolean;
  onSelect: (regionId: number) => void;
}) {
  const [selected, setSelected] = useState<number | ''>(defaultRegionId ?? '');

  // Sync from map selection — only when it changes and is a valid subtree region
  useEffect(() => {
    if (mapSelectedRegionId != null && subtreeRegions.some(r => r.id === mapSelectedRegionId)) {
      setSelected(mapSelectedRegionId);
    }
  }, [mapSelectedRegionId, subtreeRegions]);

  // Build tree indent prefix: "├─ " or "└─ " with "│  " or "   " for ancestors
  const treeLabels = useMemo(() => {
    // For each item, determine if it's the last sibling at its depth
    const lastAtDepth = new Map<number, number>(); // depth → index of last item at that depth
    for (let i = subtreeRegions.length - 1; i >= 0; i--) {
      const d = subtreeRegions[i].depth;
      if (!lastAtDepth.has(d)) lastAtDepth.set(d, i);
      // Reset deeper depths when we encounter a shallower item
      for (const [key] of lastAtDepth) {
        if (key > d) lastAtDepth.delete(key);
      }
      lastAtDepth.set(d, lastAtDepth.get(d) ?? i);
    }

    // Simpler approach: just track last child at each depth level within sibling groups
    return subtreeRegions.map((r, i) => {
      if (r.depth === 0) {
        // Check if last at root level
        const isLastRoot = !subtreeRegions.slice(i + 1).some(s => s.depth === 0);
        return `${isLastRoot ? '└' : '├'}\u2009${r.name}`;
      }
      // Find if this is the last item before next same-or-shallower depth
      let isLast = true;
      for (let j = i + 1; j < subtreeRegions.length; j++) {
        if (subtreeRegions[j].depth <= r.depth) {
          isLast = subtreeRegions[j].depth < r.depth;
          break;
        }
      }
      const prefix = '\u2003'.repeat(r.depth) + (isLast ? '└' : '├');
      return `${prefix}\u2009${r.name}`;
    });
  }, [subtreeRegions]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <TextField
        select
        size="small"
        value={selected}
        onChange={(e) => setSelected(Number(e.target.value))}
        slotProps={{ select: { native: true } }}
        sx={{ minWidth: 140, '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.5 } }}
      >
        <option value="">Assign to...</option>
        {subtreeRegions.map((r, i) => (
          <option key={r.id} value={r.id}>{treeLabels[i]}</option>
        ))}
      </TextField>
      <Button
        size="small"
        variant="outlined"
        color="success"
        onClick={() => { if (selected) onSelect(selected); }}
        disabled={isMutating || !selected}
        sx={{ fontSize: '0.7rem', py: 0.25, minHeight: 0 }}
      >
        Assign{hasGapChildren ? ' all' : ''}
      </Button>
    </Box>
  );
}

// Distinct colors for sibling regions (up to 8, then cycle)
const SIBLING_COLORS = ['#3388ff', '#33aa55', '#9955cc', '#cc7733', '#5599dd', '#aa3366', '#55bb88', '#8866cc'];

/** Map showing gap divisions in context of existing sibling regions, with drill-down */
function GapContextMap({ gapDivisions, siblingRegions, worldViewId, highlightedGapId, onHighlight, onRegionSelect, selectedRegionId }: {
  gapDivisions: CoverageGapDivision[];
  siblingRegions: SiblingRegionGeometry[];
  worldViewId: number;
  highlightedGapId: number | null;
  onHighlight: (id: number | null) => void;
  /** Called when a leaf region is clicked on the map — sets assign target */
  onRegionSelect: (regionId: number, regionName: string) => void;
  /** Currently selected assign-target region — highlighted on map */
  selectedRegionId: number | null;
}) {
  const mapRef = useRef<MapRef>(null);
  // Drill-down state: stack of { regionId, regionName, regions }
  const [drillStack, setDrillStack] = useState<Array<{ regionId: number; regionName: string; regions: SiblingRegionGeometry[] }>>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // Active regions: either the original siblings or the drill-down level
  const activeRegions = drillStack.length > 0 ? drillStack[drillStack.length - 1].regions : siblingRegions;

  // Build a FeatureCollection for all gap divisions
  const gapFeatures = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: gapDivisions
      .filter(g => g.geometry)
      .map(g => ({ type: 'Feature' as const, properties: { id: g.divisionId, name: g.name }, geometry: g.geometry! })),
  }), [gapDivisions]);

  // Highlighted gap feature
  const highlightFeature = useMemo<GeoJSON.FeatureCollection>(() => {
    const gap = highlightedGapId != null ? gapDivisions.find(g => g.divisionId === highlightedGapId) : null;
    if (!gap?.geometry) return { type: 'FeatureCollection', features: [] };
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: gap.name }, geometry: gap.geometry }] };
  }, [highlightedGapId, gapDivisions]);

  // Per-sibling FeatureCollections with label points
  const siblingFeatures = useMemo(() =>
    activeRegions.map((s, i) => ({
      ...s,
      color: SIBLING_COLORS[i % SIBLING_COLORS.length],
      isSelected: s.regionId === selectedRegionId,
      fc: {
        type: 'FeatureCollection' as const,
        features: [{ type: 'Feature' as const, properties: { name: s.name, regionId: s.regionId }, geometry: s.geometry }],
      },
      labelPoint: (() => {
        try {
          const center = turf.centerOfMass({ type: 'Feature', properties: {}, geometry: s.geometry });
          return center.geometry;
        } catch { return null; }
      })(),
    })),
  [activeRegions, selectedRegionId]);

  // Compute bounds from all geometries
  const combinedBbox = useMemo(() => {
    const geoms: GeoJSON.Geometry[] = [];
    for (const s of activeRegions) geoms.push(s.geometry);
    for (const g of gapDivisions) if (g.geometry) geoms.push(g.geometry);
    if (geoms.length === 0) return null;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geoms.map(g => ({ type: 'Feature' as const, properties: {}, geometry: g })),
    };
    return turf.bbox(fc) as [number, number, number, number];
  }, [activeRegions, gapDivisions]);

  const fitToBounds = useCallback((bbox: [number, number, number, number] | null) => {
    if (!mapRef.current || !bbox) return;
    mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, duration: 300 });
  }, []);

  const fitMap = useCallback(() => fitToBounds(combinedBbox), [fitToBounds, combinedBbox]);

  // Refit when drill level changes
  useEffect(() => { fitToBounds(combinedBbox); }, [combinedBbox, fitToBounds]);

  // Drill down into a sibling region — if it has children, drill; otherwise select as target
  const handleRegionClick = useCallback(async (regionId: number) => {
    const region = activeRegions.find(r => r.regionId === regionId);
    if (!region) return;
    setDrillLoading(true);
    try {
      const result = await getChildrenRegionGeometry(worldViewId, regionId);
      if (result.childRegions.length > 0) {
        // Has children → drill down
        setDrillStack(prev => [...prev, { regionId, regionName: region.name, regions: result.childRegions }]);
      } else {
        // Leaf region → select as assign target
        onRegionSelect(regionId, region.name);
      }
    } finally {
      setDrillLoading(false);
    }
  }, [activeRegions, worldViewId, onRegionSelect]);

  // Click handler: sibling regions take priority over gap fills
  const interactiveIds = useMemo(() => {
    const ids: string[] = [];
    // Sibling fills first so they get priority in hit-testing
    for (let i = 0; i < siblingFeatures.length; i++) ids.push(`sib-fill-${i}`);
    ids.push('gap-fill');
    return ids;
  }, [siblingFeatures.length]);

  const handleClick = useCallback((e: maplibregl.MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature?.properties) return;
    // Check if it's a sibling region click (regionId property exists on sibling features)
    if (feature.properties.regionId) {
      handleRegionClick(Number(feature.properties.regionId));
      return;
    }
    // Gap division click
    if (feature.properties.id) {
      const id = Number(feature.properties.id);
      onHighlight(id === highlightedGapId ? null : id);
    }
  }, [highlightedGapId, onHighlight, handleRegionClick]);

  return (
    <Box sx={{ height: 300, mb: 2, borderRadius: 1, overflow: 'hidden', position: 'relative' }}>
      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={COVERAGE_MAP_STYLE}
        onLoad={fitMap}
        interactiveLayerIds={interactiveIds}
        onClick={handleClick}
        cursor="pointer"
      >
        <NavigationControl position="top-right" showCompass={false} />
        {/* Individual sibling regions with distinct colors and labels */}
        {siblingFeatures.map((s, i) => (
          <Source key={`sib-${s.regionId}`} id={`sib-${i}`} type="geojson" data={s.fc}>
            <Layer id={`sib-fill-${i}`} type="fill" paint={{
              'fill-color': s.isSelected ? '#1976d2' : s.color,
              'fill-opacity': s.isSelected ? 0.4 : 0.2,
            }} />
            <Layer id={`sib-outline-${i}`} type="line" paint={{
              'line-color': s.isSelected ? '#1976d2' : s.color,
              'line-width': s.isSelected ? 3 : 1.5,
            }} />
          </Source>
        ))}
        {/* Sibling labels as a single source */}
        {siblingFeatures.some(s => s.labelPoint) && (
          <Source
            id="sib-labels"
            type="geojson"
            data={{
              type: 'FeatureCollection',
              features: siblingFeatures
                .filter(s => s.labelPoint)
                .map(s => ({ type: 'Feature' as const, properties: { name: s.name }, geometry: s.labelPoint! })),
            }}
          >
            <Layer
              id="sib-label-text"
              type="symbol"
              layout={{
                'text-field': ['get', 'name'],
                'text-size': 11,
                'text-allow-overlap': false,
                'text-font': ['Open Sans Semibold'],
              }}
              paint={{
                'text-color': '#333',
                'text-halo-color': '#fff',
                'text-halo-width': 1.5,
              }}
            />
          </Source>
        )}
        {/* All gap divisions (orange) */}
        <Source id="gaps" type="geojson" data={gapFeatures}>
          <Layer id="gap-fill" type="fill" paint={{ 'fill-color': '#ff8833', 'fill-opacity': 0.35 }} />
          <Layer id="gap-outline" type="line" paint={{ 'line-color': '#ff8833', 'line-width': 1.5 }} />
        </Source>
        {/* Highlighted gap (red) */}
        <Source id="gap-highlight" type="geojson" data={highlightFeature}>
          <Layer id="gap-hl-fill" type="fill" paint={{ 'fill-color': '#e53935', 'fill-opacity': 0.5 }} />
          <Layer id="gap-hl-outline" type="line" paint={{ 'line-color': '#e53935', 'line-width': 2.5 }} />
        </Source>
      </MapGL>
      {/* Breadcrumb / drill-down navigation */}
      {drillStack.length > 0 && (
        <Box sx={{ position: 'absolute', top: 8, left: 8, bgcolor: 'rgba(255,255,255,0.92)', borderRadius: 1, px: 1, py: 0.3, fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '80%' }}>
          <Button
            size="small"
            onClick={() => setDrillStack(prev => prev.slice(0, -1))}
            sx={{ fontSize: '0.65rem', minWidth: 0, py: 0, px: 0.5, textTransform: 'none' }}
          >
            ‹ Back
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mx: 0.3 }}>|</Typography>
          <Button
            size="small"
            onClick={() => setDrillStack([])}
            sx={{ fontSize: '0.65rem', minWidth: 0, py: 0, px: 0.5, textTransform: 'none' }}
          >
            Top
          </Button>
          {drillStack.map((level, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">›</Typography>
              <Button
                size="small"
                onClick={() => setDrillStack(prev => prev.slice(0, i + 1))}
                disabled={i === drillStack.length - 1}
                sx={{ fontSize: '0.65rem', minWidth: 0, py: 0, px: 0.5, textTransform: 'none' }}
              >
                {level.regionName}
              </Button>
            </Box>
          ))}
        </Box>
      )}
      {/* Loading overlay */}
      {drillLoading && (
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', bgcolor: 'rgba(255,255,255,0.8)', borderRadius: 1, p: 1 }}>
          <CircularProgress size={24} />
        </Box>
      )}
      {/* Legend */}
      <Box sx={{ position: 'absolute', bottom: 8, left: 8, bgcolor: 'rgba(255,255,255,0.9)', borderRadius: 1, px: 1, py: 0.5, fontSize: '0.7rem', display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#ff8833', opacity: 0.6, borderRadius: '2px' }} />
          Gap
        </Box>
        {siblingFeatures.slice(0, 6).map(s => (
          <Box key={s.regionId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: s.isSelected ? '#1976d2' : s.color, opacity: 0.5, borderRadius: '2px' }} />
            {s.name}{s.isSelected ? ' \u2713' : ''}
          </Box>
        ))}
        {siblingFeatures.length > 6 && <Box>+{siblingFeatures.length - 6} more</Box>}
      </Box>
      {/* Hint */}
      {drillStack.length === 0 && siblingFeatures.length > 0 && (
        <Box sx={{ position: 'absolute', top: 8, left: 8, bgcolor: 'rgba(255,255,255,0.85)', borderRadius: 1, px: 1, py: 0.3, fontSize: '0.65rem', color: 'text.secondary' }}>
          Click a region to drill down or select as target
        </Box>
      )}
    </Box>
  );
}

/** Tree-structured display of gap divisions. Groups children under their GADM parents. */
export function GapDivisionTree({ gapDivisions, parentRegionId: _parentRegionId, subtreeRegions, siblingRegions, worldViewId, highlightedGapId, onHighlight, isMutating, onAssign, onNewRegion }: {
  gapDivisions: CoverageGapDivision[];
  parentRegionId: number;
  /** All regions in the parent's subtree — shown as assign targets */
  subtreeRegions: Array<{ id: number; name: string; depth: number }>;
  /** Per-sibling region geometries for map context */
  siblingRegions: SiblingRegionGeometry[];
  worldViewId: number;
  /** Currently highlighted gap division ID */
  highlightedGapId: number | null;
  onHighlight: (id: number | null) => void;
  isMutating: boolean;
  onAssign: (gap: CoverageGapDivision, descendantIds: number[], targetRegionId: number) => void;
  onNewRegion: (gap: CoverageGapDivision, descendantIds: number[]) => void;
}) {
  // Region selected from the map — synced to all assign dropdowns
  const [mapSelectedRegionId, setMapSelectedRegionId] = useState<number | null>(null);

  // Build tree: find which gap divisions are children of other gap divisions
  const gapIdSet = new Set(gapDivisions.map(g => g.divisionId));
  const childrenOf = new Map<number, CoverageGapDivision[]>();
  const roots: CoverageGapDivision[] = [];

  for (const gap of gapDivisions) {
    if (gap.gadmParentId != null && gapIdSet.has(gap.gadmParentId)) {
      const siblings = childrenOf.get(gap.gadmParentId) ?? [];
      siblings.push(gap);
      childrenOf.set(gap.gadmParentId, siblings);
    } else {
      roots.push(gap);
    }
  }

  // Collect all descendant IDs within the gap set for a given division
  function collectDescendantIds(divId: number): number[] {
    const children = childrenOf.get(divId) ?? [];
    const result: number[] = [];
    for (const child of children) {
      result.push(child.divisionId);
      result.push(...collectDescendantIds(child.divisionId));
    }
    return result;
  }

  function renderGapRow(gap: CoverageGapDivision, depth: number) {
    const children = childrenOf.get(gap.divisionId) ?? [];
    const descendantIds = collectDescendantIds(gap.divisionId);
    const hasGapChildren = children.length > 0;
    const isHighlighted = highlightedGapId === gap.divisionId;

    return (
      <Box key={gap.divisionId}>
        <Box
          onMouseEnter={() => onHighlight(gap.divisionId)}
          onMouseLeave={() => onHighlight(null)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            py: 0.75,
            pl: depth * 2.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexWrap: 'wrap',
            bgcolor: isHighlighted ? 'action.selected' : undefined,
            cursor: 'pointer',
          }}
        >
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="body2" fontWeight={500}>
              {gap.name}
              {hasGapChildren && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                  (+{descendantIds.length} sub)
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary">{gap.path}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {gap.areaKm2.toLocaleString()} km²
            </Typography>
          </Box>
          {subtreeRegions.length > 0 && (
            <GapAssignSelect
              subtreeRegions={subtreeRegions}
              defaultRegionId={gap.suggestedTarget?.regionId}
              mapSelectedRegionId={mapSelectedRegionId}
              isMutating={isMutating}
              hasGapChildren={hasGapChildren}
              onSelect={(regionId) => onAssign(gap, descendantIds, regionId)}
            />
          )}
          <Button
            size="small"
            variant="outlined"
            color="info"
            onClick={() => onNewRegion(gap, descendantIds)}
            disabled={isMutating}
            sx={{ fontSize: '0.7rem', py: 0.25, minHeight: 0 }}
          >
            New Region
          </Button>
        </Box>
        {children.map(child => renderGapRow(child, depth + 1))}
      </Box>
    );
  }

  // Sort roots by area descending
  roots.sort((a, b) => b.areaKm2 - a.areaKm2);

  return (
    <>
      <GapContextMap
        gapDivisions={gapDivisions}
        siblingRegions={siblingRegions}
        worldViewId={worldViewId}
        highlightedGapId={highlightedGapId}
        onHighlight={onHighlight}
        selectedRegionId={mapSelectedRegionId}
        onRegionSelect={(regionId) => setMapSelectedRegionId(regionId)}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Found {gapDivisions.length} GADM division{gapDivisions.length === 1 ? '' : 's'} in the uncovered area.
        Assigning a parent division also handles its children.
      </Typography>
      {roots.map(gap => renderGapRow(gap, 0))}
    </>
  );
}
