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
} from '@mui/material';
import MapGL, { Source, Layer, NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { MAP_STYLE } from '../constants/mapStyles';
import { smartFitBounds } from '../utils/mapUtils';
import {
  fetchRegionGeometry,
  fetchSavedHullParams,
  previewHull,
  saveHull,
  DEFAULT_HULL_PARAMS,
} from '../api';
import type { HullParams } from '../api';

interface HullEditorDialogProps {
  open: boolean;
  onClose: () => void;
  regionId: number;
  focusBbox?: [number, number, number, number] | null;
  anchorPoint?: [number, number] | null;
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
      fetchRegionGeometry(regionId, 'ts_hull'),
      fetchSavedHullParams(regionId),
    ]).then(([realGeom, hullGeom, savedParams]) => {
      if (cancelled) return;
      setRealGeometry(realGeom?.geometry as GeoJSON.Geometry ?? null);
      setSavedHullGeometry(hullGeom?.geometry as GeoJSON.Geometry ?? null);
      if (savedParams) setHullParams(savedParams);
    }).catch((e) => {
      console.error('Failed to load hull editor data:', e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [open, regionId]);

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
          const fc: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: geom }],
          };
          const bbox = turf.bbox(fc) as [number, number, number, number];
          smartFitBounds(mapRef.current!, bbox, { padding: 50, duration: 500, geojson: fc });
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
      const hullGeom = await fetchRegionGeometry(regionId, 'ts_hull');
      setSavedHullGeometry(hullGeom?.geometry as GeoJSON.Geometry ?? null);
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
              disabled={isPreviewing || isSaving}
              startIcon={isPreviewing ? <CircularProgress size={14} /> : null}
            >
              {isPreviewing ? 'Previewing...' : 'Preview'}
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={handleSave}
              disabled={isPreviewing || isSaving || !previewGeometry}
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
