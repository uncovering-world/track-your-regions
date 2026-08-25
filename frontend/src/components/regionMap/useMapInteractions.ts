/**
 * Hook: click/hover handlers, fly-to effects, navigation callbacks.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { useNavigation } from '../../hooks/useNavigation';
import { useRegionHoverActions } from '../../hooks/useRegionHover';
import { useExperienceContext } from '../../hooks/useExperienceContext';
import { fetchDivision, fetchDivisionGeometry } from '../../api';
import { focusFromGeoJson, smartFitBounds } from '../../utils/mapUtils';
import type { Region } from '../../types';

interface ClickMeta {
  name?: string;
  hasChildren?: boolean;
  hasSubregions?: boolean;
  color?: string;
  parentRegionId?: number | null;
  focusBbox?: [number, number, number, number] | null;
  anchorPoint?: [number, number] | null;
}

function flyToClickedFeature(
  map: MapRef | null,
  id: number,
  meta: ClickMeta | undefined,
  isCustomWorldView: boolean,
  clickedFeature: { geometry?: GeoJSON.Geometry } & object,
  lastMapClickIdRef: React.MutableRefObject<number | null>,
): void {
  if (!map) return;
  if (meta?.focusBbox) {
    lastMapClickIdRef.current = id;
    smartFitBounds(map, meta.focusBbox, {
      padding: 60,
      duration: 400,
      anchorPoint: meta.anchorPoint,
    });
    return;
  }
  // No tile function carries focusBbox, so in a custom world view the accurate
  // box is always one read away: the ancestors call the selection makes anyway
  // enriches selectedRegion, and the fly-to effect below flies from it. Flying
  // from tile geometry first would be a second, worse animation — worse because
  // a feature is clipped to the tile it was drawn in, so the box is the box of
  // whatever part of the region that tile happened to hold. Every region a tile
  // drew has geometry, and the trigger
  // that computes geometry computes `focus_bbox` with it (measured on the dev
  // database: of 3 594 leaf regions with geometry, 0 lack focus data), so the
  // enrichment has an answer. A click on a context layer has always taken this
  // path and needs no term of its own: those layers exist only in a custom
  // world view — `useTileUrls` returns none otherwise, and `RegionMapVT` renders
  // and registers them under the same condition.
  //
  // GADM divisions are the exception and keep the tile-geometry path: they have
  // no focus data at all, in the tiles or in the API. `focusFromGeoJson` is what
  // stands in for it — the same antimeridian rule the trigger applies, so the
  // Far Eastern Federal District is framed the same way in either world view
  // (#666).
  if (isCustomWorldView || !clickedFeature.geometry) return;

  lastMapClickIdRef.current = id;
  try {
    const featureGeojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [clickedFeature as GeoJSON.Feature],
    };
    const focus = focusFromGeoJson(featureGeojson);
    if (!focus) return;
    smartFitBounds(map, focus.bbox, {
      padding: 60,
      duration: 400,
      anchorPoint: focus.anchorPoint,
    });
  } catch (e) {
    console.error('Failed to fit bounds from clicked feature:', e);
  }
}

function resolveClickedRegionParent(
  fromContextLayer: boolean,
  featureProps: Record<string, unknown> | null | undefined,
  viewingRegionId: 'all-leaf' | number,
  meta: ClickMeta | undefined,
): number | null {
  if (fromContextLayer) {
    return (featureProps?.parent_region_id as number | null | undefined) ?? null;
  }
  if (viewingRegionId === 'all-leaf') {
    return (featureProps?.parent_region_id as number | null | undefined)
      ?? meta?.parentRegionId
      ?? null;
  }
  return viewingRegionId;
}

function resolveClickedDivisionParent(
  selectedDivision: { id: number; hasChildren?: boolean; parentId?: number | null } | null,
): number | null {
  if (!selectedDivision) return null;
  if (selectedDivision.hasChildren) return selectedDivision.id;
  return selectedDivision.parentId ?? null;
}

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
  viewingRegionId: 'all-leaf' | number;
  contextLayerCount: number;
}

export function useMapInteractions({
  mapRef,
  mapLoaded,
  metadataById,
  viewingRegionId,
  contextLayerCount,
}: UseMapInteractionsOptions) {
  const {
    selectedDivision,
    selectedWorldView,
    setSelectedDivision,
    isCustomWorldView,
    selectedRegion,
    setSelectedRegion,
    regionBreadcrumbs,
  } = useNavigation();
  // The setter only. What is hovered is rendered by `HoveredRegionTooltip` and
  // painted by `useMapFeatureState`'s subscription — reading it here would put
  // this hook's owner, the map, back on the every-mouse-move render path.
  const { setHoveredRegionId } = useRegionHoverActions();

  const { isExploring } = useExperienceContext();

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
    }

    // No box yet: the selection was built from a tile feature, and no tile
    // function carries one. The ancestors read that every selection makes fills
    // it in and this effect runs again — see `useNavigation`. There is nothing
    // useful to do in the meantime; what stood here was a `querySourceFeatures`
    // filtered on `['get', 'id']`, which never matched anything: `ST_AsMVT` uses
    // the id column as the feature id and leaves it out of the properties, so a
    // region tile offers `region_id`, `name`, `color`, `parent_region_id` and no
    // `id` at all (read off a live tile, 2026-08-25).
  }, [selectedRegion, isCustomWorldView, mapLoaded, mapRef]);

  // Fly to selected division when selection changes (for GADM list clicks)
  useEffect(() => {
    if (!selectedDivision || !mapRef.current || !mapLoaded || isCustomWorldView) return;

    if (lastMapClickIdRef.current === selectedDivision.id) {
      lastMapClickIdRef.current = null;
      return;
    }

    console.log('[RegionMapVT] Flying to division from list selection:', selectedDivision.id, selectedDivision.name);

    // A division has no focus box anywhere — not in the tiles, not in the API —
    // so its geometry is what it is framed from. Asked of the API rather than of
    // the loaded tiles: the tile query that stood here filtered on `['get',
    // 'id']` and matched nothing, for the reason given in the effect above.
    fetchDivisionGeometry(selectedDivision.id, selectedWorldView?.id ?? 1)
      .then(geom => {
        if (geom?.geometry && mapRef.current) {
          try {
            const geojson: GeoJSON.FeatureCollection = {
              type: 'FeatureCollection',
              features: [geom as GeoJSON.Feature],
            };
            const focus = focusFromGeoJson(geojson);
            if (!focus) return;
            smartFitBounds(mapRef.current, focus.bbox, {
              padding: 100,
              duration: 500,
              anchorPoint: focus.anchorPoint,
            });
          } catch (e) {
            console.error('[RegionMapVT] Failed to fit bounds from API geometry:', e);
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on division ID change
  }, [selectedDivision?.id, isCustomWorldView, mapLoaded, selectedWorldView?.id]);

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
    if (!features || features.length === 0) return;

    // Prefer main tile features (region-fill, region-hull) over context layer
    // features when both exist at the click point. Context layers cover entire
    // ancestor areas, so without this preference a click on a child region
    // would match the ancestor polygon from the context layer instead.
    const clickedFeature = features.find(f => !f.layer?.id?.startsWith('context-')) ?? features[0];
    const id = isCustomWorldView
      ? clickedFeature.properties?.region_id as number | undefined
      : clickedFeature.properties?.division_id as number | undefined;
    if (!id) return;

    const meta = metadataById[id];
    const fromContextLayer = !!clickedFeature.layer?.id?.startsWith('context-');

    console.log('[RegionMapVT] Click:', {
      id,
      meta,
      featureProperties: clickedFeature.properties,
      viewingRegionId,
      fromContextLayer,
    });

    flyToClickedFeature(
      mapRef.current,
      id,
      meta,
      isCustomWorldView,
      clickedFeature,
      lastMapClickIdRef,
    );

    if (isCustomWorldView && selectedWorldView) {
      const parentRegionId = resolveClickedRegionParent(
        fromContextLayer,
        clickedFeature.properties as Record<string, unknown> | null | undefined,
        viewingRegionId,
        meta,
      );
      const newRegion: Region = {
        id,
        worldViewId: selectedWorldView.id,
        name: meta?.name ?? clickedFeature.properties?.name ?? '',
        description: null,
        parentRegionId,
        color: meta?.color ?? clickedFeature.properties?.color ?? null,
        hasSubregions: meta?.hasSubregions ?? clickedFeature.properties?.has_subregions ?? false,
        focusBbox: meta?.focusBbox,
        anchorPoint: meta?.anchorPoint,
      };
      console.log('[RegionMapVT] Setting selectedRegion:', newRegion);
      setSelectedRegion(newRegion);
    } else {
      setSelectedDivision({
        id,
        name: meta?.name ?? clickedFeature.properties?.name ?? '',
        parentId: resolveClickedDivisionParent(selectedDivision),
        hasChildren: meta?.hasChildren ?? clickedFeature.properties?.has_children ?? false,
      });
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
    interactiveLayerIds,
    selectedRegion,
    selectedDivision,
    isCustomWorldView,
    isExploring,
  };
}
