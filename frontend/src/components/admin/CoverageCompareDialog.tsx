/**
 * The dialog that asks whether a region's own divisions and its children's are
 * the same shape, by drawing them side by side — and the right-hand panel it
 * draws, which is the half that varies: the children unified, colour-coded per
 * child, or the region's own geoshape.
 *
 * Its own file beside `ImportTreeDialogs.tsx`, which had reached the length the
 * lint draws the line at (#933); the region-edit dialogs stay there.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { GuardedMap as MapGL } from '../shared/GuardedMap';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress,
} from '@mui/material';
import { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import { getChildrenRegionGeometry } from '../../api/admin/worldViewImport';
import { COVERAGE_MAP_STYLE } from './GapAnalysis';
import { frameGeoJson } from '../../utils/mapUtils';

const CHILD_COLORS = ['#3388ff', '#33aa55', '#9955cc', '#cc7733', '#5599dd', '#aa3366', '#55bb88', '#8866cc', '#dd5555', '#44bbaa', '#7766bb', '#bb8844'];

/** Right-side panel: children's divisions (unified or color-coded) or geoshape */
function CoverageRightPanel({ data, fitToAll }: {
  data: {
    regionId: number;
    worldViewId: number;
    childrenGeometry: GeoJSON.Geometry | null;
    geoshapeGeometry?: GeoJSON.Geometry | null;
  };
  fitToAll: (mapRef: React.RefObject<MapRef | null>) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const hasGeoshape = data.geoshapeGeometry != null;
  const hasChildren = data.childrenGeometry != null;

  // Color-coded children view
  const [rightMode, setRightMode] = useState<'unified' | 'colored'>('unified');
  const [childRegions, setChildRegions] = useState<Array<{ regionId: number; name: string; geometry: GeoJSON.Geometry }> | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset when region changes
  useEffect(() => { setRightMode('unified'); setChildRegions(null); }, [data.regionId]);

  const handleToggle = useCallback(async () => {
    setRightMode(prev => prev === 'colored' ? 'unified' : 'colored');
    if (rightMode !== 'unified' || childRegions) return; // toggling off, or already loaded
    setLoading(true);
    try {
      const result = await getChildrenRegionGeometry(data.worldViewId, data.regionId);
      setChildRegions(result.childRegions);
    } finally {
      setLoading(false);
    }
  }, [rightMode, childRegions, data.worldViewId, data.regionId]);

  const coloredChildren = useMemo(() =>
    (childRegions ?? []).map((c, i) => ({
      ...c,
      color: CHILD_COLORS[i % CHILD_COLORS.length],
      fc: {
        type: 'FeatureCollection' as const,
        features: [{ type: 'Feature' as const, properties: { name: c.name }, geometry: c.geometry }],
      },
    })),
  [childRegions]);

  let rightLabel = 'Wikidata geoshape (expected shape)';
  if (rightMode === 'colored') rightLabel = 'Subregions (color-coded)';
  else if (hasChildren) rightLabel = "Children's divisions (all descendants)";

  let buttonLabel = 'Color by subregion';
  if (loading) buttonLabel = 'Loading...';
  else if (rightMode === 'colored') buttonLabel = 'Show unified';

  if (!hasChildren && !hasGeoshape) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{rightLabel}</Typography>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography color="text.secondary">No data to compare</Typography>
        </Box>
      </Box>
    );
  }

  const geojsonData = hasChildren
    ? { type: 'Feature' as const, properties: {}, geometry: data.childrenGeometry! }
    : { type: 'Feature' as const, properties: {}, geometry: data.geoshapeGeometry! };
  const fillColor = hasChildren ? '#ff8833' : '#22c55e';
  const showColored = rightMode === 'colored' && hasChildren;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{rightLabel}</Typography>
        {hasChildren && (
          <Button
            size="small"
            variant={rightMode === 'colored' ? 'contained' : 'outlined'}
            onClick={handleToggle}
            disabled={loading}
            sx={{ fontSize: '0.7rem', py: 0.25, px: 1, minWidth: 0 }}
          >
            {buttonLabel}
          </Button>
        )}
      </Box>
      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
        style={{ width: '100%', flex: 1, minHeight: showColored ? 280 : 350 }}
        mapStyle={COVERAGE_MAP_STYLE}
        onLoad={() => fitToAll(mapRef)}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {showColored ? (
          coloredChildren.map((c, i) => (
            <Source key={`child-${c.regionId}`} id={`child-${i}`} type="geojson" data={c.fc}>
              <Layer id={`child-fill-${i}`} type="fill" paint={{ 'fill-color': c.color, 'fill-opacity': 0.45 }} />
              <Layer id={`child-outline-${i}`} type="line" paint={{ 'line-color': c.color, 'line-width': 1.5 }} />
            </Source>
          ))
        ) : (
          <Source id="right-geo" type="geojson" data={geojsonData}>
            <Layer id="right-fill" type="fill" paint={{ 'fill-color': fillColor, 'fill-opacity': 0.4 }} />
            <Layer id="right-outline" type="line" paint={{ 'line-color': fillColor, 'line-width': 2 }} />
          </Source>
        )}
      </MapGL>
      {showColored && coloredChildren.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5, maxHeight: 60, overflow: 'auto' }}>
          {coloredChildren.map(c => (
            <Box key={c.regionId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c.color, flexShrink: 0 }} />
              <Typography variant="caption" noWrap sx={{ maxWidth: 120 }}>{c.name}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Side-by-side map dialog comparing parent's own divisions vs children's divisions */
export function CoverageCompareDialog({ data, onClose, onAnalyzeGaps }: {
  data: {
    regionId: number;
    regionName: string;
    worldViewId: number;
    loading: boolean;
    parentGeometry: GeoJSON.Geometry | null;
    childrenGeometry: GeoJSON.Geometry | null;
    geoshapeGeometry?: GeoJSON.Geometry | null;
  } | null;
  onClose: () => void;
  onAnalyzeGaps?: (regionId: number) => void;
}) {
  const leftMapRef = useRef<MapRef>(null);

  const hasGeoshape = data?.geoshapeGeometry != null;
  const hasChildren = data?.childrenGeometry != null;

  // Fit both maps to the combined extent
  const allGeometries = [data?.parentGeometry, data?.childrenGeometry, data?.geoshapeGeometry].filter(Boolean) as GeoJSON.Geometry[];
  const combined = useMemo((): GeoJSON.FeatureCollection | null => {
    if (allGeometries.length === 0) return null;
    return {
      type: 'FeatureCollection',
      features: allGeometries.map(g => ({ type: 'Feature' as const, properties: {}, geometry: g })),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- allGeometries is derived from these three deps each render; recomputing only when geometries actually change
  }, [data?.parentGeometry, data?.childrenGeometry, data?.geoshapeGeometry]);

  const fitToAll = useCallback((mapRef: React.RefObject<MapRef | null>) => {
    frameGeoJson(mapRef.current, combined, { padding: 40, duration: 0 });
  }, [combined]);

  return (
    <Dialog open={data != null} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Coverage Comparison: {data?.regionName}</DialogTitle>
      <DialogContent>
        {data?.loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, minHeight: 400 }}>
            {/* Left: assigned divisions + geoshape overlay */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Assigned divisions{hasGeoshape && hasChildren ? ' + geoshape outline' : ''}
              </Typography>
              {data?.parentGeometry ? (
                <MapGL
                  ref={leftMapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', flex: 1, minHeight: 350 }}
                  mapStyle={COVERAGE_MAP_STYLE}
                  onLoad={() => fitToAll(leftMapRef)}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source id="parent-geo" type="geojson" data={{ type: 'Feature', properties: {}, geometry: data.parentGeometry }}>
                    <Layer id="parent-fill" type="fill" paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.4 }} />
                    <Layer id="parent-outline" type="line" paint={{ 'line-color': '#3388ff', 'line-width': 2 }} />
                  </Source>
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

            {/* Right: children panel with unified/colored toggle */}
            {data && (
              <CoverageRightPanel data={data} fitToAll={fitToAll} />
            )}
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
