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
import * as maplibregl from 'maplibre-gl';
import {
  LAYER_HIGHLIGHT_POINT, MARKER_LAYERS,
  EMPTY_FC, buildPointHoverData,
} from './layers';
import { markerUnderPointer, hoverKeyOf, type MarkerUnderPointer } from './markerUnderPointer';
import type { MarkerData } from './buildMarkers';
import type { HoverPreview } from '../../hooks/useHoverContext';
import type { Experience, ExperienceLocation } from '../../api/experiences';
import { placeKindNames } from '../../utils/placeKinds';
import { pointPicture } from '../../utils/pointPicture';

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
  /** One of an object's points as the region's batch holds it, for its own picture (#1270). */
  getLocation: (experienceId: number, locationId: number) => ExperienceLocation | undefined;
  /**
   * Open one part of a serial object on its own card (#1271), answering whether
   * it did: a museum's one point is the museum, and its pin selects the museum.
   */
  openPart: (experienceId: number, locationId: number) => boolean;
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
  getLocation,
  openPart,
  toggleSelectedExperience,
  toggleCollapsedExperience,
  setHoveredFromMarker,
  setHoverPreview,
  setHoverData,
}: MarkerInteractionsParams) {
  const getLocationRef = useRef(getLocation);
  getLocationRef.current = getLocation;
  const openPartRef = useRef(openPart);
  openPartRef.current = openPart;
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

    // Hover and click read the same feature, the topmost under the pointer,
    // through `markerUnderPointer` (#1916): where the selected object's dot
    // lies over another place's pin, a click opens what the hover card names.
    const onMarkerClick = (e: maplibregl.MapMouseEvent) => {
      const under = markerUnderPointer(map, e.point);
      if (!under) return;

      if (under.kind === 'highlight') {
        // A dot of the open object's places, which the markers source does not
        // hold: a part's dot opens that part's card (#1271).
        const selected = selectedExpIdRef.current;
        if (under.locationId != null && selected != null) openPartRef.current(selected, under.locationId);
        return;
      }

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
      if (under.folded) {
        toggleCollapsedRef.current(under.experienceId);
        return;
      }

      // A part's pin opens the part's card with its object's (#1271); a
      // museum's one pin selects the museum, as before.
      if (under.locationId != null && openPartRef.current(under.experienceId, under.locationId)) return;

      toggleSelectedRef.current(under.experienceId);
    };

    /** The popup, the ring and the store for a pin the pointer has arrived on. */
    const hoverPin = (pin: Extract<MarkerUnderPointer, { kind: 'pin' }>) => {
      const { experienceId, locationId, coordinates } = pin;

      // Straight to the map's source — see `setHoverData` in
      // `ExperienceMarkers`. A marker hover re-renders nothing.
      setHoverData(buildPointHoverData(coordinates));

      popup
        .setLngLat(coordinates)
        .setDOMContent(buildPopupContent(pin.name))
        .addTo(map);

      // Tell the hover store, which is what draws the row and the card.
      setHoveredRef.current(experienceId, locationId);
      const marker = markersRef.current.find(
        m => m.experienceId === experienceId && (locationId == null || m.locationId === locationId));
      if (marker) {
        setHoverPreview({
          experienceId: marker.experienceId,
          experienceName: marker.experience.name,
          subtitle: marker.experience.subtitle,
          locationId: marker.locationId,
          locationName: marker.locationName,
          kindName: placeKindNames(marker.experience),
          kindId: marker.experience.kind_id,
          treasureCount: marker.experience.treasure_count,
          findsCount: marker.experience.finds_count,
          ...pointPicture(marker.experience, marker.location),
          longitude: marker.longitude,
          latitude: marker.latitude,
        });
      }
    };

    /** The same for a dot of the selected object's places (the red dots). */
    const hoverHighlight = (dot: Extract<MarkerUnderPointer, { kind: 'highlight' }>) => {
      const { locationId, coordinates } = dot;
      // The highlight layer draws the selected experience; a dot named for
      // nothing of its own is the object's one point (#1917), so the popup
      // reads the object and the card names no part.
      const selExpId = selectedExpIdRef.current;
      const exp = selExpId == null ? undefined : getExperienceByIdRef.current(selExpId);

      setHoverData(buildPointHoverData(coordinates));

      popup
        .setLngLat(coordinates)
        .setDOMContent(buildPopupContent(dot.name || exp?.name || ''))
        .addTo(map);

      if (selExpId == null) return;
      setHoveredRef.current(selExpId, locationId);
      if (!exp) return;
      setHoverPreview({
        experienceId: exp.id,
        experienceName: exp.name,
        subtitle: exp.subtitle,
        locationId,
        locationName: dot.name || null,
        kindName: placeKindNames(exp),
        kindId: exp.kind_id,
        treasureCount: exp.treasure_count,
        findsCount: exp.finds_count,
        // The point as the region's batch holds it, whether or not a
        // pin draws it: the highlight shows the selected object's
        // places, out-of-region ones included.
        ...pointPicture(exp, locationId == null ? null : getLocationRef.current(selExpId, locationId)),
        longitude: coordinates[0],
        latitude: coordinates[1],
      });
    };

    // One move handler for the pins and the dots alike: registered per layer,
    // so a move over either calls it, and it answers for whatever is topmost —
    // which is what keeps the order the layers were registered in out of what
    // the card names where a dot and a pin overlap.
    const onPointerMove = (e: maplibregl.MapMouseEvent) => {
      const under = markerUnderPointer(map, e.point);
      if (!under) return;
      map.getCanvas().style.cursor = 'pointer';
      const hoveredKey = hoverKeyOf(under);
      if (hoveredKey === mapCurrentHoveredKey) return;
      mapCurrentHoveredKey = hoveredKey;
      if (under.kind === 'pin') hoverPin(under);
      else hoverHighlight(under);
    };

    /**
     * What is under a point, in the same key space as `mapCurrentHoveredKey`.
     * Topmost feature wins, which is the one the reader sees.
     */
    const hoverKeyAt = (point: maplibregl.Point): string | null => hoverKeyOf(markerUnderPointer(map, point));

    // One leave handler for every layer here, because they all overlap and a
    // leave from any of them can be a move onto another. A pin and its badge are
    // two layers over one place — the badge is drawn `circle-translate: [8, -8]`
    // from the point it belongs to — and the highlight dots of the selected
    // object sit among the pins of the others, a dozen pixels away. Clearing on
    // such a leave takes the popup and the ring off something the pointer is
    // still on, or off the thing it has just arrived at: within one DOM
    // `mousemove` the marker handlers run before the highlight ones, so crossing
    // from a dot onto a pin would set the hover and then clear it. So a leave
    // whose point already answers with what is hovered is a move inside the
    // hover, not a departure; anything else clears.
    //
    // Only for a leave delivered by a *move*, though. MapLibre's delegated
    // `mouseleave` has two paths (`_createDelegatedListener`, read in
    // maplibre-gl 4.7.1 and again in 6.8.0, where the multi-layer form keeps
    // both delegates and hands each the `originalEvent` it was fired from):
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

    // Wait for layers to exist before attaching handlers
    const attachHandlers = () => {
      if (MARKER_LAYERS.some(id => !map.getLayer(id))) return false;
      // Once on the map, not once per layer: a delegated listener is created per
      // registration, so a click landing on two of these — which a badge click
      // does, its circle and its glyph sitting on the same 8 px — ran this body
      // twice and undid itself. On a folded pin that meant toggling the fold off
      // and on again, so clicking the badge that says "folded" did nothing at
      // all. The handler queries `MARKER_LAYERS` itself and returns when none
      // answers, which is what makes one registration enough. `mousemove` stays
      // per layer because painting a ring twice is painting it once; `mouseleave`
      // stays per layer only because of the same-target check in
      // `onHoverLayerLeave` — over overlapping layers it fires a leave the
      // pointer never made, and clearing once there is already too many. See
      // `docs/tech/maplibre-patterns.md` § One listener per registration.
      map.on('click', onMarkerClick);
      for (const id of [...MARKER_LAYERS, LAYER_HIGHLIGHT_POINT]) {
        map.on('mousemove', id, onPointerMove);
        map.on('mouseleave', id, onHoverLayerLeave);
      }
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
      for (const id of [...MARKER_LAYERS, LAYER_HIGHLIGHT_POINT]) {
        map.off('mousemove', id, onPointerMove);
        map.off('mouseleave', id, onHoverLayerLeave);
      }
    };
  }, [mapRef, markersRef, setHoverPreview, setHoverData]);
}
