/**
 * Everything a pointer on the map does to the markers: the popup, the hover
 * ring, the click that selects or unfolds.
 *
 * Split out of `ExperienceMarkers`, which had grown past the size rule in
 * `docs/tech/development-guide.md`. This is the imperative half — MapLibre
 * listeners registered on the map object rather than rendered — and it is the
 * half that reads least like the rest of that file, which is a tree of
 * `<Source>`/`<Layer>`. Discover's map is the prior art: `useDiscoverMap` and
 * `useDiscoverHover` sit beside their component the same way.
 *
 * The hook re-registers only when the map itself changes. Everything else it
 * needs is read through a ref at call time, because these listeners outlive
 * many renders and a listener re-registered per render is a listener the map
 * spends its frame budget swapping.
 */

import { useEffect, useRef } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import {
  LAYER_MARKERS, LAYER_HIGHLIGHT_POINT, MARKER_LAYERS,
  EMPTY_FC, buildPointHoverData,
} from './layers';
import type { MarkerData } from './buildMarkers';
import type { HoverPreview } from '../../hooks/useHoverContext';
import type { Experience } from '../../api/experiences';

/**
 * Popup body for a marker: the name as text, never as markup.
 *
 * `setHTML` would interpolate it raw, and the name is not ours — sources ship
 * markup in it (20 rows in a development database carry tags such as
 * `<em>Stato da Terra</em>`) and curators can edit it, which makes anything
 * stored there executable. Built as a DOM node so the browser cannot read it as
 * anything but text.
 */
function buildPopupContent(name: string): HTMLElement {
  const strong = document.createElement('strong');
  strong.textContent = name;
  return strong;
}

export interface MarkerInteractionsParams {
  mapRef: MapRef | undefined;
  /** The markers as drawn, read at call time — see the note on refs above. */
  markersRef: React.MutableRefObject<MarkerData[]>;
  selectedExperienceId: number | null;
  getExperienceById: (id: number) => Experience | undefined;
  toggleSelectedExperience: (id: number) => void;
  toggleCollapsedExperience: (id: number) => void;
  setHoveredFromMarker: (experienceId: number | null, locationId: number | null) => void;
  setHoverPreview: (preview: HoverPreview | null) => void;
  /** Writes the ring straight to the map's source, without a re-render. */
  setHoverData: (data: GeoJSON.FeatureCollection) => void;
}

