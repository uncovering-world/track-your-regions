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

      // ── Marker hover (mousemove for precise tracking with nearby points) ──
      const onMarkerMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const features = map.queryRenderedFeatures(e.point, { layers: interactiveMarkerLayers });
        if (features.length > 0) {
          const feature = features[0];
          const id = feature.properties?.id as number;
          const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

          // Keyed by the place: an object is many pins now, and keying on the
          // object left the ring and the list scroll on the first part the
          // pointer touched while it crossed the rest.
          const hoverKey = `${id}:${feature.properties?.locationId ?? ''}`;
          if (hoverKey !== mapCurrentHoveredKey) {
            mapCurrentHoveredKey = hoverKey;

            // Update hover ring on map
            const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource;
            if (hoverSource) {
              hoverSource.setData({
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: coords },
                  properties: {},
                }],
              });
            }

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

      const onMarkerMouseLeave = () => {
        map.getCanvas().style.cursor = '';
        mapCurrentHoveredKey = null;

        // Clear hover ring
        const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource;
        if (hoverSource) {
          hoverSource.setData({ type: 'FeatureCollection', features: [] });
        }

        mapHoverCallbackRef.current?.(null);
      };
      map.on('mouseleave', 'unclustered-point', onMarkerMouseLeave);
      map.on('mouseleave', 'unclustered-count-badge-bg', onMarkerMouseLeave);
      map.on('mouseleave', 'unclustered-count-badge-text', onMarkerMouseLeave);

      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

      // ── Highlight-point hover → location list scroll ──
      let mapCurrentHighlightLocId: number | null = null;

      map.on('mousemove', 'highlight-point', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['highlight-point'] });
        if (features.length > 0) {
          const locId = features[0].properties?.locationId as number | undefined;
          if (locId != null && locId !== mapCurrentHighlightLocId) {
            mapCurrentHighlightLocId = locId;
            map.getCanvas().style.cursor = 'pointer';

            // Show hover ring at this location
            const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
            const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource;
            if (hoverSource) {
              hoverSource.setData({
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: coords },
                  properties: {},
                }],
              });
            }

            highlightHoverCallbackRef.current?.(locId);
          }
        }
      });

      map.on('mouseleave', 'highlight-point', () => {
        mapCurrentHighlightLocId = null;
        map.getCanvas().style.cursor = '';

        // Clear hover ring (unless internal hover is active)
        const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource;
        if (hoverSource) {
          hoverSource.setData({ type: 'FeatureCollection', features: [] });
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
