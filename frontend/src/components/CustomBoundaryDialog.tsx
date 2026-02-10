import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Alert,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteIcon from '@mui/icons-material/Delete';
import MapGL, { Source, Layer, NavigationControl, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { MAP_STYLE } from '../constants/mapStyles';
import { smartFitBounds } from '../utils/mapUtils';

interface CustomBoundaryDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (customGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) => void;
  sourceGeometries: GeoJSON.FeatureCollection | null;
  /** Pre-computed focusBbox for proper antimeridian handling */
  focusBbox?: [number, number, number, number] | null;
  title?: string;
}

export function CustomBoundaryDialog({
  open,
  onClose,
  onConfirm,
  sourceGeometries,
  focusBbox,
  title = 'Redefine Boundaries',
}: CustomBoundaryDialogProps) {
  const mapRef = useRef<MapRef>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [resultGeometry, setResultGeometry] = useState<GeoJSON.Feature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Step state: 'draw' or 'review'
  const [step, setStep] = useState<'draw' | 'review'>('draw');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setDrawingPoints([]);
      setResultGeometry(null);
      setError(null);
      setMapLoaded(false);
      setStep('draw');
    }
  }, [open]);

  // Fit map to source geometries — prefer focusBbox (handles antimeridian correctly)
  useEffect(() => {
    if (open && mapLoaded && sourceGeometries?.features && sourceGeometries.features.length > 0 && mapRef.current) {
      const timer = setTimeout(() => {
        try {
          if (focusBbox) {
            smartFitBounds(mapRef.current!, focusBbox, { padding: 50, duration: 500 });
          } else {
            const geojson = sourceGeometries as GeoJSON.FeatureCollection;
            const bbox = turf.bbox(geojson) as [number, number, number, number];
            smartFitBounds(mapRef.current!, bbox, { padding: 50, duration: 500, geojson });
          }
        } catch (e) {
          console.error('Failed to fit bounds:', e);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, mapLoaded, sourceGeometries, focusBbox]);

  // Handle map click — only during draw step
  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    if (step !== 'draw') return;
    const { lng, lat } = event.lngLat;
    setDrawingPoints(prev => [...prev, [lng, lat]]);
    setError(null);
  }, [step]);

  const handleUndo = useCallback(() => {
    setDrawingPoints(prev => prev.slice(0, -1));
    setResultGeometry(null);
  }, []);

  const handleClear = useCallback(() => {
    setDrawingPoints([]);
    setResultGeometry(null);
    setError(null);
  }, []);

  // Clip boundary — intersect drawn polygon with source geometries
  const handleClipBoundary = useCallback(() => {
    if (drawingPoints.length < 3) {
      setError('Draw at least 3 points to create a polygon');
      return;
    }

    if (!sourceGeometries?.features?.length) {
      setError('No source geometries to intersect with');
      return;
    }

    try {
      const drawnPolygon = turf.polygon([[...drawingPoints, drawingPoints[0]]]);
      const intersections: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[] = [];

      for (const feature of sourceGeometries.features) {
        if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
          try {
            const featureCollection = turf.featureCollection([
              drawnPolygon,
              feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
            ]) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
            const intersection = turf.intersect(featureCollection);
            if (intersection) {
              intersections.push(intersection as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
            }
          } catch (e) {
            console.warn('Intersection failed for feature:', e);
          }
        }
      }

      if (intersections.length === 0) {
        setError('No intersection found. Make sure your polygon overlaps with the source regions.');
        return;
      }

      let result: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> = intersections[0];
      for (let i = 1; i < intersections.length; i++) {
        try {
          const fc = turf.featureCollection([result, intersections[i]]) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
          const unioned = turf.union(fc);
          if (unioned) {
            result = unioned as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
          }
        } catch (e) {
          console.warn('Union failed:', e);
        }
      }

      setResultGeometry(result);
      setError(null);
      setStep('review');
    } catch (e) {
      console.error('Failed to create polygon:', e);
      setError('Failed to create polygon. Try drawing a simpler shape.');
    }
  }, [drawingPoints, sourceGeometries]);

  // Go back to drawing step
  const handleBackToDraw = useCallback(() => {
    setStep('draw');
    setResultGeometry(null);
  }, []);

  // Confirm and return the geometry
  const handleConfirm = useCallback(() => {
    if (resultGeometry?.geometry) {
      onConfirm(resultGeometry.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
    }
  }, [resultGeometry, onConfirm]);

  // GeoJSON for drawing preview
  const drawingGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      ...(drawingPoints.length >= 2 ? [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: drawingPoints,
        },
      }] : []),
      ...(drawingPoints.length >= 3 ? [{
        type: 'Feature' as const,
        properties: { closing: true },
        geometry: {
          type: 'LineString' as const,
          coordinates: [drawingPoints[drawingPoints.length - 1], drawingPoints[0]],
        },
      }] : []),
      ...drawingPoints.map((coord, idx) => ({
        type: 'Feature' as const,
        properties: { index: idx },
        geometry: {
          type: 'Point' as const,
          coordinates: coord,
        },
      })),
    ],
  };

  const resultGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: resultGeometry ? [resultGeometry] : [],
  };

  const activeStep = step === 'draw' ? 0 : 1;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {/* Step indicator */}
        <Stepper activeStep={activeStep} sx={{ mb: 2 }}>
          <Step completed={activeStep > 0}>
            <StepLabel>Draw</StepLabel>
          </Step>
          <Step completed={false}>
            <StepLabel>Review</StepLabel>
          </Step>
        </Stepper>

        <Box sx={{ mb: 2 }}>
          {step === 'draw' && (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              <Typography variant="body2">
                Click on the map to draw a polygon around the area you want to keep, then click <strong>Clip Boundary</strong>.
                Drag to pan the map.
              </Typography>
            </Alert>
          )}

          {step === 'review' && (
            <Alert severity="success" sx={{ mb: 1.5 }}>
              <Typography variant="body2">
                <strong>Boundary clipped.</strong> Review the result below. Click <strong>Use This Boundary</strong> to save, or go back to redraw.
              </Typography>
            </Alert>
          )}

          {/* Toolbar */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
            {step === 'draw' && (
              <>
                <Tooltip title="Undo last point">
                  <span>
                    <IconButton
                      onClick={handleUndo}
                      disabled={drawingPoints.length === 0}
                      size="small"
                    >
                      <UndoIcon />
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title="Clear all points">
                  <span>
                    <IconButton
                      onClick={handleClear}
                      disabled={drawingPoints.length === 0}
                      size="small"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </span>
                </Tooltip>

                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleClipBoundary}
                  disabled={drawingPoints.length < 3}
                >
                  Clip Boundary ({drawingPoints.length} points)
                </Button>

                {drawingPoints.length > 0 && drawingPoints.length < 3 && (
                  <Typography variant="caption" color="text.secondary">
                    Need {3 - drawingPoints.length} more point{3 - drawingPoints.length !== 1 ? 's' : ''}
                  </Typography>
                )}
              </>
            )}

            {step === 'review' && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleBackToDraw}
              >
                Back to Drawing
              </Button>
            )}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
        </Box>

        {/* Map */}
        <Box sx={{ height: 500, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <MapGL
            ref={mapRef}
            initialViewState={{
              longitude: 0,
              latitude: 20,
              zoom: 2,
            }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={MAP_STYLE}
            onClick={handleMapClick}
            onLoad={() => setMapLoaded(true)}
            cursor={step === 'draw' ? 'crosshair' : 'grab'}
            dragRotate={false}
          >
            <NavigationControl position="top-right" showCompass={false} />

            {/* Source geometries — always visible as semi-transparent blue */}
            {sourceGeometries && (
              <Source id="source-regions" type="geojson" data={sourceGeometries}>
                <Layer
                  id="source-fill"
                  type="fill"
                  paint={{
                    'fill-color': '#3388ff',
                    'fill-opacity': 0.2,
                  }}
                />
                <Layer
                  id="source-outline"
                  type="line"
                  paint={{
                    'line-color': '#3388ff',
                    'line-width': 1.5,
                  }}
                />
              </Source>
            )}

            {/* Drawing preview */}
            <Source id="drawing" type="geojson" data={drawingGeoJSON}>
              <Layer
                id="drawing-line"
                type="line"
                filter={['!', ['has', 'closing']]}
                paint={{
                  'line-color': '#ff6b6b',
                  'line-width': 2,
                }}
              />
              <Layer
                id="drawing-closing-line"
                type="line"
                filter={['has', 'closing']}
                paint={{
                  'line-color': '#ff6b6b',
                  'line-width': 2,
                  'line-dasharray': [2, 2],
                }}
              />
              <Layer
                id="drawing-points"
                type="circle"
                filter={['==', '$type', 'Point']}
                paint={{
                  'circle-radius': 6,
                  'circle-color': '#ff6b6b',
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#fff',
                }}
              />
            </Source>

            {/* Result geometry */}
            {resultGeometry && (
              <Source id="result" type="geojson" data={resultGeoJSON}>
                <Layer
                  id="result-fill"
                  type="fill"
                  paint={{
                    'fill-color': '#22c55e',
                    'fill-opacity': 0.5,
                  }}
                />
                <Layer
                  id="result-outline"
                  type="line"
                  paint={{
                    'line-color': '#16a34a',
                    'line-width': 3,
                  }}
                />
              </Source>
            )}
          </MapGL>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!resultGeometry}
        >
          Use This Boundary
        </Button>
      </DialogActions>
    </Dialog>
  );
}
