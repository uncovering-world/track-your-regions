import { useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  CircularProgress,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MapGL, { NavigationControl, Source, Layer, MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

interface PreviewDivision {
  name: string;
  path?: string;
}

interface DivisionPreviewDialogProps {
  division: PreviewDivision | null;
  geometry: GeoJSON.Geometry | null;
  loading: boolean;
  onClose: () => void;
}

export function DivisionPreviewDialog({
  division,
  geometry,
  loading,
  onClose,
}: DivisionPreviewDialogProps) {
  const mapRef = useRef<MapRef>(null);

  return (
    <Dialog
      open={!!division}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">{division?.name}</Typography>
            {division?.path && (
              <Typography variant="caption" color="text.secondary">
                {division.path}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ height: 350 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <CircularProgress />
            </Box>
          ) : geometry ? (
            <MapGL
              ref={mapRef}
              initialViewState={{
                longitude: 0,
                latitude: 0,
                zoom: 1,
              }}
              style={{ width: '100%', height: '100%' }}
              mapStyle={MAP_STYLE}
              onLoad={() => {
                // Fit to bounds when map loads
                if (mapRef.current && geometry) {
                  try {
                    const fc: GeoJSON.FeatureCollection = {
                      type: 'FeatureCollection',
                      features: [{ type: 'Feature', properties: {}, geometry }],
                    };
                    const bbox = turf.bbox(fc) as [number, number, number, number];
                    mapRef.current.fitBounds(
                      [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                      { padding: 40, duration: 500 }
                    );
                  } catch (e) {
                    console.error('Failed to fit bounds:', e);
                  }
                }
              }}
            >
              <NavigationControl position="top-right" showCompass={false} />
              <Source
                id="preview-division"
                type="geojson"
                data={{
                  type: 'Feature',
                  properties: {},
                  geometry,
                }}
              >
                <Layer
                  id="preview-division-fill"
                  type="fill"
                  paint={{
                    'fill-color': '#3388ff',
                    'fill-opacity': 0.4,
                  }}
                />
                <Layer
                  id="preview-division-outline"
                  type="line"
                  paint={{
                    'line-color': '#3388ff',
                    'line-width': 2,
                  }}
                />
              </Source>
            </MapGL>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Typography color="text.secondary">No geometry available</Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
