/**
 * ExperienceMarkers - experience density and markers on the shared react-map-gl Map.
 *
 * Uses react-map-gl's declarative <Source> and <Layer> components.
 *
 * 3 GeoJSON sources:
 *   exp-markers   — every in-region experience location; drives the heatmap
 *                   below HEATMAP_MAX_ZOOM and individual markers from it
 *   exp-highlight  — the selected experience's in-region locations, or all of
 *                   them when none is in region, or its own point when none has
 *                   loaded at all (red dots)
 *   exp-hover      — hover ring/glow (orange)
 *
 * Interaction model (imperative via useMap()):
 *   - Hover marker on map  → popup + orange ring + highlight list item
 *   - Hover card in list   → orange ring on map
 *   - Click marker         → toggle selected experience in list
 *   - Click list item      → fly-to marker location(s)
 */

import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { useMap, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import type { LayerProps } from 'react-map-gl/maplibre';
import { buildExperienceMarkers } from './experienceMarkers/buildMarkers';
import { useExperienceContext } from '../hooks/useExperienceContext';
import { useNavigation } from '../hooks/useNavigation';
import { useRegionLocations } from '../hooks/useRegionLocations';
import type { Experience } from '../api/experiences';

// Source IDs
const SOURCE_MARKERS = 'exp-markers';
const LAYER_HEAT = 'exp-heatmap';
/** Below this, density; from it, individual markers. */
const HEATMAP_MAX_ZOOM = 5;

/**
 * Where the markers start fading in — the same zoom at which the heat starts
 * fading out, so the two cross instead of one ending where the other begins.
 *
 * `minzoom` alone cannot do this. It is a hard cutoff: MapLibre applies no
 * cross-fade to circle or symbol layers at a zoom bound, so markers pinned to
 * HEATMAP_MAX_ZOOM appeared at exactly z5 while the heat had already ramped to
 * nothing over the half level below it. At z4.9 that left heat at ~0.17 and no
 * markers at all — a one-sided fade with a dip in it. Both layers now span the
 * band and ramp their opacity across it in opposite directions.
 */
const MARKER_FADE_START = HEATMAP_MAX_ZOOM - 0.5;

const SOURCE_HIGHLIGHT = 'exp-highlight';
const SOURCE_HOVER = 'exp-hover';

// Layer IDs
const LAYER_MARKERS = 'exp-markers-points';
const LAYER_MARKER_COUNT_BADGE_BG = 'exp-marker-count-badge-bg';
const LAYER_MARKER_COUNT_BADGE_TEXT = 'exp-marker-count-badge-text';
const LAYER_HOVER_GLOW = 'exp-hover-glow';
const LAYER_HOVER_RING = 'exp-hover-ring';
const LAYER_HIGHLIGHT_RING = 'exp-highlight-ring';
const LAYER_HIGHLIGHT_POINT = 'exp-highlight-point';

// ── Layer style definitions ──

/**
 * Density instead of counts at overview zoom.
 *
 * Replaces clustering rather than sitting beside it: a clustered source cannot
 * drive a heatmap, because MapLibre substitutes aggregates for the points and
 * the heat would be computed from cluster centroids. With `cluster` off, the
 * one source serves both this and the individual markers above the threshold.
 */
const heatmapLayer: LayerProps = {
  id: LAYER_HEAT,
  type: 'heatmap',
  source: SOURCE_MARKERS,
  maxzoom: HEATMAP_MAX_ZOOM,
  paint: {
    'heatmap-weight': 1,
    // The radius stays flat on purpose. It is in screen pixels, so zooming in
    // spreads the points across more of the screen while the blur stays the same
    // size — which is what makes a blob resolve into the finer structure inside
    // it. Growing the radius with zoom cancels exactly that, and the map then
    // shows the same clumps at every level.
    'heatmap-radius': 16,
    // Intensity is the one that has to move, and it is the ruler that can: it
    // scales density before the colour ramp reads it, so it changes what the
    // ramp sees without touching the spatial scale the radius sets.
    //
    // It runs WELL below one on the overview on purpose, and the number is set
    // by a specific question: what should a single lone point look like?
    //
    // At one, the answer was "the same as Rome". A lone marker peaks near the
    // top of the ramp all by itself, so Kazan with one site and Rome with twenty
    // both came out the hottest colour — the ramp was saturated before points
    // ever began to accumulate, and no palette can separate "dense" from
    // "denser" when every one of those pixels asks it for the same value. That
    // is also what made Europe read as one blob. Held down here, a lone point
    // lands in the lower third — visible, clearly cold — and the hot end is left
    // to places where points genuinely pile up.
    //
    // The climb is late for the opposite reason. Each zoom level doubles the
    // on-screen distance between points, so a fixed radius covers roughly a
    // quarter as many and density falls about fourfold per level — which is what
    // used to make the layer fade out on the way in. The gain arrives where that
    // loss does, past zoom 3, rather than on the overview where it only floods.
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
      0, 0.22, 3, 0.4, HEATMAP_MAX_ZOOM, 3],
    // Inferno, cold to hot. Replaces a single teal at varying alpha, which could
    // say "something is here" but not "much more here than there" — one hue
    // separates presence from absence and nothing else. Zero stays fully
    // transparent; lifting it would tint the ocean.
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(59, 15, 112, 0)',
      0.15, 'rgba(59, 15, 112, 0.5)',
      0.35, 'rgba(140, 41, 129, 0.68)',
      0.55, 'rgba(222, 73, 104, 0.78)',
      0.75, 'rgba(254, 159, 109, 0.85)',
      1, 'rgba(254, 207, 146, 0.92)',
    ],
    // Fades out across the same band the markers fade in over, so the two cross
    // rather than hand over at a line. Held at full strength until that band
    // starts: spread across a whole level, the fade itself read as the layer
    // dying before anything replaced it.
    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'],
      0, 0.85, MARKER_FADE_START, 0.85, HEATMAP_MAX_ZOOM, 0],
  },
};

