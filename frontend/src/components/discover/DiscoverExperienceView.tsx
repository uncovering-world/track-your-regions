/**
 * DiscoverExperienceView — Persistent map panel + experience list below.
 *
 * The map is always visible. Before a source is selected, it shows a welcome state.
 * When a source is selected, it shows markers for those experiences.
 * When a specific experience is selected, the map zooms to its locations.
 *
 * Hover sync: hovering a card highlights the marker on the map (teal ring).
 * Hovering a marker on the map auto-scrolls the list to center that card.
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  CircularProgress,
  TextField,
  InputAdornment,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import ExploreIcon from '@mui/icons-material/Explore';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Experience } from '../../api/experiences';
import type { ActiveView } from '../../hooks/useDiscoverExperiences';
import { ExperienceCard } from './ExperienceCard';
import { useAuth } from '../../hooks/useAuth';
import { useVisitedExperiences } from '../../hooks/useVisitedExperiences';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { CurationDialog } from '../shared/CurationDialog';
import { AddExperienceDialog } from '../shared/AddExperienceDialog';

const SOURCE_ID = 'experience-markers';
const HIGHLIGHT_SOURCE_ID = 'highlight-markers';
const HOVER_SOURCE_ID = 'hover-marker';

interface DiscoverExperienceViewProps {
  activeView: ActiveView | null;
  experiences: Experience[];
  isLoading: boolean;
  onBack: () => void;
  onSelectExperience: (id: number) => void;
  selectedExperienceId: number | null;
  /** Locations of the selected experience, for map fly-to */
  selectedExperienceLocations: { id?: number; lng: number; lat: number; name?: string }[] | null;
  /** External hover coordinates (e.g. from detail panel location list) */
  externalHoverCoords?: { lng: number; lat: number } | null;
  /** Called when hovering a highlight dot (red location marker) on the map */
  onHoverHighlightLocation?: (locationId: number | null) => void;
}

