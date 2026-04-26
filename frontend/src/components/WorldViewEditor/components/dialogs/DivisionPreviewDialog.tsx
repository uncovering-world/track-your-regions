import { useRef, useState, useEffect, useMemo } from 'react';
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
import { fetchGeoshape } from '../../../../api/admin/worldViewImport';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

interface PreviewDivision {
  name: string;
  path?: string;
}

interface DivisionPreviewDialogProps {
  division: PreviewDivision | null;
  /** GADM division geometry, or a role-tagged FeatureCollection for transfer preview */
  geometry: GeoJSON.Geometry | GeoJSON.FeatureCollection | null;
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
  /** Override label for the Accept button (default: "Accept") */
  acceptLabel?: string;
  /** Marker points extracted from Wikivoyage article (shown when no geoshape/image) */
  markerPoints?: Array<{ name: string; lat: number; lon: number }>;
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
  acceptLabel,
  markerPoints,
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

  // Detect transfer preview: a FeatureCollection with role-tagged features
  const isTransferPreview = geometry != null
    && 'type' in geometry && geometry.type === 'FeatureCollection'
    && (geometry as GeoJSON.FeatureCollection).features.some(f => f.properties?.role === 'donor');

  const transferData = useMemo(() => {
    if (!isTransferPreview) return null;
    const fc = geometry as GeoJSON.FeatureCollection;
    return {
      donor: { type: 'FeatureCollection' as const, features: fc.features.filter(f => f.properties?.role === 'donor') },
      moving: { type: 'FeatureCollection' as const, features: fc.features.filter(f => f.properties?.role === 'moving') },
      outline: { type: 'FeatureCollection' as const, features: fc.features.filter(f => f.properties?.role === 'target_outline') },
      bounds: turf.bbox(fc) as [number, number, number, number],
    };
  }, [isTransferPreview, geometry]);

  const hasImageSideBySide = !isTransferPreview && !!regionMapUrl;
  const hasGeoshapeSideBySide = !isTransferPreview && !regionMapUrl && !!wikidataId && !geoshapeError;
  const hasMarkerPointsSideBySide = !isTransferPreview && !regionMapUrl && (!wikidataId || geoshapeError) && !!markerPoints && markerPoints.length > 0;
  const hasSideBySide = hasImageSideBySide || hasGeoshapeSideBySide || hasMarkerPointsSideBySide;

  // Build GeoJSON FeatureCollection for marker points
  const markerPointsGeoJSON: GeoJSON.FeatureCollection | null = hasMarkerPointsSideBySide && markerPoints ? {
    type: 'FeatureCollection',
    features: markerPoints.map(p => ({
      type: 'Feature' as const,
      properties: { name: p.name },
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    })),
  } : null;

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

          {/* Wikivoyage marker points map (left side, fallback when no regionMapUrl and no geoshape) */}
          {hasMarkerPointsSideBySide && markerPointsGeoJSON && (
            <Box sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              borderRight: 1,
              borderColor: 'divider',
            }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', pt: 0.5 }}>
                Marker points ({markerPoints!.length})
              </Typography>
              <MapGL
                initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                style={{ width: '100%', flex: 1 }}
                mapStyle={MAP_STYLE}
                onLoad={(e) => {
                  try {
                    const bbox = turf.bbox(markerPointsGeoJSON) as [number, number, number, number];
                    e.target.fitBounds(
                      [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                      { padding: 60, duration: 500, maxZoom: 10 },
                    );
                  } catch (err) {
                    console.error('Failed to fit marker points bounds:', err);
                  }
                }}
              >
                <NavigationControl position="top-right" showCompass={false} />
                <Source id="marker-points" type="geojson" data={markerPointsGeoJSON}>
                  <Layer
                    id="marker-points-circle"
                    type="circle"
                    paint={{
                      'circle-color': '#ff9800',
                      'circle-radius': 5,
                      'circle-stroke-color': '#e65100',
                      'circle-stroke-width': 1,
                    }}
                  />
                </Source>
              </MapGL>
            </Box>
          )}

          {/* Transfer preview map — full-width 3-layer map (donor/moving/target_outline) */}
          {isTransferPreview && transferData && (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, pt: 0.5, pb: 0.25 }}>
                <Typography variant="caption" sx={{ color: '#e53935', fontSize: '0.65rem' }}>■ donor region</Typography>
                <Typography variant="caption" sx={{ color: '#ff9800', fontSize: '0.65rem' }}>■ moving divisions</Typography>
                <Typography variant="caption" sx={{ color: '#3388ff', fontSize: '0.65rem' }}>□ target outline</Typography>
              </Box>
              <MapGL
                ref={mapRef}
                initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                style={{ width: '100%', height: 'calc(100% - 26px)' }}
                mapStyle={MAP_STYLE}
                onLoad={() => {
                  if (mapRef.current) {
                    try {
                      const b = transferData.bounds;
                      mapRef.current.fitBounds(
                        [[b[0], b[1]], [b[2], b[3]]],
                        { padding: 40, duration: 500 },
                      );
                    } catch (e) {
                      console.error('Failed to fit transfer bounds:', e);
                    }
                  }
                }}
              >
                <NavigationControl position="top-right" showCompass={false} />
                <Source id="transfer-donor" type="geojson" data={transferData.donor}>
                  <Layer id="transfer-donor-fill" type="fill" paint={{ 'fill-color': '#e53935', 'fill-opacity': 0.2 }} />
                  <Layer id="transfer-donor-outline" type="line" paint={{ 'line-color': '#e53935', 'line-width': 2 }} />
                </Source>
                <Source id="transfer-moving" type="geojson" data={transferData.moving}>
                  <Layer id="transfer-moving-fill" type="fill" paint={{ 'fill-color': '#ff9800', 'fill-opacity': 0.45 }} />
                  <Layer id="transfer-moving-outline" type="line" paint={{ 'line-color': '#ff9800', 'line-width': 2 }} />
                </Source>
                <Source id="transfer-outline" type="geojson" data={transferData.outline}>
                  <Layer id="transfer-outline-line" type="line" paint={{ 'line-color': '#3388ff', 'line-width': 2, 'line-dasharray': [4, 3] }} />
                </Source>
              </MapGL>
            </Box>
          )}

          {/* GADM division map (right side, or full width if no WV image/geoshape) */}
          {!isTransferPreview && (
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
                          const geom = geometry as GeoJSON.Geometry;
                          const fc: GeoJSON.FeatureCollection = {
                            type: 'FeatureCollection',
                            features: [{ type: 'Feature', properties: {}, geometry: geom }],
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
                        geometry: geometry as GeoJSON.Geometry,
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
          )}
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
              {acceptLabel ?? 'Accept'}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
}
