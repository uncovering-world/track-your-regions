/**
 * Discover's hover, which is one mechanism across two surfaces (#562).
 *
 * Split out of `DiscoverExperienceView` under the 800-line rule in
 * `docs/tech/development-guide.md`. It is not a slice of that component's state
 * so much as the join between its two halves: a row hovered rings every point
 * the object is drawn at, and a marker hovered scrolls the row into view and
 * shows its picture. Both directions share one source of truth — which surface
 * the hover came from — so they cannot live apart without that flag becoming
 * two.
 *
 * The rules it carries were each a defect once: a ring covers *every* pin of an
 * object rather than the first (a serial site is its parts); the places inside
 * cluster bubbles are found by asking the source, because a bubble is painted at
 * its members' centroid and there is nothing at the member's own position to
 * ring; and every asynchronous answer is checked against a generation counter,
 * because `getClusterLeaves` resolves after the pointer has moved on.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import type { Experience } from '../../api/experiences';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { clusterRadiusFor, SOURCE_ID, HOVER_SOURCE_ID } from './discoverMapLayers';
import { pointInView } from '../../utils/viewBounds';

/**
 * Rings for the places of an object that the map is currently drawing as pins.
 *
 * One query for the whole layer, not one per place: an object has hundreds of
 * places now — the Rock Art has 734 — and this runs in a `mouseenter` with no
 * hover-intent delay, so probing per place meant up to 1468 `queryRenderedFeatures`
 * calls for one row, each of which walks every loaded tile's feature index.
 *
 * Only pins. A place inside a cluster is not ringed here, because a bubble is
 * painted at its members' centroid and a member can sit 50 px away
 * (`clusterRadius` in `discoverMapLayers.ts`) — there is nothing at the place's
 * own position to ring. The caller rings the bubbles instead, by asking the
 * source which clusters hold this object.
 */
function pinRingsFor(map: maplibregl.Map, expId: number): GeoJSON.Feature<GeoJSON.Point>[] {
  // Deduplicated by coordinate: a point inside two tiles' buffers is returned
  // once per tile, and this source carries no feature id to tell the copies apart
  // (`promoteId` is deliberately absent, see `discoverMapLayers.ts`). Counting the
  // copies would make an object look fully drawn and skip the cluster pass below.
  const byPosition = new Map<string, GeoJSON.Feature<GeoJSON.Point>>();
  for (const f of map.queryRenderedFeatures({ layers: ['unclustered-point'] })) {
    if (f.properties?.id !== expId) continue;
    const point = f.geometry as GeoJSON.Point;
    const key = point.coordinates.map(c => c.toFixed(6)).join(',');
    if (!byPosition.has(key)) {
      byPosition.set(key, { type: 'Feature', geometry: point, properties: {} });
    }
  }
  return [...byPosition.values()];
}

/** A ring sized to sit just outside a cluster bubble of `pointCount` points. */
function clusterRing(cluster: maplibregl.MapGeoJSONFeature): GeoJSON.Feature<GeoJSON.Point> {
  const radius = clusterRadiusFor((cluster.properties?.point_count as number) ?? 0);
  return {
    type: 'Feature',
    geometry: cluster.geometry as GeoJSON.Point,
    properties: { hoverRadius: radius + 10, ringRadius: radius + 4 },
  };
}

/** What the hover needs from the view that owns the map and the list. */
export interface DiscoverHoverWiring {
  /** The map, once it exists; every path here declines to act without it. */
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  /** This region's batch, for the picture and name a marker hover shows. */
  experiences: Experience[];
  /** Where an object is drawn — its places, or the one point a fold leaves. */
  drawnCoordsRef: React.MutableRefObject<(expId: number) => [number, number][]>;
  /** The current selection, which the marker source deliberately does not hold. */
  selectedExpIdRef: React.MutableRefObject<number | null>;
  /** A hover from the detail panel's location list, which rings one place. */
  externalHoverCoords?: { lng: number; lat: number } | null;
  /** Reported back when a highlight dot is hovered, so the panel can follow. */
  onHoverHighlightLocation?: (locationId: number | null) => void;
}

/** What the view renders with, and what it hands the map's own listeners. */
export interface DiscoverHover {
  hoveredExperienceId: number | null;
  hoverPreview: { name: string; imageUrl: string | null; categoryName: string } | null;
  cardRefsMap: React.MutableRefObject<Map<number, HTMLDivElement>>;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  mapHoverCallbackRef: React.MutableRefObject<(id: number | null) => void>;
  highlightHoverCallbackRef: React.MutableRefObject<(locationId: number | null) => void>;
  onCardMouseEnter: (expId: number) => void;
  onCardMouseLeave: () => void;
}

