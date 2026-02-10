import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  IconButton,
  Tooltip,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Paper,
  Chip,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteIcon from '@mui/icons-material/Delete';
import DrawIcon from '@mui/icons-material/Draw';
import PanToolIcon from '@mui/icons-material/PanTool';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import CheckIcon from '@mui/icons-material/Check';
import MapGL, { Source, Layer, NavigationControl, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { MAP_STYLE } from '../../../../constants/mapStyles';
import { smartFitBounds } from '../../../../utils/mapUtils';
import type { ImageOverlaySettings } from './CustomSubdivisionDialog/ImageOverlayDialog';
import {
  splitPolygonWithLine,
  doesLineCrossPolygon,
  intersectPolygonWithSource,
  calculateRemainingGeometry,
  isSinglePolygon,
  type CutPart,
} from './polygonCutUtils';

// Re-export CutPart for external use
export type { CutPart } from './polygonCutUtils';

type DrawMode = 'pan' | 'slice' | 'polygon';

interface SlicedParts {
  part1: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  part2: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
}

interface CutDivisionDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when user confirms with one or more cut parts */
  onConfirm: (cutParts: CutPart[]) => void;
  /** The source division geometry to cut from */
  divisionGeometry: GeoJSON.FeatureCollection | null;
  /** Name of the division being cut */
  divisionName: string;
  /** Optional background image overlay settings */
  imageOverlaySettings?: ImageOverlaySettings | null;
}

/**
 * Dialog for cutting pieces from a division.
 *
 * Two modes:
 * 1. **Slice mode** (default for single polygons): Draw a line from edge to edge,
 *    automatically splits the polygon and lets you choose which piece to keep.
 * 2. **Polygon mode**: Draw a closed polygon to cut out a specific area.
 */
