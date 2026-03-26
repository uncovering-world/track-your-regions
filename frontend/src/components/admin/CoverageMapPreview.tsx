/**
 * Coverage Map Preview
 *
 * Right panel of the CoverageResolveDialog: inline map preview with gap/suggestion
 * geometry overlay, legend, suggestion details, context tree, and manual region search.
 */

import { type Ref } from 'react';
import {
  Box,
  Typography,
  Chip,
  Paper,
  CircularProgress,
  Stack,
  Autocomplete,
  TextField,
} from '@mui/material';
import Close from '@mui/icons-material/Close';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import type { GeoSuggestResult } from '../../api/adminWorldViewImport';
import type { RegionSearchResult } from '../../api/regions';
import type { TreeNodeInfo } from './coverageResolveUtils';
import { ContextTreeNode } from './CoverageGapTree';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

interface CoverageMapPreviewProps {
  mapRef: Ref<MapRef>;
  selectedNodeId: number | null;
  selectedGapInfo: TreeNodeInfo | null;
  selectedGeoResult: GeoSuggestResult | undefined;
  selectedTargets: Map<number, { id: number; name: string }>;
  gapGeom: GeoJSON.Geometry | null;
  suggGeom: GeoJSON.Geometry | null;
  mapLoading: boolean;
  gapFC: GeoJSON.FeatureCollection;
  suggFC: GeoJSON.FeatureCollection;
  circleFC: GeoJSON.FeatureCollection;
  markersFC: GeoJSON.FeatureCollection;
  // Region search
  searchOpen: boolean;
  regionQuery: string;
  regionResults: RegionSearchResult[] | undefined;
  isSearchingRegions: boolean;
  onSearchOpenChange: (open: boolean) => void;
  onRegionQueryChange: (query: string) => void;
  onSelectTarget: (nodeId: number, target: { id: number; name: string }) => void;
  onClearTarget: (nodeId: number) => void;
}

