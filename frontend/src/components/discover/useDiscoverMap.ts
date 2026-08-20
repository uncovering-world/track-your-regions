/**
 * Builds Discover's map and wires its interactions, once, on mount (#562).
 *
 * Split out of `DiscoverExperienceView` under the 800-line rule in
 * `docs/tech/development-guide.md`, and split *here* rather than anywhere else
 * because this block is the one self-contained unit in that file: it owns the
 * MapLibre instance and every listener on it, and touches React only through the
 * refs and callbacks handed to it below.
 *
 * The behaviours it carries are rules, not details, and each was a defect once
 * (#558): a click tests `properties.folded` rather than inferring a folded pin
 * from its shape; the hover dedupes by `${experienceId}:${locationId}` so
 * crossing an object's places moves the ring; a cluster click marks the move as
 * the reader's *before* `easeTo`, or the places-refit throws them back out; and a
 * click that came from the map records itself, so the delayed fly-to leaves the
 * reader where they clicked. `onMarkerClick` is registered once on the map, not
 * per layer — see `docs/tech/maplibre-patterns.md` § One listener per
 * registration.
 */

import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { isWebGLAvailable } from '../../utils/webgl';
import { addDiscoverMapLayers, SOURCE_ID, HOVER_SOURCE_ID } from './discoverMapLayers';

export interface DiscoverMapWiring {
  /** Where the map is mounted; nothing is built until it exists. */
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Filled with the instance, and cleared when it is removed. */
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  /** Folding a pin the reader folded, read live by the click handler. */
  toggleCollapsedRef: React.MutableRefObject<(id: number) => void>;
  /** The object whose selection came from the map, so the fly-to can stand down. */
  selectedFromMapIdRef: React.MutableRefObject<number | null>;
  /** Set when the reader moved the camera themself, including a cluster click. */
  movedByReaderRef: React.MutableRefObject<boolean>;
  /** Hover from the map, reported to the list. */
  mapHoverCallbackRef: React.MutableRefObject<(id: number | null) => void>;
  /** Hover on a highlight dot, reported with the location it belongs to. */
  highlightHoverCallbackRef: React.MutableRefObject<(locationId: number | null) => void>;
  onSelectExperience: (id: number) => void;
}

