import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  Tooltip,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Map, { Marker, NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { MAP_STYLE } from '../../../../../constants/mapStyles';

type CalibrationStep = 'west' | 'east' | 'south' | 'north';

interface CalibrationPoint {
  lng: number;
  lat: number;
}

interface ImagePoint {
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
}

interface CalibrationViewProps {
  imageUrl: string;
  imageSize: { width: number; height: number };
  regionGeometries: GeoJSON.FeatureCollection;
  onComplete: (result: {
    scale: number;
    aspectRatioAdjust: number;
    centerLng: number;
    centerLat: number;
    mapPoints: { west: { lng: number; lat: number }; east: { lng: number; lat: number }; south: { lng: number; lat: number }; north: { lng: number; lat: number } };
    imagePoints: { west: { x: number; y: number }; east: { x: number; y: number }; south: { x: number; y: number }; north: { x: number; y: number } };
  }) => void;
  onCancel: () => void;
  baseWidthDeg: number;
}

const STEPS: CalibrationStep[] = ['west', 'east', 'south', 'north'];
const STEP_LABELS: Record<CalibrationStep, string> = {
  west: 'Westernmost',
  east: 'Easternmost',
  south: 'Southernmost',
  north: 'Northernmost',
};

export function CalibrationView({
  imageUrl,
  imageSize,
  regionGeometries,
  onComplete,
  onCancel,
  baseWidthDeg,
}: CalibrationViewProps) {
  const mapRef = useRef<MapRef>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Current step
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const currentStep = STEPS[currentStepIdx];

  // Detected map points (auto-calculated from geometries)
  const [mapPoints, setMapPoints] = useState<Record<CalibrationStep, CalibrationPoint | null>>({
    west: null,
    east: null,
    south: null,
    north: null,
  });

  // User-clicked image points
  const [imagePoints, setImagePoints] = useState<Record<CalibrationStep, ImagePoint | null>>({
    west: null,
    east: null,
    south: null,
    north: null,
  });

  // Image pan/zoom state
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 });
  const [dragDistance, setDragDistance] = useState(0);

  // Pending point (not yet confirmed)
  const [pendingPoint, setPendingPoint] = useState<ImagePoint | null>(null);

  // Find extreme points from geometries on mount
  useEffect(() => {
    if (!regionGeometries || regionGeometries.features.length === 0) return;

    let west: CalibrationPoint | null = null;
    let east: CalibrationPoint | null = null;
    let south: CalibrationPoint | null = null;
    let north: CalibrationPoint | null = null;

    regionGeometries.features.forEach(feature => {
      if (!feature.geometry) return;
      const coords = turf.coordAll(feature);
      coords.forEach(([lng, lat]) => {
        if (!west || lng < west.lng) west = { lng, lat };
        if (!east || lng > east.lng) east = { lng, lat };
        if (!south || lat < south.lat) south = { lng, lat };
        if (!north || lat > north.lat) north = { lng, lat };
      });
    });

    setMapPoints({ west, east, south, north });
  }, [regionGeometries]);

  // Center map on current point when step changes
  useEffect(() => {
    const point = mapPoints[currentStep];
    if (point && mapRef.current) {
      mapRef.current.flyTo({
        center: [point.lng, point.lat],
        zoom: 8,
        duration: 500,
      });
    }
  }, [currentStep, mapPoints]);

  // Calculate the actual image bounds within the container (accounting for objectFit: contain)
  const getImageBounds = useCallback(() => {
    const container = imageContainerRef.current;
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    // Image natural aspect ratio
    const imageAspect = imageSize.width / imageSize.height;
    const containerAspect = containerWidth / containerHeight;

    let imgDisplayWidth: number;
    let imgDisplayHeight: number;
    let imgOffsetX: number;
    let imgOffsetY: number;

    if (imageAspect > containerAspect) {
      // Image is wider than container - width fills, height has padding
      imgDisplayWidth = containerWidth;
      imgDisplayHeight = containerWidth / imageAspect;
      imgOffsetX = 0;
      imgOffsetY = (containerHeight - imgDisplayHeight) / 2;
    } else {
      // Image is taller than container - height fills, width has padding
      imgDisplayHeight = containerHeight;
      imgDisplayWidth = containerHeight * imageAspect;
      imgOffsetX = (containerWidth - imgDisplayWidth) / 2;
      imgOffsetY = 0;
    }

    return { imgDisplayWidth, imgDisplayHeight, imgOffsetX, imgOffsetY, containerWidth, containerHeight };
  }, [imageSize]);

  // Handle image click - either place pending point, confirm it, or start panning
  const handleImageClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // If we were dragging, don't place a point, just clear pending
    if (dragDistance > 5) {
      setPendingPoint(null);
      return;
    }

    const container = imageContainerRef.current;
    if (!container) return;

    const bounds = getImageBounds();
    if (!bounds) return;

    const rect = container.getBoundingClientRect();

    // Get click position relative to container
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Reverse the transform to get position in untransformed container space
    const untransformedX = (clickX - imagePan.x) / imageZoom;
    const untransformedY = (clickY - imagePan.y) / imageZoom;

    // Now convert to image coordinates (0-1), accounting for objectFit: contain
    // The image is displayed at (imgOffsetX, imgOffsetY) with size (imgDisplayWidth, imgDisplayHeight)
    const x = (untransformedX - bounds.imgOffsetX) / bounds.imgDisplayWidth;
    const y = (untransformedY - bounds.imgOffsetY) / bounds.imgDisplayHeight;

    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));

    // Check if clicking on the pending point to confirm it
    if (pendingPoint) {
      const dx = Math.abs(clampedX - pendingPoint.x);
      const dy = Math.abs(clampedY - pendingPoint.y);
      // If click is close to pending point (within ~5% of image), confirm it
      if (dx < 0.05 && dy < 0.05) {
        setImagePoints(prev => ({
          ...prev,
          [currentStep]: pendingPoint,
        }));
        setPendingPoint(null);
        // Auto-advance to next step (but not past the last one)
        if (currentStepIdx < STEPS.length - 1) {
          setCurrentStepIdx(currentStepIdx + 1);
          // Reset image view to original size for easier point finding
          setImageZoom(1);
          setImagePan({ x: 0, y: 0 });
        }
        return;
      }
    }

    // Place a new pending point (this also cancels the previous pending point)
    setPendingPoint({ x: clampedX, y: clampedY });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- currentStepIdx only used for setCurrentStepIdx functional update
  }, [currentStep, imageZoom, imagePan, pendingPoint, dragDistance, getImageBounds]);

  // Convert image point (0-1) to screen position
  const imagePointToScreen = useCallback((point: ImagePoint) => {
    const bounds = getImageBounds();
    if (!bounds) return { x: 0, y: 0 };

    // Image point (0-1) to position within the image display area
    const imgX = point.x * bounds.imgDisplayWidth + bounds.imgOffsetX;
    const imgY = point.y * bounds.imgDisplayHeight + bounds.imgOffsetY;

    // Apply transform (scale and pan)
    const screenX = imgX * imageZoom + imagePan.x;
    const screenY = imgY * imageZoom + imagePan.y;

    return { x: screenX, y: screenY };
  }, [getImageBounds, imageZoom, imagePan]);

  // Handle image pan - default drag behavior
  const handleImageMouseDown = useCallback((event: React.MouseEvent) => {
    setIsPanning(true);
    setDragDistance(0);
    setPanStart({
      x: event.clientX,
      y: event.clientY,
      panX: imagePan.x,
      panY: imagePan.y,
    });
  }, [imagePan]);

  const handleImageMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    setDragDistance(Math.sqrt(dx * dx + dy * dy));
    setImagePan({
      x: panStart.panX + dx,
      y: panStart.panY + dy,
    });
  }, [isPanning, panStart]);

  const handleImageMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Image zoom controls - zoom around center of visible area
  const handleZoomIn = useCallback(() => {
    const container = imageContainerRef.current;
    if (!container) {
      setImageZoom(z => Math.min(5, z + 0.25));
      return;
    }
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const oldZoom = imageZoom;
    const newZoom = Math.min(5, oldZoom + 0.25);
    const zoomRatio = newZoom / oldZoom;

    // Adjust pan to keep center point fixed
    setImagePan(prev => ({
      x: centerX - (centerX - prev.x) * zoomRatio,
      y: centerY - (centerY - prev.y) * zoomRatio,
    }));
    setImageZoom(newZoom);
  }, [imageZoom]);

  const handleZoomOut = useCallback(() => {
    const container = imageContainerRef.current;
    if (!container) {
      setImageZoom(z => Math.max(0.5, z - 0.25));
      return;
    }
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const oldZoom = imageZoom;
    const newZoom = Math.max(0.5, oldZoom - 0.25);
    const zoomRatio = newZoom / oldZoom;

    // Adjust pan to keep center point fixed
    setImagePan(prev => ({
      x: centerX - (centerX - prev.x) * zoomRatio,
      y: centerY - (centerY - prev.y) * zoomRatio,
    }));
    setImageZoom(newZoom);
  }, [imageZoom]);

  const handleResetView = () => {
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
  };

  // Navigation
  const handleBack = () => {
    if (currentStepIdx > 0) {
      setCurrentStepIdx(currentStepIdx - 1);
      setPendingPoint(null); // Clear pending point when going back
      // Reset image view to original size for easier point finding
      setImageZoom(1);
      setImagePan({ x: 0, y: 0 });
    }
  };

  // Check if all steps are complete
  const isAllComplete = STEPS.every(step => imagePoints[step] !== null);

  // Apply calibration
  const handleApply = useCallback(() => {
    const mp = mapPoints;
    const ip = imagePoints;

    if (!mp.west || !mp.east || !mp.south || !mp.north ||
        !ip.west || !ip.east || !ip.south || !ip.north) {
      return;
    }

    // Map extent in degrees
    const mapMinLng = Math.min(mp.west.lng, mp.east.lng);
    const mapMaxLng = Math.max(mp.west.lng, mp.east.lng);
    const mapMinLat = Math.min(mp.south.lat, mp.north.lat);
    const mapMaxLat = Math.max(mp.south.lat, mp.north.lat);
    const mapWidth = mapMaxLng - mapMinLng;
    const mapHeight = mapMaxLat - mapMinLat;
    const mapCenterLng = (mapMinLng + mapMaxLng) / 2;
    const mapCenterLat = (mapMinLat + mapMaxLat) / 2;

    // Image extent in normalized coordinates (0-1)
    // Note: In image coords, Y=0 is TOP, Y=1 is BOTTOM
    // So north point should have SMALLER y than south point
    const imgMinX = Math.min(ip.west.x, ip.east.x);
    const imgMaxX = Math.max(ip.west.x, ip.east.x);
    const imgMinY = Math.min(ip.north.y, ip.south.y);
    const imgMaxY = Math.max(ip.north.y, ip.south.y);
    const imgWidth = imgMaxX - imgMinX;
    const imgHeight = imgMaxY - imgMinY;
    const imgCenterX = (imgMinX + imgMaxX) / 2;
    const imgCenterY = (imgMinY + imgMaxY) / 2;

    if (imgWidth === 0 || imgHeight === 0) {
      return;
    }

    // Calculate the scale
    const newScale = mapWidth / (baseWidthDeg * imgWidth);

    // Calculate the aspect ratio adjustment
    const imageAspect = imageSize.width / imageSize.height;
    const fullImageWidthDeg = baseWidthDeg * newScale;
    const expectedFullImageHeightDeg = mapHeight / imgHeight;
    const newAspectRatioAdjust = fullImageWidthDeg / (imageAspect * expectedFullImageHeightDeg);

    // Calculate the center position
    const fullImageHeightDeg = fullImageWidthDeg / (imageAspect * newAspectRatioAdjust);
    const newCenterLng = mapCenterLng - (imgCenterX - 0.5) * fullImageWidthDeg;
    const newCenterLat = mapCenterLat + (imgCenterY - 0.5) * fullImageHeightDeg;


    onComplete({
      scale: Math.max(0.01, Math.min(20, newScale)),
      aspectRatioAdjust: Math.max(0.1, Math.min(10, newAspectRatioAdjust)),
      centerLng: newCenterLng,
      centerLat: newCenterLat,
      mapPoints: mp as { west: { lng: number; lat: number }; east: { lng: number; lat: number }; south: { lng: number; lat: number }; north: { lng: number; lat: number } },
      imagePoints: ip as { west: { x: number; y: number }; east: { x: number; y: number }; south: { x: number; y: number }; north: { x: number; y: number } },
    });
  }, [mapPoints, imagePoints, imageSize, baseWidthDeg, onComplete]);

  const currentMapPoint = mapPoints[currentStep];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Stepper */}
      <Stepper activeStep={currentStepIdx} sx={{ mb: 2 }}>
        {STEPS.map((step) => (
          <Step key={step} completed={imagePoints[step] !== null}>
            <StepLabel
              optional={
                imagePoints[step] ? (
                  <CheckCircleIcon color="success" sx={{ fontSize: 16 }} />
                ) : null
              }
            >
              {STEP_LABELS[step]}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Main content - Map and Image side by side */}
      <Box sx={{ display: 'flex', gap: 2, height: 400 }}>
        {/* Left: Map showing the current extreme point */}
        <Paper variant="outlined" sx={{ flex: 1, position: 'relative', overflow: 'hidden', height: '100%' }}>
          <Typography
            variant="subtitle2"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 10,
              bgcolor: 'background.paper',
              px: 1,
              py: 0.5,
              borderRadius: 1,
              boxShadow: 1,
            }}
          >
            📍 {STEP_LABELS[currentStep]} point on MAP
          </Typography>

          <Map
            ref={mapRef}
            initialViewState={{
              longitude: currentMapPoint?.lng ?? 0,
              latitude: currentMapPoint?.lat ?? 20,
              zoom: 6,
            }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={MAP_STYLE}
          >
            <NavigationControl position="top-right" showCompass={false} />

            {/* Current point marker - crosshair style */}
            {currentMapPoint && (
              <Marker longitude={currentMapPoint.lng} latitude={currentMapPoint.lat}>
                <Box sx={{ position: 'relative' }}>
                  {/* Crosshair lines */}
                  <Box sx={{
                    position: 'absolute',
                    left: '50%',
                    top: -24,
                    width: 3,
                    height: 20,
                    bgcolor: 'error.main',
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 3px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    left: '50%',
                    bottom: -24,
                    width: 3,
                    height: 20,
                    bgcolor: 'error.main',
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 3px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    top: '50%',
                    left: -24,
                    width: 20,
                    height: 3,
                    bgcolor: 'error.main',
                    transform: 'translateY(-50%)',
                    boxShadow: '0 0 3px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    top: '50%',
                    right: -24,
                    width: 20,
                    height: 3,
                    bgcolor: 'error.main',
                    transform: 'translateY(-50%)',
                    boxShadow: '0 0 3px white',
                  }} />
                  {/* Center point */}
                  <Box sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: 'error.main',
                    border: '2px solid white',
                    boxShadow: 3,
                    animation: 'pulse 1.5s infinite',
                    '@keyframes pulse': {
                      '0%': { transform: 'scale(1)' },
                      '50%': { transform: 'scale(1.2)' },
                      '100%': { transform: 'scale(1)' },
                    },
                  }} />
                  {/* Label */}
                  <Typography
                    variant="caption"
                    sx={{
                      position: 'absolute',
                      top: -38,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      bgcolor: 'error.main',
                      color: 'white',
                      px: 1,
                      py: 0.25,
                      borderRadius: 0.5,
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      boxShadow: 2,
                    }}
                  >
                    {STEP_LABELS[currentStep]}
                  </Typography>
                </Box>
              </Marker>
            )}
          </Map>
        </Paper>

        {/* Right: Image to click */}
        <Paper variant="outlined" sx={{ flex: 1, position: 'relative', overflow: 'hidden', height: '100%' }}>
          <Typography
            variant="subtitle2"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 10,
              bgcolor: 'background.paper',
              px: 1,
              py: 0.5,
              borderRadius: 1,
              boxShadow: 1,
            }}
          >
            👆 Click {STEP_LABELS[currentStep]} point on IMAGE
          </Typography>

          {/* Zoom controls */}
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
              bgcolor: 'background.paper',
              borderRadius: 1,
              boxShadow: 1,
              p: 0.5,
            }}
          >
            <Tooltip title="Zoom in" placement="left">
              <IconButton size="small" onClick={handleZoomIn}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Zoom out" placement="left">
              <IconButton size="small" onClick={handleZoomOut}>
                <ZoomOutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reset view" placement="left">
              <IconButton size="small" onClick={handleResetView}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Typography variant="caption" sx={{ textAlign: 'center' }}>
              {Math.round(imageZoom * 100)}%
            </Typography>
          </Box>

          {/* Image container */}
          <Box
            ref={imageContainerRef}
            onClick={handleImageClick}
            onMouseDown={handleImageMouseDown}
            onMouseMove={handleImageMouseMove}
            onMouseUp={handleImageMouseUp}
            onMouseLeave={handleImageMouseUp}
            sx={{
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              cursor: isPanning ? 'grabbing' : 'crosshair',
              bgcolor: 'grey.200',
              position: 'relative',
            }}
          >
            {/* Transformed image */}
            <Box
              sx={{
                position: 'absolute',
                transform: `scale(${imageZoom}) translate(${imagePan.x / imageZoom}px, ${imagePan.y / imageZoom}px)`,
                transformOrigin: 'top left',
                width: '100%',
                height: '100%',
              }}
            >
              <Box
                component="img"
                src={imageUrl}
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                }}
              />
            </Box>

            {/* Markers layer - NOT transformed, uses screen coordinates */}
            {/* Show pending point (not yet confirmed) - crosshair style */}
            {pendingPoint && (() => {
              const pos = imagePointToScreen(pendingPoint);
              return (
                <Box
                  sx={{
                    position: 'absolute',
                    left: pos.x,
                    top: pos.y,
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                  }}
                >
                  {/* Crosshair lines */}
                  <Box sx={{
                    position: 'absolute',
                    left: '50%',
                    top: -20,
                    width: 2,
                    height: 16,
                    bgcolor: 'warning.main',
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    left: '50%',
                    bottom: -20,
                    width: 2,
                    height: 16,
                    bgcolor: 'warning.main',
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    top: '50%',
                    left: -20,
                    width: 16,
                    height: 2,
                    bgcolor: 'warning.main',
                    transform: 'translateY(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    top: '50%',
                    right: -20,
                    width: 16,
                    height: 2,
                    bgcolor: 'warning.main',
                    transform: 'translateY(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  {/* Center point */}
                  <Box sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: 'warning.main',
                    border: '2px solid white',
                    boxShadow: 2,
                    animation: 'pulse 1s infinite',
                    '@keyframes pulse': {
                      '0%': { transform: 'scale(1)' },
                      '50%': { transform: 'scale(1.2)' },
                      '100%': { transform: 'scale(1)' },
                    },
                  }} />
                  {/* Label */}
                  <Typography
                    variant="caption"
                    sx={{
                      position: 'absolute',
                      top: -32,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      bgcolor: 'warning.main',
                      color: 'white',
                      px: 0.5,
                      borderRadius: 0.5,
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {currentStep.charAt(0).toUpperCase()}?
                  </Typography>
                </Box>
              );
            })()}

            {/* Show confirmed points - crosshair style */}
            {STEPS.map(step => {
              const point = imagePoints[step];
              if (!point) return null;
              const pos = imagePointToScreen(point);
              const isCurrentStep = step === currentStep;
              const color = isCurrentStep ? 'warning.main' : 'success.main';
              return (
                <Box
                  key={step}
                  sx={{
                    position: 'absolute',
                    left: pos.x,
                    top: pos.y,
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                  }}
                >
                  {/* Crosshair lines */}
                  <Box sx={{
                    position: 'absolute',
                    left: '50%',
                    top: -16,
                    width: 2,
                    height: 12,
                    bgcolor: color,
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    left: '50%',
                    bottom: -16,
                    width: 2,
                    height: 12,
                    bgcolor: color,
                    transform: 'translateX(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    top: '50%',
                    left: -16,
                    width: 12,
                    height: 2,
                    bgcolor: color,
                    transform: 'translateY(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  <Box sx={{
                    position: 'absolute',
                    top: '50%',
                    right: -16,
                    width: 12,
                    height: 2,
                    bgcolor: color,
                    transform: 'translateY(-50%)',
                    boxShadow: '0 0 2px white',
                  }} />
                  {/* Center point */}
                  <Box sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: color,
                    border: '1px solid white',
                    boxShadow: 1,
                  }} />
                  {/* Label */}
                  <Typography
                    variant="caption"
                    sx={{
                      position: 'absolute',
                      top: -26,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      bgcolor: color,
                      color: 'white',
                      px: 0.5,
                      borderRadius: 0.5,
                      fontSize: '0.65rem',
                      fontWeight: 'bold',
                    }}
                  >
                    {step.charAt(0).toUpperCase()}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {/* Instructions */}
          <Typography
            variant="caption"
            sx={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              right: 8,
              bgcolor: pendingPoint ? 'warning.light' : 'rgba(255,255,255,0.9)',
              px: 1,
              py: 0.5,
              borderRadius: 1,
              textAlign: 'center',
              fontWeight: pendingPoint ? 'bold' : 'normal',
            }}
          >
            {pendingPoint
              ? '👆 Click on the appeared point to confirm it'
              : 'Drag to pan • Click to place point • Scroll or buttons to zoom'}
          </Typography>
        </Paper>
      </Box>

      {/* Navigation buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
        <Button variant="outlined" color="error" onClick={onCancel}>
          Cancel
        </Button>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            onClick={handleBack}
            disabled={currentStepIdx === 0}
          >
            Back
          </Button>

          <Button
            variant="contained"
            color="success"
            onClick={handleApply}
            disabled={!isAllComplete}
          >
            Apply Calibration
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
