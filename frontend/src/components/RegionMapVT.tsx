/**
 * RegionMapVT - Vector Tile based Region Map
 *
 * Uses Martin tile server for fast map rendering instead of fetching GeoJSON.
 * This significantly improves load speed for the user-facing map.
 *
 * Key differences from GeoJSON approach:
 * - Geometries are streamed as vector tiles from Martin
 * - Uses setFeatureState for user-specific styling (visited regions)
 * - Keeps lightweight metadata fetch for tooltips and navigation
 *
 * Logic is split across extracted hooks in ./regionMap/:
 * - layerStyles.ts — paint/layout config factories
 * - useRegionMetadata.ts — region/division metadata queries + lookup
 * - useTileUrls.ts — Martin tile URL construction
 * - useMapFeatureState.ts — visited/hover/tiles-ready state
 * - useMapInteractions.ts — click/hover handlers, fly-to, navigation
 */

import { useRef, useCallback, useState } from 'react';
import Map, { Source, Layer, NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import { Paper, Box, CircularProgress, Typography, IconButton, Tooltip } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import { useNavigation } from '../hooks/useNavigation';
import { useVisitedRegions } from '../hooks/useVisitedRegions';
import { useVisitedExperiences, useVisitedLocations } from '../hooks/useVisitedExperiences';
import { useExperienceContext } from '../hooks/useExperienceContext';
import { ExperienceMarkers } from './ExperienceMarkers';
import { MAP_STYLE } from '../constants/mapStyles';
import { useRegionMetadata } from './regionMap/useRegionMetadata';
import { useTileUrls } from './regionMap/useTileUrls';
import { useMapFeatureState } from './regionMap/useMapFeatureState';
import { useMapInteractions } from './regionMap/useMapInteractions';
import {
  hullFillPaint,
  hullOutlinePaint,
  regionFillPaint,
  regionOutlinePaint,
  contextFillPaint,
  contextOutlinePaint,
  islandFillPaint,
  islandOutlinePaint,
  rootRegionBorderPaint,
  type ExploringParams,
} from './regionMap/layerStyles';

// Layer source name in Martin tiles
const REGIONS_SOURCE_LAYER = 'regions';
const DIVISIONS_SOURCE_LAYER = 'divisions';
const ISLANDS_SOURCE_LAYER = 'islands';

export function RegionMapVT() {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const {
    selectedDivision,
    selectedWorldView,
    isCustomWorldView,
    selectedRegion,
    hoveredRegionId,
    regionBreadcrumbs,
  } = useNavigation();

  // Visited regions tracking (only for custom world views)
  const { visitedRegionIds } = useVisitedRegions(
    isCustomWorldView ? selectedWorldView?.id : undefined
  );

  // Visited experiences tracking (for UNESCO markers)
  const { visitedIds: visitedExperienceIds } = useVisitedExperiences();
  const { visitedLocationIds } = useVisitedLocations();

  // Check if in exploration mode (right panel open with experiences)
  const { previewImageUrl, isExploring } = useExperienceContext();

  // Determine what parent we're viewing subdivisions of (GADM)
  const viewingParentId = !selectedDivision
    ? 'root' as const
    : selectedDivision.hasChildren
      ? selectedDivision.id
      : selectedDivision.parentId ?? 'root' as const;

  // For custom world views, determine what region we're viewing
  const viewingRegionId = !selectedRegion
    ? 'all-leaf' as const
    : selectedRegion.hasSubregions === true
      ? selectedRegion.id
      : (selectedRegion.parentRegionId ?? 'all-leaf' as const);

  // Exploration params for outline paint styling
  const exploringParams: ExploringParams | undefined = isExploring
    ? { active: true, hasSubregions: selectedRegion?.hasSubregions === true }
    : undefined;

  // Source layer name based on view type
  const sourceLayerName = isCustomWorldView ? REGIONS_SOURCE_LAYER : DIVISIONS_SOURCE_LAYER;

  // Extracted hooks
  const { metadata, metadataLoading, metadataById } = useRegionMetadata(viewingRegionId, viewingParentId);
  const { tileUrl, islandTileUrl, rootRegionsBorderUrl, contextLayers } = useTileUrls(
    viewingRegionId,
    viewingParentId,
    regionBreadcrumbs.length > 0 ? regionBreadcrumbs : undefined,
    selectedRegion?.hasSubregions === true,
  );

  const { tilesReady, rootOverlayEnabled } = useMapFeatureState({
    mapRef,
    mapLoaded,
    isCustomWorldView,
    isExploring,
    visitedRegionIds,
    hoveredRegionId,
    sourceLayerName,
    tileUrl,
    viewingRegionId,
    contextLayerCount: contextLayers.length,
  });

  const {
    handleMapClick,
    handleMouseMove,
    handleMouseLeave,
    handleGoToParent,
    hoveredRegionName,
    hoverPreview,
    hoverPreviewImage,
    hoverCardPlacement,
    interactiveLayerIds,
  } = useMapInteractions({
    mapRef,
    mapLoaded,
    metadataById,
    sourceLayerName,
    viewingRegionId,
    contextLayerCount: contextLayers.length,
  });

  const handleMapLoad = useCallback(() => {
    setMapLoaded(true);
  }, []);

  return (
    <Paper sx={{ height: 500, position: 'relative', overflow: 'hidden' }}>

      {/* Go to parent button */}
      {(selectedRegion || selectedDivision) && (
        <Box sx={{ position: 'absolute', top: 80, right: 10, zIndex: 1 }}>
          <Tooltip title={
            isCustomWorldView
              ? (selectedRegion?.parentRegionId ? "Go to parent region" : "Go to world view root")
              : (selectedDivision?.parentId ? "Go to parent division" : "Go to world view")
          }>
            <IconButton
              onClick={handleGoToParent}
              sx={{
                backgroundColor: 'rgba(255,255,255,0.98)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(0,0,0,0.06)',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,1)',
                  borderColor: '#0ea5e9',
                },
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
            >
              <ArrowUpwardIcon sx={{ color: '#64748b' }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Tile loading overlay - covers map until tiles are ready */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(248, 250, 252, 0.92)',
          backdropFilter: 'blur(4px)',
          opacity: tilesReady ? 0 : 1,
          pointerEvents: tilesReady ? 'none' : 'auto',
          transition: 'opacity 0.3s ease-out',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <CircularProgress size={32} sx={{ color: '#6366f1' }} />
          <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 500 }}>
            Loading map...
          </Typography>
        </Box>
      </Box>

      {/* Metadata loading indicator (small, top corner) */}
      {metadataLoading && tilesReady && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1,
            backgroundColor: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(8px)',
            py: 1,
            px: 2,
            borderRadius: 2,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <CircularProgress size={16} sx={{ color: '#6366f1' }} />
          <Typography variant="caption" sx={{ color: '#64748b' }}>
            Loading regions...
          </Typography>
        </Box>
      )}

      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 15,
          zoom: 1,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onLoad={handleMapLoad}
        interactiveLayerIds={interactiveLayerIds}
      >
        <NavigationControl position="top-right" showCompass={false} />

        {/* Ancestor context layers (dimmed ancestor-level tiles behind children) */}
        {isCustomWorldView && contextLayers.map((layer, i) => (
          <Source
            key={`context-${i}:${layer.url}`}
            id={`context-${i}-vt`}
            type="vector"
            tiles={[layer.url]}
            promoteId="region_id"
          >
            <Layer
              id={`context-${i}-fill`}
              type="fill"
              source-layer={REGIONS_SOURCE_LAYER}
              paint={contextFillPaint(layer.highlightId)}
            />
            <Layer
              id={`context-${i}-outline`}
              type="line"
              source-layer={REGIONS_SOURCE_LAYER}
              paint={contextOutlinePaint(layer.highlightId)}
            />
          </Source>
        ))}

        {/* Main regions/divisions vector tile source */}
        {tileUrl && (
          <Source
            key={tileUrl}
            id="regions-vt"
            type="vector"
            tiles={[tileUrl]}
            promoteId={isCustomWorldView ? 'region_id' : 'division_id'}
          >
            <Layer
              id="region-hull"
              type="fill"
              source-layer={sourceLayerName}
              filter={['==', ['get', 'using_hull'], true]}
              paint={hullFillPaint(selectedRegion?.id)}
            />
            <Layer
              id="region-fill"
              type="fill"
              source-layer={sourceLayerName}
              filter={['!=', ['get', 'using_hull'], true]}
              paint={regionFillPaint(selectedRegion?.id)}
            />
            <Layer
              id="region-outline"
              type="line"
              source-layer={sourceLayerName}
              filter={['!=', ['get', 'using_hull'], true]}
              paint={regionOutlinePaint(selectedRegion?.id, exploringParams)}
            />
            <Layer
              id="hull-outline"
              type="line"
              source-layer={sourceLayerName}
              filter={['==', ['get', 'using_hull'], true]}
              paint={hullOutlinePaint(selectedRegion?.id, exploringParams)}
            />
          </Source>
        )}

        {/* Island boundaries vector tile source (for hull regions) */}
        {islandTileUrl && isCustomWorldView && (
          <Source
            key={islandTileUrl}
            id="islands-vt"
            type="vector"
            tiles={[islandTileUrl]}
            promoteId="region_id"
          >
            <Layer
              id="island-fill"
              type="fill"
              source-layer={ISLANDS_SOURCE_LAYER}
              paint={islandFillPaint}
            />
            <Layer
              id="island-outline"
              type="line"
              source-layer={ISLANDS_SOURCE_LAYER}
              paint={islandOutlinePaint}
            />
          </Source>
        )}

        {/* Root regions border overlay (for hover highlighting at root level) */}
        {rootRegionsBorderUrl && isCustomWorldView && rootOverlayEnabled && (
          <Source
            key={`root-regions:${rootRegionsBorderUrl}`}
            id="root-regions-vt"
            type="vector"
            tiles={[rootRegionsBorderUrl]}
            promoteId="region_id"
          >
            <Layer
              id="root-region-border"
              type="line"
              source-layer={REGIONS_SOURCE_LAYER}
              paint={rootRegionBorderPaint}
            />
          </Source>
        )}

        {/* Experience markers - only shown in explore mode */}
        {isCustomWorldView && selectedRegion && isExploring && (
          <ExperienceMarkers
            regionId={selectedRegion.id}
            visitedIds={visitedExperienceIds}
            visitedLocationIds={visitedLocationIds}
          />
        )}
      </Map>

      {/* Hovered region tooltip - hidden when exploring */}
      {hoveredRegionId && hoveredRegionName && !isExploring && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            backgroundColor: 'rgba(255,255,255,0.98)',
            backdropFilter: 'blur(8px)',
            p: 1.5,
            px: 2,
            borderRadius: 2,
            maxWidth: 300,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            border: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
            {hoveredRegionName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click to explore
          </Typography>
        </Box>
      )}

      {/* Artwork preview overlay */}
      {previewImageUrl && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            pointerEvents: 'none',
          }}
        >
          <Box
            component="img"
            src={previewImageUrl}
            sx={{
              maxWidth: '60%',
              maxHeight: '70%',
              objectFit: 'contain',
              borderRadius: 2,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          />
        </Box>
      )}

      {/* Experience/location hover preview (explore mode) */}
      {isExploring && hoverPreview && (
        <Box
          sx={{
            position: 'absolute',
            ...hoverCardPlacement,
            zIndex: 3,
            width: 260,
            maxWidth: 'calc(100% - 32px)',
            backgroundColor: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 2,
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.20)',
            pointerEvents: 'none',
            animation: 'tyrHoverCardIn 170ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          {hoverPreviewImage && (
            <Box
              component="img"
              src={hoverPreviewImage}
              alt={hoverPreview.experienceName}
              sx={{
                width: '100%',
                maxHeight: 180,
                objectFit: 'contain',
                display: 'block',
                backgroundColor: 'grey.100',
              }}
            />
          )}
          <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {hoverPreview.experienceName}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2 }} noWrap>
              {hoverPreview.locationName || 'Primary location'}
            </Typography>
            {hoverPreview.categoryName && (
              <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.85 }} noWrap>
                {hoverPreview.categoryName}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      <style>{`
        @keyframes tyrHoverCardIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Current region info */}
      {selectedRegion && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            left: 16,
            backgroundColor: 'rgba(255,255,255,0.98)',
            backdropFilter: 'blur(8px)',
            p: 1.5,
            px: 2,
            borderRadius: 2,
            maxWidth: 300,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            border: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 500, color: '#6366f1' }}>
            {selectedRegion?.name}
          </Typography>
          {selectedRegion?.hasSubregions && (
            <Typography variant="caption" color="text.secondary">
              {metadata?.length ?? 0} subregions
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}
