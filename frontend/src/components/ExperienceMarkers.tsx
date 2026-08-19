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
 * Interaction model (imperative via useMap(), in `useMarkerInteractions`):
 *   - Hover marker on map  → popup + orange ring + highlight list item
 *   - Hover card in list   → orange ring on map
 *   - Click marker         → toggle selected experience in list, and keep the
 *                            view; on a *folded* pin it unfolds and selects nothing
 *   - Click list item      → fly-to marker location(s)
 */

import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useMap, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { buildExperienceMarkers, representablePlaces } from './experienceMarkers/buildMarkers';
import {
  SOURCE_MARKERS, SOURCE_HIGHLIGHT, SOURCE_HOVER, EMPTY_FC, buildPointHoverData, buildPointsHoverData,
  heatmapLayer, markerLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer,
  hoverGlowLayer, hoverRingLayer, highlightRingLayer, highlightPointLayer,
} from './experienceMarkers/layers';
import { useMarkerInteractions } from './experienceMarkers/useMarkerInteractions';
import { useExperienceContext } from '../hooks/useExperienceContext';
import { subscribeToHoverTarget, useHoverActions, type HoverPreview } from '../hooks/useHoverContext';
import { useRegionLocations } from '../hooks/useRegionLocations';
import type { Experience } from '../api/experiences';
import { locationLabel } from '../utils/locationLabel';

interface ExperienceLocation {
  id: number;
  name?: string | null;
  /** Nullable, for the reason given on the API's `ExperienceLocation.ordinal`. */
  ordinal: number | null;
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
}

export function ExperienceMarkers({ regionId }: ExperienceMarkersProps) {
  const { current: mapRef } = useMap();
  const {
    experiences,
    experiencesLoading,
    selectedExperienceId,
    toggleSelectedExperience,
    flyToExperienceId,
    clearFlyTo,
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

  /**
   * The hover ring, written straight to the map rather than held as state.
   *
   * It was `useState`, which made every hover a re-render of this component —
   * and this component is the map's sources and layers, so react-map-gl
   * reconciled all of them on every mouse move across the list. Profiled on
   * Europe's 661 experiences, hovering an object's row cost 320 fibers against
   * a place's 109, and the difference was this: a place rings one point while
   * an object rings all of its places (93 for the Historic Centre of Saint
   * Petersburg), and the object's path also came back through React.
   *
   * Discover's map has always drawn its ring this way (`useDiscoverHover`).
   * The ref is what the `<Source>` renders from, so a re-render for some other
   * reason recreates the source with the ring that is currently drawn rather
   * than with an empty collection.
   */
  const hoverDataRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);
  const mapRefLatest = useRef(mapRef);
  mapRefLatest.current = mapRef;
  const setHoverData = useCallback((data: GeoJSON.FeatureCollection) => {
    hoverDataRef.current = data;
    const source = mapRefLatest.current?.getMap().getSource(SOURCE_HOVER) as
      maplibregl.GeoJSONSource | undefined;
    // Absent while the map is still loading, or between regions: this component
    // unmounts its sources while a region loads. The ref keeps the value, and
    // the source is created with it.
    source?.setData(data);
  }, []);

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

  // ── Imperative event handlers (registered on the map, not rendered) ──
  useMarkerInteractions({
    mapRef,
    markersRef,
    selectedExperienceId,
    getExperienceById,
    toggleSelectedExperience,
    toggleCollapsedExperience,
    setHoveredFromMarker,
    setHoverPreview,
    setHoverData,
  });

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
    setHoverData(buildPointsHoverData(objectMarkers.map(m => [m.longitude, m.latitude])));
  }, [getExperienceById, setHoverPreview, shownPlacesFor, setHoverData]);

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
      <Source id={SOURCE_HOVER} type="geojson" data={hoverDataRef.current}>
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
