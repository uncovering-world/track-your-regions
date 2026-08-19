/**
 * ExperienceMarkers - experience density and markers on the shared react-map-gl Map.
 *
 * Uses react-map-gl's declarative <Source> and <Layer> components.
 *
 * 3 GeoJSON sources:
 *   exp-markers   — a marker per in-region place, or one folded marker for an
 *                   object the reader folded, or one stand-in marker for an
 *                   object whose places the batch does not hold; drives the
 *                   heatmap below HEATMAP_MAX_ZOOM and individual markers from it
 *   exp-highlight  — what the selected experience *shows* (`shownPlacesFor()`):
 *                   its in-region places, all of them when none is in region, or
 *                   its own point when it is folded or none has loaded (red dots)
 *   exp-hover      — hover ring/glow (orange)
 *
 * Interaction model (imperative via useMap()):
 *   - Hover marker on map  → popup + orange ring + highlight list item
 *   - Hover card in list   → orange ring on map
 *   - Click marker         → toggle selected experience in list, and keep the
 *                            view; on a *folded* pin it unfolds and selects nothing
 *   - Click list item      → fly-to marker location(s)
 */

import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { useMap, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { buildExperienceMarkers, representablePlaces } from './experienceMarkers/buildMarkers';
import {
  SOURCE_MARKERS, SOURCE_HIGHLIGHT, SOURCE_HOVER,
  LAYER_MARKERS, LAYER_MARKER_COUNT_BADGE_BG, LAYER_MARKER_COUNT_BADGE_TEXT, LAYER_HIGHLIGHT_POINT,
  heatmapLayer, markerLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer,
  hoverGlowLayer, hoverRingLayer, highlightRingLayer, highlightPointLayer,
} from './experienceMarkers/layers';
import { useExperienceContext } from '../hooks/useExperienceContext';
import { subscribeToHoverTarget, useHoverActions } from '../hooks/useHoverContext';
import { useNavigation } from '../hooks/useNavigation';
import { useRegionLocations } from '../hooks/useRegionLocations';
import type { Experience } from '../api/experiences';
import { locationLabel } from '../utils/locationLabel';

// The one collection every empty source starts from
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function buildPointHoverData(coords: [number, number]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {},
    }],
  };
}

interface ExperienceLocation {
  id: number;
  name?: string | null;
  /** Nullable, for the reason given on the API's `ExperienceLocation.ordinal`. */
  ordinal: number | null;
  longitude: number;
  latitude: number;
}

interface HoverPreview {
  experienceId: number;
  experienceName: string;
  locationId: number | null;
  locationName: string | null;
  categoryName: string | null;
  category: string | null;
  imageUrl: string | null;
  longitude: number;
  latitude: number;
}

function tryHoverSpecificLocation(
  expId: number,
  locId: number,
  locationsByExp: Record<number, ExperienceLocation[] | undefined>,
  getExperienceById: (id: number) => Experience | undefined,
  setHoverPreview: (preview: HoverPreview | null) => void,
  setHoverData: (data: GeoJSON.FeatureCollection) => void,
): boolean {
  const loc = locationsByExp[expId]?.find(l => l.id === locId);
  if (!loc) return false;
  const exp = getExperienceById(expId);
  if (exp) {
    setHoverPreview({
      experienceId: exp.id,
      experienceName: exp.name,
      locationId: loc.id,
      locationName: locationLabel(loc),
      categoryName: exp.category_name ?? null,
      category: exp.category ?? null,
      imageUrl: exp.image_url,
      longitude: loc.longitude,
      latitude: loc.latitude,
    });
  }
  setHoverData(buildPointHoverData([loc.longitude, loc.latitude]));
  return true;
}

interface ExperienceMarkersProps {
  regionId: number | null;
  visitedIds?: Set<number>;
  visitedLocationIds?: Set<number>;
}

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

