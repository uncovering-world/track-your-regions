import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Alert,
  Tooltip,
  FormControlLabel,
  Checkbox,
  LinearProgress,
  Typography,
} from '@mui/material';
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
  type ComputeProgressEvent,
} from '../../../api';
import type { Region, WorldView } from '../../../types';
import type { DisplayMode } from '../types';
import { useComputationStatus } from '../hooks';
import { CustomBoundaryDialog } from '../../CustomBoundaryDialog';
import { HullEditorDialog } from '../../HullEditorDialog';
import { useAppTheme } from '../../../theme';
import {
  ActionToolbar,
  BatchProgressSection,
  MapStateOverlay,
  type ToolbarStyles,
} from './GeometryMapPanelParts';

/**
 * Resolve which geometry to stage when entering the "redefine boundaries"
 * flow. Returns null when no geometry is available (caller alerts).
 */
interface ComputedRegionPatch {
  usesHull?: boolean;
  focusBbox?: [number, number, number, number] | null;
  anchorPoint?: [number, number] | null;
}

async function runSingleRegionCompute(
  regionId: number,
  forceRecompute: boolean,
  skipSnapping: boolean,
  onEvent: (event: ComputeProgressEvent) => void,
): Promise<ComputedRegionPatch | undefined> {
  const result = await computeRegionGeometryWithProgress(
    regionId, forceRecompute, onEvent, skipSnapping,
  );
  return result.data as ComputedRegionPatch | undefined;
}

function mergeComputedRegion(region: Region, data: ComputedRegionPatch): Region {
  return {
    ...region,
    isCustomBoundary: false,
    ...(data.usesHull !== undefined && { usesHull: data.usesHull }),
    ...(data.focusBbox !== undefined && { focusBbox: data.focusBbox }),
    ...(data.anchorPoint !== undefined && { anchorPoint: data.anchorPoint }),
  };
}

async function pickStagedGeometriesForRedefine(
  selectedRegion: Region,
  selectedRegionGeometry: unknown,
): Promise<GeoJSON.FeatureCollection | null> {
  if (selectedRegion.isCustomBoundary && selectedRegionGeometry) {
    return { type: 'FeatureCollection', features: [selectedRegionGeometry as GeoJSON.Feature] };
  }
  const memberGeomsFC = await fetchRegionMemberGeometries(selectedRegion.id);
  if (memberGeomsFC && memberGeomsFC.features.length > 0) return memberGeomsFC;
  if (selectedRegionGeometry) {
    return { type: 'FeatureCollection', features: [selectedRegionGeometry as GeoJSON.Feature] };
  }
  return null;
}

interface ComputeProgressBarProps {
  logs: ComputeProgressEvent[];
  borderColor: string;
  uiFont: string;
  monoFont: string;
  mutedColor: string;
}

function pickProgressMeta(logs: ComputeProgressEvent[]) {
  const lastLog = logs[logs.length - 1];
  const elapsed = lastLog?.elapsed || 0;
  const stepMatch = lastLog?.step?.match(/Step (\d+)\/(\d+)/);
  const current = stepMatch ? parseInt(stepMatch[1]) : 0;
  const total = stepMatch ? parseInt(stepMatch[2]) : 6;
  const remaining = current > 0 ? Math.max(0, ((elapsed / current) * total) - elapsed) : 0;
  const step = lastLog?.step?.replace(/\(\d+\.\d+s\)/, '').trim() || 'Processing...';
  return { step, elapsed, current, total, remaining };
}

function ComputeProgressBar({ logs, borderColor, uiFont, monoFont, mutedColor }: ComputeProgressBarProps) {
  const { step, elapsed, current, total, remaining } = pickProgressMeta(logs);
  const progress = total > 0 ? (current / total) * 100 : 0;
  return (
    <Box sx={{ px: 2, py: 0.75, bgcolor: '#f0f7f6', borderBottom: `1px solid ${borderColor}`, flexShrink: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontFamily: uiFont, fontSize: '0.7rem', color: mutedColor }}>
          {step}
        </Typography>
        <Typography sx={{ fontFamily: monoFont, fontSize: '0.65rem', color: mutedColor }}>
          {elapsed.toFixed(0)}s {remaining > 0 && `(~${remaining.toFixed(0)}s left)`}
        </Typography>
      </Box>
      <LinearProgress variant="determinate" value={Math.min(progress, 100)} sx={{ height: 4, borderRadius: 1 }} />
    </Box>
  );
}

