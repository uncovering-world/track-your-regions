/**
 * WorldExperiencePoints — a kind's places across the whole world, before any
 * region is chosen (#910).
 *
 * The map used to be empty at world zoom: markers and the heatmap are built
 * from a region's own read (`ExperienceMarkers`), so nothing was drawn until a
 * region was selected, and the places that sit in no region (#470) were on no
 * map at all. This draws the catalogue itself — every reader-visible point,
 * thousands of them, of which a serial World Heritage site contributes hundreds — as the
 * same density heatmap below zoom 5 and the same kind-coloured markers above
 * it, from `GET /api/experiences/points` rather than from a page of
 * `GET /api/experiences`, which caps at 1 000 rows and answers objects.
 *
 * **Through the API, and that is the decision of this file** (ADR-0061). The
 * first build read a Martin tile source, which was faster to draw and could
 * not go stale honestly: Martin caches a tile under its URL and sends no cache
 * headers, so a place a curator had just marked lost kept being drawn until the
 * server was restarted — measured. Here the read goes through React Query,
 * which the curation writes already invalidate, and a curator's verdict was
 * measured showing up in the very next request.
 *
 * Two sources, mirroring `ExperienceMarkers`:
 *   world-points — the catalogue's points: the heat, the pins, the fold's badge,
 *                  and the pins a capped read draws in the heat's place
 *   world-hover  — the ring under the pointer, written straight to the source
 *                  so that a hover re-renders nothing (this component *is* the
 *                  map's sources and layers)
 *
 * Mounted inside `<Map>`, so what it renders is sources and layers; the two
 * controls that belong to it — the kind chips and the fold chip — are rendered
 * by `RegionMapVT` beside the map's other chrome.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type * as maplibregl from 'maplibre-gl';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SOURCE_WORLD_POINTS, SOURCE_WORLD_HOVER,
  worldLayersFor,
  worldHoverGlowLayer, worldHoverRingLayer,
} from './experienceMarkers/worldPointLayers';
import { EMPTY_FC } from './experienceMarkers/layers';
import {
  pointsKey, queryForView, sameQuestion, type ViewportBounds,
} from './experienceMarkers/worldPointsView';
import {
  useWorldPointInteractions, type WorldPoint,
} from './experienceMarkers/useWorldPointInteractions';
import { fetchWorldPoints, worldPointsCollection, type WorldPointsQuery } from '../api/worldPoints';
import { useHoverActions } from '../hooks/useHoverContext';
import { useAppAddress } from '../hooks/useAppAddress';
import { useNavigation } from '../hooks/useNavigation';
import { experienceDetailsQuery } from '../api/experienceCardQueries';
import { openableRegion } from '../utils/openableRegion';

/**
 * How long an answer is served without asking again.
 *
 * Five minutes, the staleTime the region's own reads carry, and for the same
 * reason: a curator's write invalidates this key outright, so the window is
 * about a reader who left the tab open rather than about how fresh the
 * catalogue is. Freshness is the invalidation's job — which is the whole reason
 * this layer is not a tile source.
 */
const POINTS_STALE_TIME = 300000;

interface WorldExperiencePointsProps {
  /** The kind on the map, or null for every kind at once. */
  kindId: number | null;
  /** One pin per object instead of one per place. */
  folded: boolean;
  /** The kind's own name for the hover card; a point carries only its id. */
  kindNameOf: (kindId: number | null) => string | null;
}