export function useMarkerInteractions({
  mapRef,
  markersRef,
  selectedExperienceId,
  getExperienceById,
  toggleSelectedExperience,
  toggleCollapsedExperience,
  setHoveredFromMarker,
  setHoverPreview,
  setHoverData,
}: MarkerInteractionsParams) {
  // Refs for accessing latest values in long-lived map callbacks
  const toggleSelectedRef = useRef(toggleSelectedExperience);
  toggleSelectedRef.current = toggleSelectedExperience;
  const setHoveredRef = useRef(setHoveredFromMarker);
  setHoveredRef.current = setHoveredFromMarker;
  const selectedExpIdRef = useRef(selectedExperienceId);
  selectedExpIdRef.current = selectedExperienceId;
  const toggleCollapsedRef = useRef(toggleCollapsedExperience);
  toggleCollapsedRef.current = toggleCollapsedExperience;
  // A ref for the same reason as the four above, and one worth naming: this one
  // is `useCallback(…, [experiences])`, so it changes whenever the region's
  // experiences do — a curation edit, a `showLost` toggle. As a dependency it
  // tore the listeners down and rebuilt them, which takes the popup and the
  // preview card off a marker the pointer is resting on while the row stays
  // highlighted, until the next `mousemove` puts them back.
  const getExperienceByIdRef = useRef(getExperienceById);
  getExperienceByIdRef.current = getExperienceById;

  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();
    if (!map) return;

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'exp-marker-popup',
    });

    // Keyed by the place, not the object: an object is many pins now, and
    // deduping on the object alone left the ring and the popup on the first part
    // the pointer touched while it moved across the other thirty-nine.
    let mapCurrentHoveredKey: string | null = null;

    const clearHoverState = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
      mapCurrentHoveredKey = null;
      setHoverData(EMPTY_FC);
      setHoveredRef.current(null, null);
      setHoverPreview(null);
    };

    const onMarkerClick = (e: maplibregl.MapMouseEvent) => {
      // What the per-layer registrations gave for free: MapLibre's delegated
      // listener checks `getLayer(id)` before querying, and this component
      // unmounts its sources while a region loads, with this effect still
      // attached. Naming a missing layer makes `queryRenderedFeatures` fire an
      // ErrorEvent and log, on the ordinary path of clicking the map mid-load.
      if (!map.getLayer(LAYER_MARKERS)) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [...MARKER_LAYERS] });
      if (features.length === 0) return;
      const experienceId = features[0].properties?.experienceId;
      if (experienceId == null) return;

      // A pin the reader folded is unfolded by clicking it, which is the way back
      // from the only action the map offers on a folded object — and the badge is
      // what says there is something to unfold. Selection is what a click means
      // everywhere else, including on the badge of a pin standing in for places
      // the region's batch has not loaded: there is nothing folded to unfold
      // there, and selecting is what loads them.
      //
      // The test is the pin's own answer, not the id and not a shape that
      // resembles a folded pin: `buildExperienceMarkers` says which pins it drew
      // folded, and a stand-in pin — an object whose places the batch does not
      // hold — has the same null `locationId` and count above one without being
      // one. A click that unfolded that would visibly do nothing.
      if (features[0].properties?.folded === true) {
        toggleCollapsedRef.current(experienceId);
        return;
      }

      toggleSelectedRef.current(experienceId);
    };

    const onMarkerMouseMove = (e: maplibregl.MapMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      const features = map.queryRenderedFeatures(e.point, { layers: [...MARKER_LAYERS] });
      if (features.length > 0) {
        const feature = features[0];
        const experienceId = feature.properties?.experienceId as number;
        const locationId = feature.properties?.locationId as number | undefined;
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

        const hoveredKey = `${experienceId}:${locationId ?? ''}`;
        if (hoveredKey !== mapCurrentHoveredKey) {
          mapCurrentHoveredKey = hoveredKey;

          // Straight to the map's source — see `setHoverData` in
          // `ExperienceMarkers`. A marker hover re-renders nothing.
          setHoverData(buildPointHoverData(coords));

          // Show popup
          popup
            .setLngLat(coords)
            .setDOMContent(buildPopupContent(
              String(feature.properties?.experienceName || feature.properties?.name || '')))
            .addTo(map);

          // Tell the hover store, which is what draws the row and the card.
          setHoveredRef.current(experienceId, locationId ?? null);
          const marker = markersRef.current.find(
            m => m.experienceId === experienceId && (locationId == null || m.locationId === locationId));
          if (marker) {
            setHoverPreview({
              experienceId: marker.experienceId,
              experienceName: marker.experience.name,
              locationId: marker.locationId,
              locationName: marker.locationName,
              categoryName: marker.experience.category_name ?? null,
              category: marker.experience.category ?? null,
              imageUrl: marker.experience.image_url,
              imageCredit: marker.experience.image_credit ?? null,
              longitude: marker.longitude,
              latitude: marker.latitude,
            });
          }
        }
      }
    };

    /**
     * What is under a point, in the same key space as `mapCurrentHoveredKey`:
     * a pin answers with its object and place, a highlight dot with `highlight:`
     * and its place. Topmost feature wins, which is the one the reader sees.
     */
    const hoverKeyAt = (point: maplibregl.Point): string | null => {
      const layers = [...MARKER_LAYERS, LAYER_HIGHLIGHT_POINT].filter(id => map.getLayer(id));
      if (layers.length === 0) return null;
      const under = map.queryRenderedFeatures(point, { layers });
      if (under.length === 0) return null;
      const top = under[0];
      const props = top.properties;
      if (top.layer.id === LAYER_HIGHLIGHT_POINT) return `highlight:${props?.locationId ?? ''}`;
      return `${props?.experienceId}:${props?.locationId ?? ''}`;
    };

    // One leave handler for every layer here, because all four overlap and a
    // leave from any of them can be a move onto another. A pin and its badge are
    // two layers over one place — the badge is drawn `circle-translate: [8, -8]`
    // from the point it belongs to — and the highlight dots of the selected
    // object sit among the pins of the others, a dozen pixels away. Clearing on
    // such a leave takes the popup and the ring off something the pointer is
    // still on, or off the thing it has just arrived at: within one DOM
    // `mousemove` the marker handlers run before the highlight ones, so crossing
    // from a dot onto a pin used to set the hover and then clear it. So a leave
    // whose point already answers with what is hovered is a move inside the
    // hover, not a departure; anything else clears as before.
    //
    // Only for a leave delivered by a *move*, though. MapLibre's delegated
    // `mouseleave` has two paths (`_createDelegatedListener`, maplibre-gl 4.7.1):
    // a `mousemove` that no longer hits the layer, and a `mouseout` when the
    // pointer leaves the canvas — and the second carries the point it left
    // *from*, which is still over the pin when the thing it left onto is an
    // overlay drawn above the map (the fold control, the region box, the zoom
    // buttons). Trusting the point there would keep the ring and the popup lit
    // for good: `mousein` is already false, so no further leave arrives until a
    // feature is entered again.
    const onHoverLayerLeave = (e: maplibregl.MapLayerMouseEvent) => {
      const fromAMove = e.originalEvent?.type === 'mousemove';
      if (fromAMove && hoverKeyAt(e.point) === mapCurrentHoveredKey) return;
      clearHoverState();
    };

    // Highlight layer (red dots) hover — shows popup + orange ring + scrolls list
    const onHighlightMouseMove = (e: maplibregl.MapMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_HIGHLIGHT_POINT] });
      if (features.length > 0) {
        const feature = features[0];
        const locationId = feature.properties?.locationId as number | undefined;
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const name = feature.properties?.name || '';

        // Same key space as the marker layer's, so moving between the two
        // cannot look like staying on one thing: the highlight draws the
        // selected object's places, and its own id is what tells them apart.
        const hoverKey = `highlight:${locationId ?? ''}`;
        if (hoverKey !== mapCurrentHoveredKey) {
          mapCurrentHoveredKey = hoverKey;

          setHoverData(buildPointHoverData(coords));

          popup
            .setLngLat(coords)
            .setDOMContent(buildPopupContent(name))
            .addTo(map);

          // Notify the store — the highlight layer draws the selected experience
          const selExpId = selectedExpIdRef.current;
          if (selExpId != null) {
            setHoveredRef.current(selExpId, locationId ?? null);
            const exp = getExperienceByIdRef.current(selExpId);
            if (exp) {
              setHoverPreview({
                experienceId: exp.id,
                experienceName: exp.name,
                locationId: locationId ?? null,
                locationName: (feature.properties?.name as string | null | undefined) ?? null,
                categoryName: exp.category_name ?? null,
                category: exp.category ?? null,
                imageUrl: exp.image_url,
                imageCredit: exp.image_credit ?? null,
                longitude: coords[0],
                latitude: coords[1],
              });
            }
          }
        }
      }
    };


    // Wait for layers to exist before attaching handlers
    const attachHandlers = () => {
      if (MARKER_LAYERS.some(id => !map.getLayer(id))) return false;
      // Once on the map, not once per layer: a delegated listener is created per
      // registration, so a click landing on two of these — which a badge click
      // does, its circle and its glyph sitting on the same 8 px — ran this body
      // twice and undid itself. On a folded pin that meant toggling the fold off
      // and on again, so clicking the badge that says "folded" did nothing at
      // all. The handler queries the three layers itself and returns when none
      // answers, which is what makes one registration enough. `mousemove` stays
      // per layer because painting a ring twice is painting it once; `mouseleave`
      // stays per layer only because of the same-target check in
      // `onHoverLayerLeave` — over overlapping layers it fires a leave the
      // pointer never made, and clearing once there is already too many. See
      // `docs/tech/maplibre-patterns.md` § One listener per registration.
      map.on('click', onMarkerClick);
      for (const id of MARKER_LAYERS) {
        map.on('mousemove', id, onMarkerMouseMove);
        map.on('mouseleave', id, onHoverLayerLeave);
      }
      map.on('mousemove', LAYER_HIGHLIGHT_POINT, onHighlightMouseMove);
      map.on('mouseleave', LAYER_HIGHLIGHT_POINT, onHoverLayerLeave);
      return true;
    };

    // Layers might not exist yet (declarative rendering is async), so retry
    let retryInterval: ReturnType<typeof setInterval> | null = null;
    if (!attachHandlers()) {
      retryInterval = setInterval(() => {
        if (attachHandlers()) {
          clearInterval(retryInterval!);
          retryInterval = null;
        }
      }, 200);
    }

    return () => {
      if (retryInterval) clearInterval(retryInterval);
      popup.remove();
      setHoverPreview(null);
      map.off('click', onMarkerClick);
      for (const id of MARKER_LAYERS) {
        map.off('mousemove', id, onMarkerMouseMove);
        map.off('mouseleave', id, onHoverLayerLeave);
      }
      map.off('mousemove', LAYER_HIGHLIGHT_POINT, onHighlightMouseMove);
      map.off('mouseleave', LAYER_HIGHLIGHT_POINT, onHoverLayerLeave);
    };
  }, [mapRef, markersRef, setHoverPreview, setHoverData]);
}
