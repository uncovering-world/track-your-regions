/**
 * WorldExperiencePoints — a kind's places across the whole world, before any
 * region is chosen (#910).
 *
 * The map used to be empty at world zoom: markers and the heatmap are built
 * from a region's own read (`ExperienceMarkers`), so nothing was drawn until a
 * region was selected, and the places that sit in no region (#470) were on no
 * map at all. This draws the catalogue itself — 8 830 reader-visible points
 * today, of which a serial World Heritage site contributes hundreds — as the
 * same density heatmap below zoom 5 and the same kind-coloured markers above
 * it, from a Martin tile source rather than from a page of
 * `GET /api/experiences`, which caps at 1 000 rows and answers objects.
 *
 * Two sources, mirroring `ExperienceMarkers`:
 *   world-points — the tiles: heat, pins, and the fold's count badge
 *   world-hover  — the ring under the pointer, written straight to the source
 *                  so that a hover re-renders nothing (this component *is* the
 *                  map's sources and layers)
 *
 * Mounted inside `<Map>`, so what it renders is sources and layers; the two
 * controls that belong to it — the kind chips and the fold chip — are rendered
 * by `RegionMapVT` beside the map's other chrome.
 */

import { useCallback, useRef } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type * as maplibregl from 'maplibre-gl';
import { useQueryClient } from '@tanstack/react-query';
import {
  SOURCE_WORLD_POINTS, SOURCE_WORLD_HOVER,
  worldHeatmapLayer, worldMarkerLayer, worldBadgeLayers,
  worldHoverGlowLayer, worldHoverRingLayer,
} from './experienceMarkers/worldPointLayers';
import { EMPTY_FC } from './experienceMarkers/layers';
import {
  useWorldPointInteractions, type WorldPoint,
} from './experienceMarkers/useWorldPointInteractions';
import { useHoverActions } from '../hooks/useHoverContext';
import { useAppAddress } from '../hooks/useAppAddress';
import { useNavigation } from '../hooks/useNavigation';
import { experienceDetailsQuery } from '../api/experienceCardQueries';
import { openableRegion } from '../utils/openableRegion';

/**
 * Where the source stops asking for tiles of its own.
 *
 * A point quantised into a z12 tile is placed to about two metres, which is
 * under a pin's own radius, so past this MapLibre overzooms the z12 tile rather
 * than fetching a new one per level — fewer requests for a picture nobody can
 * tell apart.
 */
const POINTS_MAX_ZOOM = 12;

interface WorldExperiencePointsProps {
  /** The tile URL for the kind on the map, from `useTileUrls`. */
  tileUrl: string;
  /** One pin per object instead of one per place. */
  folded: boolean;
  /** The kind's own name for the hover card; the tile carries only its id. */
  kindNameOf: (kindId: number | null) => string | null;
}

export function WorldExperiencePoints({ tileUrl, folded, kindNameOf }: WorldExperiencePointsProps) {
  const { current: mapRef } = useMap();
  const { setHoverPreview } = useHoverActions();
  const { go } = useAppAddress();
  const { selectedWorldView, isCustomWorldView } = useNavigation();
  const queryClient = useQueryClient();

  // The ring, written straight to its source rather than held as state — see
  // `ExperienceMarkers`, where the same ref exists for the same reason: this
  // component is the map's sources and layers, so a hover that re-rendered it
  // would have react-map-gl reconcile all of them on every mouse move.
  const hoverDataRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);
  const mapRefLatest = useRef(mapRef);
  mapRefLatest.current = mapRef;
  const setHoverData = useCallback((data: GeoJSON.FeatureCollection) => {
    hoverDataRef.current = data;
    const source = mapRefLatest.current?.getMap().getSource(SOURCE_WORLD_HOVER) as
      maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
  }, []);

  /**
   * A click is a way in: it opens the object where this world view holds it.
   *
   * The regions come from the object's own read, which answers with the ones
   * whose lists will hold it, smallest first (`readerRegionsJsonSql`), and
   * `openableRegion` picks the one in the world view already open — ADR-0042's
   * rule, the same one the search and every card-to-card link follow, so the
   * address that gets written is one whose list actually holds the card.
   *
   * Where it holds it nowhere — an object in no region at all — the click flies
   * to the point instead of doing nothing. The kind does not travel into the
   * address: a region has its own markers and its own list, and `?kind=` names
   * nothing there (`docs/tech/addresses.md`).
   */
  const openPoint = useCallback(async (point: WorldPoint) => {
    const map = mapRefLatest.current?.getMap();
    const flyThere = () => map?.flyTo({
      center: point.coordinates,
      zoom: Math.max(map.getZoom(), 8),
      duration: 800,
    });
    try {
      const detail = await queryClient.fetchQuery(experienceDetailsQuery(point.experienceId));
      const worldViewId = isCustomWorldView ? selectedWorldView?.id ?? null : null;
      const region = openableRegion(detail.regions, worldViewId);
      if (!region) {
        flyThere();
        return;
      }
      go(current => ({
        ...current,
        worldViewId: region.world_view_id,
        regionId: region.id,
        experienceId: detail.id,
        kindId: null,
      }), { names: { region: region.name, experience: detail.name } });
    } catch {
      // A read that failed is not a reason to leave the click unanswered; the
      // map can still take the reader to where the pin is.
      flyThere();
    }
  }, [queryClient, go, isCustomWorldView, selectedWorldView?.id]);

  useWorldPointInteractions({
    mapRef, kindNameOf, setHoverPreview, setHoverData, openPoint,
  });

  return (
    <>
      <Source
        id={SOURCE_WORLD_POINTS}
        type="vector"
        // Keyed on the URL, so choosing another kind replaces the source rather
        // than leaving MapLibre with the tiles of the kind before it.
        key={tileUrl}
        tiles={[tileUrl]}
        minzoom={0}
        maxzoom={POINTS_MAX_ZOOM}
      >
        <Layer {...worldHeatmapLayer(folded)} />
        <Layer {...worldMarkerLayer(folded)} />
        {worldBadgeLayers(folded).map(layer => <Layer key={layer.id} {...layer} />)}
      </Source>

      <Source id={SOURCE_WORLD_HOVER} type="geojson" data={hoverDataRef.current}>
        <Layer {...worldHoverGlowLayer} />
        <Layer {...worldHoverRingLayer} />
      </Source>
    </>
  );
}
