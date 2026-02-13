/**
 * Hook: click/hover handlers, fly-to effects, navigation callbacks.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { useNavigation } from '../../hooks/useNavigation';
import { extractImageUrl, toThumbnailUrl, useExperienceContext } from '../../hooks/useExperienceContext';
import { fetchDivision, fetchDivisionGeometry } from '../../api';
import { smartFitBounds } from '../../utils/mapUtils';
import type { Region } from '../../types';

const REGIONS_SOURCE_LAYER = 'regions';

interface UseMapInteractionsOptions {
  mapRef: React.RefObject<MapRef | null>;
  mapLoaded: boolean;
  metadataById: Record<number, {
    name: string;
    hasChildren?: boolean;
    hasSubregions?: boolean;
    color?: string;
    parentRegionId?: number | null;
    focusBbox?: [number, number, number, number] | null;
    anchorPoint?: [number, number] | null;
  }>;
  sourceLayerName: string;
  viewingRegionId: 'all-leaf' | number;
  contextLayerCount: number;
}

export function useMapInteractions({
  mapRef,
  mapLoaded,
  metadataById,
  sourceLayerName,
  viewingRegionId,
  contextLayerCount,
}: UseMapInteractionsOptions) {
  const {
    selectedDivision,
    selectedWorldView,
    setSelectedDivision,
    hoveredRegionId,
    setHoveredRegionId,
    isCustomWorldView,
    selectedRegion,
    setSelectedRegion,
    regionBreadcrumbs,
  } = useNavigation();

  const { isExploring, hoverPreview } = useExperienceContext();

  // Track if the last selection was from a map click (to avoid double fly-to)
  const lastMapClickIdRef = useRef<number | null>(null);

  // Clear hover state when entering exploration mode
  useEffect(() => {
    if (isExploring) {
      setHoveredRegionId(null);
    }
  }, [isExploring, setHoveredRegionId]);

  // Fly to selected region when selection changes (for list clicks)
  useEffect(() => {
    if (!selectedRegion || !mapRef.current || !mapLoaded || !isCustomWorldView) return;

    if (lastMapClickIdRef.current === selectedRegion.id) {
      lastMapClickIdRef.current = null;
      return;
    }

    if (selectedRegion.focusBbox) {
      console.log('[RegionMapVT] Flying to region using pre-computed focusBbox:', selectedRegion.name);
      smartFitBounds(mapRef.current, selectedRegion.focusBbox, {
        padding: 60,
        duration: 400,
        anchorPoint: selectedRegion.anchorPoint,
      });
      return;
    }

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
  }, [selectedRegion, isCustomWorldView, mapLoaded, sourceLayerName, mapRef]);

  // Fly to selected division when selection changes (for GADM list clicks)
  useEffect(() => {
    if (!selectedDivision || !mapRef.current || !mapLoaded || isCustomWorldView) return;

    if (lastMapClickIdRef.current === selectedDivision.id) {
      lastMapClickIdRef.current = null;
      return;
    }

    console.log('[RegionMapVT] Flying to division from list selection:', selectedDivision.id, selectedDivision.name);

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

  // Reset to world view when navigating back to root
  const prevRegionIdRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const currentRegionId = selectedRegion?.id ?? null;

    if (isCustomWorldView && prevRegionIdRef.current !== undefined && currentRegionId === null) {
      mapRef.current.flyTo({
        center: [0, 15],
        zoom: 1,
        duration: 500,
      });
    }

    prevRegionIdRef.current = currentRegionId;
  }, [selectedRegion?.id, isCustomWorldView, mapLoaded, mapRef]);

  // Event handlers
  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    if (isExploring) return;

    const features = event.features;
    if (features && features.length > 0) {
      // Prefer main tile features (region-fill, region-hull) over context layer
      // features when both exist at the click point. Context layers cover entire
      // ancestor areas, so without this preference a click on a child region
      // would match the ancestor polygon from the context layer instead.
      const clickedFeature = features.find(f => !f.layer?.id?.startsWith('context-')) ?? features[0];
      const id = isCustomWorldView
        ? clickedFeature.properties?.region_id as number | undefined
        : clickedFeature.properties?.division_id as number | undefined;

      if (id) {
        const meta = metadataById[id];

        // Detect if click came from an ancestor context layer
        const fromContextLayer = clickedFeature.layer?.id?.startsWith('context-');

        console.log('[RegionMapVT] Click:', {
          id,
          meta,
          featureProperties: clickedFeature.properties,
          viewingRegionId,
          fromContextLayer,
        });

        if (mapRef.current) {
          if (meta?.focusBbox) {
            // Current-level region with known focus data — fly immediately
            lastMapClickIdRef.current = id;
            smartFitBounds(mapRef.current, meta.focusBbox, {
              padding: 60,
              duration: 400,
              anchorPoint: meta.anchorPoint,
            });
          } else if (fromContextLayer) {
            // Context layer click — tile functions don't include focusBbox.
            // Don't fly immediately from imprecise tile geometry; let the
            // ancestors API enrich selectedRegion with proper focusBbox, which
            // triggers the fly-to effect with accurate bounds.
          } else if (clickedFeature.geometry) {
            lastMapClickIdRef.current = id;
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

        if (isCustomWorldView && selectedWorldView) {
          // For context layer clicks, parent comes from the feature's own parent_region_id
          // (not viewingRegionId, which is the currently selected non-leaf region)
          const parentRegionId = fromContextLayer
            ? (clickedFeature.properties?.parent_region_id ?? null)
            : (viewingRegionId === 'all-leaf'
              ? (clickedFeature.properties?.parent_region_id ?? meta?.parentRegionId ?? null)
              : viewingRegionId);

          const newRegion: Region = {
            id,
            worldViewId: selectedWorldView.id,
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
  }, [selectedDivision, setSelectedDivision, isCustomWorldView, setSelectedRegion, selectedWorldView, metadataById, viewingRegionId, isExploring, mapRef]);

  const handleMouseMove = useCallback((event: MapLayerMouseEvent) => {
    if (isExploring) {
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = '';
      }
      return;
    }

    const features = event.features;
    if (features && features.length > 0) {
      // Prefer main tile features over context layers (same logic as click handler).
      // Context layers cover entire ancestor areas, so without this preference
      // hovering a child would resolve to the ancestor's region_id.
      const preferred = features.find(f => !f.layer?.id?.startsWith('context-')) ?? features[0];
      const id = isCustomWorldView
        ? preferred.properties?.region_id as number | undefined
        : preferred.properties?.division_id as number | undefined;
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
  }, [setHoveredRegionId, isCustomWorldView, isExploring, mapRef]);

  const handleMouseLeave = useCallback(() => {
    setHoveredRegionId(null);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = '';
    }
  }, [setHoveredRegionId, mapRef]);

  // Clear hover when cursor leaves the map container entirely.
  // react-map-gl's onMouseLeave only fires when leaving interactive layers,
  // not when the cursor exits the map canvas — so hover can get stuck.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const container = mapRef.current.getMap().getContainer();
    const onLeave = () => setHoveredRegionId(null);
    container.addEventListener('mouseleave', onLeave);
    return () => container.removeEventListener('mouseleave', onLeave);
  }, [mapLoaded, setHoveredRegionId, mapRef]);

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

  // Get hovered region name from metadata, falling back to tile feature properties
  // (for siblings not in current-level metadata)
  const hoveredRegionName = useMemo(() => {
    if (!hoveredRegionId) return null;
    if (metadataById[hoveredRegionId]?.name) return metadataById[hoveredRegionId].name;
    // Fall back: query tile features for the name
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      // Check context sources, main source, and root overlay
      const sourceIds = [
        ...Array.from({ length: contextLayerCount }, (_, i) => `context-${i}-vt`),
        'regions-vt',
        'root-regions-vt',
      ];
      for (const sourceId of sourceIds) {
        if (!map.getSource(sourceId)) continue;
        const sourceLayer = sourceId === 'regions-vt' ? sourceLayerName : REGIONS_SOURCE_LAYER;
        // Filter by promoted feature ID to avoid scanning all loaded tile features
        const features = map.querySourceFeatures(sourceId, {
          sourceLayer,
          filter: ['==', ['id'], hoveredRegionId],
        });
        if (features.length > 0 && features[0].properties?.name) {
          return features[0].properties.name as string;
        }
      }
    }
    return null;
  }, [hoveredRegionId, metadataById, mapRef, mapLoaded, sourceLayerName, contextLayerCount]);

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
  }, [hoverPreview, mapLoaded, mapRef]);

  // Interactive layer IDs
  const interactiveLayerIds = useMemo(() => {
    const layers = ['region-fill', 'region-hull'];
    if (isCustomWorldView) {
      layers.push('island-fill');
      for (let i = 0; i < contextLayerCount; i++) {
        layers.push(`context-${i}-fill`);
      }
    }
    return layers;
  }, [isCustomWorldView, contextLayerCount]);

  return {
    handleMapClick,
    handleMouseMove,
    handleMouseLeave,
    handleGoToParent,
    hoveredRegionName,
    hoverPreview,
    hoverPreviewImage,
    hoverCardPlacement,
    interactiveLayerIds,
    selectedRegion,
    selectedDivision,
    isCustomWorldView,
    isExploring,
    hoveredRegionId,
  };
}
