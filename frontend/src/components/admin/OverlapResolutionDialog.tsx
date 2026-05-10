/**
 * OverlapResolutionDialog — Resolve division overlaps among child regions.
 *
 * Shows a side-by-side view: source region map image (left) and MapLibre map
 * with color-coded child region geometries (right). Below the map, a scrollable
 * list of overlapping divisions with Keep/Split resolution options.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Button,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import {
  type DivisionOverlapResult,
  getOverlapDivisionChildren,
  resolveOverlap,
  type OverlapGadmChild,
} from '../../api/admin/worldViewImport';
import { getChildrenRegionGeometry } from '../../api/admin/wvImportCoverage';
import type { SiblingRegionGeometry } from '../../api/admin/wvImportCoverage';
import { fetchDivisionGeometry } from '../../api/divisions';
import type { GeoJSONGeometry } from '../../types';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const CHILD_COLORS = [
  '#3388ff', '#33aa55', '#9955cc', '#cc7733', '#5599dd',
  '#dd5577', '#55bb88', '#bb7744', '#7755cc', '#cc5533',
];

/** Placeholder text when the resolution panel has nothing selected. */
function emptyStateMessage(resolvedCount: number, totalCount: number): string {
  if (resolvedCount === totalCount) return 'All overlaps resolved!';
  return 'No overlap selected';
}

/** Color for the chip in the overlap-list strip. */
function chipColor(
  index: number,
  selectedIndex: number | null,
  resolvedIndices: Set<number>,
): 'success' | 'primary' | 'default' {
  if (resolvedIndices.has(index)) return 'success';
  if (index === selectedIndex) return 'primary';
  return 'default';
}

interface SplitPreviewProps {
  selectedRegions: DivisionOverlapResult['overlaps'][number]['regions'];
  splitChildren: OverlapGadmChild[] | null;
  splitLoading: boolean;
  splitAssignments: Map<number, number>;
  applying: boolean;
  onLoadSplit: () => void;
  onChangeAssignment: (gadmChildId: number, regionId: number | null) => void;
  onApplySplit: () => void;
}

