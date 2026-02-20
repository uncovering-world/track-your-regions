import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Button,
  Typography,
  Box,
  Chip,
  CircularProgress,
  Alert,
  Tooltip,
  FormControlLabel,
  Checkbox,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import StopIcon from '@mui/icons-material/Stop';
import DrawIcon from '@mui/icons-material/Draw';
import LayersIcon from '@mui/icons-material/Layers';
import HubIcon from '@mui/icons-material/Hub';
import SettingsIcon from '@mui/icons-material/Settings';
import MapGL, { Source, Layer, NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import { useQuery } from '@tanstack/react-query';
import * as turf from '@turf/turf';
import { MAP_STYLE } from '../../../constants/mapStyles';
import { smartFitBounds } from '../../../utils/mapUtils';
import {
  fetchRegionMemberGeometries,
  startWorldViewGeometryComputation,
  cancelWorldViewGeometryComputation,
  computeRegionGeometryWithProgress,
  resetRegionToGADM,
  fetchDisplayGeometryStatus,
  updateRegionGeometry,
  fetchRegionGeometry,
} from '../../../api';
import type { Region, WorldView } from '../../../types';
import type { DisplayMode } from '../types';
import { useComputationStatus } from '../hooks';
import { CustomBoundaryDialog } from '../../CustomBoundaryDialog';
import { HullEditorDialog } from '../../HullEditorDialog';
import { useAppTheme } from '../../../theme';

export interface GeometryMapPanelProps {
  selectedRegion: Region | null;
  worldView: WorldView;
  open: boolean;
  regions: Region[];
  onSelectedRegionChange: (region: Region) => void;
  onInvalidateQueries: (opts: { regionGeometryId?: number; regions?: boolean }) => void;
  onToggleHull: (region: Region) => void;
}

export function GeometryMapPanel({
  selectedRegion, worldView, open, regions,
  onSelectedRegionChange, onInvalidateQueries, onToggleHull,
}: GeometryMapPanelProps) {
  const { P } = useAppTheme();
  const [displayMode, setDisplayMode] = useState<DisplayMode>('real');
  const [showOptions, setShowOptions] = useState(false);

  const { data: selectedRegionGeometry, isLoading: geometryLoading } = useQuery({
    queryKey: ['regionGeometry', selectedRegion?.id, displayMode],
    queryFn: () => selectedRegion
      ? fetchRegionGeometry(selectedRegion.id, displayMode === 'real' ? undefined : 'hull')
      : null,
    enabled: !!selectedRegion,
    staleTime: 30000,
  });

  const {
    isComputing, setIsComputing,
    computationStatus, setComputationStatus,
    isComputingSingleRegion, setIsComputingSingleRegion,
    forceRecompute, setForceRecompute,
    isResettingToGADM, setIsResettingToGADM,
    skipSnapping, setSkipSnapping,
    displayGeomStatus, setDisplayGeomStatus,
    computeProgressLogs, setComputeProgressLogs,
  } = useComputationStatus({ worldView, open });

  const mapRef = useRef<MapRef>(null);
  const lastFittedRegionRef = useRef<number | null>(null);

  const [customBoundaryDialogOpen, setCustomBoundaryDialogOpen] = useState(false);
  const [stagedGeometries, setStagedGeometries] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hullEditorOpen, setHullEditorOpen] = useState(false);

  const geojsonData: GeoJSON.FeatureCollection = selectedRegionGeometry?.geometry
    ? { type: 'FeatureCollection', features: [selectedRegionGeometry as unknown as GeoJSON.Feature] }
    : { type: 'FeatureCollection', features: [] };

  const crossesDateline = selectedRegionGeometry?.properties?.crossesDateline === true;

  const [mapLoaded, setMapLoaded] = useState(false);

  // Fit map bounds — same pattern as RegionMapVT:
  // prefer pre-computed focusBbox (handles antimeridian), fall back to turf.bbox.
  // Map is always mounted, so we get smooth fly transitions between regions.
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (!selectedRegion || !selectedRegionGeometry?.geometry) return;
    const isNewRegion = lastFittedRegionRef.current !== selectedRegion.id;
    lastFittedRegionRef.current = selectedRegion.id;

    // Prefer pre-computed focusBbox (correctly handles antimeridian)
    if (selectedRegion.focusBbox) {
      smartFitBounds(mapRef.current, selectedRegion.focusBbox, {
        padding: 50,
        duration: isNewRegion ? 500 : 300,
        anchorPoint: selectedRegion.anchorPoint,
      });
      return;
    }

    // Fallback: compute bbox from geometry
    try {
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [selectedRegionGeometry as unknown as GeoJSON.Feature],
      };
      const bbox = turf.bbox(geojson) as [number, number, number, number];
      smartFitBounds(mapRef.current, bbox, { padding: 50, duration: isNewRegion ? 500 : 300, geojson });
    } catch (e) {
      console.error('Failed to fit bounds:', e);
    }
  }, [selectedRegionGeometry, selectedRegion, displayMode, mapLoaded]);

  useEffect(() => {
    if (open) {
      fetchDisplayGeometryStatus(worldView.id)
        .then((status) => setDisplayGeomStatus(status))
        .catch(() => setDisplayGeomStatus(null));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, worldView.id]);

  // --- Callbacks ---

  const handleStartComputation = useCallback(async () => {
    try {
      setComputationStatus(null);
      await startWorldViewGeometryComputation(worldView.id, true, skipSnapping);
      setIsComputing(true);
      setComputationStatus({ running: true, progress: 0, total: regions.length, status: 'Starting...' });
    } catch (e) {
      console.error('Failed to start computation:', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldView.id, regions.length, skipSnapping]);

  const handleCancelComputation = useCallback(async () => {
    try { await cancelWorldViewGeometryComputation(worldView.id); } catch (e) { console.error('Failed to cancel:', e); }
  }, [worldView.id]);

  const handleComputeSingleRegion = useCallback(async () => {
    if (!selectedRegion) return;
    setIsComputingSingleRegion(true);
    setComputeProgressLogs([]);
    try {
      const result = await computeRegionGeometryWithProgress(
        selectedRegion.id, forceRecompute,
        (event) => setComputeProgressLogs(prev => [...prev, event]),
        skipSnapping,
      );
      const data = result.data as {
        usesHull?: boolean;
        focusBbox?: [number, number, number, number] | null;
        anchorPoint?: [number, number] | null;
      } | undefined;
      if (data) {
        onSelectedRegionChange({
          ...selectedRegion,
          isCustomBoundary: false,
          ...(data.usesHull !== undefined && { usesHull: data.usesHull }),
          ...(data.focusBbox !== undefined && { focusBbox: data.focusBbox }),
          ...(data.anchorPoint !== undefined && { anchorPoint: data.anchorPoint }),
        });
      }
      onInvalidateQueries({ regionGeometryId: selectedRegion.id, regions: true });
    } catch (e) {
      console.error('Failed to compute:', e);
    } finally {
      setIsComputingSingleRegion(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRegion, forceRecompute, skipSnapping, onSelectedRegionChange, onInvalidateQueries]);

  const handleRedefineBoundaries = useCallback(async () => {
    if (!selectedRegion) return;
    if (selectedRegion.isCustomBoundary && selectedRegionGeometry) {
      setStagedGeometries({ type: 'FeatureCollection', features: [selectedRegionGeometry as unknown as GeoJSON.Feature] });
    } else {
      const memberGeomsFC = await fetchRegionMemberGeometries(selectedRegion.id);
      if (!memberGeomsFC || memberGeomsFC.features.length === 0) {
        if (selectedRegionGeometry) {
          setStagedGeometries({ type: 'FeatureCollection', features: [selectedRegionGeometry as unknown as GeoJSON.Feature] });
        } else { alert('No geometries available.'); return; }
      } else { setStagedGeometries(memberGeomsFC); }
    }
    setCustomBoundaryDialogOpen(true);
  }, [selectedRegion, selectedRegionGeometry]);

  const handleResetToGADM = useCallback(async () => {
    if (!selectedRegion) return;
    if (!window.confirm('Reset boundaries to original divisions? Custom boundary will be removed.')) return;
    setIsResettingToGADM(true);
    try {
      await resetRegionToGADM(selectedRegion.id);
      onSelectedRegionChange({ ...selectedRegion, isCustomBoundary: false });
      onInvalidateQueries({ regionGeometryId: selectedRegion.id, regions: true });
    } catch (e) {
      console.error('Failed to reset:', e);
      alert('Failed to reset boundaries');
    } finally { setIsResettingToGADM(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRegion, onSelectedRegionChange, onInvalidateQueries]);

  const handleBoundaryConfirm = useCallback(async (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) => {
    if (selectedRegion) {
      try {
        await updateRegionGeometry(selectedRegion.id, geometry, true);
        onInvalidateQueries({ regionGeometryId: selectedRegion.id, regions: true });
      } catch (e) { console.error('Failed to update:', e); alert('Failed to save custom boundary'); }
    }
    setCustomBoundaryDialogOpen(false);
  }, [selectedRegion, onInvalidateQueries]);

  // ── Toolbar button style
  const toolBtnSx = {
    textTransform: 'none' as const,
    fontFamily: P.font.ui,
    fontSize: '0.72rem',
    fontWeight: 500,
    py: 0.5,
    px: 1.5,
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* ── ACTION TOOLBAR (overlays top of map area) ── */}
        <Box sx={{
          px: 2, py: 1,
          bgcolor: P.light.surface,
          borderBottom: `1px solid ${P.light.border}`,
          display: 'flex',
          gap: 1,
          alignItems: 'center',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}>
          {selectedRegion ? (
            <>
              {/* Region info */}
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1, mr: 1,
                borderRight: `1px solid ${P.light.border}`, pr: 2,
              }}>
                <Box sx={{ width: 10, height: 10, bgcolor: selectedRegion.color || '#3388ff', borderRadius: '2px', border: '1px solid rgba(0,0,0,0.1)' }} />
                <Typography sx={{ fontFamily: P.font.ui, fontWeight: 600, fontSize: '0.85rem', color: P.light.text }}>
                  {selectedRegion.name}
                </Typography>
                <Chip
                  size="small"
                  label="Hull"
                  variant={selectedRegion.usesHull ? 'filled' : 'outlined'}
                  color={selectedRegion.usesHull ? 'warning' : 'default'}
                  onClick={() => onToggleHull(selectedRegion)}
                  sx={{ height: 20, fontSize: '0.65rem', cursor: 'pointer' }}
                />
                {selectedRegion.isCustomBoundary && <Chip size="small" label="Custom" sx={{ height: 20, fontSize: '0.65rem' }} color="info" />}
              </Box>

              {/* Geometry actions */}
              <Tooltip title={geojsonData.features.length > 0 ? 'Recompute geometry from divisions' : 'Compute geometry'}>
                <span>
                  <Button
                    size="small" variant="outlined" color="primary"
                    onClick={handleComputeSingleRegion}
                    disabled={isComputingSingleRegion || isComputing}
                    startIcon={isComputingSingleRegion ? <CircularProgress size={12} /> : <RefreshIcon sx={{ fontSize: '16px !important' }} />}
                    sx={toolBtnSx}
                  >
                    {isComputingSingleRegion ? 'Computing...' : 'Compute'}
                  </Button>
                </span>
              </Tooltip>

              <Button
                size="small" variant="outlined"
                color={selectedRegion.isCustomBoundary ? 'info' : 'primary'}
                onClick={handleRedefineBoundaries}
                startIcon={<DrawIcon sx={{ fontSize: '16px !important' }} />}
                sx={toolBtnSx}
              >
                Redefine
              </Button>

              {selectedRegion.isCustomBoundary && (
                <Tooltip title="Reset to original GADM divisions">
                  <span>
                    <Button
                      size="small" variant="outlined" color="warning"
                      onClick={handleResetToGADM}
                      disabled={isResettingToGADM || isComputingSingleRegion}
                      startIcon={isResettingToGADM ? <CircularProgress size={12} /> : <RefreshIcon sx={{ fontSize: '16px !important' }} />}
                      sx={toolBtnSx}
                    >
                      Reset
                    </Button>
                  </span>
                </Tooltip>
              )}

              {/* Display mode + hull editor for hull regions */}
              {selectedRegion.usesHull && (
                <>
                  <ToggleButtonGroup
                    size="small"
                    value={displayMode}
                    exclusive
                    onChange={(_, v) => { if (v !== null) setDisplayMode(v); }}
                    sx={{ ml: 0.5 }}
                  >
                    <ToggleButton value="real" sx={{ py: 0.25, px: 0.75, gap: 0.5 }}>
                      <Tooltip title="Show actual island polygons"><LayersIcon sx={{ fontSize: 16 }} /></Tooltip>
                      <Typography sx={{ fontSize: '0.65rem', fontFamily: P.font.ui, textTransform: 'none' }}>Islands</Typography>
                    </ToggleButton>
                    <ToggleButton value="hull" sx={{ py: 0.25, px: 0.75, gap: 0.5 }}>
                      <Tooltip title="Show convex hull envelope"><HubIcon sx={{ fontSize: 16 }} /></Tooltip>
                      <Typography sx={{ fontSize: '0.65rem', fontFamily: P.font.ui, textTransform: 'none' }}>Hull</Typography>
                    </ToggleButton>
                  </ToggleButtonGroup>

                  <Tooltip title="Edit hull envelope parameters">
                    <Button
                      size="small" variant="outlined" color="warning"
                      onClick={() => setHullEditorOpen(true)}
                      startIcon={<HubIcon sx={{ fontSize: '16px !important' }} />}
                      sx={toolBtnSx}
                    >
                      Edit Hull
                    </Button>
                  </Tooltip>
                </>
              )}

              {/* Options toggle */}
              <Tooltip title="Computation options">
                <IconButton size="small" onClick={() => setShowOptions(!showOptions)} sx={{ ml: 'auto' }}>
                  <SettingsIcon sx={{ fontSize: 16, color: showOptions ? P.accent.primary : P.light.textMuted }} />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.82rem', color: P.light.textMuted, fontStyle: 'italic', flex: 1 }}>
                Select a region to view geometry
              </Typography>
              {/* Batch compute all */}
              {isComputing ? (
                <Button size="small" variant="outlined" color="error" onClick={handleCancelComputation} startIcon={<StopIcon />} sx={toolBtnSx}>
                  Cancel
                </Button>
              ) : (
                <Button
                  size="small" variant="outlined"
                  onClick={handleStartComputation}
                  disabled={regions.length === 0}
                  startIcon={<RefreshIcon sx={{ fontSize: '16px !important' }} />}
                  sx={toolBtnSx}
                >
                  Compute All
                </Button>
              )}
            </>
          )}
        </Box>

        {/* ── Options row (collapsible) ── */}
        {showOptions && selectedRegion && (
          <Box sx={{
            px: 2, py: 0.5,
            bgcolor: '#f8f9fb',
            borderBottom: `1px solid ${P.light.border}`,
            display: 'flex', gap: 2, alignItems: 'center',
            flexShrink: 0,
          }}>
            <Tooltip title="Recompute hull even if one already exists">
              <FormControlLabel
                control={<Checkbox size="small" checked={forceRecompute} onChange={(e) => setForceRecompute(e.target.checked)} />}
                label={<Typography sx={{ fontSize: '0.72rem', fontFamily: P.font.ui }}>Regenerate hull</Typography>}
                sx={{ mr: 0 }}
              />
            </Tooltip>
            <Tooltip title="Skip vertex alignment — faster but may leave small gaps">
              <FormControlLabel
                control={<Checkbox size="small" checked={skipSnapping} onChange={(e) => setSkipSnapping(e.target.checked)} />}
                label={<Typography sx={{ fontSize: '0.72rem', fontFamily: P.font.ui }}>Skip snapping</Typography>}
                sx={{ mr: 0 }}
              />
            </Tooltip>
            {displayGeomStatus && (
              <Typography sx={{ fontFamily: P.font.mono, fontSize: '0.65rem', color: P.light.textMuted, ml: 'auto' }}>
                Display geoms: {displayGeomStatus.withDisplayGeom}/{displayGeomStatus.withGeom}
                {displayGeomStatus.hullRegions > 0 && ` | ${displayGeomStatus.hullRegions} hull`}
              </Typography>
            )}
          </Box>
        )}

        {/* ── Computation progress ── */}
        {isComputingSingleRegion && computeProgressLogs.length > 0 && (() => {
          const lastLog = computeProgressLogs[computeProgressLogs.length - 1];
          const elapsed = lastLog?.elapsed || 0;
          const stepMatch = lastLog?.step?.match(/Step (\d+)\/(\d+)/);
          const currentStep = stepMatch ? parseInt(stepMatch[1]) : 0;
          const totalSteps = stepMatch ? parseInt(stepMatch[2]) : 6;
          const progress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
          const remaining = currentStep > 0 ? Math.max(0, ((elapsed / currentStep) * totalSteps) - elapsed) : 0;
          return (
            <Box sx={{ px: 2, py: 0.75, bgcolor: '#f0f7f6', borderBottom: `1px solid ${P.light.border}`, flexShrink: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.7rem', color: P.light.textMuted }}>
                  {lastLog?.step?.replace(/\(\d+\.\d+s\)/, '').trim() || 'Processing...'}
                </Typography>
                <Typography sx={{ fontFamily: P.font.mono, fontSize: '0.65rem', color: P.light.textMuted }}>
                  {elapsed.toFixed(0)}s {remaining > 0 && `(~${remaining.toFixed(0)}s left)`}
                </Typography>
              </Box>
              <LinearProgress variant="determinate" value={Math.min(progress, 100)} sx={{ height: 4, borderRadius: 1 }} />
            </Box>
          );
        })()}

        {!isComputingSingleRegion && computeProgressLogs.length > 0 && (() => {
          const lastLog = computeProgressLogs[computeProgressLogs.length - 1];
          if (lastLog?.type === 'error') {
            return <Alert severity="error" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={() => setComputeProgressLogs([])}>
              {lastLog.message || 'Computation failed'}
            </Alert>;
          }
          if (lastLog?.type === 'complete') {
            const data = lastLog.data as { points?: number; numPolygons?: number; numHoles?: number } | undefined;
            return <Alert severity="success" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={() => setComputeProgressLogs([])}>
              Done in {lastLog.elapsed?.toFixed(1)}s
              {data?.points && ` | ${data.points.toLocaleString()} pts`}
              {data?.numPolygons && ` | ${data.numPolygons} polys`}
            </Alert>;
          }
          return null;
        })()}

        {/* Batch computation progress */}
        {isComputing && computationStatus && (
          <Box sx={{ px: 2, py: 0.75, bgcolor: '#f0f7f6', borderBottom: `1px solid ${P.light.border}`, flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
              <Box sx={{ flex: 1 }}>
                <LinearProgress variant="determinate" value={computationStatus.percent ?? 0} sx={{ height: 4, borderRadius: 1 }} />
              </Box>
              <Typography sx={{ fontFamily: P.font.mono, fontSize: '0.65rem', color: P.light.textMuted, minWidth: 36 }}>
                {computationStatus.percent ?? 0}%
              </Typography>
            </Box>
            {computationStatus.currentRegion && (
              <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.7rem', color: P.light.textMuted }}>
                {computationStatus.currentRegion}
                {(computationStatus.currentMembers ?? 0) > 0 && ` (${computationStatus.currentMembers} divisions)`}
              </Typography>
            )}
          </Box>
        )}

        {!isComputing && computationStatus?.status === 'Complete' && (
          <Alert severity="success" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={() => setComputationStatus(null)}>
            Complete! Computed: {computationStatus.computed ?? 0}, Skipped: {computationStatus.skipped ?? 0}
          </Alert>
        )}
        {!isComputing && computationStatus?.status === 'Cancelled' && (
          <Alert severity="warning" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={() => setComputationStatus(null)}>
            Cancelled. Computed: {computationStatus.computed ?? 0}
          </Alert>
        )}

        {/* ── MAP (always mounted — overlays show loading/empty states) ── */}
        <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <MapGL
            ref={mapRef}
            initialViewState={{ longitude: 0, latitude: 30, zoom: 1 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={MAP_STYLE}
            onLoad={() => setMapLoaded(true)}
          >
            <NavigationControl position="top-right" showCompass={false} />
            <Source id="region-geometry" type="geojson" data={geojsonData}>
              <Layer
                id="region-fill"
                type="fill"
                paint={{
                  'fill-color': selectedRegion?.color || '#3388ff',
                  'fill-opacity': 0.35,
                }}
              />
              <Layer
                id="region-line"
                type="line"
                paint={{
                  'line-color': selectedRegion?.color || '#3388ff',
                  'line-width': crossesDateline ? 0 : 2,
                }}
              />
            </Source>
          </MapGL>

          {/* Overlay states on top of the always-mounted map */}
          {geometryLoading && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.7)', zIndex: 5 }}>
              <CircularProgress size={32} sx={{ color: P.accent.primary }} />
            </Box>
          )}
          {!selectedRegion && !geometryLoading && (
            <Box sx={{
              position: 'absolute', inset: 0,
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              bgcolor: P.light.bg,
              backgroundImage: 'radial-gradient(circle, rgba(78,205,196,0.06) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              zIndex: 5,
            }}>
              <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.9rem', color: P.light.textMuted }}>
                Select a region from the sidebar
              </Typography>
            </Box>
          )}
          {selectedRegion && !geometryLoading && geojsonData.features.length === 0 && (
            <Box sx={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
              bgcolor: P.light.bg,
              backgroundImage: 'radial-gradient(circle, rgba(78,205,196,0.06) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              zIndex: 5,
            }}>
              <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.85rem', color: P.light.textMuted, mb: 1 }}>
                No geometry computed yet
              </Typography>
              <Button size="small" variant="contained" onClick={handleComputeSingleRegion} disabled={isComputingSingleRegion}
                sx={{ textTransform: 'none', fontFamily: P.font.ui, bgcolor: P.accent.primary, '&:hover': { bgcolor: P.accent.primaryHover } }}>
                Compute Now
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {/* Custom Boundary Drawing Dialog */}
      <CustomBoundaryDialog
        open={customBoundaryDialogOpen}
        onClose={() => setCustomBoundaryDialogOpen(false)}
        onConfirm={handleBoundaryConfirm}
        sourceGeometries={stagedGeometries}
        focusBbox={selectedRegion?.focusBbox}
        title={`Redefine Boundaries for "${selectedRegion?.name || 'Region'}"`}
      />

      {/* Hull Editor Dialog (hull regions only) */}
      {selectedRegion && (
        <HullEditorDialog
          open={hullEditorOpen}
          onClose={() => setHullEditorOpen(false)}
          regionId={selectedRegion.id}
          focusBbox={selectedRegion.focusBbox}
          anchorPoint={selectedRegion.anchorPoint}
          onSaved={() => onInvalidateQueries({ regionGeometryId: selectedRegion.id, regions: true })}
        />
      )}
    </>
  );
}