export function CutDivisionDialog({
  open,
  onClose,
  onConfirm,
  divisionGeometry,
  divisionName,
  imageOverlaySettings,
}: CutDivisionDialogProps) {
  const mapRef = useRef<MapRef>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Cut parts list - multiple pieces can be cut
  const [cutParts, setCutParts] = useState<CutPart[]>([]);
  const [currentPartName, setCurrentPartName] = useState('');

  // Slice mode state - when a line splits the polygon into 2 parts
  const [slicedParts, setSlicedParts] = useState<SlicedParts | null>(null);
  const [selectedSlicePart, setSelectedSlicePart] = useState<1 | 2 | null>(null);

  // Polygon mode result
  const [resultGeometry, setResultGeometry] = useState<GeoJSON.Feature | null>(null);

  // Check if source is a single polygon (determines default mode)
  const sourceFeature = divisionGeometry?.features?.[0] as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | undefined;
  const canUseSliceMode = sourceFeature ? isSinglePolygon(sourceFeature) : false;

  // Mode: slice (simple line cut) or polygon (draw closed shape)
  const [mode, setMode] = useState<DrawMode>(canUseSliceMode ? 'slice' : 'polygon');

  // Calculate remaining geometry (original minus all cut parts)
  const remaining = sourceFeature ? calculateRemainingGeometry(sourceFeature, cutParts) : null;
  const remainingArea = remaining?.geometry ? turf.area(remaining) : 0;
  const hasRemainingArea = remainingArea > 1000;

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setDrawingPoints([]);
      setResultGeometry(null);
      setSlicedParts(null);
      setSelectedSlicePart(null);
      setError(null);
      setMapLoaded(false);
      setCutParts([]);
      setCurrentPartName(`${divisionName} - Part 1`);
      // Default to slice mode for single polygons
      setMode(canUseSliceMode ? 'slice' : 'polygon');
    }
  }, [open, divisionName, canUseSliceMode]);

  // Fit map to division geometry when map is loaded
  useEffect(() => {
    if (open && mapLoaded && divisionGeometry?.features && divisionGeometry.features.length > 0 && mapRef.current) {
      const timer = setTimeout(() => {
        try {
          const bbox = turf.bbox(divisionGeometry) as [number, number, number, number];
          smartFitBounds(mapRef.current!, bbox, { padding: 50, duration: 500, geojson: divisionGeometry });
        } catch (e) {
          console.error('Failed to fit bounds:', e);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, mapLoaded, divisionGeometry]);

  // Handle map click
  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    if (mode === 'pan') return;

    const { lng, lat } = event.lngLat;
    setDrawingPoints(prev => [...prev, [lng, lat]]);
    setError(null);
    setSlicedParts(null);
    setSelectedSlicePart(null);
    setResultGeometry(null);
  }, [mode]);

  // Undo last point
  const handleUndo = useCallback(() => {
    setDrawingPoints(prev => prev.slice(0, -1));
    setSlicedParts(null);
    setSelectedSlicePart(null);
    setResultGeometry(null);
  }, []);

  // Clear all points
  const handleClear = useCallback(() => {
    setDrawingPoints([]);
    setSlicedParts(null);
    setSelectedSlicePart(null);
    setResultGeometry(null);
    setError(null);
  }, []);

  // Try to slice the polygon when we have 2+ points in slice mode
  useEffect(() => {
    if (mode !== 'slice' || drawingPoints.length < 2 || !remaining) return;

    // Check if the line crosses the polygon
    if (doesLineCrossPolygon(remaining, drawingPoints)) {
      const result = splitPolygonWithLine(remaining, drawingPoints);
      if (result) {
        setSlicedParts(result);
        setError(null);
      }
    }
  }, [mode, drawingPoints, remaining]);

  // Complete polygon (for polygon mode)
  const handleCompletePolygon = useCallback(() => {
    if (drawingPoints.length < 3) {
      setError('Draw at least 3 points to create a polygon');
      return;
    }

    if (!remaining) {
      setError('No geometry to intersect with');
      return;
    }

    const result = intersectPolygonWithSource(drawingPoints, remaining);
    if (!result) {
      setError('No intersection found. Make sure your polygon overlaps with the division.');
      return;
    }

    setResultGeometry(result);
    setError(null);
  }, [drawingPoints, remaining]);

  // Add the selected slice part to cut parts
  const handleConfirmSlice = useCallback(() => {
    if (!slicedParts || !selectedSlicePart) return;

    const selectedGeometry = selectedSlicePart === 1 ? slicedParts.part1 : slicedParts.part2;
    const partName = currentPartName.trim() || `${divisionName} - Part ${cutParts.length + 1}`;

    setCutParts(prev => [...prev, {
      name: partName,
      geometry: selectedGeometry.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    }]);

    // Reset for next cut
    setDrawingPoints([]);
    setSlicedParts(null);
    setSelectedSlicePart(null);
    setCurrentPartName(`${divisionName} - Part ${cutParts.length + 2}`);
  }, [slicedParts, selectedSlicePart, currentPartName, divisionName, cutParts.length]);

  // Add polygon mode result as a cut part
  const handleAddPolygonPart = useCallback(() => {
    if (!resultGeometry?.geometry) return;

    const partName = currentPartName.trim() || `${divisionName} - Part ${cutParts.length + 1}`;
    setCutParts(prev => [...prev, {
      name: partName,
      geometry: resultGeometry.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    }]);

    setDrawingPoints([]);
    setResultGeometry(null);
    setCurrentPartName(`${divisionName} - Part ${cutParts.length + 2}`);
  }, [resultGeometry, currentPartName, divisionName, cutParts.length]);

  // Use remaining area as a part
  const handleUseRemaining = useCallback(() => {
    if (!remaining?.geometry) return;

    const partName = `${divisionName} - Part ${cutParts.length + 1} (remaining)`;
    setCutParts(prev => [...prev, {
      name: partName,
      geometry: remaining.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    }]);
  }, [remaining, divisionName, cutParts.length]);

  // Delete a cut part
  const handleDeletePart = useCallback((idx: number) => {
    setCutParts(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // Rename a cut part
  const handleRenamePart = useCallback((idx: number, newName: string) => {
    setCutParts(prev => prev.map((p, i) => i === idx ? { ...p, name: newName } : p));
  }, []);

  // GeoJSON for drawing preview
  const drawingGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      // Line for slice mode
      ...(drawingPoints.length >= 2 ? [{
        type: 'Feature' as const,
        properties: { isSliceLine: mode === 'slice' },
        geometry: {
          type: 'LineString' as const,
          coordinates: drawingPoints,
        },
      }] : []),
      // Closing line for polygon mode
      ...(mode === 'polygon' && drawingPoints.length >= 3 ? [{
        type: 'Feature' as const,
        properties: { closing: true },
        geometry: {
          type: 'LineString' as const,
          coordinates: [drawingPoints[drawingPoints.length - 1], drawingPoints[0]],
        },
      }] : []),
      // Points
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

  // GeoJSON for sliced parts preview
  const slicedPartsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: slicedParts ? [
      { ...slicedParts.part1, properties: { partNum: 1, selected: selectedSlicePart === 1 } },
      { ...slicedParts.part2, properties: { partNum: 2, selected: selectedSlicePart === 2 } },
    ] : [],
  };

  // GeoJSON for polygon mode result
  const resultGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: resultGeometry ? [resultGeometry] : [],
  };

  // GeoJSON for already cut parts
  const cutPartsGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: cutParts.map((part, idx) => ({
      type: 'Feature' as const,
      properties: { name: part.name, index: idx },
      geometry: part.geometry,
    })),
  };

  // GeoJSON for remaining geometry
  const remainingGeoJSON: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: remaining && !slicedParts ? [remaining] : [],
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        ✂️ Cut Division: {divisionName}
        <Typography variant="body2" color="text.secondary">
          {mode === 'slice'
            ? 'Draw a line from edge to edge to slice the region'
            : 'Draw a polygon to cut out a piece'}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          {/* Mode-specific instructions */}
          {mode === 'slice' ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              <Typography variant="body2">
                <strong>Slice mode:</strong> Click to draw a line across the region.
                When the line crosses from edge to edge, the region will split into two pieces.
                Then choose which piece to keep.
              </Typography>
            </Alert>
          ) : mode === 'polygon' ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              <Typography variant="body2">
                <strong>Polygon mode:</strong> Click to draw points, then click "Complete Polygon" to cut out that area.
              </Typography>
            </Alert>
          ) : null}

          {/* Toolbar */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              value={mode}
              exclusive
              onChange={(_, newMode) => {
                if (newMode) {
                  setMode(newMode);
                  handleClear();
                }
              }}
              size="small"
            >
              {canUseSliceMode && (
                <ToggleButton value="slice">
                  <Tooltip title="Slice mode - draw a line to split the region">
                    <ContentCutIcon />
                  </Tooltip>
                </ToggleButton>
              )}
              <ToggleButton value="polygon">
                <Tooltip title="Polygon mode - draw a shape to cut out">
                  <DrawIcon />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="pan">
                <Tooltip title="Pan mode - navigate the map">
                  <PanToolIcon />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ borderLeft: 1, borderColor: 'divider', height: 24, mx: 1 }} />

            <Tooltip title="Undo last point">
              <span>
                <IconButton onClick={handleUndo} disabled={drawingPoints.length === 0} size="small">
                  <UndoIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Clear all">
              <span>
                <IconButton onClick={handleClear} disabled={drawingPoints.length === 0} size="small">
                  <DeleteIcon />
                </IconButton>
              </span>
            </Tooltip>

            {/* Polygon mode: complete button */}
            {mode === 'polygon' && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleCompletePolygon}
                disabled={drawingPoints.length < 3}
              >
                Complete Polygon ({drawingPoints.length} points)
              </Button>
            )}

            {/* Slice mode: indicator */}
            {mode === 'slice' && drawingPoints.length >= 2 && !slicedParts && (
              <Chip
                label="Keep drawing until line crosses both edges"
                color="warning"
                size="small"
              />
            )}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}

          {/* Slice mode: select which part to keep */}
          {slicedParts && (
            <Paper variant="outlined" sx={{ mt: 1, p: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom>
                ✅ Region split into 2 pieces! Click on the map or below to select which one to keep:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                <Button
                  variant={selectedSlicePart === 1 ? 'contained' : 'outlined'}
                  color={selectedSlicePart === 1 ? 'primary' : 'inherit'}
                  size="small"
                  onClick={() => setSelectedSlicePart(1)}
                  startIcon={selectedSlicePart === 1 ? <CheckIcon /> : undefined}
                >
                  Part 1 ({(turf.area(slicedParts.part1) / 1_000_000).toFixed(1)} km²)
                </Button>
                <Button
                  variant={selectedSlicePart === 2 ? 'contained' : 'outlined'}
                  color={selectedSlicePart === 2 ? 'primary' : 'inherit'}
                  size="small"
                  onClick={() => setSelectedSlicePart(2)}
                  startIcon={selectedSlicePart === 2 ? <CheckIcon /> : undefined}
                >
                  Part 2 ({(turf.area(slicedParts.part2) / 1_000_000).toFixed(1)} km²)
                </Button>
              </Box>
              {selectedSlicePart && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label="Name this piece"
                    value={currentPartName}
                    onChange={(e) => setCurrentPartName(e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <Button variant="contained" size="small" onClick={handleConfirmSlice}>
                    Add This Piece
                  </Button>
                </Box>
              )}
            </Paper>
          )}

          {/* Polygon mode: result ready */}
          {resultGeometry && (
            <Paper variant="outlined" sx={{ mt: 1, p: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom>
                ✅ Piece ready! Name it and add:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="Name this piece"
                  value={currentPartName}
                  onChange={(e) => setCurrentPartName(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button variant="contained" size="small" onClick={handleAddPolygonPart}>
                  Add This Piece
                </Button>
              </Box>
            </Paper>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 2, height: 400 }}>
          {/* Map */}
          <Box sx={{ flex: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <MapGL
              ref={mapRef}
              initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
              style={{ width: '100%', height: '100%' }}
              mapStyle={MAP_STYLE}
              onClick={handleMapClick}
              onLoad={() => setMapLoaded(true)}
              cursor={mode === 'pan' ? 'grab' : 'crosshair'}
              dragPan={mode === 'pan'}
              dragRotate={false}
            >
              <NavigationControl position="top-right" showCompass={false} />

              {/* Image overlay */}
              {imageOverlaySettings && (
                <Source
                  id="image-overlay"
                  type="image"
                  url={imageOverlaySettings.imageUrl}
                  coordinates={imageOverlaySettings.coordinates}
                >
                  <Layer
                    id="image-overlay-layer"
                    type="raster"
                    paint={{
                      'raster-opacity': imageOverlaySettings.opacity,
                      'raster-fade-duration': 0,
                    }}
                  />
                </Source>
              )}

              {/* Remaining geometry (before slicing) */}
              <Source id="remaining" type="geojson" data={remainingGeoJSON}>
                <Layer
                  id="remaining-fill"
                  type="fill"
                  paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.3 }}
                />
                <Layer
                  id="remaining-outline"
                  type="line"
                  paint={{ 'line-color': '#3388ff', 'line-width': 2 }}
                />
              </Source>

              {/* Sliced parts preview */}
              {slicedParts && (
                <Source id="sliced-parts" type="geojson" data={slicedPartsGeoJSON}>
                  <Layer
                    id="sliced-fill"
                    type="fill"
                    paint={{
                      'fill-color': [
                        'case',
                        ['==', ['get', 'selected'], true], '#4caf50',
                        ['==', ['get', 'partNum'], 1], '#ff9800',
                        '#2196f3',
                      ],
                      'fill-opacity': [
                        'case',
                        ['==', ['get', 'selected'], true], 0.6,
                        0.4,
                      ],
                    }}
                  />
                  <Layer
                    id="sliced-outline"
                    type="line"
                    paint={{
                      'line-color': [
                        'case',
                        ['==', ['get', 'selected'], true], '#2e7d32',
                        '#333',
                      ],
                      'line-width': [
                        'case',
                        ['==', ['get', 'selected'], true], 3,
                        2,
                      ],
                    }}
                  />
                </Source>
              )}

              {/* Polygon mode result */}
              <Source id="result" type="geojson" data={resultGeoJSON}>
                <Layer id="result-fill" type="fill" paint={{ 'fill-color': '#4caf50', 'fill-opacity': 0.5 }} />
                <Layer id="result-outline" type="line" paint={{ 'line-color': '#2e7d32', 'line-width': 3 }} />
              </Source>

              {/* Already cut parts */}
              <Source id="cut-parts" type="geojson" data={cutPartsGeoJSON}>
                <Layer
                  id="cut-parts-fill"
                  type="fill"
                  paint={{
                    'fill-color': ['interpolate', ['linear'], ['get', 'index'], 0, '#e41a1c', 1, '#377eb8', 2, '#4daf4a', 3, '#984ea3', 4, '#ff7f00'],
                    'fill-opacity': 0.5,
                  }}
                />
                <Layer id="cut-parts-outline" type="line" paint={{ 'line-color': '#333', 'line-width': 2 }} />
              </Source>

              {/* Drawing preview */}
              <Source id="drawing" type="geojson" data={drawingGeoJSON}>
                <Layer
                  id="drawing-line"
                  type="line"
                  filter={['!', ['has', 'closing']]}
                  paint={{ 'line-color': '#ff6b6b', 'line-width': 3 }}
                />
                <Layer
                  id="drawing-closing"
                  type="line"
                  filter={['has', 'closing']}
                  paint={{ 'line-color': '#ff6b6b', 'line-width': 2, 'line-dasharray': [4, 2] }}
                />
                <Layer
                  id="drawing-points"
                  type="circle"
                  paint={{ 'circle-radius': 6, 'circle-color': '#ff6b6b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }}
                />
              </Source>
            </MapGL>
          </Box>

          {/* Cut parts list */}
          <Paper variant="outlined" sx={{ flex: 1, p: 1, overflow: 'auto', minWidth: 200 }}>
            <Typography variant="subtitle2" gutterBottom>
              Cut Parts ({cutParts.length})
            </Typography>

            {cutParts.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No parts yet. Draw to cut pieces.
              </Typography>
            ) : (
              <List dense>
                {cutParts.map((part, idx) => (
                  <ListItem
                    key={idx}
                    secondaryAction={
                      <IconButton size="small" onClick={() => handleDeletePart(idx)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <Box
                        sx={{
                          width: 14,
                          height: 14,
                          backgroundColor: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00'][idx % 5],
                          borderRadius: 0.5,
                        }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <TextField
                          size="small"
                          variant="standard"
                          defaultValue={part.name}
                          onBlur={(e) => handleRenamePart(idx, e.target.value.trim() || part.name)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          fullWidth
                        />
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}

            {/* Add remaining button */}
            {cutParts.length > 0 && hasRemainingArea && !slicedParts && (
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={handleUseRemaining}
                sx={{ mt: 1 }}
              >
                Add Remaining Area
              </Button>
            )}
          </Paper>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => onConfirm(cutParts)}
          disabled={cutParts.length === 0}
        >
          Use {cutParts.length} Part{cutParts.length !== 1 ? 's' : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