/** Right-hand "Split into GADM children" panel. */
function SplitPreview({
  selectedRegions,
  splitChildren,
  splitLoading,
  splitAssignments,
  applying,
  onLoadSplit,
  onChangeAssignment,
  onApplySplit,
}: SplitPreviewProps) {
  if (!splitChildren) {
    return (
      <Button
        variant="outlined"
        size="small"
        onClick={onLoadSplit}
        disabled={splitLoading}
        startIcon={splitLoading ? <CircularProgress size={14} /> : undefined}
      >
        {splitLoading ? 'Loading...' : 'Preview split'}
      </Button>
    );
  }
  if (splitChildren.length === 0) {
    return <Typography variant="body2" color="text.secondary">No GADM children available</Typography>;
  }
  return (
    <>
      {splitChildren.map((c) => (
        <Box key={c.divisionId} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={c.name}>
            {c.name}
            {c.areaKm2 != null && (
              <Typography component="span" variant="caption" color="text.secondary">
                {' '}({c.areaKm2.toLocaleString()} km²)
              </Typography>
            )}
          </Typography>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select
              value={splitAssignments.get(c.divisionId) ?? ''}
              displayEmpty
              onChange={(e) => {
                const value = e.target.value;
                onChangeAssignment(c.divisionId, value === '' ? null : Number(value));
              }}
            >
              <MenuItem value=""><em>Unassigned</em></MenuItem>
              {selectedRegions.map((r) => (
                <MenuItem key={r.regionId} value={r.regionId}>{r.regionName}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      ))}
      <Button
        variant="contained"
        size="small"
        startIcon={applying ? <CircularProgress size={14} /> : <CheckIcon />}
        disabled={applying || splitAssignments.size === 0}
        onClick={onApplySplit}
        sx={{ mt: 1 }}
      >
        Apply split
      </Button>
    </>
  );
}

interface OverlapResolutionDialogProps {
  open: boolean;
  onClose: () => void;
  worldViewId: number;
  parentRegionId: number;
  parentRegionName: string;
  regionMapUrl: string | null;
  overlapData: DivisionOverlapResult;
  onApplied: () => void;
}

export function OverlapResolutionDialog({
  open,
  onClose,
  worldViewId,
  parentRegionId,
  parentRegionName,
  regionMapUrl,
  overlapData,
  onApplied,
}: OverlapResolutionDialogProps) {
  const mapRef = useRef<MapRef>(null);

  // Data state
  const [childGeometries, setChildGeometries] = useState<SiblingRegionGeometry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-division geometries (fetched on demand, cached)
  const [divisionGeometries, setDivisionGeometries] = useState<Map<number, GeoJSONGeometry>>(new Map());
  const [divGeoLoading, setDivGeoLoading] = useState(false);

  // Interaction state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [resolvedIndices, setResolvedIndices] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Resolution choice per overlap
  const [keepChoice, setKeepChoice] = useState<Map<number, number>>(new Map()); // overlapIndex → regionId

  // Split preview
  const [splitChildren, setSplitChildren] = useState<OverlapGadmChild[] | null>(null);
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitAssignments, setSplitAssignments] = useState<Map<number, number>>(new Map()); // gadmChildId → regionId

  const overlaps = overlapData.overlaps;

  // Load child geometries on open
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setChildGeometries(null);
    setSelectedIndex(overlaps.length > 0 ? 0 : null);
    setResolvedIndices(new Set());
    setDivisionGeometries(new Map());
    setKeepChoice(new Map());
    setSplitChildren(null);
    setSplitAssignments(new Map());

    getChildrenRegionGeometry(worldViewId, parentRegionId)
      .then((geoResult) => {
        setChildGeometries(geoResult.childRegions);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load geometries');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, worldViewId, parentRegionId, overlaps.length]);

  // Selected overlap

  const selected = selectedIndex != null ? overlaps[selectedIndex] : null;

  // Color map: regionId → color
  const colorMap = useMemo(() => {
    const map = new Map<number, string>();
    if (!childGeometries) return map;
    childGeometries.forEach((cg, i) => {
      map.set(cg.regionId, CHILD_COLORS[i % CHILD_COLORS.length]);
    });
    return map;
  }, [childGeometries]);

  // Fetch division geometry when selection changes
  useEffect(() => {
    if (!selected) return;
    // Fetch the overlapping division geometry + the "via" divisions
    const idsToFetch = new Set<number>();
    idsToFetch.add(selected.divisionId);
    for (const r of selected.regions) {
      if (r.viaDivisionId !== selected.divisionId) {
        idsToFetch.add(r.viaDivisionId);
      }
    }
    const missing = Array.from(idsToFetch).filter(id => !divisionGeometries.has(id));
    if (missing.length === 0) return;

    setDivGeoLoading(true);
    Promise.all(
      missing.map(id => fetchDivisionGeometry(id, worldViewId, { detail: 'medium' }).then(feat => ({ id, feat }))),
    )
      .then((results) => {
        setDivisionGeometries(prev => {
          const next = new Map(prev);
          for (const { id, feat } of results) {
            if (feat?.geometry) next.set(id, feat.geometry as GeoJSONGeometry);
          }
          return next;
        });
      })
      .finally(() => setDivGeoLoading(false));
  }, [selected, worldViewId, divisionGeometries]);

  // Reset split state when selection changes
  useEffect(() => {
    setSplitChildren(null);
    setSplitAssignments(new Map());
  }, [selectedIndex]);

  // Fit map bounds to selected division
  useEffect(() => {
    if (!selected || !mapRef.current) return;
    const geo = divisionGeometries.get(selected.divisionId);
    if (!geo) return;
    try {
      const [minLng, minLat, maxLng, maxLat] = turf.bbox(geo as GeoJSON.GeoJsonProperties as GeoJSON.Geometry);
      mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, maxZoom: 10 });
    } catch { /* ignore bbox errors */ }
  }, [selected, divisionGeometries]);

  // Build GeoJSON for child region backgrounds
  const childrenGeoJson = useMemo((): GeoJSON.FeatureCollection => {
    if (!childGeometries) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: childGeometries
        .filter(cg => cg.geometry)
        .map((cg, i) => ({
          type: 'Feature' as const,
          properties: {
            regionId: cg.regionId,
            color: CHILD_COLORS[i % CHILD_COLORS.length],
            name: cg.name,
          },
          geometry: cg.geometry as GeoJSON.Geometry,
        })),
    };
  }, [childGeometries]);

  // Build GeoJSON for the overlapping division
  const overlapGeoJson = useMemo((): GeoJSON.FeatureCollection => {
    if (!selected) return { type: 'FeatureCollection', features: [] };
    const features: GeoJSON.Feature[] = [];
    const geo = divisionGeometries.get(selected.divisionId);
    if (geo) {
      features.push({
        type: 'Feature',
        properties: { id: selected.divisionId, type: 'overlap' },
        geometry: geo as GeoJSON.Geometry,
      });
    }
    // Also show "via" divisions that are different
    for (const r of selected.regions) {
      if (r.viaDivisionId !== selected.divisionId) {
        const viaGeo = divisionGeometries.get(r.viaDivisionId);
        if (viaGeo) {
          features.push({
            type: 'Feature',
            properties: {
              id: r.viaDivisionId,
              type: 'via',
              color: colorMap.get(r.regionId) ?? '#999',
            },
            geometry: viaGeo as GeoJSON.Geometry,
          });
        }
      }
    }
    return { type: 'FeatureCollection', features };
  }, [selected, divisionGeometries, colorMap]);

  // Load GADM children for split preview
  const handleLoadSplit = useCallback(async () => {
    if (!selected) return;
    setSplitLoading(true);
    try {
      const regionIds = selected.regions.map(r => r.regionId);
      // The containment region's `viaDivisionId` points to the GADM ancestor whose
      // children we need to enumerate. The direct region's `viaDivisionId` would be
      // the overlap division itself, yielding the wrong children.
      const containmentRegion = selected.regions.find(r => !r.isDirect);
      if (!containmentRegion) {
        throw new Error('Overlap split requires a containment region (non-direct)');
      }
      const result = await getOverlapDivisionChildren(worldViewId, containmentRegion.viaDivisionId, regionIds);
      setSplitChildren(result.children);
      // Auto-assign: if a child is already assigned, keep that; otherwise leave unassigned
      const autoAssign = new Map<number, number>();
      for (const c of result.children) {
        if (c.assignedToRegionId) {
          autoAssign.set(c.divisionId, c.assignedToRegionId);
        }
      }
      setSplitAssignments(autoAssign);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to load GADM children');
    } finally {
      setSplitLoading(false);
    }
  }, [selected, worldViewId]);

  // Advance to next unresolved overlap (declared before handlers that call it).
  const advanceToNext = useCallback(() => {
    const nextIdx = overlaps.findIndex((_, i) => i > (selectedIndex ?? -1) && !resolvedIndices.has(i));
    if (nextIdx >= 0) {
      setSelectedIndex(nextIdx);
    } else {
      // Try from beginning
      const fromStart = overlaps.findIndex((_, i) => !resolvedIndices.has(i) && i !== selectedIndex);
      setSelectedIndex(fromStart >= 0 ? fromStart : null);
    }
  }, [overlaps, selectedIndex, resolvedIndices]);

  // Apply "keep" resolution
  const handleKeep = useCallback(async () => {
    if (!selected || selectedIndex == null) return;
    const keepRegionId = keepChoice.get(selectedIndex);
    if (keepRegionId == null) return;

    setApplying(true);
    setApplyError(null);
    try {
      const removeFrom = selected.regions
        .filter(r => r.regionId !== keepRegionId)
        .map(r => r.regionId);

      // For containment overlaps: remove the overlapping division from children
      // that have it via a parent. For direct overlaps: remove from other children.
      await resolveOverlap(worldViewId, {
        action: 'keep',
        divisionId: selected.divisionId,
        keepInRegionId: keepRegionId,
        removeFromRegionIds: removeFrom,
      });
      setResolvedIndices(prev => new Set(prev).add(selectedIndex));
      onApplied();
      advanceToNext();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setApplying(false);
    }
  }, [selected, selectedIndex, keepChoice, worldViewId, onApplied, advanceToNext]);

  // Apply "split" resolution
  const handleSplit = useCallback(async () => {
    if (!selected || selectedIndex == null || !splitChildren) return;

    // Find which region has the coarse parent (the one to split)
    const splitRegion = selected.regions.find(r => !r.isDirect);
    if (!splitRegion) return;

    const assignments = splitChildren
      .filter(c => splitAssignments.has(c.divisionId))
      .map(c => ({
        gadmChildId: c.divisionId,
        targetRegionId: splitAssignments.get(c.divisionId)!,
      }));

    if (assignments.length === 0) {
      setApplyError('Assign at least one GADM child to a region');
      return;
    }

    setApplying(true);
    setApplyError(null);
    try {
      await resolveOverlap(worldViewId, {
        action: 'split',
        divisionId: splitRegion.viaDivisionId,
        splitRegionId: splitRegion.regionId,
        assignments,
      });
      setResolvedIndices(prev => new Set(prev).add(selectedIndex));
      onApplied();
      advanceToNext();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setApplying(false);
    }
  }, [selected, selectedIndex, splitChildren, splitAssignments, worldViewId, onApplied, advanceToNext]);

  const handleSkip = useCallback(() => advanceToNext(), [advanceToNext]);

  // Check if all has "keep" option (containment overlaps have a split option)
  const hasContainmentOverlap = selected?.regions.some(r => !r.isDirect) ?? false;

  const resolvedCount = resolvedIndices.size;
  const totalCount = overlaps.length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false} fullWidth sx={{ '& .MuiDialog-paper': { maxWidth: '95vw', height: '85vh' } }}>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
        <Typography variant="h6" component="span">
          Division Overlaps — {parentRegionName}
          <Chip label={`${resolvedCount}/${totalCount} resolved`} size="small" color={resolvedCount === totalCount ? 'success' : 'default'} sx={{ ml: 1.5 }} />
        </Typography>
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, overflow: 'hidden' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <CircularProgress />
          </Box>
        )}
        {!loading && error && <Typography color="error">{error}</Typography>}
        {!loading && !error && (
          <>
            {/* Map panels */}
            <Box sx={{ display: 'flex', gap: 1.5, flex: '1 1 60%', minHeight: 0 }}>
              {/* Left: static region map */}
              {regionMapUrl && (
                <Box sx={{ flex: '0 0 42%', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', bgcolor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={`${regionMapUrl}?width=500`}
                    alt={parentRegionName}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </Box>
              )}

              {/* Right: MapLibre interactive map */}
              <Box sx={{ flex: 1, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', position: 'relative' }}>
                {divGeoLoading && (
                  <CircularProgress size={24} sx={{ position: 'absolute', top: 8, left: 8, zIndex: 10 }} />
                )}
                <MapGL
                  ref={mapRef}
                  style={{ width: '100%', height: '100%' }}
                  mapStyle={MAP_STYLE}
                  initialViewState={{ longitude: 0, latitude: 30, zoom: 2 }}
                >
                  <NavigationControl position="top-right" />

                  {/* Child region backgrounds */}
                  <Source id="children-bg" type="geojson" data={childrenGeoJson}>
                    <Layer id="children-fill" type="fill" paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 }} />
                    <Layer id="children-outline" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.5 }} />
                  </Source>

                  {/* Overlap division + via divisions */}
                  <Source id="overlap-divs" type="geojson" data={overlapGeoJson}>
                    <Layer
                      id="overlap-fill"
                      type="fill"
                      filter={['==', ['get', 'type'], 'overlap']}
                      paint={{ 'fill-color': '#ff5252', 'fill-opacity': 0.35 }}
                    />
                    <Layer
                      id="overlap-border"
                      type="line"
                      filter={['==', ['get', 'type'], 'overlap']}
                      paint={{ 'line-color': '#ff5252', 'line-width': 2.5, 'line-dasharray': [4, 3] }}
                    />
                    <Layer
                      id="via-fill"
                      type="fill"
                      filter={['==', ['get', 'type'], 'via']}
                      paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 }}
                    />
                    <Layer
                      id="via-border"
                      type="line"
                      filter={['==', ['get', 'type'], 'via']}
                      paint={{ 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [6, 3] }}
                    />
                  </Source>
                </MapGL>
              </Box>
            </Box>

            {/* Conflict list + resolution panel */}
            <Box sx={{ flex: '0 0 auto', maxHeight: '40%', overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              {selected ? (
                <Box>
                  {/* Selected conflict info */}
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {selectedIndex != null ? `${selectedIndex + 1}/${totalCount}` : ''} — {selected.divisionPath}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Claimed by: {selected.regions.map(r => (
                      <Chip
                        key={r.regionId}
                        label={r.isDirect ? r.regionName : `${r.regionName} (via ${r.viaDivisionName})`}
                        size="small"
                        sx={{ mr: 0.5, mb: 0.5, bgcolor: colorMap.get(r.regionId) ?? '#ccc', color: '#fff', fontWeight: 500 }}
                      />
                    ))}
                  </Typography>

                  {applyError && <Typography color="error" variant="body2" sx={{ mb: 1 }}>{applyError}</Typography>}

                  {/* Resolution options */}
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {/* Option 1: Keep in one child */}
                    <Box sx={{ flex: '1 1 300px', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="subtitle2" gutterBottom>Keep in one region</Typography>
                      <FormControl size="small" fullWidth sx={{ mb: 1 }}>
                        <InputLabel>Assign to</InputLabel>
                        <Select
                          value={keepChoice.get(selectedIndex ?? -1) ?? ''}
                          label="Assign to"
                          onChange={(e) => {
                            if (selectedIndex == null) return;
                            setKeepChoice(prev => new Map(prev).set(selectedIndex, e.target.value as number));
                          }}
                        >
                          {selected.regions.map(r => (
                            <MenuItem key={r.regionId} value={r.regionId}>
                              {r.regionName}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={applying ? <CircularProgress size={14} /> : <CheckIcon />}
                        disabled={applying || keepChoice.get(selectedIndex ?? -1) == null}
                        onClick={handleKeep}
                      >
                        Apply
                      </Button>
                    </Box>

                    {/* Option 2: Split deeper (only for containment overlaps) */}
                    {hasContainmentOverlap && (
                      <Box sx={{ flex: '1 1 300px', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                        <Typography variant="subtitle2" gutterBottom>Split into GADM children</Typography>
                        <SplitPreview
                          selectedRegions={selected.regions}
                          splitChildren={splitChildren}
                          splitLoading={splitLoading}
                          splitAssignments={splitAssignments}
                          applying={applying}
                          onLoadSplit={handleLoadSplit}
                          onChangeAssignment={(gadmChildId, regionId) => {
                            setSplitAssignments(prev => {
                              const next = new Map(prev);
                              if (regionId == null) next.delete(gadmChildId);
                              else next.set(gadmChildId, regionId);
                              return next;
                            });
                          }}
                          onApplySplit={handleSplit}
                        />
                      </Box>
                    )}

                    {/* Skip button */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-end' }}>
                      <Button variant="text" size="small" startIcon={<SkipNextIcon />} onClick={handleSkip}>
                        Skip
                      </Button>
                    </Box>
                  </Box>
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 2 }}>
                  <Typography variant="body1" color="text.secondary">
                    {emptyStateMessage(resolvedCount, totalCount)}
                  </Typography>
                </Box>
              )}

              {/* Overlap list (clickable chips) */}
              {overlaps.length > 1 && (
                <Box sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: 'divider', display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {overlaps.map((o, i) => (
                    <Chip
                      key={o.divisionId}
                      label={o.divisionPath.split(' > ').pop()}
                      size="small"
                      variant={i === selectedIndex ? 'filled' : 'outlined'}
                      color={chipColor(i, selectedIndex, resolvedIndices)}
                      onClick={() => setSelectedIndex(i)}
                      sx={{ cursor: 'pointer' }}
                    />
                  ))}
                </Box>
              )}
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
