/**
 * ExperienceMarkers - MapLibre native GeoJSON cluster markers on the shared react-map-gl Map.
 *
 * Uses react-map-gl's declarative <Source> and <Layer> components.
 *
 * 3 GeoJSON sources:
 *   exp-markers   — clustered source for in-region experience locations
 *   exp-highlight  — non-clustered source for ALL locations of the selected experience (red dots)
 *   exp-hover      — non-clustered source for hover ring/glow (orange)
 *
 * Interaction model (imperative via useMap()):
 *   - Hover marker on map  → popup + orange ring + highlight list item
 *   - Hover card in list   → cluster-aware orange ring on map
 *   - Click marker         → toggle selected experience in list
 *   - Click cluster        → zoom to expansion zoom
 *   - Click list item      → fly-to marker location(s)
 */

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useMap, Source, Layer } from 'react-map-gl/maplibre';
import { Box } from '@mui/material';
import maplibregl from 'maplibre-gl';
import type { LayerProps } from 'react-map-gl/maplibre';
import { useExperienceContext } from '../hooks/useExperienceContext';
import { useNavigation } from '../hooks/useNavigation';
import { fetchExperienceLocations, type Experience, type ExperienceLocation } from '../api/experiences';

// Source IDs
const SOURCE_MARKERS = 'exp-markers';
const SOURCE_HIGHLIGHT = 'exp-highlight';
const SOURCE_HOVER = 'exp-hover';

// Layer IDs
const LAYER_CLUSTERS = 'exp-clusters';
const LAYER_CLUSTER_COUNT = 'exp-cluster-count';
const LAYER_UNCLUSTERED = 'exp-unclustered';
const LAYER_UNCLUSTERED_COUNT_BADGE_BG = 'exp-unclustered-count-badge-bg';
const LAYER_UNCLUSTERED_COUNT_BADGE_TEXT = 'exp-unclustered-count-badge-text';
const LAYER_HOVER_GLOW = 'exp-hover-glow';
const LAYER_HOVER_RING = 'exp-hover-ring';
const LAYER_HIGHLIGHT_RING = 'exp-highlight-ring';
const LAYER_HIGHLIGHT_POINT = 'exp-highlight-point';

// ── Layer style definitions ──

const clusterLayer: LayerProps = {
  id: LAYER_CLUSTERS,
  type: 'circle',
  source: SOURCE_MARKERS,
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': [
      'step', ['get', 'point_count'],
      '#7dd3c8', 10, '#5ab8aa', 30, '#3d9d8f', 100, '#2a7d72',
    ],
    'circle-radius': [
      'step', ['get', 'point_count'],
      14, 10, 18, 30, 22, 100, 26,
    ],
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
    'circle-opacity': 0.9,
  },
};

const clusterCountLayer: LayerProps = {
  id: LAYER_CLUSTER_COUNT,
  type: 'symbol',
  source: SOURCE_MARKERS,
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    'text-size': 11,
    'text-font': ['Open Sans Bold'],
  },
  paint: { 'text-color': '#ffffff' },
};

const unclusteredLayer: LayerProps = {
  id: LAYER_UNCLUSTERED,
  type: 'circle',
  source: SOURCE_MARKERS,
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-color': [
      'match', ['get', 'category'],
      'cultural', '#8B5CF6',
      'natural', '#10B981',
      'mixed', '#F59E0B',
      '#0d9488',
    ],
    'circle-radius': 6,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  },
};

const unclusteredCountBadgeBgLayer: LayerProps = {
  id: LAYER_UNCLUSTERED_COUNT_BADGE_BG,
  type: 'circle',
  source: SOURCE_MARKERS,
  filter: ['all', ['!', ['has', 'point_count']], ['>', ['coalesce', ['get', 'locationCount'], 1], 1]],
  paint: {
    'circle-color': '#0f172a',
    'circle-radius': 8,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
    'circle-translate': [8, -8],
    'circle-translate-anchor': 'viewport',
  },
};

