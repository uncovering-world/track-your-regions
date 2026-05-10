/**
 * Hook: visited state, hover state, root overlay, tiles-ready tracking.
 */

import { useEffect, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';

const REGIONS_SOURCE_LAYER = 'regions';

/**
 * The setFeatureState calls swallow exceptions because the feature may not yet
 * be loaded (initial render) or may have been unloaded (after a tile evict);
 * either case is a no-op for hover painting.
 */
function applyFeatureHover(
  map: MapLibreMap,
  source: string,
  sourceLayer: string,
  id: number,
  hovered: boolean,
): void {
  try {
    map.setFeatureState({ source, sourceLayer, id }, { hovered });
  } catch {
    // Feature might not be loaded yet, or might have been unloaded — ignore.
  }
}

function clearHoverState(
  map: MapLibreMap,
  primaryLayer: string,
  overlaySources: string[],
  id: number,
): void {
  applyFeatureHover(map, 'regions-vt', primaryLayer, id, false);
  for (const overlaySource of overlaySources) {
    if (map.getSource(overlaySource)) {
      applyFeatureHover(map, overlaySource, REGIONS_SOURCE_LAYER, id, false);
    }
  }
}

function setHoverState(
  map: MapLibreMap,
  primaryLayer: string,
  overlaySources: string[],
  id: number,
): void {
  applyFeatureHover(map, 'regions-vt', primaryLayer, id, true);
  for (const overlaySource of overlaySources) {
    if (map.getSource(overlaySource)) {
      applyFeatureHover(map, overlaySource, REGIONS_SOURCE_LAYER, id, true);
    }
  }
}

interface UseMapFeatureStateOptions {
  mapRef: React.RefObject<MapRef | null>;
  mapLoaded: boolean;
  isCustomWorldView: boolean;
  isExploring: boolean;
  visitedRegionIds: Set<number> | undefined;
  hoveredRegionId: number | null;
  sourceLayerName: string;
  tileUrl: string | null;
  viewingRegionId: 'all-leaf' | number;
  contextLayerCount: number;
}

export function useMapFeatureState({
  mapRef,
  mapLoaded,
  isCustomWorldView,
  isExploring,
  visitedRegionIds,
  hoveredRegionId,
  sourceLayerName,
  tileUrl,
  viewingRegionId,
  contextLayerCount,
}: UseMapFeatureStateOptions) {
  const [tilesReady, setTilesReady] = useState(false);
  const [rootOverlayEnabled, setRootOverlayEnabled] = useState(false);

  // Track previously visited region IDs to clear their state when unmarked
  const prevVisitedRef = useRef<Set<number>>(new Set());

  // Apply visited state to features using setFeatureState
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !isCustomWorldView) return;

    const map = mapRef.current.getMap();
    const currentVisited = visitedRegionIds || new Set<number>();

    const applyVisitedState = () => {
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

      prevVisitedRef.current = new Set(currentVisited);
    };

    if (map.getSource('regions-vt')) {
      applyVisitedState();
    }

    const handleSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === 'regions-vt' && e.isSourceLoaded && e.tile) {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => applyVisitedState(), { timeout: 100 });
        } else {
          setTimeout(applyVisitedState, 50);
        }
      }
    };

    map.on('sourcedata', handleSourceData);
    return () => { map.off('sourcedata', handleSourceData); };
  }, [mapLoaded, visitedRegionIds, isCustomWorldView, viewingRegionId, tileUrl, mapRef]);

  // Defer root overlay loading until main tiles render
  useEffect(() => {
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
        setRootOverlayEnabled(true);
        map.off('sourcedata', handleSourceData);
      }
    };

    if (map.getSource('regions-vt') && map.isSourceLoaded('regions-vt')) {
      setRootOverlayEnabled(true);
    } else {
      map.on('sourcedata', handleSourceData);
    }

    return () => { map.off('sourcedata', handleSourceData); };
  }, [mapLoaded, isCustomWorldView, viewingRegionId, mapRef]);

  // Track when tiles are ready (for loading overlay)
  useEffect(() => {
    setTilesReady(false);
  }, [tileUrl]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !tileUrl) return;

    const map = mapRef.current.getMap();

    const handleSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === 'regions-vt' && e.isSourceLoaded) {
        setTilesReady(true);
        map.off('sourcedata', handleSourceData);
      }
    };

    if (map.getSource('regions-vt') && map.isSourceLoaded('regions-vt')) {
      setTilesReady(true);
    } else {
      map.on('sourcedata', handleSourceData);
    }

    return () => { map.off('sourcedata', handleSourceData); };
  }, [mapLoaded, tileUrl, mapRef]);

  // Apply hover state to features using setFeatureState
  const prevHoveredIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current.getMap();
    if (!map.getSource('regions-vt')) return;

    const overlaySources = [
      'root-regions-vt',
      ...Array.from({ length: contextLayerCount }, (_, i) => `context-${i}-vt`),
    ];

    if (prevHoveredIdRef.current !== null) {
      clearHoverState(map, sourceLayerName, overlaySources, prevHoveredIdRef.current);
    }

    if (hoveredRegionId !== null && !isExploring) {
      setHoverState(map, sourceLayerName, overlaySources, hoveredRegionId);
      prevHoveredIdRef.current = hoveredRegionId;
    } else {
      prevHoveredIdRef.current = null;
    }
  }, [mapLoaded, hoveredRegionId, sourceLayerName, isExploring, contextLayerCount, mapRef]);

  // Hide region layers when exploring
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current.getMap();
    const layerIds = [
      'region-hull', 'region-fill', 'island-fill', 'island-outline', 'root-region-border',
      ...Array.from({ length: contextLayerCount }, (_, i) => [`context-${i}-fill`, `context-${i}-outline`]).flat(),
    ];
    const visibility = isExploring ? 'none' : 'visible';
    for (const id of layerIds) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visibility);
      }
    }
  }, [mapLoaded, isExploring, contextLayerCount, mapRef]);

  return { tilesReady, rootOverlayEnabled };
}
