import { useRef, useState, useEffect } from 'react';
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
import MapGL, { NavigationControl, Source, Layer, MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { fetchGeoshape } from '../../../../api/adminWorldViewImport';

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
  /** Region map image URL for side-by-side comparison */
  regionMapUrl?: string;
  /** Wikidata ID for geoshape fallback (when no regionMapUrl) */
  wikidataId?: string;
  /** Optional accept callback — when provided, shows an Accept button */
  onAccept?: () => void;
  /** Optional reject callback — when provided, shows a Reject button */
  onReject?: () => void;
  /** Optional accept-and-reject-rest callback — accepts this and rejects remaining suggestions */
  onAcceptAndRejectRest?: () => void;
  /** Whether accept/reject actions are in progress */
  actionPending?: boolean;
}

export function DivisionPreviewDialog({
  division,
  geometry,
  loading,
  onClose,
  regionMapUrl,
  wikidataId,
  onAccept,
  onReject,
  onAcceptAndRejectRest,
  actionPending,
}: DivisionPreviewDialogProps) {
  const mapRef = useRef<MapRef>(null);
  const geoshapeMapRef = useRef<MapRef>(null);
  const [geoshapeData, setGeoshapeData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoshapeLoading, setGeoshapeLoading] = useState(false);
  const [geoshapeError, setGeoshapeError] = useState(false);

  // Fetch geoshape when dialog opens with wikidataId (and no regionMapUrl)
  useEffect(() => {
    if (!division || regionMapUrl || !wikidataId) {
      setGeoshapeData(null);
      setGeoshapeError(false);
      return;
    }

    let stale = false;
    setGeoshapeLoading(true);
    setGeoshapeError(false);
    fetchGeoshape(wikidataId)
      .then(data => { if (!stale) setGeoshapeData(data); })
      .catch(() => { if (!stale) setGeoshapeError(true); })
      .finally(() => { if (!stale) setGeoshapeLoading(false); });
    return () => { stale = true; };
  }, [division, regionMapUrl, wikidataId]);

  const hasImageSideBySide = !!regionMapUrl;
  const hasGeoshapeSideBySide = !regionMapUrl && !!wikidataId && !geoshapeError;
  const hasSideBySide = hasImageSideBySide || hasGeoshapeSideBySide;

  return (
    <Dialog
      open={!!division}
      onClose={onClose}
      maxWidth={hasSideBySide ? 'md' : 'sm'}
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
        <Box sx={{ display: 'flex', height: 400 }}>
          {/* Region map image (left side) */}
          {hasImageSideBySide && (
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
                src={`${regionMapUrl}?width=500`}
                alt="Region map"
                sx={{
                  maxWidth: '100%',
                  maxHeight: 360,
                  objectFit: 'contain',
                }}
              />
            </Box>
          )}

          {/* Wikidata geoshape map (left side, fallback when no regionMapUrl) */}
          {hasGeoshapeSideBySide && (
            <Box sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              borderRight: 1,
              borderColor: 'divider',
            }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', pt: 0.5 }}>
                Source region
              </Typography>
              {geoshapeLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : geoshapeData ? (
                <MapGL
                  ref={geoshapeMapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', flex: 1 }}
                  mapStyle={MAP_STYLE}
                  onLoad={() => {
                    if (geoshapeMapRef.current && geoshapeData) {
                      try {
                        const bbox = turf.bbox(geoshapeData) as [number, number, number, number];
                        geoshapeMapRef.current.fitBounds(
                          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                          { padding: 40, duration: 500 },
                        );
                      } catch (e) {
                        console.error('Failed to fit geoshape bounds:', e);
                      }
                    }
                  }}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source id="geoshape" type="geojson" data={geoshapeData}>
                    <Layer
                      id="geoshape-fill"
                      type="fill"
                      paint={{ 'fill-color': '#e53935', 'fill-opacity': 0.3 }}
                    />
                    <Layer
                      id="geoshape-outline"
                      type="line"
                      paint={{ 'line-color': '#e53935', 'line-width': 2 }}
                    />
                  </Source>
                </MapGL>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">No geoshape available</Typography>
                </Box>
              )}
            </Box>
          )}

          {/* GADM division map (right side, or full width if no WV image/geoshape) */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress />
              </Box>
            ) : geometry ? (
              <>
                {hasSideBySide && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', pt: 0.5 }}>
                    GADM division
                  </Typography>
                )}
                <MapGL
                  ref={mapRef}
                  initialViewState={{
                    longitude: 0,
                    latitude: 0,
                    zoom: 1,
                  }}
                  style={{ width: '100%', height: hasSideBySide ? 'calc(100% - 20px)' : '100%' }}
                  mapStyle={MAP_STYLE}
                  onLoad={() => {
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
              </>
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Typography color="text.secondary">No geometry available</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      {(onAccept || onReject) && (
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          {onReject && (
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<CloseIcon />}
              onClick={onReject}
              disabled={actionPending}
            >
              Reject
            </Button>
          )}
          {onAcceptAndRejectRest && (
            <Button
              variant="outlined"
              color="success"
              size="small"
              startIcon={<CheckIcon />}
              onClick={onAcceptAndRejectRest}
              disabled={actionPending}
            >
              Accept &amp; reject rest
            </Button>
          )}
          {onAccept && (
            <Button
              variant="contained"
              color="success"
              size="small"
              startIcon={<CheckIcon />}
              onClick={onAccept}
              disabled={actionPending}
            >
              Accept
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
}