export function useDiscoverHover({
  mapRef,
  experiences,
  drawnCoordsRef,
  selectedExpIdRef,
  externalHoverCoords,
  onHoverHighlightLocation,
}: DiscoverHoverWiring): DiscoverHover {
  // ── Hover sync state ──
  const [hoveredExperienceId, setHoveredExperienceId] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    name: string; imageUrl: string | null; categoryName: string;
  } | null>(null);
  const hoverSourceRef = useRef<'list' | 'map' | null>(null);
  const isAutoScrollingRef = useRef(false);
  const cardRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const listContainerRef = useRef<HTMLDivElement>(null);
  /** Which card-hover fan-out is current, so a late cluster answer stands down. */
  const hoverGenerationRef = useRef(0);
  const experiencesRef = useRef(experiences);
  experiencesRef.current = experiences;

  // Map hover → React state. A ref because the map's listeners are registered
  // once, on mount, by `useDiscoverMap` — they must see this render's callback.
  const mapHoverCallbackRef = useRef<(id: number | null) => void>(() => {});
  mapHoverCallbackRef.current = (id: number | null) => {
    hoverSourceRef.current = id != null ? 'map' : null;
    setHoveredExperienceId(id);
    if (id != null) {
      const exp = experiencesRef.current.find(e => e.id === id);
      if (exp) {
        const rawImg = extractImageUrl(exp.image_url);
        setHoverPreview({
          name: exp.name,
          imageUrl: rawImg ? toThumbnailUrl(rawImg, 250) : null,
          categoryName: exp.category_name || '',
        });
      }
    } else {
      setHoverPreview(null);
    }
  };

  // Hover on a highlight dot → the panel's location list, the same way round.
  const highlightHoverCallbackRef = useRef<(locationId: number | null) => void>(() => {});
  highlightHoverCallbackRef.current = (locationId: number | null) => {
    onHoverHighlightLocation?.(locationId);
  };

  // ── Map hover → auto-scroll list ──
  useEffect(() => {
    if (hoverSourceRef.current !== 'map' || hoveredExperienceId == null) return;
    const card = cardRefsMap.current.get(hoveredExperienceId);
    if (card && listContainerRef.current) {
      isAutoScrollingRef.current = true;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear auto-scroll flag after animation
      const timer = setTimeout(() => { isAutoScrollingRef.current = false; }, 500);
      return () => clearTimeout(timer);
    }
  }, [hoveredExperienceId]);

  // ── External hover (from detail panel location list) → update map hover ring ──
  useEffect(() => {
    // This hook is called before `useDiscoverMap` — it hands that one the two
    // callback refs above — so on the first commit this effect runs before the
    // map is built, where it used to run after. It makes no difference: the map's
    // sources are added on `load`, so this asked for a source that did not exist
    // yet either way, and both paths out of that are this early return.
    const map = mapRef.current;
    if (!map) return;
    const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!hoverSource) return;

    if (externalHoverCoords) {
      hoverSource.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [externalHoverCoords.lng, externalHoverCoords.lat] },
          properties: {},
        }],
      });
    } else if (hoverSourceRef.current !== 'list' && hoverSourceRef.current !== 'map') {
      // Only clear if no internal hover is active
      hoverSource.setData({ type: 'FeatureCollection', features: [] });
    }
    // The refs below are arguments now rather than locals, so the exhaustive-deps
    // rule cannot tell they are stable — they are listed to keep it quiet, and a
    // ref object never changes identity, so nothing re-runs because of them.
  }, [externalHoverCoords, mapRef]);

  // ── List hover → update map hover ring (cluster-aware) ──
  const handleCardMouseEnter = useCallback((expId: number) => {
    if (hoverSourceRef.current === 'map' || isAutoScrollingRef.current) return;
    hoverSourceRef.current = 'list';
    setHoveredExperienceId(expId);

    const map = mapRef.current;
    if (!map) return;
    const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!hoverSource) return;

    const exp = experiencesRef.current.find(e => e.id === expId);
    if (!exp) return;

    // Every point the object is drawn at, because that is what the card stands
    // for now — a serial site is its parts, and ringing one of thirteen left the
    // other twelve unmarked. A folded object, and one whose places this region's
    // batch does not hold, is one point: its own (ADR-0028 decision 2).
    const drawn = drawnCoordsRef.current(expId);
    const coords: [number, number] = drawn[0];

    // A selected object has no feature in the marker source at all — it is
    // excluded there and drawn by the highlight layer — so neither the
    // unclustered test below nor the cluster search can find it, and both would
    // fall back to a single point. Its dots are always drawn, so ring them.
    // Through a ref, because this callback is created once and the map handlers
    // registered with it must see the current selection rather than the first.
    if (expId === selectedExpIdRef.current) {
      hoverSource.setData({
        type: 'FeatureCollection',
        features: drawn.map(c => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: c },
          properties: {},
        })),
      });
      return;
    }

    // Every pin of this object that is drawn, in one query over the layer.
    const pinRings = pinRingsFor(map, expId);
    if (pinRings.length > 0) {
      hoverSource.setData({ type: 'FeatureCollection', features: pinRings });
    }

    // Its remaining places are inside clusters, and a bubble sits at its members'
    // centroid rather than at any of them — so which bubbles hold this object is a
    // question only the source can answer. Every one of them is ringed, not the
    // first: at continental zoom the Rock Art is several clusters across three
    // provinces, and ringing one left the rest of the row unmarked.
    //
    // Compared against the places *in view*, because that is the population the
    // pins were counted from: measured against every place the object has, a row
    // with anything off screen would take this path on every hover — and this one
    // has no hover-intent delay, while `getClusterLeaves` materialises a feature
    // per member of every visible cluster.
    // `pointInView` rather than `LngLatBounds.contains`: that method takes its
    // wrapping branch only on `sw.lng > ne.lng`, a form `getBounds()` never
    // produces — it assigns `Math.min`/`Math.max` on longitude and lets the
    // values leave [-180, 180] instead. Over the dateline it therefore answers
    // false for every real longitude, and this count would say nothing of the
    // object is on screen (#553).
    const b = map.getBounds();
    const inView = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const onScreen = drawn.filter(([lng, lat]) => pointInView(lng, lat, inView));
    if (pinRings.length >= onScreen.length) return;

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const clusterFeatures = map.queryRenderedFeatures({ layers: ['clusters'] });
    if (clusterFeatures.length === 0) {
      if (pinRings.length === 0) {
        // Nothing of this object is on screen at all: ring where it says it is.
        hoverSource.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }],
        });
      }
      return;
    }

    const rings = [...pinRings];
    let remaining = clusterFeatures.length;
    // `getClusterLeaves` answers after the pointer may have moved on, and this
    // path is taken on most hovers now — any object with places off screen has
    // fewer rendered pins than places. Without an ownership check the last promise
    // of a row paints its rings with nothing hovered, or over the row the reader
    // moved to. Map mode could delete its ownership machinery when clustering
    // left; this surface still clusters, so it needs one. (A generation rather
    // than a token because the timing-attack lint rule reads any `token`
    // comparison as a comparison of secrets.)
    const generation = ++hoverGenerationRef.current;
    for (const cluster of clusterFeatures) {
      const clusterId = cluster.properties.cluster_id as number;
      const pointCount = cluster.properties.point_count as number;
      source.getClusterLeaves(clusterId, pointCount, 0)
        .then(leaves => {
          if (generation !== hoverGenerationRef.current) return;
          if (leaves.some(leaf => leaf.properties?.id === expId)) rings.push(clusterRing(cluster));
        })
        // supercluster throws "No cluster with the specified id" once the index
        // is rebuilt, and `source.setData` rebuilds it — which this view now does
        // on five things, including the batch arriving and a fold. Such a bubble
        // simply contributes no ring; the alternative is an unhandled rejection.
        .catch(() => {})
        // Counted here rather than in `then`, or a rejection would leave
        // `remaining` above zero for good and the paint below would never run —
        // for an object with no pins drawn, that is a hover that shows nothing at
        // all, after the previous row's ring has already been cleared.
        .finally(() => {
          if (generation !== hoverGenerationRef.current) return;
          remaining--;
          if (remaining > 0) return;
          if (rings.length > 0) {
            hoverSource.setData({ type: 'FeatureCollection', features: rings });
          } else {
            // In no cluster and drawn nowhere — ring the coordinate it claims.
            hoverSource.setData({
              type: 'FeatureCollection',
              features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }],
            });
          }
        });
    }
  }, [mapRef, drawnCoordsRef, selectedExpIdRef]);

  const handleCardMouseLeave = useCallback(() => {
    if (hoverSourceRef.current !== 'list') return;
    hoverGenerationRef.current++;
    hoverSourceRef.current = null;
    setHoveredExperienceId(null);

    const map = mapRef.current;
    if (!map) return;
    const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (hoverSource) {
      hoverSource.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [mapRef]);

  return {
    hoveredExperienceId,
    hoverPreview,
    cardRefsMap,
    listContainerRef,
    mapHoverCallbackRef,
    highlightHoverCallbackRef,
    onCardMouseEnter: handleCardMouseEnter,
    onCardMouseLeave: handleCardMouseLeave,
  };
}
