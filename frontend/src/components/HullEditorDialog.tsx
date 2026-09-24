import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Slider,
  CircularProgress,
  Chip,
  Alert,
} from '@mui/material';
import { Source, Layer, NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import { GuardedMap as MapGL } from './shared/GuardedMap';
import { MAP_STYLE } from '../constants/mapStyles';
import { frameGeoJson, smartFitBounds } from '../utils/mapUtils';
import {
  fetchRegionGeometry,
  fetchSavedHullParams,
  previewHull,
  saveHull,
  DEFAULT_HULL_PARAMS,
} from '../api';
import type { HullParams } from '../api';
import type { AnchorPoint, FocusBbox, RegionGeometry } from '../api/regions';

/**
 * The saved hull, or null where the region has none: asked for the hull, the
 * read answers the outline instead and says so (`displayMode: 'real'`), and
 * that outline is not a hull to draw.
 */
function savedHullOf(answer: RegionGeometry | null): GeoJSON.Geometry | null {
  return answer?.properties.displayMode === 'hull' ? answer.geometry : null;
}

interface HullEditorDialogProps {
  open: boolean;
  onClose: () => void;
  regionId: number;
  focusBbox?: FocusBbox | null;
  anchorPoint?: AnchorPoint | null;
  onSaved: () => void;
}

export function HullEditorDialog({
  open,
  onClose,
  regionId,
  focusBbox,
  anchorPoint,
  onSaved,
}: HullEditorDialogProps) {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Geometry data
  const [realGeometry, setRealGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [savedHullGeometry, setSavedHullGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [loading, setLoading] = useState(false);

  // Hull params + preview
  const [hullParams, setHullParams] = useState<HullParams>(DEFAULT_HULL_PARAMS);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Whether the saved parameters are known. Until they are, Preview and Save
  // stay off: the sliders would show the defaults as if they were the
  // region's own, and saving would write them over a tuned hull (#1013).
  const [paramsState, setParamsState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [paramsAttempt, setParamsAttempt] = useState(0);
  // The region the loaded parameters belong to. The dialog stays mounted
  // while the editor moves between regions, and the reset below runs after
  // the first render for a new one; until then the old region's settings are
  // still in state, and must not be previewed or saved for this one.
  const [paramsLoadedFor, setParamsLoadedFor] = useState<number | null>(null);
  const paramsReady = paramsState === 'loaded' && paramsLoadedFor === regionId;

  // Fetch geometries + saved params on open
  useEffect(() => {
    if (!open) return;

    // Reset state
    setRealGeometry(null);
    setSavedHullGeometry(null);
    setPreviewGeometry(null);
    setHullParams(DEFAULT_HULL_PARAMS);
    setIsPreviewing(false);
    setIsSaving(false);
    setSaveSuccess(false);
    setMapLoaded(false);
    setLoading(true);

    let cancelled = false;

    Promise.all([
      fetchRegionGeometry(regionId),
      fetchRegionGeometry(regionId, 'hull'),
    ]).then(([realGeom, hullGeom]) => {
      if (cancelled) return;
      setRealGeometry(realGeom?.geometry ?? null);
      setSavedHullGeometry(savedHullOf(hullGeom));
    }).catch((e) => {
      console.error('Failed to load hull editor data:', e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [open, regionId]);

  // The saved parameters, read apart from the geometries so a failed read can
  // be retried on its own without redrawing the map.
  useEffect(() => {
    if (!open) return;
    setParamsState('loading');
    let cancelled = false;
    fetchSavedHullParams(regionId).then((savedParams) => {
      if (cancelled) return;
      setHullParams(savedParams ?? DEFAULT_HULL_PARAMS);
      setParamsLoadedFor(regionId);
      setParamsState('loaded');
    }).catch((e) => {
      if (cancelled) return;
      console.error('Failed to load saved hull parameters:', e);
      setParamsState('failed');
    });
    return () => { cancelled = true; };
  }, [open, regionId, paramsAttempt]);

  // Fit map to geometry when loaded
  useEffect(() => {
    if (!open || !mapLoaded || !mapRef.current) return;
    const geom = realGeometry || savedHullGeometry;
    if (!geom) return;

    const timer = setTimeout(() => {
      try {
        if (focusBbox) {
          smartFitBounds(mapRef.current!, focusBbox, {
            padding: 50, duration: 500, anchorPoint: anchorPoint ?? undefined,
          });
        } else {
          // A region's own shape, framed like its stored box would be: floor 1.
          frameGeoJson(mapRef.current, geom, { padding: 50, duration: 500, minZoom: 1 });
        }
      } catch (e) {
        console.error('Failed to fit bounds:', e);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [open, mapLoaded, realGeometry, savedHullGeometry, focusBbox, anchorPoint]);

  const handlePreview = useCallback(async () => {
    setIsPreviewing(true);
    setSaveSuccess(false);
    try {
      const result = await previewHull(regionId, hullParams);
      if (result.geometry) {
        setPreviewGeometry(result.geometry);
      }
    } catch (e) {
      console.error('Failed to preview hull:', e);
    } finally {
      setIsPreviewing(false);
    }
  }, [regionId, hullParams]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveHull(regionId, hullParams);
      setSaveSuccess(true);
      setPreviewGeometry(null);
      // Refetch hull to show the newly saved one
      setSavedHullGeometry(savedHullOf(await fetchRegionGeometry(regionId, 'hull')));
      onSaved();
    } catch (e) {
      console.error('Failed to save hull:', e);
    } finally {
      setIsSaving(false);
    }
  }, [regionId, hullParams, onSaved]);

  const handleReset = useCallback(() => {
    setHullParams(DEFAULT_HULL_PARAMS);
    setPreviewGeometry(null);
    setSaveSuccess(false);
  }, []);

  // Determine which hull to display: preview takes priority, then saved hull
  const displayHull = previewGeometry || savedHullGeometry;
  const isPreviewActive = !!previewGeometry;

  // GeoJSON data for map layers
  const realGeoJSON: GeoJSON.FeatureCollection = realGeometry
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: realGeometry }] }
    : { type: 'FeatureCollection', features: [] };

  const hullGeoJSON: GeoJSON.FeatureCollection = displayHull
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: displayHull }] }
    : { type: 'FeatureCollection', features: [] };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Hull Envelope</DialogTitle>
      <DialogContent>
        {/* Map */}
        <Box sx={{ height: 400, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 2, position: 'relative' }}>
          {loading && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.7)', zIndex: 5 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          <MapGL
            ref={mapRef}
            initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={MAP_STYLE}
            onLoad={() => setMapLoaded(true)}
            dragRotate={false}
          >
            <NavigationControl position="top-right" showCompass={false} />

            {/* Real geometry — blue semi-transparent fill + solid outline */}
            <Source id="real-geometry" type="geojson" data={realGeoJSON}>
              <Layer
                id="real-fill"
                type="fill"
                paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.2 }}
              />
              <Layer
                id="real-outline"
                type="line"
                paint={{ 'line-color': '#3388ff', 'line-width': 1.5 }}
              />
            </Source>

            {/* Hull — dashed outline: orange for saved, green for preview */}
            <Source id="hull-geometry" type="geojson" data={hullGeoJSON}>
              <Layer
                id="hull-fill"
                type="fill"
                paint={{
                  'fill-color': isPreviewActive ? '#4caf50' : '#ff9800',
                  'fill-opacity': 0.08,
                }}
              />
              <Layer
                id="hull-outline"
                type="line"
                paint={{
                  'line-color': isPreviewActive ? '#4caf50' : '#ff9800',
                  'line-width': 2,
                  'line-dasharray': [4, 2],
                }}
              />
            </Source>
          </MapGL>
        </Box>

        {/* Hull parameter sliders */}
        <Box sx={{ px: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Typography variant="subtitle2">Hull Parameters</Typography>
            {isPreviewActive && <Chip size="small" label="Preview active" color="success" />}
            {saveSuccess && <Chip size="small" label="Saved" color="info" />}
          </Box>

          {paramsState === 'failed' && (
            <Alert
              severity="warning"
              sx={{ mb: 1.5 }}
              action={<Button color="inherit" size="small" onClick={() => setParamsAttempt(n => n + 1)}>Retry</Button>}
            >
              This region's saved hull settings could not be loaded. Preview and Save stay off until they are,
              so the defaults shown here cannot replace settings nobody has seen.
            </Alert>
          )}

          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Buffer: {hullParams.bufferKm} km
            </Typography>
            <Slider
              size="small"
              value={Math.log10(hullParams.bufferKm)}
              onChange={(_, value) => {
                const linearValue = Math.round(Math.pow(10, value as number));
                setHullParams(prev => ({ ...prev, bufferKm: linearValue }));
              }}
              min={Math.log10(2)}
              max={Math.log10(1000)}
              step={0.01}
              marks={[
                { value: Math.log10(2), label: '2' },
                { value: Math.log10(10), label: '10' },
                { value: Math.log10(50), label: '50' },
                { value: Math.log10(200), label: '200' },
                { value: Math.log10(1000), label: '1000' },
              ]}
            />
          </Box>

          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Concavity: {hullParams.concavity.toFixed(2)} (higher = looser)
            </Typography>
            <Slider
              size="small"
              value={hullParams.concavity}
              onChange={(_, value) => setHullParams(prev => ({ ...prev, concavity: value as number }))}
              min={0.1}
              max={2}
              step={0.1}
              marks={[
                { value: 0.1, label: '0.1' },
                { value: 1, label: '1' },
                { value: 2, label: '2' },
              ]}
            />
          </Box>

          <Box sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Simplify: {hullParams.simplifyTolerance.toFixed(3)}&deg;
            </Typography>
            <Slider
              size="small"
              value={hullParams.simplifyTolerance}
              onChange={(_, value) => setHullParams(prev => ({ ...prev, simplifyTolerance: value as number }))}
              min={0.001}
              max={0.1}
              step={0.005}
              marks={[
                { value: 0.001, label: '0.001' },
                { value: 0.05, label: '0.05' },
                { value: 0.1, label: '0.1' },
              ]}
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              onClick={handlePreview}
              disabled={isPreviewing || isSaving || !paramsReady}
              startIcon={isPreviewing ? <CircularProgress size={14} /> : null}
            >
              {isPreviewing ? 'Previewing...' : 'Preview'}
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={handleSave}
              // No preview can exist before the parameters load, so the last
              // term only matters if a preview ever outlives a failed read;
              // it keeps "never save settings nobody loaded" true then too.
              disabled={isPreviewing || isSaving || !previewGeometry || !paramsReady}
              startIcon={isSaving ? <CircularProgress size={14} /> : null}
            >
              {isSaving ? 'Saving...' : 'Save Hull'}
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={handleReset}
            >
              Reset
            </Button>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
