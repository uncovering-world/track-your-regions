/**
 * Hook: visited state, hover state, root overlay, tiles-ready tracking.
 */

import { useEffect, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';
import { subscribeToRegionHover, useRegionHoverActions } from '../../hooks/useRegionHover';

const REGIONS_SOURCE_LAYER = 'regions';

/**
 * How long the blocking "Loading map..." overlay may stay up before the map is
 * handed to the user anyway. Nothing guarantees the tiles ever arrive: a source
 * that errors, or one whose request never returns, leaves `isSourceLoaded` false
 * forever, and the overlay covering the whole canvas has no other way down.
 * After this the map becomes usable and the wait is reported non-blockingly —
 * a partly-drawn map the user can pan is better than an opaque one they cannot.
 */
const TILE_WAIT_TIMEOUT_MS = 8000;

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
  sourceLayerName,
  tileUrl,
  viewingRegionId,
  contextLayerCount,
}: UseMapFeatureStateOptions) {
  const [tilesReady, setTilesReady] = useState(false);
  const [tilesStalled, setTilesStalled] = useState(false);
  const waitStartedAtRef = useRef(Date.now());
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
    setTilesStalled(false);
    waitStartedAtRef.current = Date.now();
  }, [tileUrl]);

  useEffect(() => {
    // Armed before anything is checked, deliberately — before the map, and
    // before there is even a tile URL. The overlay is bound to tilesReady and
    // tilesStalled alone, so every state that leaves both false has to have
    // something scheduled to end it. A null tileUrl is not a corner case there:
    // it is the first paint, and it is permanent if /api/world-views never
    // answers, since worldViews then stays [] and no world view is ever picked.
    // The reset above re-stamps the deadline when a URL does arrive, so a slow
    // one still gets the full wait rather than the remainder of this one.
    const remaining = Math.max(
      0, TILE_WAIT_TIMEOUT_MS - (Date.now() - waitStartedAtRef.current));
    const timer = setTimeout(() => setTilesStalled(true), remaining);

    if (!tileUrl) return () => clearTimeout(timer);

    // Deadline, not duration: this effect re-runs when the map finishes loading,
    // and restarting a fresh timeout there would silently double the wait.
    if (!mapLoaded || !mapRef.current) return () => clearTimeout(timer);

    const map = mapRef.current.getMap();

    if (map.getSource('regions-vt') && map.isSourceLoaded('regions-vt')) {
      setTilesReady(true);
      clearTimeout(timer);
      return;
    }

    const stopWaiting = () => {
      clearTimeout(timer);
      map.off('sourcedata', handleSourceData);
      map.off('error', handleError);
    };

    const handleSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId === 'regions-vt' && e.isSourceLoaded) {
        setTilesReady(true);
        stopWaiting();
      }
    };

    // A failed tile request never produces an `isSourceLoaded` event, so without
    // this the overlay would outlive the thing it is waiting for. It lowers the
    // overlay and nothing more: MapLibre reports one error per failed tile, and
    // unsubscribing from `sourcedata` here would mean a single transient failure
    // pins the notice up for good, even once every tile has since arrived.
    const handleError = (e: { sourceId?: string }) => {
      if (e.sourceId === 'regions-vt') {
        setTilesStalled(true);
        clearTimeout(timer);
        map.off('error', handleError);
      }
    };

    map.on('sourcedata', handleSourceData);
    map.on('error', handleError);

    return stopWaiting;
  }, [mapLoaded, tileUrl, mapRef]);

  // Apply hover state to features using setFeatureState — from a subscription,
  // not a render: the hovered id changes on every mouse move over the map, and
  // as a prop of this hook it re-rendered the component that *is* the map's
  // sources and layers for each one (#573). Answering it here costs two
  // `setFeatureState` calls and no render at all.
  const prevHoveredIdRef = useRef<number | null>(null);
  const { store: regionHoverStore } = useRegionHoverActions();

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const map = mapRef.current.getMap();

    // The root overlay is in the list only while it is mounted: `setHoverState`
    // checks `getSource` per overlay anyway, but the gate is also what makes
    // `rootOverlayEnabled` a dependency — the overlay appearing re-subscribes,
    // and the call-once below paints the standing hover onto it.
    const overlaySources = [
      ...(rootOverlayEnabled ? ['root-regions-vt'] : []),
      ...Array.from({ length: contextLayerCount }, (_, i) => `context-${i}-vt`),
    ];

    // Called once on subscribe with the standing value — a hover set before
    // this effect re-ran (the tiles arriving, an overlay appearing, the source
    // replaced under it) is painted rather than lost until the pointer moves
    // again. `tileUrl` is a dependency for exactly that: replacing `regions-vt`
    // wipes its feature state, and re-subscribing is what repaints the standing
    // hover onto the new source — the visited effect above lists it for the
    // same reason.
    const paint = (hoveredRegionId: number | null) => {
      // Checked per event, not once at subscribe: the sources are added by
      // react-map-gl's own `<Source>` components after `load`, so a check that
      // gated the subscription concluded "no source" once and never looked
      // again — the pre-store effect self-healed because hover state re-ran it
      // on every pointer move, and this subscription has no such retry.
      if (!map.getSource('regions-vt')) return;
      if (prevHoveredIdRef.current !== null) {
        clearHoverState(map, sourceLayerName, overlaySources, prevHoveredIdRef.current);
      }

      if (hoveredRegionId !== null && !isExploring) {
        setHoverState(map, sourceLayerName, overlaySources, hoveredRegionId);
        prevHoveredIdRef.current = hoveredRegionId;
      } else {
        prevHoveredIdRef.current = null;
      }
    };
    const unsubscribe = subscribeToRegionHover(regionHoverStore, paint);

    // The retry for a paint the guard above skipped: a hover set in the window
    // between this effect running and the source landing has no later event to
    // carry it — the deps cover the *replacement* of a source, not its first
    // arrival. Same shape as the visited effect's listener; gated on the
    // painted id already matching so routine tile loads cost nothing.
    const handleSourceData = (e: MapSourceDataEvent) => {
      if (e.sourceId !== 'regions-vt' || !e.isSourceLoaded) return;
      if (prevHoveredIdRef.current === regionHoverStore.getState()) return;
      paint(regionHoverStore.getState());
    };
    map.on('sourcedata', handleSourceData);
    return () => {
      unsubscribe();
      map.off('sourcedata', handleSourceData);
    };
  }, [mapLoaded, regionHoverStore, sourceLayerName, isExploring, contextLayerCount, rootOverlayEnabled, tileUrl, mapRef]);

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

  return { tilesReady, tilesStalled, rootOverlayEnabled };
}