export function CoverageMapPreview({
  mapRef,
  selectedNodeId,
  selectedGapInfo,
  selectedGeoResult,
  selectedTargets,
  gapGeom,
  suggGeom,
  mapLoading,
  gapFC,
  suggFC,
  circleFC,
  markersFC,
  searchOpen,
  regionQuery,
  regionResults,
  isSearchingRegions,
  onSearchOpenChange,
  onRegionQueryChange,
  onSelectTarget,
  onClearTarget,
}: CoverageMapPreviewProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* Map */}
      <Box sx={{ flex: 1, position: 'relative', minHeight: 200 }}>
        {mapLoading && (
          <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
            <CircularProgress size={32} />
          </Box>
        )}
        {selectedNodeId == null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" color="text.disabled">
              Select a gap to preview on map
            </Typography>
          </Box>
        ) : (
          <MapGL
            ref={mapRef}
            initialViewState={{ longitude: 0, latitude: 20, zoom: 1 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={MAP_STYLE}
          >
            <NavigationControl position="top-right" showCompass={false} />

            {/* Distance circle */}
            <Source id="circle" type="geojson" data={circleFC}>
              <Layer
                id="circle-fill"
                type="fill"
                paint={{ 'fill-color': '#ffa726', 'fill-opacity': 0.08 }}
              />
              <Layer
                id="circle-outline"
                type="line"
                paint={{ 'line-color': '#ffa726', 'line-width': 2, 'line-dasharray': [4, 3] }}
              />
            </Source>

            {/* Gap division (red) */}
            <Source id="gap-division" type="geojson" data={gapFC}>
              <Layer
                id="gap-fill"
                type="fill"
                paint={{ 'fill-color': '#ef5350', 'fill-opacity': 0.35 }}
              />
              <Layer
                id="gap-outline"
                type="line"
                paint={{ 'line-color': '#c62828', 'line-width': 2 }}
              />
            </Source>

            {/* Suggested division (blue) */}
            <Source id="sugg-division" type="geojson" data={suggFC}>
              <Layer
                id="sugg-fill"
                type="fill"
                paint={{ 'fill-color': '#42a5f5', 'fill-opacity': 0.35 }}
              />
              <Layer
                id="sugg-outline"
                type="line"
                paint={{ 'line-color': '#1565c0', 'line-width': 2 }}
              />
            </Source>

            {/* Center markers */}
            <Source id="markers" type="geojson" data={markersFC}>
              <Layer
                id="marker-gap"
                type="circle"
                filter={['==', ['get', 'type'], 'gap']}
                paint={{ 'circle-radius': 6, 'circle-color': '#c62828', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }}
              />
              <Layer
                id="marker-sugg"
                type="circle"
                filter={['==', ['get', 'type'], 'sugg']}
                paint={{ 'circle-radius': 6, 'circle-color': '#1565c0', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }}
              />
            </Source>
          </MapGL>
        )}
      </Box>

      {/* Suggestion details below map */}
      {selectedGapInfo && (
        <Box sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {selectedGapInfo.name}
            {selectedGapInfo.parentName && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                ({selectedGapInfo.parentName})
              </Typography>
            )}
          </Typography>

          {/* Legend */}
          {(gapGeom || suggGeom) && (
            <Stack direction="row" spacing={1.5} sx={{ mb: 1 }}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Box sx={{ width: 12, height: 12, bgcolor: '#ef5350', borderRadius: '2px', opacity: 0.7 }} />
                <Typography variant="caption" color="text.secondary">Gap</Typography>
              </Stack>
              {suggGeom && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Box sx={{ width: 12, height: 12, bgcolor: '#42a5f5', borderRadius: '2px', opacity: 0.7 }} />
                  <Typography variant="caption" color="text.secondary">Nearest assigned</Typography>
                </Stack>
              )}
            </Stack>
          )}

          {selectedGeoResult?.suggestion ? (
            <>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Nearest: <strong>{selectedGeoResult.suggestion.targetRegionName}</strong>
                {selectedGeoResult.distanceKm != null && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    ({selectedGeoResult.distanceKm.toLocaleString()} km to boundary)
                  </Typography>
                )}
              </Typography>

              {/* Hierarchy tree -- let user pick where to add */}
              {selectedGeoResult.contextTree && (
                <Box sx={{ mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                    Add to:
                  </Typography>
                  <ContextTreeNode
                    node={selectedGeoResult.contextTree}
                    depth={0}
                    selectedId={selectedTargets.get(selectedNodeId!)?.id ?? selectedGeoResult.suggestion!.targetRegionId}
                    onSelect={(id, name) => onSelectTarget(selectedNodeId!, { id, name })}
                  />
                </Box>
              )}
            </>
          ) : selectedGapInfo.suggestion ? (
            <Chip
              label={`${selectedGapInfo.suggestion.action === 'add_member' ? 'Add to' : 'Create under'} ${selectedGapInfo.suggestion.targetRegionName}`}
              size="small"
              color="info"
              variant="outlined"
            />
          ) : (
            <Typography variant="caption" color="text.disabled">
              No suggestion -- use geo-suggest to find nearest region
            </Typography>
          )}

          {/* Manual region search */}
          <Box sx={{ mt: 1 }}>
            {/* Show manual override chip if active */}
            {selectedTargets.has(selectedNodeId!) && !selectedGeoResult?.suggestion && (
              <Chip
                label={`Manual: ${selectedTargets.get(selectedNodeId!)!.name}`}
                size="small"
                color="success"
                variant="outlined"
                onDelete={() => {
                  onClearTarget(selectedNodeId!);
                  onSearchOpenChange(false);
                }}
                deleteIcon={<Close sx={{ fontSize: 16 }} />}
                sx={{ mb: 0.5 }}
              />
            )}

            {searchOpen ? (
              <Autocomplete<RegionSearchResult>
                size="small"
                options={regionResults ?? []}
                getOptionLabel={(opt) => opt.name}
                onChange={(_, value) => {
                  if (value) {
                    onSelectTarget(selectedNodeId!, { id: value.id, name: value.name });
                    onSearchOpenChange(false);
                    onRegionQueryChange('');
                  }
                }}
                onInputChange={(_, value) => onRegionQueryChange(value)}
                loading={isSearchingRegions}
                openOnFocus
                autoFocus
                renderOption={(props, opt) => (
                  <li {...props} key={opt.id}>
                    <Box>
                      <Typography variant="body2">{opt.name}</Typography>
                      {opt.path && opt.path !== opt.name && (
                        <Typography variant="caption" color="text.secondary">
                          {opt.path}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder="Search regions..."
                    variant="outlined"
                    onBlur={() => {
                      if (!regionQuery) onSearchOpenChange(false);
                    }}
                  />
                )}
                sx={{ mt: 0.5 }}
              />
            ) : (
              <Typography
                variant="caption"
                color="primary"
                sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                onClick={() => onSearchOpenChange(true)}
              >
                Choose region manually...
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Paper>
  );
}