export function ExperienceMarkers({ regionId }: ExperienceMarkersProps) {
  const { current: mapRef } = useMap();
  const { selectedRegion } = useNavigation();
  const {
    experiences,
    experiencesLoading,
    selectedExperienceId,
    toggleSelectedExperience,
    flyToExperienceId,
    clearFlyTo,
    shouldFitRegion,
    clearFitRegion,
    getExperienceById,
    expandedCategoryNames,
    collapsedExperienceIds,
    toggleCollapsedExperience,
    showLost,
  } = useExperienceContext();
  // Only the setters and the store. This component draws the markers, so a
  // re-render here reconciles every `<Source>` and `<Layer>` react-map-gl holds;
  // it reacts to a hover in an effect instead, and never renders for one.
  const { store: hoverStore, setHoveredFromMarker, setHoverPreview } = useHoverActions();

  // Batch-fetch all locations for all experiences in the region (single request)
  const { locationsByExperience } = useRegionLocations(regionId, showLost);

  // Hover source data (updated by event handlers and list hover)
  const [hoverData, setHoverData] = useState<GeoJSON.FeatureCollection>(EMPTY_FC);

  // Refs for accessing latest values in long-lived map callbacks
  const toggleSelectedRef = useRef(toggleSelectedExperience);
  toggleSelectedRef.current = toggleSelectedExperience;
  const setHoveredRef = useRef(setHoveredFromMarker);
  setHoveredRef.current = setHoveredFromMarker;
  const selectedExpIdRef = useRef(selectedExperienceId);
  selectedExpIdRef.current = selectedExperienceId;
  const toggleCollapsedRef = useRef(toggleCollapsedExperience);
  toggleCollapsedRef.current = toggleCollapsedExperience;

  // Popup ref for cleanup
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // ── One marker per place a reader may go to (ADR-0028 decision 1, #558) ──
  // An object folded by this reader is one marker instead, at the coordinate the
  // catalogue answers with; a selected object leaves this set and is drawn by the
  // highlight layer below, which follows the same rule.
  const markers = useMemo(
    () => buildExperienceMarkers(
      experiences, locationsByExperience, expandedCategoryNames, collapsedExperienceIds),
    [experiences, locationsByExperience, expandedCategoryNames, collapsedExperienceIds],
  );

  // Keep a ref so map callbacks can access the latest markers
  const markersRef = useRef(markers);
  markersRef.current = markers;

  // ── Declarative GeoJSON data for sources ──

  // Main markers source data (excludes selected experience — shown via highlight instead)
  const markersGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    const visibleMarkers = selectedExperienceId != null
      ? markers.filter(m => m.experienceId !== selectedExperienceId)
      : markers;

    return {
      type: 'FeatureCollection',
      features: visibleMarkers.map((m) => ({
        type: 'Feature' as const,
        // The object's id would now repeat across every one of its places, and a
        // source whose features share an id cannot tell them apart — `id` is what
        // MapLibre keys a feature by. `m.id` is `${experienceId}-${locationId}`.
        id: m.id,
        geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] },
        properties: {
          // No `id` here: the feature-level one above is what identifies a
          // marker, and nothing reads a property by that name — the handlers ask
          // for `experienceId`/`locationId`, the popup for the names, the badge
          // layers for `locationCount`.
          experienceId: m.experienceId,
          locationId: m.locationId,
          name: m.locationName || m.experience.name,
          experienceName: m.experience.name,
          category: m.experience.category || '',
          locationCount: m.locationCount,
          folded: m.folded === true,
        },
      })),
    };
  }, [markers, selectedExperienceId]);

  /**
   * The places an object shows on the map, or `null` for "draw its own point".
   *
   * `null` covers two cases that want the same answer. An object whose places the
   * region batch does not hold — the common one in a continent fetched without
   * descendants — has nothing else to draw. And an object this reader folded has
   * places, deliberately undrawn: folding that stopped at the marker source would
   * be undone by selecting the row, since a selected object is drawn by the
   * highlight layer instead. Both land on the coordinate the catalogue answers
   * with (ADR-0028 decision 2), which is where the folded pin already sits.
   *
   * The in-region preference is the marker builder's, for the same reason: an
   * experience assigned by hand has no in-region place, and filtering to none
   * would leave the row with a marker until it was clicked and nothing after.
   */
  const shownPlacesFor = useCallback((experienceId: number): ExperienceLocation[] | null => {
    const locations = locationsByExperience[experienceId];
    const representable = representablePlaces(locations);
    if (representable.length === 0) return null;
    if (collapsedExperienceIds.has(experienceId) && representable.length > 1) return null;
    return representable as ExperienceLocation[];
  }, [locationsByExperience, collapsedExperienceIds]);

  // Highlight source data (the places of the selected experience)
  const highlightGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (selectedExperienceId == null) return EMPTY_FC;

    const shown = shownPlacesFor(selectedExperienceId);
    if (!shown) {
      const exp = getExperienceById(selectedExperienceId);
      if (!exp) return EMPTY_FC;
      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [exp.longitude, exp.latitude] },
          properties: { locationId: null, name: exp.name },
        }],
      };
    }

    return {
      type: 'FeatureCollection',
      features: shown.map((loc) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [loc.longitude, loc.latitude] },
        properties: {
          locationId: loc.id,
          name: locationLabel(loc),
        },
      })),
    };
  }, [selectedExperienceId, shownPlacesFor, getExperienceById]);

  // ── Imperative event handlers (registered on map via useEffect) ──
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
    popupRef.current = popup;

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
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_MARKERS, LAYER_MARKER_COUNT_BADGE_BG, LAYER_MARKER_COUNT_BADGE_TEXT],
      });
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
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_MARKERS, LAYER_MARKER_COUNT_BADGE_BG, LAYER_MARKER_COUNT_BADGE_TEXT],
      });
      if (features.length > 0) {
        const feature = features[0];
        const experienceId = feature.properties?.experienceId as number;
        const locationId = feature.properties?.locationId as number | undefined;
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

        const hoveredKey = `${experienceId}:${locationId ?? ''}`;
        if (hoveredKey !== mapCurrentHoveredKey) {
          mapCurrentHoveredKey = hoveredKey;

          // Update hover ring via state
          setHoverData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: coords },
              properties: {},
            }],
          });

          // Show popup
          popup
            .setLngLat(coords)
            .setDOMContent(buildPopupContent(
              String(feature.properties?.experienceName || feature.properties?.name || '')))
            .addTo(map);

          // Notify React context
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
              longitude: marker.longitude,
              latitude: marker.latitude,
            });
          }
        }
      }
    };

    const onMarkerMouseLeave = () => clearHoverState();

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

          setHoverData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: coords },
              properties: {},
            }],
          });

          popup
            .setLngLat(coords)
            .setDOMContent(buildPopupContent(name))
            .addTo(map);

          // Notify context — highlight layer is for the selected experience
          const selExpId = selectedExpIdRef.current;
          if (selExpId != null) {
            setHoveredRef.current(selExpId, locationId ?? null);
            const exp = getExperienceById(selExpId);
            if (exp) {
              setHoverPreview({
                experienceId: exp.id,
                experienceName: exp.name,
                locationId: locationId ?? null,
                locationName: (feature.properties?.name as string | null | undefined) ?? null,
                categoryName: exp.category_name ?? null,
                category: exp.category ?? null,
                imageUrl: exp.image_url,
                longitude: coords[0],
                latitude: coords[1],
              });
            }
          }
        }
      }
    };

    const onHighlightMouseLeave = () => clearHoverState();

    // Wait for layers to exist before attaching handlers
    const attachHandlers = () => {
      if (
        !map.getLayer(LAYER_MARKERS) ||
        !map.getLayer(LAYER_MARKER_COUNT_BADGE_BG) ||
        !map.getLayer(LAYER_MARKER_COUNT_BADGE_TEXT)
      ) {
        return false;
      }
      // Once on the map, not once per layer: a delegated listener is created per
      // registration, so a click landing on two of these — which a badge click
      // does, its circle and its glyph sitting on the same 8 px — ran this body
      // twice and undid itself. On a folded pin that meant toggling the fold off
      // and on again, so clicking the badge that says "folded" did nothing at
      // all. The handler queries the three layers itself and returns when none
      // answers, which is what makes one registration enough. The `mousemove` and
      // `mouseleave` registrations below stay per layer, which is safe only
      // because painting a ring twice is painting it once — see
      // `docs/tech/maplibre-patterns.md` § One listener per registration.
      map.on('click', onMarkerClick);
      map.on('mousemove', LAYER_MARKERS, onMarkerMouseMove);
      map.on('mousemove', LAYER_MARKER_COUNT_BADGE_BG, onMarkerMouseMove);
      map.on('mousemove', LAYER_MARKER_COUNT_BADGE_TEXT, onMarkerMouseMove);
      map.on('mouseleave', LAYER_MARKERS, onMarkerMouseLeave);
      map.on('mouseleave', LAYER_MARKER_COUNT_BADGE_BG, onMarkerMouseLeave);
      map.on('mouseleave', LAYER_MARKER_COUNT_BADGE_TEXT, onMarkerMouseLeave);
      map.on('mousemove', LAYER_HIGHLIGHT_POINT, onHighlightMouseMove);
      map.on('mouseleave', LAYER_HIGHLIGHT_POINT, onHighlightMouseLeave);
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
      popupRef.current = null;
      setHoverPreview(null);
      map.off('click', onMarkerClick);
      map.off('mousemove', LAYER_MARKERS, onMarkerMouseMove);
      map.off('mousemove', LAYER_MARKER_COUNT_BADGE_BG, onMarkerMouseMove);
      map.off('mousemove', LAYER_MARKER_COUNT_BADGE_TEXT, onMarkerMouseMove);
      map.off('mouseleave', LAYER_MARKERS, onMarkerMouseLeave);
      map.off('mouseleave', LAYER_MARKER_COUNT_BADGE_BG, onMarkerMouseLeave);
      map.off('mouseleave', LAYER_MARKER_COUNT_BADGE_TEXT, onMarkerMouseLeave);
      map.off('mousemove', LAYER_HIGHLIGHT_POINT, onHighlightMouseMove);
      map.off('mouseleave', LAYER_HIGHLIGHT_POINT, onHighlightMouseLeave);
    };
  }, [mapRef, getExperienceById, setHoverPreview]);

  // ── List hover → hover ring on map ──
  const locationsByExpRef = useRef(locationsByExperience);
  locationsByExpRef.current = locationsByExperience;

  // Takes no map. Every branch below resolves against `markersRef` and the hover
  // state now that the cluster scan is gone — and the guard that fetched the map
  // had quietly acquired teeth: bailing out when the map was not ready skipped
  // the `expId == null` clear too, leaving the previous row's ring lit with
  // nothing left to take it down.
  const updateHoverFromList = useCallback((expId: number | null, locId: number | null) => {
    if (expId == null) {
      setHoverData(EMPTY_FC);
      setHoverPreview(null);
      return;
    }

    // Specific location (from an expanded experience): the point lives on the
    // highlight layer rather than in the markers source, so the ring goes on
    // that location rather than on the experience's primary marker.
    //
    // Not when the object is folded, though: the card's location list stays open
    // and keeps reporting hovers, while the map is drawing one dot at the object's
    // own coordinate — ringing the row's own place would put an orange ring on
    // empty map. `shownPlacesFor` answering `null` is exactly that state, and the
    // object-level branch below rings what is drawn.
    if (locId != null && shownPlacesFor(expId) !== null
      && tryHoverSpecificLocation(expId, locId, locationsByExpRef.current, getExperienceById, setHoverPreview, setHoverData)) {
      return;
    }

    // Experience-level hover — every place of the object, because that is what
    // the row stands for. Ringing one of them was the old shape, when one of them
    // was all the map drew.
    const objectMarkers = markersRef.current.filter(m => m.experienceId === expId);
    const marker = objectMarkers[0];
    if (!marker) {
      // Nothing to show. Returning bare would leave the previous row's ring and
      // card up, where they read as this row's — worse than showing none. Both
      // go, not just the ring: the card carries the name, image and category.
      setHoverData(EMPTY_FC);
      setHoverPreview(null);
      return;
    }
    setHoverPreview({
      experienceId: marker.experienceId,
      experienceName: marker.experience.name,
      locationId: marker.locationId,
      locationName: marker.locationName,
      categoryName: marker.experience.category_name ?? null,
      category: marker.experience.category ?? null,
      imageUrl: marker.experience.image_url,
      longitude: marker.longitude,
      latitude: marker.latitude,
    });
    // Straight onto the object's own points. With the source unclustered there is
    // no aggregate standing in for them and nothing to resolve asynchronously, so
    // the rings land where the markers are whether or not they are currently
    // drawn — below HEATMAP_MAX_ZOOM the heat is what shows there instead.
    setHoverData({
      type: 'FeatureCollection',
      features: objectMarkers.map(m => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] },
        properties: {},
      })),
    });
  }, [getExperienceById, setHoverPreview, shownPlacesFor]);

  // Drive list → map hover, straight from the store. Subscribed rather than
  // depended on: the values change on every mouse move across the list, and
  // reading them in the render is what used to rebuild this whole component —
  // and with it the map's sources — per move.
  //
  // To the *target* only. `updateHoverFromList` writes the preview card, and a
  // subscriber that heard that write would answer it by writing again — see
  // `subscribeToHoverTarget`.
  useEffect(() => subscribeToHoverTarget(hoverStore, (
    { hoveredExperienceId, hoveredLocationId, hoverSource },
  ) => {
    if (hoverSource === 'list') {
      updateHoverFromList(hoveredExperienceId, hoveredLocationId);
    }
    if (hoverSource === null && hoveredExperienceId === null) {
      updateHoverFromList(null, null);
    }
  }), [hoverStore, updateHoverFromList]);

  // No auto-fit on a marker click any more. It framed every place of the object
  // clicked, which was the whole content of that click while an object was one
  // dot: "show me this". A pin is one named place now, and framing all of them
  // takes the place the reader clicked off the screen — at zoom 12 over Aragón,
  // clicking one of the Rock Art's 734 shelters threw the view out across three
  // provinces, and that shelter's own pin left `exp-markers` in the same commit,
  // so there was nothing to click back to. A click on the map means "this one,
  // here"; a click in the list still means "take me to it", and that fly-to
  // below is unchanged.

  // ── Fly to experience when triggered from list click ──
  useEffect(() => {
    if (flyToExperienceId && mapRef) {
      const map = mapRef.getMap();

      // The same rule the highlight layer uses, so what a list click frames is
      // what the map is drawing — including a folded object, which is flown to as
      // the single point it is drawn as rather than to bounds around parts nobody
      // can see. A map click frames nothing; see the comment above this effect.
      const flyLocs = shownPlacesFor(flyToExperienceId) ?? [];

      if (flyLocs.length > 1) {
        const lngs = flyLocs.map(loc => loc.longitude);
        const lats = flyLocs.map(loc => loc.latitude);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 80, duration: 800, maxZoom: 12 }
        );
      } else if (flyLocs.length === 1) {
        map.flyTo({
          center: [flyLocs[0].longitude, flyLocs[0].latitude],
          zoom: Math.max(map.getZoom(), 8),
          duration: 800,
        });
      } else {
        // Locations not loaded yet — fall back to experience coordinates
        const exp = getExperienceById(flyToExperienceId);
        if (exp) {
          map.flyTo({
            center: [exp.longitude, exp.latitude],
            zoom: Math.max(map.getZoom(), 8),
            duration: 800,
          });
        }
      }
      clearFlyTo();
    }
  }, [flyToExperienceId, mapRef, shownPlacesFor, getExperienceById, clearFlyTo]);

  // ── Fit to region bounds when closing expanded item ──
  useEffect(() => {
    if (shouldFitRegion && mapRef && selectedRegion?.focusBbox) {
      const map = mapRef.getMap();
      const [west, south, east, north] = selectedRegion.focusBbox;
      map.fitBounds(
        [[west, south], [east, north]],
        { padding: 50, duration: 1000 }
      );
      clearFitRegion();
    }
  }, [shouldFitRegion, mapRef, selectedRegion, clearFitRegion]);

  // Don't render any DOM if no region or still loading
  if (!regionId || experiencesLoading) {
    return null;
  }

  return (
    <>
      {/* Main markers source — heatmap below the threshold, markers above it */}
      <Source
        id={SOURCE_MARKERS}
        type="geojson"
        data={markersGeoJson}
      >
        <Layer {...heatmapLayer} />
        <Layer {...markerLayer} />
        <Layer {...markerCountBadgeBgLayer} />
        <Layer {...markerCountBadgeTextLayer} />
      </Source>

      {/* Highlight source — selected experience locations (red dots/rings) */}
      <Source id={SOURCE_HIGHLIGHT} type="geojson" data={highlightGeoJson}>
        <Layer {...highlightRingLayer} />
        <Layer {...highlightPointLayer} />
      </Source>

      {/* Hover source — orange ring/glow on the hovered marker */}
      <Source id={SOURCE_HOVER} type="geojson" data={hoverData}>
        <Layer {...hoverGlowLayer} />
        <Layer {...hoverRingLayer} />
      </Source>

      {/* Popup styles */}
      <style>{`
        .exp-marker-popup .maplibregl-popup-content {
          padding: 6px 10px;
          font-size: 12px;
          font-family: "Figtree", sans-serif;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
      `}</style>
    </>
  );
}