const unclusteredCountBadgeTextLayer: LayerProps = {
  id: LAYER_UNCLUSTERED_COUNT_BADGE_TEXT,
  type: 'symbol',
  source: SOURCE_MARKERS,
  filter: ['all', ['!', ['has', 'point_count']], ['>', ['coalesce', ['get', 'locationCount'], 1], 1]],
  layout: {
    'text-field': ['to-string', ['get', 'locationCount']],
    'text-size': 9,
    'text-font': ['Open Sans Bold'],
    'text-offset': [0.88, -0.88],
    'text-anchor': 'center',
    'text-allow-overlap': true,
  },
  paint: {
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

interface ExperienceMarkersProps {
  regionId: number | null;
  visitedIds?: Set<number>;
  visitedLocationIds?: Set<number>;
}

/**
 * Flattened marker data — supports both single and multi-location experiences
 */
interface MarkerData {
  id: string;
  experienceId: number;
  locationId: number | null;
  experience: Experience;
  longitude: number;
  latitude: number;
  locationName: string | null;
  locationCount: number;
  isMultiLocation: boolean;
  locationOrdinal: number;
  inRegion: boolean;
}

export function ExperienceMarkers({ regionId }: ExperienceMarkersProps) {
  const { current: mapRef } = useMap();
  const { selectedRegion } = useNavigation();
  const {
    experiences,
    experiencesLoading,
    totalExperiences,
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
    expandedSourceNames,
    setHoverPreview,
  } = useExperienceContext();

  // Track locations with region membership info
  const [locationsByExperience, setLocationsByExperience] = useState<Record<number, ExperienceLocation[]>>({});

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

  // ── Fetch locations for all experiences when region changes ──
  useEffect(() => {
    if (experiences.length === 0 || !regionId) return;

    let cancelled = false;

    const fetchAllLocations = async () => {
      const toFetch = experiences.filter(exp => !locationsByExperience[exp.id]);
      if (toFetch.length === 0) return;

      const results = await Promise.allSettled(
        toFetch.map(async exp => {
          const response = await fetchExperienceLocations(exp.id, regionId);
          return { experienceId: exp.id, locations: response.locations };
        })
      );

      if (cancelled) return;

      const successfulResults = results
        .filter((r): r is PromiseFulfilledResult<{ experienceId: number; locations: ExperienceLocation[] }> =>
          r.status === 'fulfilled'
        )
        .map(r => r.value);

      if (successfulResults.length > 0) {
        setLocationsByExperience(prev => {
          const next = { ...prev };
          successfulResults.forEach(r => {
            next[r.experienceId] = r.locations;
          });
          return next;
        });
      }
    };

    fetchAllLocations();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- locationsByExperience intentionally omitted
  }, [experiences, regionId]);

  // Clear locations cache when region changes
  useEffect(() => {
    setLocationsByExperience({});
  }, [regionId]);

  // ── One marker per experience (primary in-region location), filtered by expanded groups ──
  // Multi-location experiences show all locations via the highlight layer when selected.
  const markers = useMemo<MarkerData[]>(() => {
    const result: MarkerData[] = [];

    for (const exp of experiences.slice(0, 100)) {
      const sourceName = exp.source_name || 'Experiences';
      if (expandedSourceNames.size > 0 && !expandedSourceNames.has(sourceName)) continue;

      const locations = locationsByExperience[exp.id];

      if (locations && locations.length > 0) {
        // Use the first in-region location as the representative point
        const inRegionLocations = locations.filter(loc => loc.in_region !== false);
        const primaryLoc = inRegionLocations[0];
        if (primaryLoc) {
          result.push({
            id: `${exp.id}-${primaryLoc.id}`,
            experienceId: exp.id,
            locationId: primaryLoc.id,
            experience: exp,
            longitude: primaryLoc.longitude,
            latitude: primaryLoc.latitude,
            locationName: primaryLoc.name,
            locationCount: inRegionLocations.length,
            isMultiLocation: locations.length > 1,
            locationOrdinal: primaryLoc.ordinal,
            inRegion: true,
          });
        }
      } else if (!locations) {
        // Locations not yet loaded — use experience's own coordinates
        result.push({
          id: String(exp.id),
          experienceId: exp.id,
          locationId: null,
          experience: exp,
          longitude: exp.longitude,
          latitude: exp.latitude,
          locationName: null,
          locationCount: exp.location_count ?? 1,
          isMultiLocation: false,
          locationOrdinal: 0,
          inRegion: true,
        });
      }
    }

    return result;
  }, [experiences, locationsByExperience, expandedSourceNames]);

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
    if (!locations || locations.length === 0) return EMPTY_FC;

    const inRegion = locations.filter(loc => loc.in_region !== false);
    return {
      type: 'FeatureCollection',
      features: inRegion.map((loc) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [loc.longitude, loc.latitude] },
        properties: {
          locationId: loc.id,
          name: loc.name || `Location ${loc.ordinal + 1}`,
        },
      })),
    };
  }, [selectedExperienceId, locationsByExperience]);

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

    const onClusterClick = async (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTERS] });
      if (!features.length) return;
      const clusterId = features[0].properties.cluster_id;
      const source = map.getSource(SOURCE_MARKERS) as maplibregl.GeoJSONSource;
      if (!source) return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({
        center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
        zoom,
      });
    };

    const onMarkerClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_UNCLUSTERED, LAYER_UNCLUSTERED_COUNT_BADGE_BG, LAYER_UNCLUSTERED_COUNT_BADGE_TEXT],
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
        layers: [LAYER_UNCLUSTERED, LAYER_UNCLUSTERED_COUNT_BADGE_BG, LAYER_UNCLUSTERED_COUNT_BADGE_TEXT],
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
            .setHTML(`<strong>${feature.properties?.name || ''}</strong>`)
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
              sourceName: marker.experience.source_name ?? null,
              category: marker.experience.category ?? null,
              imageUrl: marker.experience.image_url,
              longitude: marker.longitude,
              latitude: marker.latitude,
            });
          }
        }
      }
    };

    const onMarkerMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
      mapCurrentHoveredId = null;
      setHoverData(EMPTY_FC);
      setHoveredRef.current(null, null);
      setHoverPreview(null);
    };

    const onClusterEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onClusterLeave = () => { map.getCanvas().style.cursor = ''; };

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
            .setHTML(`<strong>${name}</strong>`)
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
                sourceName: exp.source_name ?? null,
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

    const onHighlightMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
      mapCurrentHoveredId = null;
      setHoverData(EMPTY_FC);
      setHoveredRef.current(null, null);
      setHoverPreview(null);
    };

    // Wait for layers to exist before attaching handlers
    const attachHandlers = () => {
      if (
        !map.getLayer(LAYER_CLUSTERS) ||
        !map.getLayer(LAYER_UNCLUSTERED) ||
        !map.getLayer(LAYER_UNCLUSTERED_COUNT_BADGE_BG) ||
        !map.getLayer(LAYER_UNCLUSTERED_COUNT_BADGE_TEXT)
      ) {
        return false;
      }
      map.on('click', LAYER_CLUSTERS, onClusterClick);
      map.on('click', LAYER_UNCLUSTERED, onMarkerClick);
      map.on('click', LAYER_UNCLUSTERED_COUNT_BADGE_BG, onMarkerClick);
      map.on('click', LAYER_UNCLUSTERED_COUNT_BADGE_TEXT, onMarkerClick);
      map.on('mousemove', LAYER_UNCLUSTERED, onMarkerMouseMove);
      map.on('mousemove', LAYER_UNCLUSTERED_COUNT_BADGE_BG, onMarkerMouseMove);
      map.on('mousemove', LAYER_UNCLUSTERED_COUNT_BADGE_TEXT, onMarkerMouseMove);
      map.on('mouseleave', LAYER_UNCLUSTERED, onMarkerMouseLeave);
      map.on('mouseleave', LAYER_UNCLUSTERED_COUNT_BADGE_BG, onMarkerMouseLeave);
      map.on('mouseleave', LAYER_UNCLUSTERED_COUNT_BADGE_TEXT, onMarkerMouseLeave);
      map.on('mouseenter', LAYER_CLUSTERS, onClusterEnter);
      map.on('mouseleave', LAYER_CLUSTERS, onClusterLeave);
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
      map.off('click', LAYER_CLUSTERS, onClusterClick);
      map.off('click', LAYER_UNCLUSTERED, onMarkerClick);
      map.off('click', LAYER_UNCLUSTERED_COUNT_BADGE_BG, onMarkerClick);
      map.off('click', LAYER_UNCLUSTERED_COUNT_BADGE_TEXT, onMarkerClick);
      map.off('mousemove', LAYER_UNCLUSTERED, onMarkerMouseMove);
      map.off('mousemove', LAYER_UNCLUSTERED_COUNT_BADGE_BG, onMarkerMouseMove);
      map.off('mousemove', LAYER_UNCLUSTERED_COUNT_BADGE_TEXT, onMarkerMouseMove);
      map.off('mouseleave', LAYER_UNCLUSTERED, onMarkerMouseLeave);
      map.off('mouseleave', LAYER_UNCLUSTERED_COUNT_BADGE_BG, onMarkerMouseLeave);
      map.off('mouseleave', LAYER_UNCLUSTERED_COUNT_BADGE_TEXT, onMarkerMouseLeave);
      map.off('mouseenter', LAYER_CLUSTERS, onClusterEnter);
      map.off('mouseleave', LAYER_CLUSTERS, onClusterLeave);
      map.off('mousemove', LAYER_HIGHLIGHT_POINT, onHighlightMouseMove);
      map.off('mouseleave', LAYER_HIGHLIGHT_POINT, onHighlightMouseLeave);
    };
  }, [mapRef, getExperienceById, setHoverPreview]);

  // ── List hover → cluster-aware hover ring on map ──
  const locationsByExpRef = useRef(locationsByExperience);
  locationsByExpRef.current = locationsByExperience;

  const updateHoverFromList = useCallback((expId: number | null, locId: number | null) => {
    if (!mapRef) return;
    const map = mapRef.getMap();
    if (!map) return;

    if (expId == null) {
      setHoverData(EMPTY_FC);
      setHoverPreview(null);
      return;
    }

    // If a specific location is hovered (from expanded experience), place ring directly
    // — the point is on the highlight layer, not in the clustered markers source
    if (locId != null) {
      const locations = locationsByExpRef.current[expId];
      const loc = locations?.find(l => l.id === locId);
      if (loc) {
        const exp = getExperienceById(expId);
        if (exp) {
          setHoverPreview({
            experienceId: exp.id,
            experienceName: exp.name,
            locationId: loc.id,
            locationName: loc.name || `Location ${loc.ordinal + 1}`,
            sourceName: exp.source_name ?? null,
            category: exp.category ?? null,
            imageUrl: exp.image_url,
            longitude: loc.longitude,
            latitude: loc.latitude,
          });
        }
        setHoverData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [loc.longitude, loc.latitude] },
            properties: {},
          }],
        });
        return;
      }
    }

    // Experience-level hover — find the primary marker
    const marker = markersRef.current.find(m => m.experienceId === expId);
    if (!marker) return;
    setHoverPreview({
      experienceId: marker.experienceId,
      experienceName: marker.experience.name,
      locationId: marker.locationId,
      locationName: marker.locationName,
      sourceName: marker.experience.source_name ?? null,
      category: marker.experience.category ?? null,
      imageUrl: marker.experience.image_url,
      longitude: marker.longitude,
      latitude: marker.latitude,
    });
    const coords: [number, number] = [marker.longitude, marker.latitude];

    // Check if the point is visible as an unclustered marker
    const screenPoint = map.project(new maplibregl.LngLat(coords[0], coords[1]));
    const nearby = map.queryRenderedFeatures(
      [
        [screenPoint.x - 5, screenPoint.y - 5],
        [screenPoint.x + 5, screenPoint.y + 5],
      ],
      { layers: map.getLayer(LAYER_UNCLUSTERED) ? [LAYER_UNCLUSTERED] : [] },
    );
    const isUnclustered = nearby.some(f => f.properties?.experienceId === expId);

    if (isUnclustered) {
      setHoverData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords },
          properties: {},
        }],
      });
    } else {
      // Point is inside a cluster — find the containing cluster
      const mainSource = map.getSource(SOURCE_MARKERS) as maplibregl.GeoJSONSource | undefined;
      if (!mainSource) return;

      const clusterFeatures = map.getLayer(LAYER_CLUSTERS)
        ? map.queryRenderedFeatures(undefined, { layers: [LAYER_CLUSTERS] })
        : [];

      let found = false;
      let remaining = clusterFeatures.length;
      if (remaining === 0) {
        setHoverData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }],
        });
        return;
      }

      for (const cluster of clusterFeatures) {
        const clusterId = cluster.properties.cluster_id;
        const pointCount = cluster.properties.point_count;
        mainSource.getClusterLeaves(clusterId, pointCount, 0).then(leaves => {
          if (!found && leaves.some(leaf => leaf.properties?.experienceId === expId)) {
            found = true;
            const clusterCoords = (cluster.geometry as GeoJSON.Point).coordinates;
            const clusterRadius: number = pointCount < 10 ? 14 : pointCount < 30 ? 18 : pointCount < 100 ? 22 : 26;
            setHoverData({
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: clusterCoords },
                properties: { hoverRadius: clusterRadius + 10, ringRadius: clusterRadius + 4 },
              }],
            });
          }
          remaining--;
          if (remaining === 0 && !found) {
            setHoverData({
              type: 'FeatureCollection',
              features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }],
            });
          }
        });
      }
    }
  }, [mapRef, getExperienceById, setHoverPreview]);

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
      const inRegionLocs = locations?.filter(loc => loc.in_region !== false) ?? [];

      if (inRegionLocs.length > 1) {
        const lngs = inRegionLocs.map(loc => loc.longitude);
        const lats = inRegionLocs.map(loc => loc.latitude);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 80, duration: 800, maxZoom: 12 }
        );
      } else if (inRegionLocs.length === 1) {
        map.flyTo({
          center: [inRegionLocs[0].longitude, inRegionLocs[0].latitude],
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

  const showLimitIndicator = totalExperiences > 100;

  return (
    <>
      {/* Main clustered markers source */}
      <Source
        id={SOURCE_MARKERS}
        type="geojson"
        data={markersGeoJson}
        cluster={true}
        clusterMaxZoom={12}
        clusterRadius={50}
      >
        <Layer {...clusterLayer} />
        <Layer {...clusterCountLayer} />
        <Layer {...unclusteredLayer} />
        <Layer {...unclusteredCountBadgeBgLayer} />
        <Layer {...unclusteredCountBadgeTextLayer} />
      </Source>

      {/* Highlight source — selected experience locations (red dots/rings) */}
      <Source id={SOURCE_HIGHLIGHT} type="geojson" data={highlightGeoJson}>
        <Layer {...highlightRingLayer} />
        <Layer {...highlightPointLayer} />
      </Source>

      {/* Hover source — orange ring/glow on hovered marker or cluster */}
      <Source id={SOURCE_HOVER} type="geojson" data={hoverData}>
        <Layer {...hoverGlowLayer} />
        <Layer {...hoverRingLayer} />
      </Source>

      {/* Limit indicator */}
      {showLimitIndicator && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'rgba(0,0,0,0.6)',
            color: 'white',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            fontSize: '0.75rem',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          Showing 100 of {totalExperiences} sites
        </Box>
      )}

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
