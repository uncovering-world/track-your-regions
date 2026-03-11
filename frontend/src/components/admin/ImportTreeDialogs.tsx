import { useState, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
} from '@mui/material';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';

export const COVERAGE_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Extracted to avoid re-rendering the entire tree on every keystroke */
export function ManualFixDialog({ state, onClose, onSubmit, isPending }: {
  state: { regionId: number; regionName: string } | null;
  onClose: () => void;
  onSubmit: (regionId: number, fixNote: string | undefined) => void;
  isPending: boolean;
}) {
  const [fixNote, setFixNote] = useState('');

  // Reset note when dialog opens with a new region
  const prevRegionId = state?.regionId;
  const [lastRegionId, setLastRegionId] = useState<number | undefined>();
  if (prevRegionId !== lastRegionId) {
    setLastRegionId(prevRegionId);
    if (prevRegionId != null) setFixNote('');
  }

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Mark as Needing Manual Fix</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {state?.regionName}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          label="What needs to be fixed?"
          placeholder="e.g., Borders don't match GADM, need to split into sub-regions..."
          value={fixNote}
          onChange={(e) => setFixNote(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => {
            if (state) {
              onSubmit(state.regionId, fixNote || undefined);
              onClose();
            }
          }}
          disabled={isPending}
        >
          Mark for Fix
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Confirmation dialog for removing a region from the import tree */
export function RemoveRegionDialog({ state, onClose, onConfirm, isPending }: {
  state: { regionId: number; regionName: string; hasChildren: boolean; hasDivisions: boolean } | null;
  onClose: () => void;
  onConfirm: (regionId: number, reparentChildren: boolean, reparentDivisions: boolean) => void;
  isPending: boolean;
}) {
  const hasChildren = state?.hasChildren ?? false;
  const hasDivisions = state?.hasDivisions ?? false;

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Remove Region</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {state?.regionName}
        </Typography>
        {hasChildren && hasDivisions ? (
          <Typography variant="body2">
            This region has children and assigned divisions. Choose what to keep:
          </Typography>
        ) : hasChildren ? (
          <Typography variant="body2">
            This region has children. Choose what to do with them:
          </Typography>
        ) : hasDivisions ? (
          <Typography variant="body2">
            This region has assigned GADM divisions. Move them to the parent?
          </Typography>
        ) : (
          <Typography variant="body2">
            Remove this region from the import tree?
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {hasChildren ? (
          <>
            <Button
              variant="outlined"
              color="error"
              onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
              disabled={isPending}
            >
              Remove entire branch
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={() => { if (state) onConfirm(state.regionId, true, hasDivisions); }}
              disabled={isPending}
            >
              Move children{hasDivisions ? ' & divisions' : ''} up
            </Button>
          </>
        ) : hasDivisions ? (
          <>
            <Button
              variant="outlined"
              color="error"
              onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
              disabled={isPending}
            >
              Remove with divisions
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={() => { if (state) onConfirm(state.regionId, false, true); }}
              disabled={isPending}
            >
              Move divisions to parent
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            color="error"
            onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
            disabled={isPending}
          >
            Remove
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Side-by-side map dialog comparing parent's own divisions vs children's divisions */
export function CoverageCompareDialog({ data, onClose, onAnalyzeGaps }: {
  data: {
    regionId: number;
    regionName: string;
    loading: boolean;
    parentGeometry: GeoJSON.Geometry | null;
    childrenGeometry: GeoJSON.Geometry | null;
    geoshapeGeometry?: GeoJSON.Geometry | null;
  } | null;
  onClose: () => void;
  onAnalyzeGaps?: (regionId: number) => void;
}) {
  const leftMapRef = useRef<MapRef>(null);
  const rightMapRef = useRef<MapRef>(null);

  const hasGeoshape = data?.geoshapeGeometry != null;
  const hasChildren = data?.childrenGeometry != null;

  // Fit both maps to the combined extent
  const allGeometries = [data?.parentGeometry, data?.childrenGeometry, data?.geoshapeGeometry].filter(Boolean) as GeoJSON.Geometry[];
  const combinedBbox = useMemo(() => {
    if (allGeometries.length === 0) return null;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: allGeometries.map(g => ({ type: 'Feature' as const, properties: {}, geometry: g })),
    };
    return turf.bbox(fc) as [number, number, number, number];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.parentGeometry, data?.childrenGeometry, data?.geoshapeGeometry]);

  const fitToAll = useCallback((mapRef: React.RefObject<MapRef | null>) => {
    if (!mapRef.current || !combinedBbox) return;
    mapRef.current.fitBounds([[combinedBbox[0], combinedBbox[1]], [combinedBbox[2], combinedBbox[3]]], { padding: 40, duration: 0 });
  }, [combinedBbox]);

  // Left: assigned divisions (blue) + geoshape overlay (green dashed) if available
  // Right: geoshape (green) for leaves, or children's divisions (orange) for containers
  const rightLabel = hasChildren ? "Children's divisions (all descendants)" : 'Wikidata geoshape (expected shape)';

  return (
    <Dialog open={data != null} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Coverage Comparison: {data?.regionName}</DialogTitle>
      <DialogContent>
        {data?.loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, height: 400 }}>
            {/* Left: assigned divisions + geoshape overlay */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Assigned divisions{hasGeoshape && hasChildren ? ' + geoshape outline' : ''}
              </Typography>
              {data?.parentGeometry ? (
                <MapGL
                  ref={leftMapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', flex: 1 }}
                  mapStyle={COVERAGE_MAP_STYLE}
                  onLoad={() => fitToAll(leftMapRef)}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source id="parent-geo" type="geojson" data={{ type: 'Feature', properties: {}, geometry: data.parentGeometry }}>
                    <Layer id="parent-fill" type="fill" paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.4 }} />
                    <Layer id="parent-outline" type="line" paint={{ 'line-color': '#3388ff', 'line-width': 2 }} />
                  </Source>
                  {/* Overlay geoshape as dashed outline when container has both */}
                  {hasGeoshape && hasChildren && (
                    <Source id="geoshape-overlay" type="geojson" data={{ type: 'Feature', properties: {}, geometry: data.geoshapeGeometry! }}>
                      <Layer id="geoshape-overlay-outline" type="line" paint={{ 'line-color': '#22c55e', 'line-width': 2, 'line-dasharray': [4, 3] }} />
                    </Source>
                  )}
                </MapGL>
              ) : (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography color="text.secondary">No divisions assigned</Typography>
                </Box>
              )}
            </Box>

            {/* Right: children's divisions (containers) or geoshape (leaves) */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{rightLabel}</Typography>
              {hasChildren ? (
                <MapGL
                  ref={rightMapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', flex: 1 }}
                  mapStyle={COVERAGE_MAP_STYLE}
                  onLoad={() => fitToAll(rightMapRef)}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source id="children-geo" type="geojson" data={{ type: 'Feature', properties: {}, geometry: data!.childrenGeometry! }}>
                    <Layer id="children-fill" type="fill" paint={{ 'fill-color': '#ff8833', 'fill-opacity': 0.4 }} />
                    <Layer id="children-outline" type="line" paint={{ 'line-color': '#ff8833', 'line-width': 2 }} />
                  </Source>
                </MapGL>
              ) : hasGeoshape ? (
                <MapGL
                  ref={rightMapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', flex: 1 }}
                  mapStyle={COVERAGE_MAP_STYLE}
                  onLoad={() => fitToAll(rightMapRef)}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source id="geoshape-geo" type="geojson" data={{ type: 'Feature', properties: {}, geometry: data!.geoshapeGeometry! }}>
                    <Layer id="geoshape-fill" type="fill" paint={{ 'fill-color': '#22c55e', 'fill-opacity': 0.4 }} />
                    <Layer id="geoshape-outline" type="line" paint={{ 'line-color': '#22c55e', 'line-width': 2 }} />
                  </Source>
                </MapGL>
              ) : (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography color="text.secondary">{data?.childrenGeometry === null && !hasGeoshape ? 'No data to compare' : 'No descendant divisions'}</Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {onAnalyzeGaps && data && !data.loading && hasChildren && (
          <Button
            variant="outlined"
            size="small"
            onClick={() => { onAnalyzeGaps(data.regionId); onClose(); }}
            sx={{ mr: 'auto' }}
          >
            Find Gap Divisions
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
