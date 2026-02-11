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
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import Map, { Source, Layer, NavigationControl, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { MapSourceDataEvent } from 'maplibre-gl';
import { Paper, Box, CircularProgress, Typography, IconButton, Tooltip } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import { useQuery } from '@tanstack/react-query';
import * as turf from '@turf/turf';
import { useNavigation } from '../hooks/useNavigation';
import { useVisitedRegions } from '../hooks/useVisitedRegions';
import { useVisitedExperiences, useVisitedLocations } from '../hooks/useVisitedExperiences';
import { extractImageUrl, toThumbnailUrl, useExperienceContext } from '../hooks/useExperienceContext';
import { ExperienceMarkers } from './ExperienceMarkers';
import {
  fetchDivision,
  fetchLeafRegions,
  fetchSubregions,
  fetchRootDivisions,
  fetchSubdivisions,
  fetchDivisionGeometry,
  MARTIN_URL,
} from '../api';
import { MAP_STYLE } from '../constants/mapStyles';
import { smartFitBounds } from '../utils/mapUtils';
import type { Region } from '../types';

// Layer source name in Martin tiles
const REGIONS_SOURCE_LAYER = 'regions';
const DIVISIONS_SOURCE_LAYER = 'divisions';
const ISLANDS_SOURCE_LAYER = 'islands';

export function RegionMapVT() {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);
  const [rootOverlayEnabled, setRootOverlayEnabled] = useState(false);

  const {
    selectedDivision,
    selectedWorldView,
    selectedWorldViewId,
    setSelectedDivision,
    hoveredRegionId,
    setHoveredRegionId,
    isCustomWorldView,
    selectedRegion,
    setSelectedRegion,
    regionBreadcrumbs,
    tileVersion,
    rootRegions,
  } = useNavigation();

  // Visited regions tracking (only for custom world views)
  const { visitedRegionIds } = useVisitedRegions(
    isCustomWorldView ? selectedWorldView?.id : undefined
  );

  // Visited experiences tracking (for UNESCO markers)
  const { visitedIds: visitedExperienceIds } = useVisitedExperiences();
  const { visitedLocationIds } = useVisitedLocations();

  // Check if in exploration mode (right panel open with experiences)
  const { isExploring, previewImageUrl, hoverPreview } = useExperienceContext();

  // Clear hover state when entering exploration mode
  useEffect(() => {
    if (isExploring) {
      setHoveredRegionId(null);
    }
  }, [isExploring, setHoveredRegionId]);

  // Determine what parent we're viewing subdivisions of (GADM)
  const viewingParentId = !selectedDivision
    ? 'root'
    : selectedDivision.hasChildren
      ? selectedDivision.id
      : selectedDivision.parentId ?? 'root';

  // For custom world views, determine what region we're viewing
  // 'all-leaf' = show all leaf regions (default view)
  // number = show subregions of that region
  const viewingRegionId = !selectedRegion
    ? 'all-leaf'
    : selectedRegion.hasSubregions === true
      ? selectedRegion.id
      : (selectedRegion.parentRegionId ?? 'all-leaf');

  // ==========================================================================
  // Metadata fetches (lightweight, no geometries)
  // Used for: tooltips, navigation, bounds fitting
  // ==========================================================================

  // Fetch region metadata for custom world views (no geometries)
  // By default, fetch all leaf regions (regions without subregions)
  // Uses selectedWorldViewId for eager loading (before full world view object loads)
  const { data: regionMetadata, isLoading: regionsLoading } = useQuery({
    queryKey: ['regionMetadata', selectedWorldViewId, viewingRegionId],
    queryFn: async () => {
      if (viewingRegionId === 'all-leaf') {
        // Default view: show all leaf regions
        return fetchLeafRegions(selectedWorldViewId!);
      }
      // Viewing subregions of a specific parent
      return fetchSubregions(viewingRegionId as number);
    },
    enabled: !!selectedWorldViewId && isCustomWorldView,
    staleTime: 30000,
  });

  // Fetch division metadata for GADM (no geometries)
  const { data: divisionMetadata, isLoading: divisionsLoading } = useQuery({
    queryKey: ['divisionMetadata', viewingParentId],
    queryFn: async () => {
      if (viewingParentId === 'root') {
        return fetchRootDivisions();
      }
      return fetchSubdivisions(viewingParentId as number);
    },
    enabled: !!selectedWorldView && !isCustomWorldView,
    staleTime: 300000,
  });

  const metadata = isCustomWorldView ? regionMetadata : divisionMetadata;
  const metadataLoading = isCustomWorldView ? regionsLoading : divisionsLoading;

  // Create a lookup map for metadata by ID
  // Include both current view metadata AND root regions for tooltip lookups
  const metadataById = useMemo(() => {
    const lookup: Record<number, {
      name: string;
      hasChildren?: boolean;
      hasSubregions?: boolean;
      color?: string;
      parentRegionId?: number | null;
      focusBbox?: [number, number, number, number] | null;
      anchorPoint?: [number, number] | null;
    }> = {};

    // Add root regions first (for hover tooltips when at root level)
    if (isCustomWorldView && rootRegions) {
      for (const region of rootRegions) {
        lookup[region.id] = {
          name: region.name,
          hasSubregions: region.hasSubregions,
          color: region.color ?? undefined,
          parentRegionId: region.parentRegionId,
          focusBbox: region.focusBbox,
          anchorPoint: region.anchorPoint,
        };
      }
    }

    // Add current view metadata (may override root regions, which is fine)
    if (metadata) {
      for (const item of metadata) {
        const region = item as Region;
        lookup[item.id] = {
          name: item.name,
          hasChildren: 'hasChildren' in item ? item.hasChildren : undefined,
          hasSubregions: 'hasSubregions' in item ? item.hasSubregions : undefined,
          color: 'color' in item ? region.color ?? undefined : undefined,
          parentRegionId: 'parentRegionId' in item ? region.parentRegionId : undefined,
          focusBbox: 'focusBbox' in item ? region.focusBbox : undefined,
          anchorPoint: 'anchorPoint' in item ? region.anchorPoint : undefined,
        };
      }
    }
    return lookup;
  }, [metadata, rootRegions, isCustomWorldView]);

  // ==========================================================================
  // Vector Tile URLs
  // ==========================================================================

  // Build tile URL for current view
  // _v is a cache-busting version incremented when geometry data changes (editor close)
  // Uses selectedWorldViewId for eager loading (tiles can start before full world view object loads)
  const tileUrl = useMemo(() => {
    if (!selectedWorldViewId && !selectedWorldView) return null;

    const versionParam = `&_v=${tileVersion}`;
    let url: string;

    if (isCustomWorldView) {
      // Custom world view regions
      const wvId = selectedWorldViewId ?? selectedWorldView?.id;
      if (viewingRegionId === 'all-leaf') {
        // Default view: show ALL leaf regions (regions without subregions)
        url = `${MARTIN_URL}/tile_world_view_all_leaf_regions/{z}/{x}/{y}?world_view_id=${wvId}${versionParam}`;
      } else {
        // Viewing subregions of a specific parent region
        url = `${MARTIN_URL}/tile_region_subregions/{z}/{x}/{y}?parent_id=${viewingRegionId}${versionParam}`;
      }
    } else {
      // GADM divisions
      if (viewingParentId === 'root') {
        url = `${MARTIN_URL}/tile_gadm_root_divisions/{z}/{x}/{y}?_v=${tileVersion}`;
      } else {
        url = `${MARTIN_URL}/tile_gadm_subdivisions/{z}/{x}/{y}?parent_id=${viewingParentId}${versionParam}`;
      }
    }

    return url;
  }, [selectedWorldViewId, selectedWorldView, isCustomWorldView, viewingRegionId, viewingParentId, tileVersion]);

  // Island boundaries tile URL (for archipelagos)
  const islandTileUrl = useMemo(() => {
    if (!isCustomWorldView || !selectedWorldViewId) return null;

    const versionParam = `&_v=${tileVersion}`;

    if (viewingRegionId === 'all-leaf') {
      return `${MARTIN_URL}/tile_region_islands/{z}/{x}/{y}?_v=${tileVersion}`;
    } else {
      return `${MARTIN_URL}/tile_region_islands/{z}/{x}/{y}?parent_id=${viewingRegionId}${versionParam}`;
    }
  }, [isCustomWorldView, selectedWorldViewId, viewingRegionId, tileVersion]);

  // Root regions border overlay URL (only at root level for hover highlighting)
  const rootRegionsBorderUrl = useMemo(() => {
    if (!isCustomWorldView || !selectedWorldViewId) return null;
    // Only load at root level (all-leaf view)
    if (viewingRegionId !== 'all-leaf') return null;

    return `${MARTIN_URL}/tile_world_view_root_regions/{z}/{x}/{y}?world_view_id=${selectedWorldViewId}&_v=${tileVersion}`;
  }, [isCustomWorldView, selectedWorldViewId, viewingRegionId, tileVersion]);

  // Source layer name based on view type
  const sourceLayerName = isCustomWorldView ? REGIONS_SOURCE_LAYER : DIVISIONS_SOURCE_LAYER;

  // ==========================================================================
  // Feature State for visited regions
  // ==========================================================================

  // Track previously visited region IDs to clear their state when unmarked
  const prevVisitedRef = useRef<Set<number>>(new Set());

  // Apply visited state to features using setFeatureState
  // We use a sourcedata event to ensure the source is loaded before setting state
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !isCustomWorldView) return;

    const map = mapRef.current.getMap();
    const currentVisited = visitedRegionIds || new Set<number>();

    const applyVisitedState = () => {
      // Double-check source exists
      if (!map.getSource('regions-vt')) return;

      // Clear state for regions that were visited but are no longer
      prevVisitedRef.current.forEach((regionId) => {
        if (!currentVisited.has(regionId)) {
          try {
            map.setFeatureState(
              { source: 'regions-vt', sourceLayer: REGIONS_SOURCE_LAYER, id: regionId },
              { visited: false }
            );
          } catch {
            // Feature might not be loaded, ignore
          }
        }
      });

      // Set visited state for currently visited regions
      currentVisited.forEach((regionId) => {
        try {
          map.setFeatureState(
            { source: 'regions-vt', sourceLayer: REGIONS_SOURCE_LAYER, id: regionId },
            { visited: true }
          );
        } catch {
          // Feature might not be loaded yet, ignore
        }
      });

      // Update the ref with current visited set
      prevVisitedRef.current = new Set(currentVisited);
    };

    // If source already exists, apply immediately
    if (map.getSource('regions-vt')) {
      applyVisitedState();
    }

    // Listen for sourcedata event to apply when NEW tiles load
    // Only apply when tile data actually arrives (not on every sourcedata)
    const handleSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === 'regions-vt' && e.isSourceLoaded && e.tile) {
        // New tile arrived - apply visited state (debounced via requestIdleCallback)
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => applyVisitedState(), { timeout: 100 });
        } else {
          setTimeout(applyVisitedState, 50);
        }
      }
    };

    map.on('sourcedata', handleSourceData);

    return () => {
      map.off('sourcedata', handleSourceData);
    };
  }, [mapLoaded, visitedRegionIds, isCustomWorldView, viewingRegionId, tileUrl]);

  // ==========================================================================
  // Defer root overlay loading until main tiles render
  // This reduces initial load time since root overlay is only for hover highlighting
  // ==========================================================================

  useEffect(() => {
    // Reset root overlay when navigating away from all-leaf view
    if (viewingRegionId !== 'all-leaf') {
      setRootOverlayEnabled(false);
      return;
    }

    if (!mapLoaded || !mapRef.current || !isCustomWorldView) {
      setRootOverlayEnabled(false);
      return;
    }

    const map = mapRef.current.getMap();

    const handleSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === 'regions-vt' && e.isSourceLoaded) {
        // Main tiles loaded, now enable root overlay
        setRootOverlayEnabled(true);
        map.off('sourcedata', handleSourceData);
      }
    };

    // Check if source already loaded
    if (map.getSource('regions-vt') && map.isSourceLoaded('regions-vt')) {
      setRootOverlayEnabled(true);
    } else {
      map.on('sourcedata', handleSourceData);
    }

    return () => {
      map.off('sourcedata', handleSourceData);
    };
  }, [mapLoaded, isCustomWorldView, viewingRegionId]);

  // ==========================================================================
  // Track when tiles are ready (for loading overlay)
  // Reset when navigating to new region/world view
  // ==========================================================================

  // Reset tilesReady when tile URL changes (navigation)
  useEffect(() => {
    setTilesReady(false);
  }, [tileUrl]);

  // Set tilesReady when source is loaded (using sourcedata event)
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !tileUrl) return;

    const map = mapRef.current.getMap();

    const handleSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === 'regions-vt' && e.isSourceLoaded) {
        setTilesReady(true);
        map.off('sourcedata', handleSourceData);
      }
    };

    // Check if source already exists and is loaded
    if (map.getSource('regions-vt') && map.isSourceLoaded('regions-vt')) {
      setTilesReady(true);
    } else {
      map.on('sourcedata', handleSourceData);
    }

    return () => {
      map.off('sourcedata', handleSourceData);
    };
  }, [mapLoaded, tileUrl]);

  // ==========================================================================
  // Apply hover state to features using setFeatureState (fast!)
  // This is much faster than setPaintProperty because it only updates
  // the specific feature's state, not the entire layer's paint expression.
  // ==========================================================================

  // Track the previous hovered ID to clear its state
  const prevHoveredIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current.getMap();
    if (!map.getSource('regions-vt')) return;

    // Clear previous hover state on main source
    if (prevHoveredIdRef.current !== null) {
      try {
        map.setFeatureState(
          { source: 'regions-vt', sourceLayer: sourceLayerName, id: prevHoveredIdRef.current },
          { hovered: false }
        );
      } catch {
        // Feature might not exist anymore
      }
      // Also clear on root regions overlay if it exists
      if (map.getSource('root-regions-vt')) {
        try {
          map.setFeatureState(
            { source: 'root-regions-vt', sourceLayer: REGIONS_SOURCE_LAYER, id: prevHoveredIdRef.current },
            { hovered: false }
          );
        } catch {
          // Feature might not exist
        }
      }
    }

    // Set new hover state on main source (but NOT when exploring)
    if (hoveredRegionId !== null && !isExploring) {
      try {
        map.setFeatureState(
          { source: 'regions-vt', sourceLayer: sourceLayerName, id: hoveredRegionId },
          { hovered: true }
        );
      } catch {
        // Feature might not be loaded yet
      }
      // Also set on root regions overlay if it exists
      if (map.getSource('root-regions-vt')) {
        try {
          map.setFeatureState(
            { source: 'root-regions-vt', sourceLayer: REGIONS_SOURCE_LAYER, id: hoveredRegionId },
            { hovered: true }
          );
        } catch {
          // Feature might not be loaded yet
        }
      }
      prevHoveredIdRef.current = hoveredRegionId;
    } else {
      prevHoveredIdRef.current = null;
    }
  }, [mapLoaded, hoveredRegionId, sourceLayerName, isExploring]);

  // ==========================================================================
  // Hide region layers when exploring (so markers aren't cluttered)
  // ==========================================================================
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current.getMap();
    const layerIds = ['region-hull', 'region-fill', 'region-outline', 'island-fill', 'island-outline', 'root-region-border'];
    const visibility = isExploring ? 'none' : 'visible';
    for (const id of layerIds) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visibility);
      }
    }
  }, [mapLoaded, isExploring]);

  // ==========================================================================
  // Fly to selected region when it changes (e.g., from list click)
  // For map clicks, this is handled immediately in handleMapClick
  // ==========================================================================

  // Track if the last selection was from a map click (to avoid double fly-to)
  const lastMapClickIdRef = useRef<number | null>(null);

  // Fly to selected region when selection changes (for list clicks)
  useEffect(() => {
    if (!selectedRegion || !mapRef.current || !mapLoaded || !isCustomWorldView) return;

    // Skip if this selection was from a map click (already flew there)
    if (lastMapClickIdRef.current === selectedRegion.id) {
      lastMapClickIdRef.current = null;
      return;
    }

    // Use pre-computed focusBbox for instant fitBounds (adapts to screen size)
    if (selectedRegion.focusBbox) {
      console.log('[RegionMapVT] Flying to region using pre-computed focusBbox:', selectedRegion.name);
      smartFitBounds(mapRef.current, selectedRegion.focusBbox, {
        padding: 60,
        duration: 400,
        anchorPoint: selectedRegion.anchorPoint,
      });
      return;
    }

    // Fallback: try to find feature in tiles (should rarely happen)
    console.log('[RegionMapVT] No pre-computed focusBbox, trying tile query:', selectedRegion.name);
    const map = mapRef.current.getMap();
    const features = map.querySourceFeatures('regions-vt', {
      sourceLayer: sourceLayerName,
      filter: ['==', ['get', 'id'], selectedRegion.id],
    });

    if (features.length > 0 && features[0].geometry) {
      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: [features[0] as GeoJSON.Feature],
        };
        const bbox = turf.bbox(geojson) as [number, number, number, number];
        smartFitBounds(mapRef.current, bbox, { padding: 80, duration: 400, geojson });
      } catch (e) {
        console.error('[RegionMapVT] Failed to fit bounds from tile feature:', e);
      }
    }
  }, [selectedRegion, isCustomWorldView, mapLoaded, sourceLayerName]);

  // Fly to selected division when selection changes (for GADM list clicks)
  useEffect(() => {
    if (!selectedDivision || !mapRef.current || !mapLoaded || isCustomWorldView) return;

    // Skip if this selection was from a map click
    if (lastMapClickIdRef.current === selectedDivision.id) {
      lastMapClickIdRef.current = null;
      return;
    }

    console.log('[RegionMapVT] Flying to division from list selection:', selectedDivision.id, selectedDivision.name);

    // Try to find the feature in already-loaded tiles
    const map = mapRef.current.getMap();
    const features = map.querySourceFeatures('regions-vt', {
      sourceLayer: sourceLayerName,
      filter: ['==', ['get', 'id'], selectedDivision.id],
    });

    if (features.length > 0 && features[0].geometry) {
      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: [features[0] as GeoJSON.Feature],
        };
        const bbox = turf.bbox(geojson) as [number, number, number, number];
        smartFitBounds(mapRef.current, bbox, { padding: 100, duration: 500, geojson });
        return;
      } catch (e) {
        console.error('[RegionMapVT] Failed to fit bounds from tile feature:', e);
      }
    }

    // Feature not in tiles yet - fetch geometry from API
    fetchDivisionGeometry(selectedDivision.id, selectedWorldView?.id ?? 1)
      .then(geom => {
        if (geom?.geometry && mapRef.current) {
          try {
            const geojson: GeoJSON.FeatureCollection = {
              type: 'FeatureCollection',
              features: [geom as GeoJSON.Feature],
            };
            const bbox = turf.bbox(geojson) as [number, number, number, number];
            smartFitBounds(mapRef.current, bbox, { padding: 100, duration: 500, geojson });
          } catch (e) {
            console.error('[RegionMapVT] Failed to fit bounds from API geometry:', e);
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on division ID change
  }, [selectedDivision?.id, isCustomWorldView, mapLoaded, sourceLayerName, selectedWorldView?.id]);

  // ==========================================================================
  // Reset to world view when navigating back to root
  // ==========================================================================

  // Track previous region/division to detect when we go back to root
  const prevRegionIdRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const currentRegionId = selectedRegion?.id ?? null;

    // For custom world views: if we had a region selected and now we don't, fly to world view
    if (isCustomWorldView && prevRegionIdRef.current !== undefined && currentRegionId === null) {
      mapRef.current.flyTo({
        center: [0, 15],
        zoom: 1,
        duration: 500,
      });
    }

    prevRegionIdRef.current = currentRegionId;
  }, [selectedRegion?.id, isCustomWorldView, mapLoaded]);

  // ==========================================================================
  // Event handlers
  // ==========================================================================

  const handleMapLoad = useCallback(() => {
    setMapLoaded(true);
  }, []);

  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    // Disable region clicks when exploring experiences
    if (isExploring) return;

    const features = event.features;
    if (features && features.length > 0) {
      const clickedFeature = features[0];
      // Use region_id or division_id from properties depending on view type
      const id = isCustomWorldView
        ? clickedFeature.properties?.region_id as number | undefined
        : clickedFeature.properties?.division_id as number | undefined;

      if (id) {
        // Record that this selection came from a map click (to prevent double fly-to in useEffect)
        lastMapClickIdRef.current = id;

        // Get metadata from our lookup
        const meta = metadataById[id];

        console.log('[RegionMapVT] Click:', {
          id,
          meta,
          featureProperties: clickedFeature.properties,
          viewingRegionId,
        });

        // Fly to region using pre-computed focusBbox (instant!)
        // smartFitBounds handles antimeridian-crossing regions
        if (mapRef.current) {
          if (meta?.focusBbox) {
            smartFitBounds(mapRef.current, meta.focusBbox, {
              padding: 60,
              duration: 400,
              anchorPoint: meta.anchorPoint,
            });
          } else if (clickedFeature.geometry) {
            // Fallback: calculate from geometry
            try {
              const featureGeojson: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: [clickedFeature as GeoJSON.Feature],
              };
              const bbox = turf.bbox(featureGeojson) as [number, number, number, number];
              smartFitBounds(mapRef.current, bbox, { padding: 60, duration: 400, geojson: featureGeojson });
            } catch (e) {
              console.error('Failed to fit bounds from clicked feature:', e);
            }
          }
        }

        if (isCustomWorldView) {
          // For leaf regions in all-leaf view, use the parent_region_id from the tile
          // For subregions view, use the current viewing parent
          const parentRegionId = viewingRegionId === 'all-leaf'
            ? (clickedFeature.properties?.parent_region_id ?? meta?.parentRegionId ?? null)
            : viewingRegionId;

          const newRegion: Region = {
            id,
            worldViewId: selectedWorldView!.id,
            name: meta?.name ?? clickedFeature.properties?.name ?? '',
            description: null,
            parentRegionId: parentRegionId,
            color: meta?.color ?? clickedFeature.properties?.color ?? null,
            hasSubregions: meta?.hasSubregions ?? clickedFeature.properties?.has_subregions ?? false,
            focusBbox: meta?.focusBbox,
            anchorPoint: meta?.anchorPoint,
          };

          console.log('[RegionMapVT] Setting selectedRegion:', newRegion);
          setSelectedRegion(newRegion);
        } else {
          let parentId: number | null = null;

          if (!selectedDivision) {
            parentId = null;
          } else if (selectedDivision.hasChildren) {
            parentId = selectedDivision.id;
          } else {
            parentId = selectedDivision.parentId;
          }

          setSelectedDivision({
            id,
            name: meta?.name ?? clickedFeature.properties?.name ?? '',
            parentId: parentId,
            hasChildren: meta?.hasChildren ?? clickedFeature.properties?.has_children ?? false,
          });
        }
      }
    }
  }, [selectedDivision, setSelectedDivision, isCustomWorldView, setSelectedRegion, selectedWorldView, metadataById, viewingRegionId, isExploring]);

  const handleMouseMove = useCallback((event: MapLayerMouseEvent) => {
    // Disable region hover when exploring experiences
    if (isExploring) {
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = '';
      }
      return;
    }

    const features = event.features;
    if (features && features.length > 0) {
      // Use region_id or division_id from properties depending on view type
      const id = isCustomWorldView
        ? features[0].properties?.region_id as number | undefined
        : features[0].properties?.division_id as number | undefined;
      setHoveredRegionId(id ?? null);
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = 'pointer';
      }
    } else {
      setHoveredRegionId(null);
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = '';
      }
    }
  }, [setHoveredRegionId, isCustomWorldView, isExploring]);

  const handleMouseLeave = useCallback(() => {
    setHoveredRegionId(null);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = '';
    }
  }, [setHoveredRegionId]);

  // Navigate to parent
  const handleGoToParent = useCallback(async () => {
    if (isCustomWorldView) {
      if (!selectedRegion || regionBreadcrumbs.length === 0) {
        return;
      }

      if (regionBreadcrumbs.length === 1) {
        setSelectedRegion(null);
      } else {
        const parentRegion = regionBreadcrumbs[regionBreadcrumbs.length - 2];
        setSelectedRegion(parentRegion);
      }
      return;
    }

    if (!selectedDivision?.parentId) {
      setSelectedDivision(null);
      return;
    }

    try {
      const parent = await fetchDivision(selectedDivision.parentId, selectedWorldView?.id ?? 1);
      setSelectedDivision(parent);
    } catch (e) {
      console.error('Failed to fetch parent division', e);
      setSelectedDivision(null);
    }
  }, [selectedDivision, selectedWorldView, setSelectedDivision, isCustomWorldView, selectedRegion, setSelectedRegion, regionBreadcrumbs]);

  // Get hovered region name from metadata
  const hoveredRegionName = useMemo(() => {
    if (!hoveredRegionId) return null;
    return metadataById[hoveredRegionId]?.name ?? null;
  }, [hoveredRegionId, metadataById]);

  const hoverPreviewImage = useMemo(() => {
    if (!hoverPreview) return null;
    const imageUrl = extractImageUrl(hoverPreview.imageUrl);
    if (!imageUrl) return null;
    return toThumbnailUrl(imageUrl, 720);
  }, [hoverPreview]);

  const hoverCardPlacement = useMemo(() => {
    const fallback = { left: 16, bottom: 16 } as const;
    if (!hoverPreview || !mapRef.current || !mapLoaded) return fallback;
    const map = mapRef.current.getMap();
    const canvas = map.getCanvas();
    const point = map.project([hoverPreview.longitude, hoverPreview.latitude]);
    const placeLeft = point.x >= canvas.clientWidth / 2;
    const placeBottom = point.y < canvas.clientHeight / 2;
    return {
      ...(placeLeft ? { left: 16 } : { right: 16 }),
      ...(placeBottom ? { bottom: 16 } : { top: 86 }),
    };
  }, [hoverPreview, mapLoaded]);

  // Interactive layer IDs
  const interactiveLayerIds = useMemo(() => {
    const layers = ['region-fill', 'region-hull'];
    if (isCustomWorldView) {
      layers.push('island-fill');
    }
    return layers;
  }, [isCustomWorldView]);

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
          zoom: 1, // Show entire world at root level
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

        {/* Main regions/divisions vector tile source */}
        {tileUrl && (
          <Source
            key={tileUrl}  // Force re-creation when URL changes
            id="regions-vt"
            type="vector"
            tiles={[tileUrl]}
            promoteId={isCustomWorldView ? 'region_id' : 'division_id'}
          >
            {/* Hull layer for archipelagos */}
            <Layer
              id="region-hull"
              type="fill"
              source-layer={sourceLayerName}
              filter={['==', ['get', 'using_ts_hull'], true]}
              paint={{
                'fill-color': [
                  'case',
                  ['==', ['get', 'id'], selectedRegion?.id ?? -1],
                  '#6366f1', // Indigo for selected
                  ['boolean', ['feature-state', 'visited'], false],
                  '#10b981', // Emerald for visited
                  ['has', 'color'],
                  ['coalesce', ['get', 'color'], '#6366f1'],
                  '#6366f1',
                ],
                'fill-opacity': [
                  'case',
                  ['==', ['get', 'id'], selectedRegion?.id ?? -1],
                  0.2,
                  ['boolean', ['feature-state', 'hovered'], false],
                  0.25,
                  ['boolean', ['feature-state', 'visited'], false],
                  0.15,
                  0.08, // More transparent at rest
                ],
              }}
            />

            {/* Regular fill layer */}
            <Layer
              id="region-fill"
              type="fill"
              source-layer={sourceLayerName}
              filter={['!=', ['get', 'using_ts_hull'], true]}
              paint={{
                'fill-color': [
                  'case',
                  ['==', ['get', 'id'], selectedRegion?.id ?? -1],
                  '#6366f1', // Indigo for selected
                  ['boolean', ['feature-state', 'visited'], false],
                  '#10b981', // Emerald for visited
                  ['has', 'color'],
                  ['coalesce', ['get', 'color'], '#6366f1'],
                  '#6366f1',
                ],
                'fill-opacity': [
                  'case',
                  ['boolean', ['feature-state', 'hovered'], false],
                  0.45,
                  ['boolean', ['feature-state', 'visited'], false],
                  0.35,
                  0.2, // More transparent at rest
                ],
              }}
            />

            {/* Outline layer */}
            <Layer
              id="region-outline"
              type="line"
              source-layer={sourceLayerName}
              filter={['!=', ['get', 'using_ts_hull'], true]}
              paint={{
                'line-color': [
                  'case',
                  ['==', ['get', 'id'], selectedRegion?.id ?? -1],
                  '#4f46e5', // Darker indigo for selected outline
                  ['boolean', ['feature-state', 'hovered'], false],
                  '#0ea5e9', // Sky blue for hover
                  ['boolean', ['feature-state', 'visited'], false],
                  '#059669', // Darker emerald for visited
                  ['has', 'color'],
                  ['coalesce', ['get', 'color'], '#6366f1'],
                  '#6366f1',
                ],
                'line-width': [
                  'case',
                  ['boolean', ['feature-state', 'hovered'], false],
                  2.5,
                  ['==', ['get', 'id'], selectedRegion?.id ?? -1],
                  2,
                  1, // Thinner borders
                ],
                'line-opacity': [
                  'case',
                  ['boolean', ['feature-state', 'hovered'], false],
                  1,
                  0.6,
                ],
              }}
            />
          </Source>
        )}

        {/* Island boundaries vector tile source (for archipelagos) */}
        {islandTileUrl && isCustomWorldView && (
          <Source
            key={islandTileUrl}  // Force re-creation when URL changes
            id="islands-vt"
            type="vector"
            tiles={[islandTileUrl]}
            promoteId="region_id"
          >
            <Layer
              id="island-fill"
              type="fill"
              source-layer={ISLANDS_SOURCE_LAYER}
              paint={{
                'fill-color': [
                  'case',
                  ['has', 'color'],
                  ['coalesce', ['get', 'color'], '#6366f1'],
                  '#6366f1',
                ],
                'fill-opacity': 0.06,
              }}
            />
            <Layer
              id="island-outline"
              type="line"
              source-layer={ISLANDS_SOURCE_LAYER}
              paint={{
                'line-color': [
                  'case',
                  ['has', 'color'],
                  ['coalesce', ['get', 'color'], '#6366f1'],
                  '#6366f1',
                ],
                'line-width': 0.5,
                'line-opacity': 0.5,
              }}
            />
          </Source>
        )}

        {/* Root regions border overlay (for hover highlighting at root level) */}
        {/* Deferred loading: only loads after main tiles render to reduce initial load time */}
        {rootRegionsBorderUrl && isCustomWorldView && rootOverlayEnabled && (
          <Source
            key={rootRegionsBorderUrl}
            id="root-regions-vt"
            type="vector"
            tiles={[rootRegionsBorderUrl]}
            promoteId="region_id"
          >
            {/* Border-only layer for root regions - visible on hover */}
            <Layer
              id="root-region-border"
              type="line"
              source-layer={REGIONS_SOURCE_LAYER}
              paint={{
                'line-color': [
                  'case',
                  ['boolean', ['feature-state', 'hovered'], false],
                  '#0ea5e9',  // Sky blue on hover
                  'transparent',  // Invisible when not hovered
                ],
                'line-width': [
                  'case',
                  ['boolean', ['feature-state', 'hovered'], false],
                  2.5,
                  0,
                ],
                'line-opacity': [
                  'case',
                  ['boolean', ['feature-state', 'hovered'], false],
                  1,
                  0,
                ],
              }}
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