export function WorldExperiencePoints({ kindId, folded, kindNameOf }: WorldExperiencePointsProps) {
  const { current: mapRef } = useMap();
  const { setHoverPreview } = useHoverActions();
  const { go } = useAppAddress();
  const { selectedWorldView, isCustomWorldView } = useNavigation();
  const queryClient = useQueryClient();

  /**
   * Where the map is looking, sampled when it stops.
   *
   * On `moveend` rather than on every frame, and held as the *snapped* question
   * rather than as the raw viewport: a pan that asks the same question sets the
   * same state, React bails out of the render, and neither this component's
   * layers nor the query are touched. That is what makes panning at overview
   * zoom free — the question there is the whole world at every position.
   */
  const [view, setView] = useState<WorldPointsQuery>(
    () => queryForView(kindId, folded, 0, { west: -180, south: -85, east: 180, north: 85 }),
  );

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return undefined;
    const sample = () => {
      const bounds = map.getBounds();
      const viewport: ViewportBounds = {
        west: bounds.getWest(), south: bounds.getSouth(),
        east: bounds.getEast(), north: bounds.getNorth(),
      };
      const next = queryForView(kindId, folded, map.getZoom(), viewport);
      setView(current => (sameQuestion(current, next) ? current : next));
    };
    sample();
    map.on('moveend', sample);
    return () => { map.off('moveend', sample); };
  }, [mapRef, kindId, folded]);

  const { data: answer } = useQuery({
    queryKey: pointsKey(view),
    queryFn: () => fetchWorldPoints(view),
    staleTime: POINTS_STALE_TIME,
    // The answer already on screen stays drawn while the next one is in
    // flight, which is what lets the box be snapped tight instead of padded:
    // a pan that outran the box shows slightly less world for a moment rather
    // than an empty map.
    placeholderData: keepPreviousData,
  });

  /**
   * The FeatureCollection MapLibre wants, built once per answer.
   *
   * Memoised on the answer itself rather than on the query key, because the
   * build is the expensive half of this layer — every place in the catalogue
   * as a feature at the overview — and a rebuild on any other render would re-parse the whole collection
   * for a picture that has not changed.
   *
   * **Whatever answer is in hand is drawn**, through the layers its own shape
   * supports (`worldLayersFor`), rather than discarded when the view has moved
   * on. Crossing the fade band changes the tier and the box at once, and
   * throwing the previous answer away there unmounted the whole layer for a
   * round trip — a hard cutoff where the band exists to cross-fade, and the
   * style churn the mount gate below exists to avoid, paid per crossing rather
   * than once per load.
   *
   * So a **chip switch keeps the previous kind on screen for the round trip**,
   * the way a pan keeps the previous box. Nothing here could do otherwise: an
   * answer echoes the tier and the fold it was built for but never the kind it
   * was asked for, so a stale kind is not detectable from one — and the pins it
   * draws are true places either way, which is the same reason the box is not
   * compared.
   */
  const collection = useMemo(
    () => (answer ? worldPointsCollection(answer) : EMPTY_FC),
    [answer],
  );

  // The ring, written straight to its source rather than held as state — see
  // `ExperienceMarkers`, where the same ref exists for the same reason: this
  // component is the map's sources and layers, so a hover that re-rendered it
  // would have react-map-gl reconcile all of them on every mouse move.
  const hoverDataRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);
  const mapRefLatest = useRef(mapRef);
  mapRefLatest.current = mapRef;
  const setHoverData = useCallback((hover: GeoJSON.FeatureCollection) => {
    hoverDataRef.current = hover;
    const source = mapRefLatest.current?.getMap().getSource(SOURCE_WORLD_HOVER) as
      maplibregl.GeoJSONSource | undefined;
    source?.setData(hover);
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

  /**
   * Nothing goes into the style until there is something to draw.
   *
   * This used to mount both sources and every layer on the first render, over
   * an empty collection, and fill them when the read landed — so for the whole
   * of the page's load the style carried a heatmap, a circle layer and two
   * hover layers with no features in them. That is not free: a layer added to a
   * live style is a synchronous style update and a repaint, react-map-gl adds
   * them one at a time, and a heatmap's blur passes are sized by the viewport
   * rather than by what is in the source.
   *
   * Measured on the fixture lane, which is the cleanest place to see it: that
   * world view holds **three** experiences, and the layer still pushed the
   * shell's total blocking time from the 0-128 ms the budget was calibrated on
   * to 320 ms. Three points cannot cost that; carrying the layers can.
   *
   * The hover source is gated with them and stays correct: nothing can be under
   * the pointer before a pin is drawn, and a pin needs this to be true.
   *
   * An empty *answer* — a kind with no places, a box with nothing in it —
   * unmounts them again, which is the same statement rather than an exception.
   */
  if (collection.features.length === 0) return null;

  return (
    <>
      <Source id={SOURCE_WORLD_POINTS} type="geojson" data={collection}>
        {worldLayersFor(answer).map(layer => <Layer key={layer.id} {...layer} />)}
      </Source>

      <Source id={SOURCE_WORLD_HOVER} type="geojson" data={hoverDataRef.current}>
        <Layer {...worldHoverGlowLayer} />
        <Layer {...worldHoverRingLayer} />
      </Source>
    </>
  );
}
