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
import { useExperienceContext } from '../hooks/useExperienceContext';
import { HoverPreviewCard } from './regionMap/HoverPreviewCard';
import { HoveredRegionTooltip } from './regionMap/HoveredRegionTooltip';
import { ExperienceMarkers } from './ExperienceMarkers';
import { SelectedObjectFoldControl } from './experienceMarkers/FoldPlacesControl';
import { MapUnavailable } from './shared/MapUnavailable';
import { ArtworkPreviewOverlay } from './regionMap/ArtworkPreviewOverlay';
import { isWebGLAvailable } from '../utils/webgl';
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
    regionBreadcrumbs,
  } = useNavigation();

  // Visited regions tracking (only for custom world views)
  const { visitedRegionIds } = useVisitedRegions(
    isCustomWorldView ? selectedWorldView?.id : undefined
  );

  // Check if in exploration mode (right panel open with experiences)
  const { artworkPreview, isExploring, setViewBounds } = useExperienceContext();

  // Determine what parent we're viewing subdivisions of (GADM)
  let viewingParentId: number | 'root';
  if (!selectedDivision) viewingParentId = 'root';
  else if (selectedDivision.hasChildren) viewingParentId = selectedDivision.id;
  else viewingParentId = selectedDivision.parentId ?? 'root';

  // For custom world views, determine what region we're viewing
  let viewingRegionId: number | 'all-leaf';
  if (!selectedRegion) viewingRegionId = 'all-leaf';
  else if (selectedRegion.hasSubregions === true) viewingRegionId = selectedRegion.id;
  else viewingRegionId = selectedRegion.parentRegionId ?? 'all-leaf';

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

  const { tilesReady, tilesStalled, rootOverlayEnabled } = useMapFeatureState({
    mapRef,
    mapLoaded,
    isCustomWorldView,
    isExploring,
    visitedRegionIds,
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
    interactiveLayerIds,
  } = useMapInteractions({
    mapRef,
    mapLoaded,
    metadataById,
    sourceLayerName,
    viewingRegionId,
    contextLayerCount: contextLayers.length,
  });

  /**
   * Tell the list what the map is showing (#553).
   *
   * `moveend`, never `move`: recomputing during a pan gesture re-sorts the rows
   * under the reader's eye while they are in the middle of reading them. The
   * camera settling is the moment the question "what is here" has a new answer.
   *
   * The box is passed on exactly as MapLibre reports it, which is *not* this
   * repository's `west > east` convention: `getBounds()` keeps `west <= east`
   * and lets the values leave `[-180, 180]` instead. Normalising here would
   * throw away the only thing that says where the view actually is —
   * `pointInView` reads the box in its own frame and handles both shapes.
   */
  const publishViewBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setViewBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
  }, [setViewBounds]);

  const handleMapLoad = useCallback(() => {
    setMapLoaded(true);
    // The first view, before any gesture: without it the list answers about the
    // whole region until the reader happens to move the map.
    publishViewBounds();
  }, [publishViewBounds]);

  // Asked before `<Map>` is mounted, not after it fails. react-map-gl builds
  // the map inside its own effect, where MapLibre's `Failed to initialize
  // WebGL` throw would unwind past this component instead of arriving as an
  // error state we could render — there is no error boundary above us to stop
  // it. Every hook above still runs, so this early return does not reorder any.
  if (!isWebGLAvailable()) {
    return (
      <Paper sx={{ height: 500, position: 'relative', overflow: 'hidden' }}>
        <MapUnavailable detail="Choosing regions and browsing their experiences still work — the map is the only part that needs WebGL." />
      </Paper>
    );
  }

  return (
    <Paper sx={{ height: 500, position: 'relative', overflow: 'hidden' }}>

      {/* Go to parent button */}
      {(selectedRegion || selectedDivision) && (() => {
        let goToParentTitle: string;
        if (isCustomWorldView) {
          goToParentTitle = selectedRegion?.parentRegionId ? "Go to parent region" : "Go to world view root";
        } else {
          goToParentTitle = selectedDivision?.parentId ? "Go to parent division" : "Go to world view";
        }
        return (
        <Box sx={{ position: 'absolute', top: 80, right: 10, zIndex: 1 }}>
          <Tooltip title={goToParentTitle}>
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
        );
      })()}

      {/* Tile loading overlay - covers map until tiles are ready, or until the
          wait has gone on long enough that blocking the map costs more than the
          half-drawn map it is hiding. See TILE_WAIT_TIMEOUT_MS. */}
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
          opacity: tilesReady || tilesStalled ? 0 : 1,
          pointerEvents: tilesReady || tilesStalled ? 'none' : 'auto',
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

      {/* The wait outlived the overlay. The map is interactive now; say why it
          may look incomplete rather than leaving the user to guess. */}
      {tilesStalled && !tilesReady && (
        <Box
          sx={{
            position: 'absolute',
            // The note says panning and zooming still work; absorbing the events
            // over its own footprint would make that false where it sits.
            pointerEvents: 'none',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2,
            px: 2,
            py: 1,
            borderRadius: 2,
            backgroundColor: 'rgba(248, 250, 252, 0.95)',
            boxShadow: 1,
          }}
        >
          <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 500 }}>
            Some map areas are still loading — panning and zooming still work.
          </Typography>
        </Box>
      )}

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
        onMoveEnd={publishViewBounds}
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
          />
        )}
      </Map>

      {/* Hovered region tooltip - hidden when exploring. Its own subscriber to
          the region hover store, so a mouse move re-renders it and not the map. */}
      {!isExploring && (
        <HoveredRegionTooltip
          mapRef={mapRef}
          metadataById={metadataById}
          sourceLayerName={sourceLayerName}
          contextLayerCount={contextLayers.length}
        />
      )}

      {/* The work under the pointer, at a size worth looking at, credited. */}
      <ArtworkPreviewOverlay preview={artworkPreview} />

      {/* The map's own way to fold one object back into a single pin (#558) */}
      {isExploring && isCustomWorldView && selectedRegion && (
        <SelectedObjectFoldControl regionId={selectedRegion.id} />
      )}

      {/* Experience/location hover preview (explore mode). Its own subscriber to
          the hover context, so a mouse move over a list of places does not
          re-render this map — see the component. */}
      {isExploring && <HoverPreviewCard mapRef={mapRef} mapLoaded={mapLoaded} />}

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