/**
 * No `point_count` filter on the marker layers. With `cluster` off the source
 * never produces an aggregate feature, so `['!', ['has', 'point_count']]` held
 * for every feature it would ever see — a filter that selected nothing and read
 * as if clustering were still in play.
 */
const markerLayer: LayerProps = {
  id: LAYER_MARKERS,
  minzoom: MARKER_FADE_START,
  type: 'circle',
  source: SOURCE_MARKERS,
  paint: {
    'circle-color': [
      'match', ['get', 'category'],
      'cultural', '#8B5CF6',
      // Museums, named rather than left to the fallback below — which is also
      // what public art takes, and the two must not share a pin colour.
      'art', '#2563EB',
      'natural', '#10B981',
      'mixed', '#F59E0B',
      '#0d9488',
    ],
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
    'circle-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
    'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
  },
};

const markerCountBadgeBgLayer: LayerProps = {
  id: LAYER_MARKER_COUNT_BADGE_BG,
  minzoom: MARKER_FADE_START,
  type: 'circle',
  source: SOURCE_MARKERS,
  filter: ['>', ['coalesce', ['get', 'locationCount'], 1], 1],
  paint: {
    'circle-color': '#0f172a',
    'circle-radius': 8,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
    'circle-translate': [8, -8],
    'circle-translate-anchor': 'viewport',
    'circle-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
    'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
  },
};

const markerCountBadgeTextLayer: LayerProps = {
  id: LAYER_MARKER_COUNT_BADGE_TEXT,
  minzoom: MARKER_FADE_START,
  type: 'symbol',
  source: SOURCE_MARKERS,
  filter: ['>', ['coalesce', ['get', 'locationCount'], 1], 1],
  layout: {
    'text-field': ['to-string', ['get', 'locationCount']],
    'text-size': 9,
    'text-font': ['Open Sans Bold'],
    'text-offset': [0.88, -0.88],
    'text-anchor': 'center',
    'text-allow-overlap': true,
  },
  paint: {
    'text-opacity': ['interpolate', ['linear'], ['zoom'],
      MARKER_FADE_START, 0, HEATMAP_MAX_ZOOM, 1],
    'text-color': '#ffffff',
    'text-halo-color': '#0f172a',
    'text-halo-width': 0.2,
  },
};

