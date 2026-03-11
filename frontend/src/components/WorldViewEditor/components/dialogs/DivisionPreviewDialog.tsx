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
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
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
  /** Single geometry or FeatureCollection (for multi-division with individual borders) */
  geometry: GeoJSON.Geometry | GeoJSON.FeatureCollection | null;
  loading: boolean;
  onClose: () => void;
  /** Region map image URL for side-by-side comparison */
  regionMapUrl?: string;
  /** Label override for the region map panel (e.g. "Parent region map" when using fallback) */
  regionMapLabel?: string;
  /** Name of the region being reviewed (shown in the strip header) */
  regionName?: string;
  /** Wikidata ID for geoshape fallback (when no regionMapUrl) */
  wikidataId?: string;
  /** Optional accept callback — when provided, shows an Accept button */
  onAccept?: () => void;
  /** Optional reject callback — when provided, shows a Reject button */
  onReject?: () => void;
  /** Optional accept-and-reject-rest callback — accepts this and rejects remaining suggestions */
  onAcceptAndRejectRest?: () => void;
  /** Optional split-deeper callback — replaces divisions with finer-grained children */
  onSplitDeeper?: () => void;
  /** Optional AI vision match callback — suggests divisions via image analysis */
  onVisionMatch?: () => Promise<{ ids: number[]; rejectedIds?: number[]; unclearIds?: number[]; reasoning?: string; debugImages?: { regionMap: string; divisionsMap: string } }>;
  /** Whether accept/reject actions are in progress */
  actionPending?: boolean;
}