interface ComputeProgressOutcomeProps {
  logs: ComputeProgressEvent[];
  onDismiss: () => void;
}

interface ComputeCompleteData { points?: number; numPolygons?: number; numHoles?: number }

function ComputeProgressOutcome({ logs, onDismiss }: ComputeProgressOutcomeProps) {
  const lastLog = logs[logs.length - 1];
  if (lastLog?.type === 'error') {
    return (
      <Alert severity="error" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={onDismiss}>
        {lastLog.message || 'Computation failed'}
      </Alert>
    );
  }
  if (lastLog?.type === 'complete') {
    const data = lastLog.data as ComputeCompleteData | undefined;
    return (
      <Alert severity="success" sx={{ mx: 2, my: 0.5, py: 0 }} onClose={onDismiss}>
        Done in {lastLog.elapsed?.toFixed(1)}s
        {data?.points && ` | ${data.points.toLocaleString()} pts`}
        {data?.numPolygons && ` | ${data.numPolygons} polys`}
      </Alert>
    );
  }
  return null;
}

function fitMapToRegion(
  map: MapRef,
  region: Region,
  geometryFeature: unknown,
  isNewRegion: boolean,
): void {
  const duration = isNewRegion ? 500 : 300;
  // Pre-computed focusBbox correctly handles antimeridian crossing.
  if (region.focusBbox) {
    smartFitBounds(map, region.focusBbox, {
      padding: 50,
      duration,
      anchorPoint: region.anchorPoint,
    });
    return;
  }
  try {
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [geometryFeature as unknown as GeoJSON.Feature],
    };
    const bbox = turf.bbox(geojson) as [number, number, number, number];
    smartFitBounds(map, bbox, { padding: 50, duration, geojson });
  } catch (e) {
    console.error('Failed to fit bounds:', e);
  }
}

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

  const geometryFlavor = displayMode === 'real' ? undefined : 'hull';
  const { data: selectedRegionGeometry, isLoading: geometryLoading } = useQuery({
    queryKey: ['regionGeometry', selectedRegion?.id, displayMode],
    queryFn: () => selectedRegion
      ? fetchRegionGeometry(selectedRegion.id, geometryFlavor)
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
    fitMapToRegion(mapRef.current, selectedRegion, selectedRegionGeometry, isNewRegion);
  }, [selectedRegionGeometry, selectedRegion, displayMode, mapLoaded]);

  useEffect(() => {
    if (open) {
      fetchDisplayGeometryStatus(worldView.id)
        .then((status) => setDisplayGeomStatus(status))
        .catch(() => setDisplayGeomStatus(null));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only refetch when dialog opens or world view changes; setDisplayGeomStatus is stable
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- regions.length is the relevant trigger (we display "Starting... 0/N"); the regions array reference itself changes too often
  }, [worldView.id, regions.length, skipSnapping]);

  const handleCancelComputation = useCallback(async () => {
    try { await cancelWorldViewGeometryComputation(worldView.id); } catch (e) { console.error('Failed to cancel:', e); }
  }, [worldView.id]);

  const handleComputeSingleRegion = useCallback(async () => {
    if (!selectedRegion) return;
    setIsComputingSingleRegion(true);
    setComputeProgressLogs([]);
    try {
      const data = await runSingleRegionCompute(
        selectedRegion.id,
        forceRecompute,
        skipSnapping,
        event => setComputeProgressLogs(prev => [...prev, event]),
      );
      if (data) onSelectedRegionChange(mergeComputedRegion(selectedRegion, data));
      onInvalidateQueries({ regionGeometryId: selectedRegion.id, regions: true });
    } catch (e) {
      console.error('Failed to compute:', e);
    } finally {
      setIsComputingSingleRegion(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setComputeProgressLogs/setIsComputingSingleRegion setters are stable; deps listed are the actual trigger inputs
  }, [selectedRegion, forceRecompute, skipSnapping, onSelectedRegionChange, onInvalidateQueries]);

  const handleRedefineBoundaries = useCallback(async () => {
    if (!selectedRegion) return;
    const staged = await pickStagedGeometriesForRedefine(selectedRegion, selectedRegionGeometry);
    if (staged === null) {
      alert('No geometries available.');
      return;
    }
    setStagedGeometries(staged);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setIsResettingToGADM setter is stable; deps listed are the actual trigger inputs
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

  const toolbarStyles: ToolbarStyles = {
    surface: P.light.surface,
    border: P.light.border,
    text: P.light.text,
    textMuted: P.light.textMuted,
    primary: P.accent.primary,
    uiFont: P.font.ui,
    monoFont: P.font.mono,
  };

  const fillColor = selectedRegion?.color || '#3388ff';
  const lineWidth = crossesDateline ? 0 : 2;

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        <ActionToolbar
          selectedRegion={selectedRegion}
          displayMode={displayMode}
          showOptions={showOptions}
          isComputing={isComputing}
          isComputingSingleRegion={isComputingSingleRegion}
          isResettingToGADM={isResettingToGADM}
          regionsCount={regions.length}
          geojsonHasFeatures={geojsonData.features.length > 0}
          toolBtnSx={toolBtnSx}
          styles={toolbarStyles}
          onToggleHull={onToggleHull}
          onComputeSingleRegion={handleComputeSingleRegion}
          onRedefineBoundaries={handleRedefineBoundaries}
          onResetToGADM={handleResetToGADM}
          onSetDisplayMode={setDisplayMode}
          onSetShowOptions={setShowOptions}
          onOpenHullEditor={() => setHullEditorOpen(true)}
          onStartComputation={handleStartComputation}
          onCancelComputation={handleCancelComputation}
        />

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

        {isComputingSingleRegion && computeProgressLogs.length > 0 && (
          <ComputeProgressBar
            logs={computeProgressLogs}
            borderColor={P.light.border}
            uiFont={P.font.ui}
            monoFont={P.font.mono}
            mutedColor={P.light.textMuted}
          />
        )}

        {!isComputingSingleRegion && computeProgressLogs.length > 0 && (
          <ComputeProgressOutcome
            logs={computeProgressLogs}
            onDismiss={() => setComputeProgressLogs([])}
          />
        )}

        <BatchProgressSection
          isComputing={isComputing}
          computationStatus={computationStatus}
          borderColor={P.light.border}
          uiFont={P.font.ui}
          monoFont={P.font.mono}
          mutedColor={P.light.textMuted}
          onClearStatus={() => setComputationStatus(null)}
        />

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
                paint={{ 'fill-color': fillColor, 'fill-opacity': 0.35 }}
              />
              <Layer
                id="region-line"
                type="line"
                paint={{ 'line-color': fillColor, 'line-width': lineWidth }}
              />
            </Source>
          </MapGL>
          <MapStateOverlay
            selectedRegion={selectedRegion}
            geometryLoading={geometryLoading}
            geojsonHasFeatures={geojsonData.features.length > 0}
            isComputingSingleRegion={isComputingSingleRegion}
            uiFont={P.font.ui}
            bgColor={P.light.bg}
            mutedColor={P.light.textMuted}
            primaryColor={P.accent.primary}
            primaryHover={P.accent.primaryHover}
            onComputeSingleRegion={handleComputeSingleRegion}
          />
        </Box>
      </Box>

      <CustomBoundaryDialog
        open={customBoundaryDialogOpen}
        onClose={() => setCustomBoundaryDialogOpen(false)}
        onConfirm={handleBoundaryConfirm}
        sourceGeometries={stagedGeometries}
        focusBbox={selectedRegion?.focusBbox}
        title={`Redefine Boundaries for "${selectedRegion?.name || 'Region'}"`}
      />

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
