import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Slider,
  TextField,
  Paper,
  IconButton,
  Tooltip,
  Stack,
  Divider,
  Tabs,
  Tab,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TuneIcon from '@mui/icons-material/Tune';
import Map, { Source, Layer, NavigationControl, type MapRef, useMap } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import { MAP_STYLE } from '../../../../../constants/mapStyles';
import { CalibrationView } from './CalibrationView';

// Component that renders image overlay and updates coordinates in real-time
function ImageOverlaySource({
  imageUrl,
  coordinates,
  opacity,
}: {
  imageUrl: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  opacity: number;
}) {
  const { current: map } = useMap();

  // Update image source coordinates when they change
  useEffect(() => {
    if (!map) return;
    const source = map.getSource('image-overlay') as maplibregl.ImageSource | undefined;
    if (source) {
      source.setCoordinates(coordinates);
    }
  }, [map, coordinates]);

  // Update opacity when it changes
  useEffect(() => {
    if (!map) return;
    const mapInstance = map.getMap();
    if (mapInstance.getLayer('image-overlay-layer')) {
      mapInstance.setPaintProperty('image-overlay-layer', 'raster-opacity', opacity);
    }
  }, [map, opacity]);

  return (
    <Source
      id="image-overlay"
      type="image"
      url={imageUrl}
      coordinates={coordinates}
    >
      <Layer
        id="image-overlay-layer"
        type="raster"
        paint={{
          'raster-opacity': opacity,
          'raster-fade-duration': 0,
        }}
      />
    </Source>
  );
}

export interface ImageOverlaySettings {
  imageUrl: string;
  imageName: string;
  // Geographic bounds: [[west, south], [east, north]] or corner coordinates
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  opacity: number;
  // Image dimensions (optional for backwards compatibility)
  imageSize?: { width: number; height: number };
}

interface ImageOverlayDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (settings: ImageOverlaySettings) => void;
  initialCenter?: [number, number]; // [lng, lat] - center of the region we're working with
  initialZoom?: number;
  existingSettings?: ImageOverlaySettings | null;
  regionGeometries?: GeoJSON.FeatureCollection | null; // Geometries of the divisions for auto-calibration
}