export function DivisionPreviewDialog({
  division,
  geometry,
  loading,
  onClose,
  regionMapUrl,
  regionMapLabel,
  regionName,
  wikidataId,
  onAccept,
  onReject,
  onAcceptAndRejectRest,
  onSplitDeeper,
  onVisionMatch,
  actionPending,
}: DivisionPreviewDialogProps) {
  const mapRef = useRef<MapRef>(null);
  const geoshapeMapRef = useRef<MapRef>(null);
  const [geoshapeData, setGeoshapeData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoshapeLoading, setGeoshapeLoading] = useState(false);
  const [geoshapeError, setGeoshapeError] = useState(false);
  const [preferImage, setPreferImage] = useState(false);
  const [aiSuggestedIds, setAiSuggestedIds] = useState<Set<number>>(new Set());
  const [aiRejectedIds, setAiRejectedIds] = useState<Set<number>>(new Set());
  const [aiUnclearIds, setAiUnclearIds] = useState<Set<number>>(new Set());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiDebugImages, setAiDebugImages] = useState<{ regionMap: string; divisionsMap: string } | null>(null);

  // Fetch geoshape when dialog opens with wikidataId (preferred over image)
  useEffect(() => {
    if (!division || !wikidataId) {
      setGeoshapeData(null);
      setGeoshapeError(false);
      setPreferImage(false);
      setAiSuggestedIds(new Set());
      setAiRejectedIds(new Set());
      setAiUnclearIds(new Set());
      setAiReasoning(null);
      setAiDebugImages(null);
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
  }, [division, wikidataId]);

  // Geoshape preferred; fall back to image only when geoshape unavailable/empty
  const geoshapeHasFeatures = !!geoshapeData && geoshapeData.features.length > 0;
  const geoshapeAvailable = !!wikidataId && !geoshapeError && (geoshapeLoading || geoshapeHasFeatures);
  const imageAvailable = !!regionMapUrl;
  const canToggle = geoshapeAvailable && imageAvailable;
  const showGeoshape = geoshapeAvailable && !preferImage;
  const showImage = imageAvailable && (!geoshapeAvailable || preferImage);
  // Show side-by-side when we have content OR when we tried to fetch (show placeholder)
  const hasSideBySide = showGeoshape || showImage || !!wikidataId;

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
            {regionName && (
              <Typography variant="body2" color="text.secondary">
                reviewing for <strong>{regionName}</strong>
              </Typography>
            )}
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
        {/* Fixed toggle strip between title and maps */}
        {hasSideBySide && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 2, py: 0.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {showGeoshape ? 'Source region' : showImage ? (regionMapLabel ?? 'Region map') : 'Source region'}
              {canToggle && (
                <Typography component="span" variant="caption" sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }} onClick={() => setPreferImage(prev => !prev)}>
                  switch to {preferImage ? 'geoshape' : 'image'}
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary">GADM division <strong>{division?.name}</strong></Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', height: hasSideBySide ? 380 : 400 }}>
          {/* Region map image (left side) */}
          {showImage && (
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

          {/* Wikidata geoshape map (left side) */}
          {showGeoshape && (
            <Box sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              borderRight: 1,
              borderColor: 'divider',
            }}>
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
                          { padding: 40, duration: 0 },
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

          {/* Placeholder when neither geoshape nor image is available */}
          {hasSideBySide && !showGeoshape && !showImage && (
            <Box sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: 'grey.50',
              p: 2,
            }}>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                No source map available
              </Typography>
              <Typography variant="caption" color="text.disabled" textAlign="center" sx={{ mt: 0.5 }}>
                Neither a region map image nor a Wikidata geoshape exists for this region
              </Typography>
            </Box>
          )}

          {/* GADM division map (right side, or full width if no WV image/geoshape) */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress />
              </Box>
            ) : geometry ? (() => {
              const rawData: GeoJSON.FeatureCollection = geometry.type === 'FeatureCollection'
                ? geometry as GeoJSON.FeatureCollection
                : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: geometry as GeoJSON.Geometry }] };
              // Enrich with AI classification flags
              const hasAiResults = aiSuggestedIds.size > 0 || aiRejectedIds.size > 0 || aiUnclearIds.size > 0;
              const geoData: GeoJSON.FeatureCollection = hasAiResults
                ? {
                    ...rawData,
                    features: rawData.features.map(f => {
                      const divId = f.properties?.divisionId;
                      if (divId == null) return f;
                      const aiClass = aiSuggestedIds.has(divId) ? 'inside'
                        : aiRejectedIds.has(divId) ? 'outside'
                        : aiUnclearIds.has(divId) ? 'unclear'
                        : null;
                      return aiClass ? { ...f, properties: { ...f.properties, aiClass } } : f;
                    }),
                  }
                : rawData;
              return (
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
                    if (mapRef.current && geometry) {
                      try {
                        const bbox = turf.bbox(geoData) as [number, number, number, number];
                        mapRef.current.fitBounds(
                          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                          { padding: 40, duration: 0 }
                        );
                      } catch (e) {
                        console.error('Failed to fit bounds:', e);
                      }
                    }
                  }}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source id="preview-division" type="geojson" data={geoData}>
                    <Layer
                      id="preview-division-fill"
                      type="fill"
                      filter={['!=', ['geometry-type'], 'Point']}
                      paint={{
                        'fill-color': ['case',
                          ['has', 'assignedTo'], '#9e9e9e',
                          ['==', ['get', 'aiClass'], 'inside'], '#4caf50',
                          ['==', ['get', 'aiClass'], 'outside'], '#f44336',
                          ['==', ['get', 'aiClass'], 'unclear'], '#ff9800',
                          ['==', ['get', 'hasPoints'], true], '#4caf50',
                          '#3388ff',
                        ],
                        'fill-opacity': ['case',
                          ['has', 'assignedTo'], 0.15,
                          ['==', ['get', 'aiClass'], 'inside'], 0.5,
                          ['==', ['get', 'aiClass'], 'outside'], 0.2,
                          ['==', ['get', 'aiClass'], 'unclear'], 0.4,
                          ['==', ['get', 'hasPoints'], true], 0.5,
                          0.4,
                        ],
                      }}
                    />
                    <Layer
                      id="preview-division-outline"
                      type="line"
                      filter={['!=', ['geometry-type'], 'Point']}
                      paint={{
                        'line-color': ['case',
                          ['has', 'assignedTo'], '#9e9e9e',
                          ['==', ['get', 'aiClass'], 'inside'], '#2e7d32',
                          ['==', ['get', 'aiClass'], 'outside'], '#c62828',
                          ['==', ['get', 'aiClass'], 'unclear'], '#e65100',
                          ['==', ['get', 'hasPoints'], true], '#2e7d32',
                          '#3388ff',
                        ],
                        'line-width': ['case',
                          ['has', 'assignedTo'], 1,
                          ['has', 'aiClass'], 2,
                          2,
                        ],
                      }}
                    />
                    <Layer
                      id="preview-markers"
                      type="circle"
                      filter={['==', ['geometry-type'], 'Point']}
                      paint={{
                        'circle-radius': 5,
                        'circle-color': '#e53935',
                        'circle-stroke-color': '#fff',
                        'circle-stroke-width': 1.5,
                      }}
                    />
                  </Source>
                </MapGL>
              );
            })() : (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <Typography color="text.secondary">No geometry available</Typography>
              </Box>
            )}
          </Box>
        </Box>
      {aiReasoning && (
        <Box sx={{ px: 2, py: 0.5, borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            <strong>AI reasoning:</strong> {aiReasoning}
          </Typography>
          {aiDebugImages && (
            <Button size="small" variant="text" sx={{ fontSize: '0.7rem', minWidth: 0, py: 0 }} onClick={() => {
              const w = window.open('', '_blank', 'width=1400,height=700');
              if (!w) return;
              w.document.title = 'AI Vision Debug';
              const doc = w.document;
              const root = doc.createElement('div');
              Object.assign(root.style, { display: 'flex', gap: '16px', padding: '16px', fontFamily: 'sans-serif', background: '#f5f5f5', minHeight: '100vh' });
              const entries: [string, string][] = [['Image 1: Region Map', aiDebugImages.regionMap], ['Image 2: Numbered Divisions', aiDebugImages.divisionsMap]];
              for (const [title, src] of entries) {
                const col = doc.createElement('div');
                col.style.flex = '1';
                const h = doc.createElement('h3');
                h.textContent = title;
                Object.assign(h.style, { margin: '0 0 8px' });
                const img = doc.createElement('img');
                img.src = src;
                Object.assign(img.style, { maxWidth: '100%', border: '1px solid #ccc', borderRadius: '4px' });
                col.append(h, img);
                root.appendChild(col);
              }
              doc.body.appendChild(root);
            }}>
              Show AI inputs
            </Button>
          )}
        </Box>
      )}
      </DialogContent>
      {(onAccept || onReject || onSplitDeeper || onVisionMatch) && (
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1, mr: 'auto' }}>
            {onSplitDeeper && (
              <Button
                variant="outlined"
                color="info"
                size="small"
                startIcon={<UnfoldMoreIcon />}
                onClick={onSplitDeeper}
                disabled={actionPending || aiLoading}
              >
                Split deeper
              </Button>
            )}
            {onVisionMatch && (
              <Button
                variant="outlined"
                color="warning"
                size="small"
                startIcon={aiLoading ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
                onClick={async () => {
                  setAiLoading(true);
                  setAiReasoning(null);
                  setAiDebugImages(null);
                  try {
                    const result = await onVisionMatch();
                    setAiSuggestedIds(new Set(result.ids));
                    setAiRejectedIds(new Set(result.rejectedIds ?? []));
                    setAiUnclearIds(new Set(result.unclearIds ?? []));
                    if (result.reasoning) setAiReasoning(result.reasoning);
                    if (result.debugImages) setAiDebugImages(result.debugImages);
                  } catch (err) {
                    console.error('Vision match failed:', err);
                    setAiReasoning(`Error: ${err instanceof Error ? err.message : 'AI analysis failed'}`);
                  } finally {
                    setAiLoading(false);
                  }
                }}
                disabled={actionPending || aiLoading}
              >
                {aiLoading ? 'Analyzing...' : 'Suggest with AI'}
              </Button>
            )}
          </Box>
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