const hoverGlowLayer: LayerProps = {
  id: LAYER_HOVER_GLOW,
  type: 'circle',
  source: SOURCE_HOVER,
  paint: {
    'circle-color': '#f97316',
    'circle-radius': ['coalesce', ['get', 'hoverRadius'], 24],
    'circle-opacity': 0.18,
    'circle-blur': 0.6,
  },
};

const hoverRingLayer: LayerProps = {
  id: LAYER_HOVER_RING,
  type: 'circle',
  source: SOURCE_HOVER,
  paint: {
    'circle-color': 'transparent',
    'circle-radius': ['coalesce', ['get', 'ringRadius'], 18],
    'circle-stroke-width': 3,
    'circle-stroke-color': '#f97316',
    'circle-stroke-opacity': 1,
  },
};

const highlightRingLayer: LayerProps = {
  id: LAYER_HIGHLIGHT_RING,
  type: 'circle',
  source: SOURCE_HIGHLIGHT,
  paint: {
    'circle-color': 'transparent',
    'circle-radius': 14,
    'circle-stroke-width': 3,
    'circle-stroke-color': '#ef4444',
    'circle-stroke-opacity': 0.8,
  },
};

const highlightPointLayer: LayerProps = {
  id: LAYER_HIGHLIGHT_POINT,
  type: 'circle',
  source: SOURCE_HIGHLIGHT,
  paint: {
    'circle-color': '#ef4444',
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
};

// ── Empty feature collection constant ──
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
  ordinal: number;
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
      locationName: loc.name || `Location ${loc.ordinal + 1}`,
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
    hoveredExperienceId,
    hoveredLocationId,
    hoverSource,
    setHoveredFromMarker,
    selectedExperienceId,
    toggleSelectedExperience,
    flyToExperienceId,
    clearFlyTo,
    shouldFitRegion,
    clearFitRegion,
    getExperienceById,
    expandedCategoryNames,
    setHoverPreview,
    showLost,
  } = useExperienceContext();

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

  // Popup ref for cleanup
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pendingMarkerFitExperienceIdRef = useRef<number | null>(null);

  // ── One marker per experience (its primary location, in-region when it has one) ──
  // Multi-location experiences show all locations via the highlight layer when selected.
  const markers = useMemo(
    () => buildExperienceMarkers(experiences, locationsByExperience, expandedCategoryNames),
    [experiences, locationsByExperience, expandedCategoryNames],
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
        id: m.experienceId,
        geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] },
        properties: {
          id: m.id,
          experienceId: m.experienceId,
          locationId: m.locationId,
          name: m.locationName || m.experience.name,
          experienceName: m.experience.name,
          category: m.experience.category || '',
          locationCount: m.locationCount,
        },
      })),
    };
  }, [markers, selectedExperienceId]);

  // Highlight source data (in-region locations of selected experience)
  const highlightGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (selectedExperienceId == null) return EMPTY_FC;

    const locations = locationsByExperience[selectedExperienceId];

    // No locations loaded for this one — draw its own point rather than nothing.
    // The batch fetch is per region without descendants, so most experiences in
    // a continent have none, and the selected experience is removed from the
    // marker source by the memo above: returning empty here made it disappear
    // from the map entirely at the moment of being selected.
    if (!locations || locations.length === 0) {
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

    // Same fallback as the marker builder, and for the same reason: an
    // experience assigned by hand has no in-region location, and filtering to
    // none would empty this collection — the row would carry a marker until it
    // was clicked and then have nothing drawn for it at all.
    const inRegion = locations.filter(loc => loc.in_region !== false);
    const shown = inRegion.length > 0 ? inRegion : locations;
    return {
      type: 'FeatureCollection',
      features: shown.map((loc) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [loc.longitude, loc.latitude] },
        properties: {
          locationId: loc.id,
          name: loc.name || `Location ${loc.ordinal + 1}`,
        },
      })),
    };
  }, [selectedExperienceId, locationsByExperience, getExperienceById]);

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

    let mapCurrentHoveredId: number | null = null;

    const clearHoverState = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
      mapCurrentHoveredId = null;
      setHoverData(EMPTY_FC);
      setHoveredRef.current(null, null);
      setHoverPreview(null);
    };

    const onMarkerClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_MARKERS, LAYER_MARKER_COUNT_BADGE_BG, LAYER_MARKER_COUNT_BADGE_TEXT],
      });
      if (features.length > 0) {
        const experienceId = features[0].properties?.experienceId;
        if (experienceId != null) {
          const willSelect = selectedExpIdRef.current !== experienceId;
          toggleSelectedRef.current(experienceId);
          pendingMarkerFitExperienceIdRef.current = willSelect ? experienceId : null;
        }
      }
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

        if (experienceId !== mapCurrentHoveredId) {
          mapCurrentHoveredId = experienceId;

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
          const marker = markersRef.current.find(m => m.experienceId === experienceId);
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

        const hoverKey = locationId ?? -1;
        if (hoverKey !== mapCurrentHoveredId) {
          mapCurrentHoveredId = hoverKey;

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
      map.on('click', LAYER_MARKERS, onMarkerClick);
      map.on('click', LAYER_MARKER_COUNT_BADGE_BG, onMarkerClick);
      map.on('click', LAYER_MARKER_COUNT_BADGE_TEXT, onMarkerClick);
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
      map.off('click', LAYER_MARKERS, onMarkerClick);
      map.off('click', LAYER_MARKER_COUNT_BADGE_BG, onMarkerClick);
      map.off('click', LAYER_MARKER_COUNT_BADGE_TEXT, onMarkerClick);
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
    if (locId != null
      && tryHoverSpecificLocation(expId, locId, locationsByExpRef.current, getExperienceById, setHoverPreview, setHoverData)) {
      return;
    }

    // Experience-level hover — find the primary marker
    const marker = markersRef.current.find(m => m.experienceId === expId);
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
    // Straight onto the marker's own point. With the source unclustered there is
    // no aggregate standing in for it and nothing to resolve asynchronously, so
    // the ring lands where the marker is whether or not it is currently drawn —
    // below HEATMAP_MAX_ZOOM the heat is what shows there instead.
    setHoverData(buildPointHoverData([marker.longitude, marker.latitude]));
  }, [getExperienceById, setHoverPreview]);

  // Watch hoveredExperienceId + hoverSource to drive list → map hover
  useEffect(() => {
    if (hoverSource === 'list') {
      updateHoverFromList(hoveredExperienceId, hoveredLocationId);
    }
    if (hoverSource === null && hoveredExperienceId === null) {
      updateHoverFromList(null, null);
    }
  }, [hoveredExperienceId, hoveredLocationId, hoverSource, updateHoverFromList]);

  // ── Marker click auto-fit: wait for locations to load, then fit selected experience bounds ──
  useEffect(() => {
    if (!mapRef) return;

    const pendingId = pendingMarkerFitExperienceIdRef.current;
    if (!pendingId || selectedExperienceId !== pendingId) return;

    const locations = locationsByExperience[pendingId];
    if (!locations || locations.length === 0) return;

    const map = mapRef.getMap();
    const inRegionLocs = locations.filter(loc => loc.in_region !== false);
    const fitLocs = inRegionLocs.length > 0 ? inRegionLocs : locations;

    if (fitLocs.length > 1) {
      const lngs = fitLocs.map(loc => loc.longitude);
      const lats = fitLocs.map(loc => loc.latitude);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 80, duration: 800, maxZoom: 12 }
      );
    }

    pendingMarkerFitExperienceIdRef.current = null;
  }, [mapRef, selectedExperienceId, locationsByExperience]);

  // ── Fly to experience when triggered from list click ──
  useEffect(() => {
    if (flyToExperienceId && mapRef) {
      const map = mapRef.getMap();

      // Use locationsByExperience for accurate multi-location bounds
      const locations = locationsByExperience[flyToExperienceId];
      // Same fallback as the highlight layer and the marker-click fit. Without it
      // a hand-assigned experience takes the "not loaded yet" branch below and
      // flies to the experience's own point — which for a serial site can be
      // nowhere near the locations that are the only thing drawn for it, and
      // leaves the list click framing it differently from a click on the map.
      const allLocs = locations ?? [];
      const inRegion = allLocs.filter(loc => loc.in_region !== false);
      const flyLocs = inRegion.length > 0 ? inRegion : allLocs;

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
  }, [flyToExperienceId, mapRef, locationsByExperience, getExperienceById, clearFlyTo]);

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