export function DiscoverExperienceView({
  activeView,
  experiences,
  isLoading,
  onBack,
  onSelectExperience,
  selectedExperienceId,
  selectedExperienceLocations,
  externalHoverCoords,
  onHoverHighlightLocation,
}: DiscoverExperienceViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { isAuthenticated, isCurator } = useAuth();
  const { visitedIds, markVisited, unmarkVisited } = useVisitedExperiences();
  const [search, setSearch] = useState('');

  // Curator state
  const [curationTarget, setCurationTarget] = useState<Experience | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Check if any experiences have is_rejected field (indicates curator has scope)
  const hasCuratorScope = isCurator && experiences.some((exp) => exp.is_rejected !== undefined);

  // Count rejected for header info
  const rejectedCount = useMemo(
    () => experiences.filter((exp) => exp.is_rejected).length,
    [experiences],
  );

  // ── Hover sync state ──
  const [hoveredExperienceId, setHoveredExperienceId] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    name: string; imageUrl: string | null; sourceName: string;
  } | null>(null);
  const hoverSourceRef = useRef<'list' | 'map' | null>(null);
  const isAutoScrollingRef = useRef(false);
  const cardRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Refs for accessing latest values in long-lived callbacks
  const selectedLocsRef = useRef(selectedExperienceLocations);
  selectedLocsRef.current = selectedExperienceLocations;
  const experiencesRef = useRef(experiences);
  experiencesRef.current = experiences;

  // Ref callback for map hover → React state (used inside map init effect)
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
          sourceName: exp.source_name || '',
        });
      }
    } else {
      setHoverPreview(null);
    }
  };

  // Ref callback for highlight-point hover → location list scroll
  const highlightHoverCallbackRef = useRef<(locationId: number | null) => void>(() => {});
  highlightHoverCallbackRef.current = (locationId: number | null) => {
    onHoverHighlightLocation?.(locationId);
  };

  const shortSourceName = activeView
    ? activeView.sourceName
        .replace('UNESCO World Heritage Sites', 'UNESCO')
        .replace('Top Museums', 'Museums')
        .replace('Public Art & Monuments', 'Public Art')
    : '';

  // Client-side search filtering
  const filteredExperiences = useMemo(() => {
    if (!search) return experiences;
    const lower = search.toLowerCase();
    return experiences.filter(
      (exp) =>
        exp.name.toLowerCase().includes(lower) ||
        exp.country_names?.some((c) => c.toLowerCase().includes(lower)),
    );
  }, [experiences, search]);

  // Reset search when active view changes
  useEffect(() => {
    setSearch('');
  }, [activeView?.regionId, activeView?.sourceId]);

  // ── Map init (once) ──
  useEffect(() => {
    if (!mapContainerRef.current) return;

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
    let mapCurrentHoveredId: number | null = null;

    map.on('load', () => {
      // ── Sources ──
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 50,
        promoteId: 'id',
      });

      map.addSource(HIGHLIGHT_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource(HOVER_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // ── Layers (order matters: bottom → top) ──

      // Cluster circles
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
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
      });

      // Cluster count labels
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 11,
          'text-font': ['Open Sans Bold'],
        },
        paint: { 'text-color': '#ffffff' },
      });

      // Individual markers
      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: SOURCE_ID,
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
      });

      // Multi-location badge background (shows total locations behind marker)
      map.addLayer({
        id: 'unclustered-count-badge-bg',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['all', ['!', ['has', 'point_count']], ['>', ['coalesce', ['get', 'locationCount'], 1], 1]],
        paint: {
          'circle-color': '#0f172a',
          'circle-radius': 8,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-translate': [8, -8],
          'circle-translate-anchor': 'viewport',
        },
      });

      map.addLayer({
        id: 'unclustered-count-badge-text',
        type: 'symbol',
        source: SOURCE_ID,
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
      });

      // Hover glow (soft orange fill behind the ring — visible even on clusters)
      map.addLayer({
        id: 'hover-glow',
        type: 'circle',
        source: HOVER_SOURCE_ID,
        paint: {
          'circle-color': '#f97316',
          'circle-radius': ['coalesce', ['get', 'hoverRadius'], 24],
          'circle-opacity': 0.18,
          'circle-blur': 0.6,
        },
      });

      // Hover ring (bright orange, prominent)
      map.addLayer({
        id: 'hover-ring',
        type: 'circle',
        source: HOVER_SOURCE_ID,
        paint: {
          'circle-color': 'transparent',
          'circle-radius': ['coalesce', ['get', 'ringRadius'], 18],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#f97316',
          'circle-stroke-opacity': 1,
        },
      });

      // Highlight markers (red ring for selected experience locations)
      map.addLayer({
        id: 'highlight-ring',
        type: 'circle',
        source: HIGHLIGHT_SOURCE_ID,
        paint: {
          'circle-color': 'transparent',
          'circle-radius': 14,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ef4444',
          'circle-stroke-opacity': 0.8,
        },
      });
      map.addLayer({
        id: 'highlight-point',
        type: 'circle',
        source: HIGHLIGHT_SOURCE_ID,
        paint: {
          'circle-color': '#ef4444',
          'circle-radius': 6,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      // ── Cluster click → zoom ──
      map.on('click', 'clusters', async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({
          center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });

      // ── Marker click → select experience ──
      const interactiveMarkerLayers = ['unclustered-point', 'unclustered-count-badge-bg', 'unclustered-count-badge-text'];
      const onMarkerClick = (e: maplibregl.MapLayerMouseEvent) => {
        const features = map.queryRenderedFeatures(e.point, { layers: interactiveMarkerLayers });
        if (features.length > 0) {
          const id = features[0].properties?.id;
          if (id != null) onSelectExperience(id);
        }
      };
      map.on('click', 'unclustered-point', onMarkerClick);
      map.on('click', 'unclustered-count-badge-bg', onMarkerClick);
      map.on('click', 'unclustered-count-badge-text', onMarkerClick);

      // ── Marker hover (mousemove for precise tracking with nearby points) ──
      const onMarkerMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const features = map.queryRenderedFeatures(e.point, { layers: interactiveMarkerLayers });
        if (features.length > 0) {
          const feature = features[0];
          const id = feature.properties?.id as number;
          const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

          if (id !== mapCurrentHoveredId) {
            mapCurrentHoveredId = id;

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

      const onMarkerMouseLeave = () => {
        map.getCanvas().style.cursor = '';
        mapCurrentHoveredId = null;

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ResizeObserver: call map.resize() when container changes ──
  useEffect(() => {
    const container = mapContainerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      map.resize();
      // After resize settles, re-center on selected experience locations
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const locs = selectedLocsRef.current;
        if (locs && locs.length > 0) {
          if (locs.length === 1) {
            map.easeTo({ center: [locs[0].lng, locs[0].lat], duration: 400 });
          } else {
            const bounds = new maplibregl.LngLatBounds();
            for (const l of locs) bounds.extend([l.lng, l.lat]);
            map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 400 });
          }
        }
      }, 250);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearTimeout(debounceTimer);
    };
  }, []);

  // ── Update experience markers when experiences or selection changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateData = () => {
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      // Hide selected experience's main marker — its locations are shown as highlight dots
      // Also exclude rejected experiences from map markers
      const visibleExperiences = experiences.filter(exp =>
        !exp.is_rejected && (selectedExperienceId == null || exp.id !== selectedExperienceId)
      );

      const features: GeoJSON.Feature<GeoJSON.Point>[] = visibleExperiences.map((exp) => ({
        type: 'Feature',
        id: exp.id,
        geometry: { type: 'Point', coordinates: [exp.longitude, exp.latitude] },
        properties: {
          id: exp.id,
          name: exp.name,
          category: exp.category || '',
          locationCount: Math.max(1, exp.location_count ?? 1),
        },
      }));

      source.setData({ type: 'FeatureCollection', features });

      // Fit bounds only if no experience is selected (to not interrupt detail view)
      if (features.length > 0 && !selectedExperienceId) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of features) {
          bounds.extend(f.geometry.coordinates as [number, number]);
        }
        map.fitBounds(bounds, { padding: 40, maxZoom: 10, duration: 800 });
      }
    };

    if (map.getSource(SOURCE_ID)) {
      updateData();
    } else {
      map.on('load', updateData);
    }
  }, [experiences, selectedExperienceId]);

  // ── Update highlight markers + delayed flyTo ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateHighlight = () => {
      const source = map.getSource(HIGHLIGHT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      if (selectedExperienceLocations && selectedExperienceLocations.length > 0) {
        const features: GeoJSON.Feature<GeoJSON.Point>[] = selectedExperienceLocations.map((loc, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
          properties: { name: loc.name || `Location ${i + 1}`, locationId: loc.id ?? i },
        }));
        source.setData({ type: 'FeatureCollection', features });
      } else {
        source.setData({ type: 'FeatureCollection', features: [] });
      }
    };

    if (map.getSource(HIGHLIGHT_SOURCE_ID)) {
      updateHighlight();
    } else {
      map.on('load', updateHighlight);
    }

    // Delayed flyTo — waits for panel CSS transition to complete before centering
    const flyTimer = setTimeout(() => {
      if (selectedExperienceLocations && selectedExperienceLocations.length > 0) {
        if (selectedExperienceLocations.length === 1) {
          map.flyTo({
            center: [selectedExperienceLocations[0].lng, selectedExperienceLocations[0].lat],
            zoom: Math.max(map.getZoom(), 8),
            duration: 800,
          });
        } else {
          const bounds = new maplibregl.LngLatBounds();
          for (const l of selectedExperienceLocations) bounds.extend([l.lng, l.lat]);
          map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 800 });
        }
      }
    }, 350);

    return () => clearTimeout(flyTimer);
  }, [selectedExperienceLocations]);

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
  }, [externalHoverCoords]);

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

    const coords: [number, number] = [exp.longitude, exp.latitude];

    // Check if the point is visible as an unclustered marker
    const screenPoint = map.project(coords);
    const nearby = map.queryRenderedFeatures(
      [
        [screenPoint.x - 5, screenPoint.y - 5],
        [screenPoint.x + 5, screenPoint.y + 5],
      ],
      { layers: ['unclustered-point'] },
    );
    const isUnclustered = nearby.some(f => f.properties?.id === expId);

    if (isUnclustered) {
      // Point is visible — highlight at its location
      hoverSource.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords },
          properties: {},
        }],
      });
    } else {
      // Point is inside a cluster — find it and highlight the cluster
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const clusterFeatures = map.queryRenderedFeatures(undefined, { layers: ['clusters'] });

      // Search clusters for the one containing our experience
      let found = false;
      let remaining = clusterFeatures.length;
      if (remaining === 0) {
        // No clusters visible — fall back to raw coords
        hoverSource.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }],
        });
        return;
      }

      for (const cluster of clusterFeatures) {
        const clusterId = cluster.properties.cluster_id;
        const pointCount = cluster.properties.point_count;
        source.getClusterLeaves(clusterId, pointCount, 0).then(leaves => {
          if (!found && leaves.some(leaf => leaf.properties?.id === expId)) {
            found = true;
            const clusterCoords = (cluster.geometry as GeoJSON.Point).coordinates;
            // Compute visual radius from the cluster's rendered size
            const clusterRadius: number = pointCount < 10 ? 14 : pointCount < 30 ? 18 : pointCount < 100 ? 22 : 26;
            hoverSource.setData({
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
            // Experience not found in any cluster — fall back to raw coords
            hoverSource.setData({
              type: 'FeatureCollection',
              features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }],
            });
          }
        });
      }
    }
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (hoverSourceRef.current !== 'list') return;
    hoverSourceRef.current = null;
    setHoveredExperienceId(null);

    const map = mapRef.current;
    if (!map) return;
    const hoverSource = map.getSource(HOVER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (hoverSource) {
      hoverSource.setData({ type: 'FeatureCollection', features: [] });
    }
  }, []);

  const handleVisitedToggle = useCallback(
    (experienceId: number, isVisited: boolean, e: React.MouseEvent) => {
      e.stopPropagation();
      if (isVisited) {
        unmarkVisited(experienceId);
      } else {
        markVisited(experienceId);
      }
    },
    [markVisited, unmarkVisited],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Map — always visible, takes remaining height */}
      <Box sx={{ flex: activeView ? '0 0 45%' : 1, minHeight: 200, position: 'relative' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        {/* Loading overlay */}
        {isLoading && activeView && (
          <Box sx={{ position: 'absolute', top: 8, left: 8, bgcolor: 'background.paper', borderRadius: 1, px: 1.5, py: 0.5, boxShadow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption">Loading...</Typography>
          </Box>
        )}
        {/* Default state overlay when no source is selected */}
        {!activeView && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Box sx={{ textAlign: 'center', bgcolor: 'rgba(255,255,255,0.9)', borderRadius: 2, px: 4, py: 3, boxShadow: 2 }}>
              <ExploreIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                Select a category in the tree
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Click a source tag (e.g. UNESCO 42) to see experiences on the map
              </Typography>
            </Box>
          </Box>
        )}
        {/* Hover preview card (map marker hover) */}
        {hoverPreview && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 3,
              width: 260,
              maxWidth: 'calc(100% - 24px)',
              backgroundColor: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: '0 10px 30px rgba(0,0,0,0.20)',
              pointerEvents: 'none',
              animation: 'tyrDiscoverHoverIn 170ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            {hoverPreview.imageUrl && (
              <Box
                component="img"
                src={hoverPreview.imageUrl}
                alt={hoverPreview.name}
                sx={{
                  width: '100%',
                  maxHeight: 180,
                  objectFit: 'contain',
                  display: 'block',
                  backgroundColor: 'grey.100',
                }}
              />
            )}
            <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                {hoverPreview.name}
              </Typography>
              {hoverPreview.sourceName && (
                <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.85 }} noWrap>
                  {hoverPreview.sourceName}
                </Typography>
              )}
            </Box>
          </Box>
        )}
        <style>{`
          @keyframes tyrDiscoverHoverIn {
            from { opacity: 0; transform: translateY(8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </Box>

      {/* Experience list (below map, only when active view) */}
      {activeView && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderTop: '1px solid', borderColor: 'divider', minHeight: 0 }}>
          {/* List header with back button */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <IconButton size="small" onClick={onBack}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                {shortSourceName} in {activeView.regionName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {isLoading ? 'Loading...' : `${filteredExperiences.length}${search ? ` of ${experiences.length}` : ''} experiences`}
                {hasCuratorScope && rejectedCount > 0 && (
                  <Typography component="span" variant="caption" color="error.main">
                    {' '}({rejectedCount} rejected)
                  </Typography>
                )}
              </Typography>
            </Box>
            {hasCuratorScope && activeView?.regionId && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlaylistAddIcon />}
                onClick={() => setAddDialogOpen(true)}
                sx={{ flexShrink: 0, mr: 0.5 }}
              >
                Add
              </Button>
            )}
          </Box>

          {/* Search (only for 15+ experiences) */}
          {experiences.length > 15 && (
            <Box sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
              <TextField
                size="small"
                placeholder="Filter by name or country..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                fullWidth
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearch('')}>
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />
            </Box>
          )}

          {/* Scrollable experience list */}
          <Box ref={listContainerRef} sx={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : filteredExperiences.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {search ? 'No experiences match your filter.' : 'No experiences found.'}
                </Typography>
              </Box>
            ) : (
              filteredExperiences.map((exp) => (
                <ExperienceCard
                  key={exp.id}
                  ref={(el) => {
                    if (el) cardRefsMap.current.set(exp.id, el);
                    else cardRefsMap.current.delete(exp.id);
                  }}
                  experience={exp}
                  isVisited={visitedIds.has(exp.id)}
                  isHovered={hoveredExperienceId === exp.id}
                  isSelected={selectedExperienceId === exp.id}
                  onClick={() => onSelectExperience(exp.id)}
                  onMouseEnter={() => handleCardMouseEnter(exp.id)}
                  onMouseLeave={handleCardMouseLeave}
                  onVisitedToggle={(e) => handleVisitedToggle(exp.id, visitedIds.has(exp.id), e)}
                  showCheckbox={isAuthenticated}
                  compact
                  onCurate={hasCuratorScope ? () => setCurationTarget(exp) : undefined}
                />
              ))
            )}
          </Box>
        </Box>
      )}
      {/* Curation Dialog */}
      <CurationDialog
        experience={curationTarget}
        regionId={activeView?.regionId ?? null}
        onClose={() => setCurationTarget(null)}
      />

      {/* Add Experience Dialog */}
      {activeView?.regionId && (
        <AddExperienceDialog
          open={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          regionId={activeView.regionId}
          regionName={activeView.regionName}
          defaultSourceId={activeView.sourceId}
        />
      )}
    </Box>
  );
}