export function ImageOverlayDialog({
  open,
  onClose,
  onApply,
  initialCenter = [0, 20],
  initialZoom = 4,
  existingSettings,
  regionGeometries,
}: ImageOverlayDialogProps) {
  const mapRef = useRef<MapRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image state
  const [imageUrl, setImageUrl] = useState<string | null>(existingSettings?.imageUrl || null);
  const [imageName, setImageName] = useState<string>(existingSettings?.imageName || '');
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  // Drag state for repositioning image on map
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);

  // Overlay adjustment state
  const [centerLng, setCenterLng] = useState(initialCenter[0]);
  const [centerLat, setCenterLat] = useState(initialCenter[1]);
  const [rotation, setRotation] = useState(0); // degrees
  const [scale, setScale] = useState(1); // 1 = base size, calculated from image aspect ratio
  const [aspectRatioAdjust, setAspectRatioAdjust] = useState(1); // 1 = original, <1 = wider, >1 = taller
  const [opacity, setOpacity] = useState(0.7);

  // Tab state: 0 = Manual Adjustment, 1 = Calibration
  const [activeTab, setActiveTab] = useState(0);

  // Base size in degrees (will be multiplied by scale)
  const baseWidthDeg = 5;

  // Reset when dialog opens with new settings
  useEffect(() => {
    if (open) {
      if (existingSettings) {
        setImageUrl(existingSettings.imageUrl);
        setImageName(existingSettings.imageName);
        setOpacity(existingSettings.opacity);
        // Calculate center and scale from existing coordinates
        const coords = existingSettings.coordinates;
        const avgLng = (coords[0][0] + coords[1][0] + coords[2][0] + coords[3][0]) / 4;
        const avgLat = (coords[0][1] + coords[1][1] + coords[2][1] + coords[3][1]) / 4;
        setCenterLng(avgLng);
        setCenterLat(avgLat);

        // Use persisted imageSize if available, otherwise load from image URL
        if (existingSettings.imageSize) {
          setImageSize(existingSettings.imageSize);
        } else {
          // Load image size from existing URL
          const img = new Image();
          img.onload = () => {
            setImageSize({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
          };
          img.onerror = () => {
            console.warn('Could not get image dimensions from existing URL, using defaults');
            setImageSize({ width: 800, height: 600 });
          };
          img.src = existingSettings.imageUrl;
        }
      } else {
        setCenterLng(initialCenter[0]);
        setCenterLat(initialCenter[1]);
        setRotation(0);
        setScale(1);
        setOpacity(0.7);
      }
    }
  }, [open, existingSettings, initialCenter]);

  // Track Shift key for image dragging mode indication
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle file upload
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type (including SVG)
    const isImage = file.type.startsWith('image/');
    const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');
    if (!isImage && !isSvg) {
      alert('Please select an image file (PNG, JPG, SVG, etc.)');
      return;
    }

    // Read file as data URL (more reliable for MapLibre than blob URLs)
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImageUrl(dataUrl);
      setImageName(file.name);

      // Get image dimensions
      const img = new Image();
      img.onload = () => {
        setImageSize({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      };
      img.onerror = () => {
        // For SVGs that might not report size correctly, use default
        console.warn('Could not get image dimensions, using defaults');
        setImageSize({ width: 800, height: 600 });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  // Calculate corner coordinates for the image overlay
  const calculateCoordinates = useCallback((): [[number, number], [number, number], [number, number], [number, number]] => {
    const aspectRatio = imageSize ? imageSize.width / imageSize.height : 1;
    const adjustedAspectRatio = aspectRatio * aspectRatioAdjust;
    const widthDeg = baseWidthDeg * scale;
    const heightDeg = widthDeg / adjustedAspectRatio;

    // Half dimensions
    const halfW = widthDeg / 2;
    const halfH = heightDeg / 2;

    // Corners before rotation (relative to center)
    const corners: [number, number][] = [
      [-halfW, halfH],   // top-left
      [halfW, halfH],    // top-right
      [halfW, -halfH],   // bottom-right
      [-halfW, -halfH],  // bottom-left
    ];

    // Apply rotation
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotatedCorners = corners.map(([x, y]) => {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      return [centerLng + rx, centerLat + ry] as [number, number];
    });

    return rotatedCorners as [[number, number], [number, number], [number, number], [number, number]];
  }, [centerLng, centerLat, rotation, scale, aspectRatioAdjust, imageSize]);

  // Calculate coordinates with a given center (for dragging)
  const calculateCoordinatesAt = useCallback((lng: number, lat: number): [[number, number], [number, number], [number, number], [number, number]] => {
    const aspectRatio = imageSize ? imageSize.width / imageSize.height : 1;
    const adjustedAspectRatio = aspectRatio * aspectRatioAdjust;
    const widthDeg = baseWidthDeg * scale;
    const heightDeg = widthDeg / adjustedAspectRatio;

    const halfW = widthDeg / 2;
    const halfH = heightDeg / 2;

    const corners: [number, number][] = [
      [-halfW, halfH],
      [halfW, halfH],
      [halfW, -halfH],
      [-halfW, -halfH],
    ];

    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotatedCorners = corners.map(([x, y]) => {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      return [lng + rx, lat + ry] as [number, number];
    });

    return rotatedCorners as [[number, number], [number, number], [number, number], [number, number]];
  }, [rotation, scale, aspectRatioAdjust, imageSize]);

  // Mouse handlers for dragging image on map (requires Shift key)
  const handleMapMouseDown = useCallback((event: maplibregl.MapMouseEvent) => {
    if (!imageUrl || !imageSize) return;

    // Only drag image when Shift is pressed
    if (!event.originalEvent.shiftKey) return;

    const clickLng = event.lngLat.lng;
    const clickLat = event.lngLat.lat;

    // Check if click is roughly within the image bounds
    const coords = calculateCoordinates();

    // Simple bounding box check
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    if (clickLng >= minLng && clickLng <= maxLng && clickLat >= minLat && clickLat <= maxLat) {
      setIsDragging(true);
      dragStartRef.current = {
        x: event.point.x,
        y: event.point.y,
        lng: centerLng,
        lat: centerLat,
      };
      event.preventDefault();
    }
  }, [imageUrl, imageSize, calculateCoordinates, centerLng, centerLat]);

  const handleMapMouseMove = useCallback((event: maplibregl.MapMouseEvent) => {
    if (!isDragging || !dragStartRef.current || !mapRef.current) return;

    const map = mapRef.current.getMap();
    const dragStart = dragStartRef.current;
    const startPoint = map.project([dragStart.lng, dragStart.lat]);
    const newX = startPoint.x + (event.point.x - dragStart.x);
    const newY = startPoint.y + (event.point.y - dragStart.y);
    const newLngLat = map.unproject([newX, newY]);

    // Update the image source directly (no React state update)
    const source = map.getSource('image-overlay') as maplibregl.ImageSource | undefined;
    if (source) {
      const newCoords = calculateCoordinatesAt(newLngLat.lng, newLngLat.lat);
      source.setCoordinates(newCoords);
    }
  }, [isDragging, calculateCoordinatesAt]);

  const handleMapMouseUp = useCallback((event: maplibregl.MapMouseEvent) => {
    if (isDragging && dragStartRef.current && mapRef.current) {
      const map = mapRef.current.getMap();
      const dragStart = dragStartRef.current;
      const startPoint = map.project([dragStart.lng, dragStart.lat]);
      const newX = startPoint.x + (event.point.x - dragStart.x);
      const newY = startPoint.y + (event.point.y - dragStart.y);
      const newLngLat = map.unproject([newX, newY]);

      setCenterLng(newLngLat.lng);
      setCenterLat(newLngLat.lat);
    }
    setIsDragging(false);
    dragStartRef.current = null;
  }, [isDragging]);

  const handleMapMouseLeave = useCallback(() => {
    // On mouse leave, revert to the original position if still dragging
    if (isDragging && dragStartRef.current && mapRef.current) {
      const source = mapRef.current.getMap().getSource('image-overlay') as maplibregl.ImageSource | undefined;
      if (source) {
        source.setCoordinates(calculateCoordinates());
      }
    }
    setIsDragging(false);
    dragStartRef.current = null;
  }, [isDragging, calculateCoordinates]);

  // Handle apply
  const handleApply = useCallback(() => {
    if (!imageUrl) return;

    onApply({
      imageUrl,
      imageName,
      coordinates: calculateCoordinates(),
      opacity,
      imageSize: imageSize ?? undefined,
    });
    onClose();
  }, [imageUrl, imageName, calculateCoordinates, opacity, imageSize, onApply, onClose]);

  // Handle reset
  const handleReset = useCallback(() => {
    setCenterLng(initialCenter[0]);
    setCenterLat(initialCenter[1]);
    setRotation(0);
    setScale(1);
    setAspectRatioAdjust(1);
    setOpacity(0.7);
  }, [initialCenter]);

  // Handle remove image
  const handleRemoveImage = useCallback(() => {
    setImageUrl(null);
    setImageName('');
    setImageSize(null);
  }, []);

  // Handle calibration completion from CalibrationView
  const handleCalibrationComplete = useCallback((result: {
    scale: number;
    aspectRatioAdjust: number;
    centerLng: number;
    centerLat: number;
    mapPoints?: { west: { lng: number; lat: number }; east: { lng: number; lat: number }; south: { lng: number; lat: number }; north: { lng: number; lat: number } };
    imagePoints?: { west: { x: number; y: number }; east: { x: number; y: number }; south: { x: number; y: number }; north: { x: number; y: number } };
  }) => {
    setScale(result.scale);
    setAspectRatioAdjust(result.aspectRatioAdjust);
    setCenterLng(result.centerLng);
    setCenterLat(result.centerLat);
    setActiveTab(0); // Switch back to manual adjustment tab
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={activeTab === 1 ? 'lg' : 'md'}
      fullWidth
    >
      <DialogTitle>
        Reference Image Overlay
        <Typography variant="body2" color="text.secondary">
          Upload an image to use as a reference while grouping regions
        </Typography>
      </DialogTitle>
      <DialogContent>
        {/* Show tabs only when image is loaded */}
        {imageUrl && imageSize && regionGeometries && regionGeometries.features.length > 0 && (
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="Manual Adjustment" icon={<TuneIcon />} iconPosition="start" />
            <Tab label="4-Point Calibration" icon={<RestartAltIcon />} iconPosition="start" />
          </Tabs>
        )}

        {/* Tab 0: Manual Adjustment (or default view for uploading) */}
        {activeTab === 0 && (
          <Box sx={{ display: 'flex', gap: 2, minHeight: 450 }}>
            {/* Left: Controls */}
            <Paper variant="outlined" sx={{ width: 280, p: 2, flexShrink: 0 }}>
              {/* Upload section */}
              <Typography variant="subtitle2" gutterBottom>
                Image File
              </Typography>
              <input
                type="file"
                accept="image/*,.svg"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              {imageUrl ? (
                <Box sx={{ mb: 2 }}>
                  <Box
                    component="img"
                    src={imageUrl}
                    sx={{
                      width: '100%',
                      height: 100,
                      objectFit: 'contain',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      mb: 1,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {imageName}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => fileInputRef.current?.click()}
                    >
                    Change
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={handleRemoveImage}
                  >
                    Remove
                  </Button>
                </Box>
              </Box>
            ) : (
              <Button
                variant="outlined"
                startIcon={<CloudUploadIcon />}
                onClick={() => fileInputRef.current?.click()}
                fullWidth
                sx={{ mb: 2 }}
              >
                Upload Image
              </Button>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Position controls */}
            <Typography variant="subtitle2" gutterBottom>
              Position
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  label="Longitude"
                  type="number"
                  value={centerLng.toFixed(4)}
                  onChange={(e) => setCenterLng(parseFloat(e.target.value) || 0)}
                  inputProps={{ step: 0.1 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label="Latitude"
                  type="number"
                  value={centerLat.toFixed(4)}
                  onChange={(e) => setCenterLat(parseFloat(e.target.value) || 0)}
                  inputProps={{ step: 0.1 }}
                  sx={{ flex: 1 }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                Drag the image on the map to reposition
              </Typography>
            </Stack>

            {/* Rotation controls */}
            <Typography variant="subtitle2" gutterBottom>
              Rotation: {rotation}°
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Tooltip title="Rotate left 15°">
                <IconButton size="small" onClick={() => setRotation(r => r - 15)}>
                  <RotateLeftIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Slider
                value={rotation}
                onChange={(_, v) => setRotation(v as number)}
                min={-180}
                max={180}
                size="small"
                sx={{ flex: 1 }}
              />
              <Tooltip title="Rotate right 15°">
                <IconButton size="small" onClick={() => setRotation(r => r + 15)}>
                  <RotateRightIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Scale controls */}
            <Typography variant="subtitle2" gutterBottom>
              Scale: {scale.toFixed(2)}x
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Tooltip title="Zoom out (-0.01)">
                <IconButton size="small" onClick={() => setScale(s => Math.max(0.1, +(s - 0.01).toFixed(3)))}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Slider
                value={scale}
                onChange={(_, v) => setScale(v as number)}
                min={0.1}
                max={10}
                step={0.01}
                size="small"
                sx={{ flex: 1 }}
              />
              <Tooltip title="Zoom in (+0.01)">
                <IconButton size="small" onClick={() => setScale(s => Math.min(10, +(s + 0.01).toFixed(3)))}>
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TextField
                size="small"
                type="number"
                value={scale.toFixed(3)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val >= 0.01 && val <= 20) {
                    setScale(val);
                  }
                }}
                inputProps={{ step: 0.001, min: 0.01, max: 20 }}
                sx={{ width: 100 }}
              />
              <Typography variant="caption" color="text.secondary">
                Fine-tune: use arrows or type exact value
              </Typography>
            </Box>

            {/* Aspect ratio adjustment */}
            <Typography variant="subtitle2" gutterBottom>
              Stretch: {aspectRatioAdjust < 1 ? 'Wider' : aspectRatioAdjust > 1 ? 'Taller' : 'Original'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Tooltip title="Make wider (-0.01)">
                <IconButton
                  size="small"
                  onClick={() => setAspectRatioAdjust(v => Math.max(0.25, +(v - 0.01).toFixed(3)))}
                >
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Slider
                value={aspectRatioAdjust}
                onChange={(_, v) => setAspectRatioAdjust(v as number)}
                min={0.25}
                max={4}
                step={0.01}
                marks={[
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1:1' },
                  { value: 2, label: '2' },
                ]}
                size="small"
                sx={{ flex: 1 }}
              />
              <Tooltip title="Make taller (+0.01)">
                <IconButton
                  size="small"
                  onClick={() => setAspectRatioAdjust(v => Math.min(4, +(v + 0.01).toFixed(3)))}
                >
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TextField
                size="small"
                type="number"
                value={aspectRatioAdjust.toFixed(3)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val >= 0.1 && val <= 10) {
                    setAspectRatioAdjust(val);
                  }
                }}
                inputProps={{ step: 0.001, min: 0.1, max: 10 }}
                sx={{ width: 100 }}
              />
              <Typography variant="caption" color="text.secondary">
                Fine-tune: use arrows or type exact value
              </Typography>
            </Box>

            {/* Opacity controls */}
            <Typography variant="subtitle2" gutterBottom>
              Opacity: {Math.round(opacity * 100)}%
            </Typography>
            <Slider
              value={opacity}
              onChange={(_, v) => setOpacity(v as number)}
              min={0.1}
              max={1}
              step={0.05}
              size="small"
              sx={{ mb: 2 }}
            />

            <Divider sx={{ my: 2 }} />

            {/* Instructions */}
            <Paper variant="outlined" sx={{ p: 1, mb: 2, bgcolor: 'grey.50' }}>
              <Typography variant="caption" color="text.secondary">
                💡 <strong>Shift + drag</strong> on image to move it<br />
                💡 Without Shift, you can navigate the map normally<br />
                💡 Use <strong>4-Point Calibration</strong> tab for precise alignment
              </Typography>
            </Paper>

            {/* Reset button */}
            <Button
              variant="outlined"
              startIcon={<RestartAltIcon />}
              onClick={handleReset}
              fullWidth
              size="small"
              sx={{ mb: 1 }}
            >
              Reset Adjustments
            </Button>

          </Paper>

          {/* Right: Map preview */}
          <Paper variant="outlined" sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <Map
              ref={mapRef}
              initialViewState={{
                longitude: initialCenter[0],
                latitude: initialCenter[1],
                zoom: initialZoom,
              }}
              style={{ width: '100%', height: '100%' }}
              mapStyle={MAP_STYLE}
              onMouseDown={handleMapMouseDown}
              onMouseMove={handleMapMouseMove}
              onMouseUp={handleMapMouseUp}
              onMouseLeave={handleMapMouseLeave}
              cursor={isDragging ? 'grabbing' : (shiftPressed && imageUrl && imageSize ? 'grab' : 'default')}
            >
              <NavigationControl position="top-right" showCompass={true} />

              {/* Image overlay */}
              {imageUrl && imageSize && (
                <ImageOverlaySource
                  imageUrl={imageUrl}
                  coordinates={calculateCoordinates()}
                  opacity={opacity}
                />
              )}
            </Map>

            {!imageUrl && (
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  color: 'text.secondary',
                }}
              >
                <CloudUploadIcon sx={{ fontSize: 48, opacity: 0.5 }} />
                <Typography variant="body2">
                  Upload an image to see preview
                </Typography>
              </Box>
            )}

            {imageUrl && !imageSize && (
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  color: 'text.secondary',
                }}
              >
                <Typography variant="body2">
                  Loading image...
                </Typography>
              </Box>
            )}
          </Paper>
        </Box>
        )}

        {/* Tab 1: Calibration View */}
        {activeTab === 1 && imageUrl && imageSize && regionGeometries && (
          <Box sx={{ height: 550 }}>
            <CalibrationView
              imageUrl={imageUrl}
              imageSize={imageSize}
              regionGeometries={regionGeometries}
              onComplete={handleCalibrationComplete}
              onCancel={() => setActiveTab(0)}
              baseWidthDeg={baseWidthDeg}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleApply}
          disabled={!imageUrl}
        >
          Apply Overlay
        </Button>
      </DialogActions>
    </Dialog>
  );
}