export function useDiscoverMap({
  mapContainerRef,
  mapRef,
  toggleCollapsedRef,
  selectedFromMapIdRef,
  movedByReaderRef,
  mapHoverCallbackRef,
  highlightHoverCallbackRef,
  onSelectExperience,
}: DiscoverMapWiring): void {
  useEffect(() => {
    if (!mapContainerRef.current) return;
    // `new maplibregl.Map` throws without a WebGL context, and this effect is
    // the one place in Discover where that throw is not caught by anything —
    // it unwinds through React and takes the whole page with it, list and all.
    // Every later effect here already guards on a null `mapRef`, so declining
    // to build the map leaves the rest of the view working.
    if (!isWebGLAvailable()) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
          },
        },
        layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
      },
      center: [15, 30],
      zoom: 2,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Hover preview handled by React overlay (hoverPreview state)

    // Track which feature is hovered on the map (local to this closure)
    // Keyed by place rather than object — see the hover handler below.
    let mapCurrentHoveredKey: string | null = null;

    map.on('load', () => {
      // ── Sources ──
      addDiscoverMapLayers(map);

      // ── Cluster click → zoom ──
      map.on('click', 'clusters', async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        // The reader asked for this view, even though the camera move is ours:
        // `easeTo` fires a `movestart` with no `originalEvent`, so the listener
        // below cannot tell it from a fit. Without this, zooming into a cluster
        // while the location batch is still in flight is answered by the
        // places-refit throwing the map back out to the whole region.
        movedByReaderRef.current = true;
        map.easeTo({
          center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });

      // ── Marker click → select experience ──
      const interactiveMarkerLayers = ['unclustered-point', 'unclustered-count-badge-bg', 'unclustered-count-badge-text'];
      const onMarkerClick = (e: maplibregl.MapLayerMouseEvent) => {
        // The gate the delegated listeners had: naming a layer the style does not
        // hold makes `queryRenderedFeatures` fire an ErrorEvent and log.
        if (!map.getLayer('unclustered-point')) return;
        const features = map.queryRenderedFeatures(e.point, { layers: interactiveMarkerLayers });
        if (features.length === 0) return;
        const id = features[0].properties?.id;
        if (id == null) return;

        // A folded pin unfolds, exactly as in Map mode — the badge is what says
        // there is something folded there, and this is the only action that pin
        // can offer. The builder says which pins those are: this surface counts a
        // different set for the control (see `drawnPlacesOfSelected`), so an
        // object can be in the folded set while its pin is a stand-in, and
        // inferring "folded" from the pin's shape would swallow that click.
        if (features[0].properties?.folded === true) {
          toggleCollapsedRef.current(id);
          return;
        }

        selectedFromMapIdRef.current = id;
        onSelectExperience(id);
      };
      // Once, not once per layer: maplibre creates a delegated listener per
      // registration, so a click on the badge — whose circle and glyph occupy the
      // same 8 px — ran this twice and undid itself, which on a folded pin meant
      // its badge click did nothing. The handler queries the three layers itself.
      // See `docs/tech/maplibre-patterns.md` § One listener per registration.
      map.on('click', onMarkerClick);

      // Two trackers, one ring: each hover dedupes on its own, so a handler that
      // ends one of them must hand the ring to the other rather than keep it.
      let mapCurrentHighlightLocId: number | null = null;

      /**
       * The one writer of the hover ring's source *here*; `null` takes it off.
       *
       * `useDiscoverHover` writes the same source on three other paths, and one
       * of them rings every point an object is drawn at — a shape this cannot
       * express, deliberately, because nothing on this side rings more than one.
       */
      const setHoverRing = (coords: [number, number] | null) => {
        const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource;
        if (!hoverSource) return;
        hoverSource.setData(coords
          ? {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: coords },
              properties: {},
            }],
          }
          : { type: 'FeatureCollection', features: [] });
      };

      /** Where a queried feature is. */
      const pointOf = (feature: maplibregl.MapGeoJSONFeature): [number, number] =>
        (feature.geometry as GeoJSON.Point).coordinates as [number, number];

      /** The one key space `mapCurrentHoveredKey` is written and read in. */
      const keyOf = (feature: maplibregl.MapGeoJSONFeature): string =>
        `${feature.properties?.id}:${feature.properties?.locationId ?? ''}`;

      // ── Marker hover (mousemove for precise tracking with nearby points) ──
      const onMarkerMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const features = map.queryRenderedFeatures(e.point, { layers: interactiveMarkerLayers });
        if (features.length > 0) {
          const feature = features[0];
          const id = feature.properties?.id as number;
          const coords = pointOf(feature);

          // Keyed by the place: an object is many pins now, and keying on the
          // object left the ring and the list scroll on the first part the
          // pointer touched while it crossed the rest. Through `keyOf`, which is
          // what the leave compares against — a key space stated twice is a key
          // space that can drift, silently, into a leave that never returns.
          const hoverKey = keyOf(feature);
          if (hoverKey !== mapCurrentHoveredKey) {
            mapCurrentHoveredKey = hoverKey;

            // Update hover ring on map
            setHoverRing(coords);

            // Notify React (triggers list auto-scroll + card highlight + hover card)
            mapHoverCallbackRef.current?.(id);
          }
        }
      };
      map.on('mousemove', 'unclustered-point', onMarkerMouseMove);
      map.on('mousemove', 'unclustered-count-badge-bg', onMarkerMouseMove);
      map.on('mousemove', 'unclustered-count-badge-text', onMarkerMouseMove);

      // A move the reader made themself carries an `originalEvent`; the ones this
      // component makes (`fitBounds`, `flyTo`) do not.
      map.on('movestart', (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
        if (e.originalEvent) movedByReaderRef.current = true;
      });

      /** The pin under a point, if one is there. */
      const markerAt = (point: maplibregl.Point): maplibregl.MapGeoJSONFeature | null => {
        if (!map.getLayer('unclustered-point')) return null;
        const under = map.queryRenderedFeatures(point, { layers: interactiveMarkerLayers });
        return under[0] ?? null;
      };

      /**
       * Whether a cluster is under a point. Clusters set the pointer cursor from
       * a one-shot `mouseenter`, so a leave on any layer over one must not reset
       * what nothing will set again until the pointer leaves the cluster too.
       */
      const onACluster = (point: maplibregl.Point): boolean =>
        !!map.getLayer('clusters')
        && map.queryRenderedFeatures(point, { layers: ['clusters'] }).length > 0;

      /** The place of the selected object under a point, if one is there. */
      const highlightDotAt = (point: maplibregl.Point): maplibregl.MapGeoJSONFeature | null => {
        if (!map.getLayer('highlight-point')) return null;
        return map.queryRenderedFeatures(point, { layers: ['highlight-point'] })[0] ?? null;
      };

      // The badge is drawn `circle-translate: [8, -8]` over a point of radius 6,
      // so a pin and its badge overlap only in part: moving from one onto the
      // other makes MapLibre report a leave for the layer walked off, and
      // clearing there takes the ring, the list highlight and the hover card off
      // a pin the pointer is still on — the badge being exactly what a reader
      // aims at to see what a fold is hiding. Only a leave delivered by a move
      // may be trusted with its point: the other path is `mouseout`, which
      // carries the point the pointer left *from*. Map Mode's
      // `useMarkerInteractions` and `docs/tech/maplibre-patterns.md` § The rule
      // carry the same check and the reasoning behind it.
      const onMarkerMouseLeave = (e: maplibregl.MapLayerMouseEvent) => {
        const fromAMove = e.originalEvent?.type === 'mousemove';
        const pin = fromAMove ? markerAt(e.point) : null;
        if (pin && keyOf(pin) === mapCurrentHoveredKey) return;
        mapCurrentHoveredKey = null;

        // The object's hover has ended, but the ring may not be this handler's
        // to take: the dots of the selected object share the source and overlap
        // these pins in pixels. Handed over rather than kept — the dot's own
        // `mousemove` dedupes on a dot that has not changed, so leaving the ring
        // as it is would leave it on the pin the pointer has just left.
        const dot = fromAMove ? highlightDotAt(e.point) : null;
        if (dot) {
          // The ring, and not the dot's key: `mapCurrentHighlightLocId` is what
          // the dot's own `mousemove` dedupes on, and that delegate is
          // registered after this leave, so it runs later in the same move.
          // Writing the key here would leave the hand-over half done — ring on
          // the dot, and the panel never told which place it is, because the
          // move that would have said so found nothing to do.
          setHoverRing(pointOf(dot));
        } else {
          if (!fromAMove || !onACluster(e.point)) map.getCanvas().style.cursor = '';
          setHoverRing(null);
        }

        mapHoverCallbackRef.current?.(null);
      };
      map.on('mouseleave', 'unclustered-point', onMarkerMouseLeave);
      map.on('mouseleave', 'unclustered-count-badge-bg', onMarkerMouseLeave);
      map.on('mouseleave', 'unclustered-count-badge-text', onMarkerMouseLeave);

      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      // The cursor is shared with the pins and the dots a bubble covers — a dot
      // is drawn above it and stays hoverable — and neither gets it back from
      // this move: the dots' `mousemove` sets it inside a dedupe, so on a dot
      // the arrow stays until the pointer enters something else, and the pins'
      // sets it unconditionally but is registered ahead of this leave, so the
      // reset lands after it and holds for a frame. Ask, like the two leaves
      // above do about clusters.
      map.on('mouseleave', 'clusters', (e: maplibregl.MapLayerMouseEvent) => {
        const fromAMove = e.originalEvent?.type === 'mousemove';
        if (fromAMove && (markerAt(e.point) || highlightDotAt(e.point))) return;
        map.getCanvas().style.cursor = '';
      });

      // ── Highlight-point hover → location list scroll ──

      map.on('mousemove', 'highlight-point', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['highlight-point'] });
        if (features.length > 0) {
          const locId = features[0].properties?.locationId as number | undefined;
          if (locId != null && locId !== mapCurrentHighlightLocId) {
            mapCurrentHighlightLocId = locId;
            map.getCanvas().style.cursor = 'pointer';

            // Show hover ring at this location
            setHoverRing(pointOf(features[0]));

            highlightHoverCallbackRef.current?.(locId);
          }
        }
      });

      map.on('mouseleave', 'highlight-point', (e) => {
        mapCurrentHighlightLocId = null;

        // The mirror of the case above. These dots overlap the pins of every
        // other object in pixels and never in meaning, and the marker handlers
        // are registered ahead of this one — so crossing from a dot onto a pin
        // drew the ring on the pin and erased it here a step later, with the
        // marker handler deduping on an unchanged key and never redrawing it.
        // The ring goes to the pin the pointer is on, not away.
        const fromAMove = e.originalEvent?.type === 'mousemove';
        const pin = fromAMove ? markerAt(e.point) : null;
        if (pin) {
          // The ring, and not the pin's key, for the reason the mirror above
          // gives: `mapCurrentHoveredKey` belongs to the marker `mousemove`,
          // which is registered ahead of this leave and has already set it in
          // this same move. Writing it here is dead today and the same trap
          // tomorrow, the moment those registrations change order.
          setHoverRing(pointOf(pin));
        } else {
          if (!fromAMove || !onACluster(e.point)) map.getCanvas().style.cursor = '';
          setHoverRing(null);
        }

        highlightHoverCallbackRef.current?.(null);
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- map init is mount-only; recreating on dep change would destroy/recreate the MapLibre instance every render
  }, []);
}
