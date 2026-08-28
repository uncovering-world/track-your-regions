import { useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import { NavigationControl, Source, Layer, MapRef } from 'react-map-gl/maplibre';
import { GuardedMap as MapGL } from '../shared/GuardedMap';
import { frameGeoJson } from '../../utils/mapUtils';
import { toThumbnailUrl } from '../../utils/imageUrl';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

interface SmartFlattenPreviewDialogProps {
  open: boolean;
  regionName: string;
  geometry: GeoJSON.Geometry | null;
  regionMapUrl: string | null;
  descendants: number;
  divisions: number;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}

export function SmartFlattenPreviewDialog({
  open,
  regionName,
  geometry,
  regionMapUrl,
  descendants,
  divisions,
  onConfirm,
  onCancel,
  confirming,
}: SmartFlattenPreviewDialogProps) {
  const mapRef = useRef<MapRef>(null);
  // The stored map is wiki content: drawn only as toThumbnailUrl allows (#694).
  const mapSrc = regionMapUrl ? toThumbnailUrl(regionMapUrl, 500) : '';
  const hasSideBySide = !!mapSrc;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth={hasSideBySide ? 'md' : 'sm'}
      fullWidth
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">Smart Flatten: {regionName}</Typography>
            <Typography variant="caption" color="text.secondary">
              Will absorb {descendants} descendant{descendants !== 1 ? 's' : ''} ({divisions} division{divisions !== 1 ? 's' : ''})
            </Typography>
          </Box>
          <IconButton onClick={onCancel} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', height: 400 }}>
          {/* Region map image (left side) */}
          {hasSideBySide && (
            <Box sx={{
              flex: 1,
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
                src={mapSrc}
                alt="Region map"
                sx={{
                  maxWidth: '100%',
                  maxHeight: 360,
                  objectFit: 'contain',
                }}
              />
            </Box>
          )}

          {/* Unified GADM geometry map (right side, or full width) */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {geometry ? (
              <>
                {hasSideBySide && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', pt: 0.5 }}>
                    GADM divisions (unified)
                  </Typography>
                )}
                <MapGL
                  ref={mapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', height: hasSideBySide ? 'calc(100% - 20px)' : '100%' }}
                  mapStyle={MAP_STYLE}
                  onLoad={() => frameGeoJson(mapRef.current, geometry, { padding: 40, duration: 500 })}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source
                    id="flatten-preview"
                    type="geojson"
                    data={{ type: 'Feature', properties: {}, geometry }}
                  >
                    <Layer
                      id="flatten-preview-fill"
                      type="fill"
                      paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.4 }}
                    />
                    <Layer
                      id="flatten-preview-outline"
                      type="line"
                      paint={{ 'line-color': '#3388ff', 'line-width': 2 }}
                    />
                  </Source>
                </MapGL>
              </>
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Typography color="text.secondary">No geometry available</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={onCancel}
          disabled={confirming}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          size="small"
          startIcon={confirming ? <CircularProgress size={16} /> : <CheckIcon />}
          onClick={onConfirm}
          disabled={confirming}
        >
          Confirm Flatten
        </Button>
      </DialogActions>
    </Dialog>
  );
}
