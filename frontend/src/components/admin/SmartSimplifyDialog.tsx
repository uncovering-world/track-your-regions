/**
 * SmartSimplifyDialog — Detect and fix misplaced divisions across child regions.
 *
 * Shows a side-by-side view: source region map image (left) and MapLibre map
 * with color-coded child region geometries (right). Below the map, a scrollable
 * list of detected moves that can be applied individually or skipped.
 *
 * The map has a Current/Proposed toggle:
 * - Current: divisions shown in their current region's color, moved divisions
 *   highlighted with dashed red borders
 * - Proposed: moved divisions recolored to the owner region's color
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
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import {
  detectSmartSimplify,
  applySmartSimplifyMove,
  type SmartSimplifyMove,
  type SpatialAnomaly,
} from '../../api/adminWorldViewImport';
import { getChildrenRegionGeometry } from '../../api/adminWvImportCoverage';
import type { SiblingRegionGeometry } from '../../api/adminWvImportCoverage';
import { fetchDivisionGeometry } from '../../api/divisions';
import type { GeoJSONGeometry } from '../../types';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const CHILD_COLORS = [
  '#3388ff', '#33aa55', '#9955cc', '#cc7733', '#5599dd',
  '#dd5577', '#55bb88', '#bb7744', '#7755cc', '#cc5533',
];

interface SmartSimplifyDialogProps {
  open: boolean;
  onClose: () => void;
  worldViewId: number;
  parentRegionId: number;
  parentRegionName: string;
  regionMapUrl: string | null;
  onApplied: () => void;
}

export function SmartSimplifyDialog({
  open,
  onClose,
  worldViewId,
  parentRegionId,
  parentRegionName,
  regionMapUrl,
  onApplied,
}: SmartSimplifyDialogProps) {
  const mapRef = useRef<MapRef>(null);

  // Data state
  const [moves, setMoves] = useState<SmartSimplifyMove[] | null>(null);
  const [childGeometries, setChildGeometries] = useState<SiblingRegionGeometry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-division geometries for the selected move (fetched on demand)
  const [divisionGeometries, setDivisionGeometries] = useState<Map<number, GeoJSONGeometry>>(new Map());
  const [divGeoLoading, setDivGeoLoading] = useState(false);

  // Spatial anomaly state
  const [spatialAnomalies, setSpatialAnomalies] = useState<SpatialAnomaly[] | null>(null);
  const [appliedAnomalyIndices, setAppliedAnomalyIndices] = useState<Set<number>>(new Set());
  const [selectedAnomalyIndex, setSelectedAnomalyIndex] = useState<number | null>(null);

  // Interaction state
  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null);
  const [appliedGadmParentIds, setAppliedGadmParentIds] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'current' | 'proposed'>('current');

  // Load data on open
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setMoves(null);
    setChildGeometries(null);
    setSelectedMoveIndex(null);
    setAppliedGadmParentIds(new Set());
    setDivisionGeometries(new Map());
    setViewMode('current');
    setSpatialAnomalies(null);
    setAppliedAnomalyIndices(new Set());
    setSelectedAnomalyIndex(null);

    Promise.all([
      detectSmartSimplify(worldViewId, parentRegionId),
      getChildrenRegionGeometry(worldViewId, parentRegionId),
    ])
      .then(([detectResult, geoResult]) => {
        setMoves(detectResult.moves);
        setSpatialAnomalies(detectResult.spatialAnomalies);
        setChildGeometries(geoResult.childRegions);
        if (detectResult.moves.length > 0) {
          setSelectedMoveIndex(0);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, worldViewId, parentRegionId]);

  // Derived: the active selection (either a GADM move or a spatial anomaly)
  const selectedMove = moves && selectedMoveIndex != null ? moves[selectedMoveIndex] : null;
  const selectedAnomaly = spatialAnomalies && selectedAnomalyIndex != null ? spatialAnomalies[selectedAnomalyIndex] : null;

  // Active division IDs to show on the map (from whichever selection is active)
  const activeDivIds = useMemo(() => {
    if (selectedMove) return selectedMove.divisions.map(d => d.divisionId);
    if (selectedAnomaly) return selectedAnomaly.divisions.map(d => d.divisionId);
    return [];
  }, [selectedMove, selectedAnomaly]);

  // Fetch division geometries when active selection changes
  useEffect(() => {
    if (activeDivIds.length === 0) return;
    const missing = activeDivIds.filter(id => !divisionGeometries.has(id));
    if (missing.length === 0) return;

    setDivGeoLoading(true);
    Promise.all(
      missing.map(id => fetchDivisionGeometry(id, worldViewId, { detail: 'medium' }).then(feat => ({ id, feat }))),
    )
      .then(results => {
        setDivisionGeometries(prev => {
          const next = new Map(prev);
          for (const { id, feat } of results) {
            if (feat?.geometry) next.set(id, feat.geometry);
          }
          return next;
        });
      })
      .finally(() => setDivGeoLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch when selection key changes
  }, [selectedMove?.gadmParentId, selectedAnomalyIndex, worldViewId]);

  // Fly to selected anomaly's divisions when geometries are ready
  useEffect(() => {
    if (!selectedAnomaly || !mapRef.current) return;
    const geoms = selectedAnomaly.divisions
      .map(d => divisionGeometries.get(d.divisionId))
      .filter((g): g is GeoJSONGeometry => !!g);
    if (geoms.length === 0) return;
    try {
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: geoms.map(g => ({ type: 'Feature' as const, properties: {}, geometry: g as GeoJSON.Geometry })),
      };
      const bounds = turf.bbox(fc) as [number, number, number, number];
      mapRef.current.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        { padding: 60, duration: 500 },
      );
    } catch { /* ignore */ }
  }, [selectedAnomaly, divisionGeometries]);

  // Fit map bounds when geometries load
  useEffect(() => {
    if (!childGeometries || childGeometries.length === 0 || !mapRef.current) return;
    try {
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: childGeometries.map((c) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: c.geometry,
        })),
      };
      const bounds = turf.bbox(fc) as [number, number, number, number];
      mapRef.current.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        { padding: 40, duration: 500 },
      );
    } catch (e) {
      console.error('Failed to fit bounds:', e);
    }
  }, [childGeometries]);

  // Build a color map: regionId -> color
  const colorMap = useMemo(() => {
    if (!childGeometries) return new Map<number, string>();
    return new Map(childGeometries.map((c, i) => [c.regionId, CHILD_COLORS[i % CHILD_COLORS.length]]));
  }, [childGeometries]);

  // Handle Apply
  const handleApply = useCallback(async () => {
    if (moves == null || selectedMoveIndex == null) return;
    const move = moves[selectedMoveIndex];
    if (!move) return;

    setApplying(true);
    setApplyError(null);
    try {
      await applySmartSimplifyMove(
        worldViewId,
        parentRegionId,
        move.ownerRegionId,
        move.divisions.map((d) => d.memberRowId),
      );
      setAppliedGadmParentIds((prev) => new Set(prev).add(move.gadmParentId));
      onApplied();

      // Advance to next non-applied move
      const nextIndex = moves.findIndex(
        (m, i) => i > selectedMoveIndex && !appliedGadmParentIds.has(m.gadmParentId) && m.gadmParentId !== move.gadmParentId,
      );
      setSelectedMoveIndex(nextIndex >= 0 ? nextIndex : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      console.error('Apply move failed:', err);
      setApplyError(msg);
    } finally {
      setApplying(false);
    }
  }, [moves, selectedMoveIndex, worldViewId, parentRegionId, onApplied, appliedGadmParentIds]);

  // Handle Skip
  const handleSkip = useCallback(() => {
    if (moves == null || selectedMoveIndex == null) return;
    const nextIndex = moves.findIndex(
      (m, i) => i > selectedMoveIndex && !appliedGadmParentIds.has(m.gadmParentId),
    );
    setSelectedMoveIndex(nextIndex >= 0 ? nextIndex : null);
  }, [moves, selectedMoveIndex, appliedGadmParentIds]);

  // Handle Apply Anomaly
  const handleApplyAnomaly = useCallback(async (index: number) => {
    if (!spatialAnomalies) return;
    const anomaly = spatialAnomalies[index];
    const memberRowIds = anomaly.divisions
      .map(d => d.memberRowId)
      .filter((id): id is number => id !== null);
    if (memberRowIds.length === 0) return;

    try {
      setApplyError(null);
      await applySmartSimplifyMove(
        worldViewId,
        parentRegionId,
        anomaly.suggestedTargetRegionId,
        memberRowIds,
        true, // skipSimplify
      );
      setAppliedAnomalyIndices(prev => new Set(prev).add(index));
      onApplied();
      // Advance to next non-applied anomaly
      const nextIndex = spatialAnomalies.findIndex(
        (_, i) => i > index && !appliedAnomalyIndices.has(i),
      );
      setSelectedAnomalyIndex(nextIndex >= 0 ? nextIndex : null);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply');
    }
  }, [spatialAnomalies, worldViewId, parentRegionId, appliedAnomalyIndices, onApplied]);

  // Handle Skip Anomaly
  const handleSkipAnomaly = useCallback((index: number) => {
    if (!spatialAnomalies) return;
    const nextIndex = spatialAnomalies.findIndex(
      (_, i) => i > index && !appliedAnomalyIndices.has(i),
    );
    setSelectedAnomalyIndex(nextIndex >= 0 ? nextIndex : null);
  }, [spatialAnomalies, appliedAnomalyIndices]);

  // Highlight region IDs involved in the selected move or anomaly
  const highlightedRegionIds = useMemo(() => {
    const set = new Set<number>();
    if (selectedMove) {
      set.add(selectedMove.ownerRegionId);
      for (const div of selectedMove.divisions) {
        set.add(div.fromRegionId);
      }
    } else if (selectedAnomaly) {
      set.add(selectedAnomaly.suggestedTargetRegionId);
      set.add(selectedAnomaly.divisions[0]?.sourceRegionId);
    }
    return set;
  }, [selectedMove, selectedAnomaly]);

  const hasSideBySide = !!regionMapUrl;
  const pendingMoves = moves ? moves.filter((m) => !appliedGadmParentIds.has(m.gadmParentId)).length : 0;

  // Division overlay color: in "proposed" mode, show in the target's color; in "current", show in the source's color
  const getDivisionOverlayColor = useCallback((divisionId: number): string => {
    if (selectedMove) {
      if (viewMode === 'proposed') {
        return colorMap.get(selectedMove.ownerRegionId) ?? '#4CAF50';
      }
      const div = selectedMove.divisions.find(d => d.divisionId === divisionId);
      return div ? (colorMap.get(div.fromRegionId) ?? '#ff5252') : '#ff5252';
    }
    if (selectedAnomaly) {
      if (viewMode === 'proposed') {
        return colorMap.get(selectedAnomaly.suggestedTargetRegionId) ?? '#4CAF50';
      }
      return colorMap.get(selectedAnomaly.divisions[0]?.sourceRegionId) ?? '#ff5252';
    }
    return '#ff5252';
  }, [selectedMove, selectedAnomaly, viewMode, colorMap]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">Smart Simplify: {parentRegionName}</Typography>
            <Typography variant="caption" color="text.secondary">
              {loading
                ? 'Detecting misplaced divisions...'
                : error
                  ? error
                  : (moves?.length === 0 && (!spatialAnomalies || spatialAnomalies.length === 0))
                    ? 'No misplaced divisions detected'
                    : `${moves?.length ?? 0} move${(moves?.length ?? 0) !== 1 ? 's' : ''}, ${pendingMoves} pending${spatialAnomalies && spatialAnomalies.length > 0 ? ` + ${spatialAnomalies.length} anomal${spatialAnomalies.length !== 1 ? 'ies' : 'y'}` : ''}`
              }
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: 600 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <Typography color="error">{error}</Typography>
          </Box>
        ) : (
          <>
            {/* Top section: map(s) */}
            <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* Left panel: source map image */}
              {hasSideBySide && (
                <Box sx={{
                  width: '42%',
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRight: 1,
                  borderColor: 'divider',
                  bgcolor: 'grey.50',
                  p: 1,
                }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                    Region map
                  </Typography>
                  <Box
                    component="img"
                    src={`${regionMapUrl}?width=500`}
                    alt="Region map"
                    sx={{
                      maxWidth: '100%',
                      maxHeight: '95%',
                      objectFit: 'contain',
                    }}
                  />
                </Box>
              )}

              {/* Right panel: MapLibre map with child regions */}
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {/* Toggle bar */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 1.5, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary">
                    Child regions (GADM)
                    {divGeoLoading && <CircularProgress size={10} sx={{ ml: 1 }} />}
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={viewMode}
                    onChange={(_, v) => { if (v) setViewMode(v); }}
                  >
                    <ToggleButton value="current" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', textTransform: 'none' }}>
                      Current
                    </ToggleButton>
                    <ToggleButton value="proposed" sx={{ px: 1.5, py: 0, fontSize: '0.7rem', textTransform: 'none' }}>
                      Proposed
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <MapGL
                    ref={mapRef}
                    initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                    style={{ width: '100%', height: '100%' }}
                    mapStyle={MAP_STYLE}
                    onLoad={() => {
                      if (mapRef.current && childGeometries && childGeometries.length > 0) {
                        try {
                          const fc: GeoJSON.FeatureCollection = {
                            type: 'FeatureCollection',
                            features: childGeometries.map((c) => ({
                              type: 'Feature' as const,
                              properties: {},
                              geometry: c.geometry,
                            })),
                          };
                          const bounds = turf.bbox(fc) as [number, number, number, number];
                          mapRef.current.fitBounds(
                            [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                            { padding: 40, duration: 500 },
                          );
                        } catch (e) {
                          console.error('Failed to fit bounds on load:', e);
                        }
                      }
                    }}
                  >
                    <NavigationControl position="top-right" showCompass={false} />

                    {/* Child region union geometries (background) */}
                    {childGeometries?.map((child, idx) => {
                      const color = CHILD_COLORS[idx % CHILD_COLORS.length];
                      const isHighlighted = highlightedRegionIds.has(child.regionId);
                      return (
                        <Source
                          key={child.regionId}
                          id={`child-${child.regionId}`}
                          type="geojson"
                          data={{
                            type: 'Feature',
                            properties: { name: child.name },
                            geometry: child.geometry,
                          }}
                        >
                          <Layer
                            id={`child-fill-${child.regionId}`}
                            type="fill"
                            paint={{
                              'fill-color': color,
                              'fill-opacity': isHighlighted ? 0.35 : 0.15,
                            }}
                          />
                          <Layer
                            id={`child-outline-${child.regionId}`}
                            type="line"
                            paint={{
                              'line-color': color,
                              'line-width': isHighlighted ? 2.5 : 1,
                            }}
                          />
                        </Source>
                      );
                    })}

                    {/* Per-division overlays for the selected move or anomaly */}
                    {activeDivIds.map(divId => {
                      const geom = divisionGeometries.get(divId);
                      if (!geom) return null;
                      const overlayColor = getDivisionOverlayColor(divId);
                      const isCurrent = viewMode === 'current';
                      const divName = selectedMove?.divisions.find(d => d.divisionId === divId)?.name
                        ?? selectedAnomaly?.divisions.find(d => d.divisionId === divId)?.name
                        ?? '';
                      return (
                        <Source
                          key={`div-${divId}`}
                          id={`div-${divId}`}
                          type="geojson"
                          data={{
                            type: 'Feature',
                            properties: { name: divName },
                            geometry: geom,
                          }}
                        >
                          <Layer
                            id={`div-fill-${divId}`}
                            type="fill"
                            paint={{
                              'fill-color': overlayColor,
                              'fill-opacity': 0.6,
                            }}
                          />
                          <Layer
                            id={`div-border-${divId}`}
                            type="line"
                            paint={{
                              'line-color': isCurrent ? '#ff5252' : overlayColor,
                              'line-width': isCurrent ? 2.5 : 2,
                              'line-dasharray': isCurrent ? [4, 3] : [1, 0],
                            }}
                          />
                        </Source>
                      );
                    })}
                  </MapGL>
                </Box>
              </Box>
            </Box>

            {/* Bottom section: moves list */}
            {((moves && moves.length > 0) || (spatialAnomalies && spatialAnomalies.length > 0)) && (
              <Box sx={{
                borderTop: 1,
                borderColor: 'divider',
                maxHeight: 220,
                minHeight: 120,
                overflow: 'auto',
                p: 1.5,
              }}>
                {applyError && (
                  <Typography variant="body2" color="error" sx={{ mb: 1 }}>
                    {applyError}
                  </Typography>
                )}
                {moves && moves.length > 0 && (
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Detected Moves
                  </Typography>
                )}
                {moves?.map((move, idx) => {
                  const isApplied = appliedGadmParentIds.has(move.gadmParentId);
                  const isSelected = selectedMoveIndex === idx;
                  return (
                    <Box
                      key={move.gadmParentId}
                      onClick={() => { if (!isApplied) { setSelectedMoveIndex(idx); setSelectedAnomalyIndex(null); } }}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        mb: 0.5,
                        borderRadius: 1,
                        cursor: isApplied ? 'default' : 'pointer',
                        bgcolor: isSelected ? 'action.selected' : isApplied ? 'action.disabledBackground' : 'transparent',
                        opacity: isApplied ? 0.5 : 1,
                        '&:hover': !isApplied ? { bgcolor: isSelected ? 'action.selected' : 'action.hover' } : {},
                        border: 1,
                        borderColor: isSelected ? 'primary.main' : 'transparent',
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {move.gadmParentName}
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            {move.gadmParentPath}
                          </Typography>
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Move {move.divisions.length} division{move.divisions.length !== 1 ? 's' : ''} to{' '}
                          <Typography component="span" variant="caption" fontWeight={600} sx={{ color: colorMap.get(move.ownerRegionId) ?? 'text.primary' }}>
                            {move.ownerRegionName}
                          </Typography>
                          {' '}(has {move.totalChildren - move.divisions.length}/{move.totalChildren} children)
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {move.divisions.map((div) => (
                            <Chip
                              key={div.memberRowId}
                              label={`${div.name} (from ${div.fromRegionName})`}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.65rem',
                                bgcolor: colorMap.get(div.fromRegionId)
                                  ? `${colorMap.get(div.fromRegionId)}22`
                                  : undefined,
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                      {isApplied ? (
                        <Chip label="Applied" color="success" size="small" sx={{ height: 24 }} />
                      ) : isSelected ? (
                        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            startIcon={applying ? <CircularProgress size={14} /> : <CheckIcon />}
                            onClick={(e) => { e.stopPropagation(); handleApply(); }}
                            disabled={applying}
                          >
                            Apply
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<SkipNextIcon />}
                            onClick={(e) => { e.stopPropagation(); handleSkip(); }}
                            disabled={applying}
                          >
                            Skip
                          </Button>
                        </Box>
                      ) : null}
                    </Box>
                  );
                })}

                {/* Spatial anomalies section */}
                {spatialAnomalies && spatialAnomalies.length > 0 && (
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Spatial Anomalies ({spatialAnomalies.length})
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      Disconnected fragments or exclaves detected. Each fragment could be reassigned to the surrounding region.
                    </Typography>
                    {spatialAnomalies.map((anomaly, idx) => {
                      const isApplied = appliedAnomalyIndices.has(idx);
                      const isSelected = selectedAnomalyIndex === idx;
                      return (
                        <Box
                          key={`anomaly-${idx}`}
                          onClick={() => { if (!isApplied) { setSelectedAnomalyIndex(idx); setSelectedMoveIndex(null); } }}
                          sx={{
                            p: 1, mb: 0.5, borderRadius: 1, cursor: isApplied ? 'default' : 'pointer',
                            border: 1, borderColor: isSelected ? 'info.main' : 'divider',
                            opacity: isApplied ? 0.5 : 1,
                            bgcolor: isSelected ? 'action.selected' : undefined,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="body2" fontWeight={500}>
                              {anomaly.divisions.length} div{anomaly.divisions.length > 1 ? 's' : ''} of {anomaly.divisions[0]?.sourceRegionName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              ({anomaly.fragmentSize}/{anomaly.totalRegionSize} divisions)
                            </Typography>
                            <Typography variant="caption">
                              &rarr; {anomaly.suggestedTargetRegionName}
                            </Typography>
                            {isApplied && (
                              <Chip label="Applied" size="small" color="success" sx={{ height: 20, fontSize: '0.65rem' }} />
                            )}
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                            {anomaly.divisions.map(d => (
                              <Chip key={d.divisionId} label={d.name} size="small" variant="outlined"
                                sx={{ height: 20, fontSize: '0.65rem' }} />
                            ))}
                          </Box>
                          {isSelected && !isApplied && (
                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                              <Button size="small" variant="contained" color="success"
                                onClick={(e) => { e.stopPropagation(); handleApplyAnomaly(idx); }}>
                                Accept
                              </Button>
                              <Button size="small" variant="outlined"
                                onClick={(e) => { e.stopPropagation(); handleSkipAnomaly(idx); }}>
                                Skip
                              </Button>
                            </Box>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Box>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
