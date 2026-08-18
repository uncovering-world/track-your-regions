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
import type { Experience } from '../../api/experiences';
import type { ActiveView } from '../../hooks/useDiscoverExperiences';
import { useRegionLocations } from '../../hooks/useRegionLocations';
import { useCollapsedExperiences } from '../../hooks/useCollapsedExperiences';
import { buildExperienceMarkers, representablePlaces } from '../experienceMarkers/buildMarkers';
import { FoldPlacesControl } from '../experienceMarkers/FoldPlacesControl';

/** Discover shows one category at a time, so the builder's filter has nothing to do. */
const NO_CATEGORY_FILTER: Set<string> = new Set();
import { ExperienceCard } from './ExperienceCard';
import { useAuth } from '../../hooks/useAuth';
import { useNewBadgeImpressions } from '../../hooks/useNewBadgeImpressions';
import { useVisitedExperiences } from '../../hooks/useVisitedExperiences';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { CurationDialog } from '../shared/CurationDialog';
import { AddExperienceDialog } from '../shared/AddExperienceDialog';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { EmptyState } from '../shared/EmptyState';
import { MapUnavailable } from '../shared/MapUnavailable';
import { isWebGLAvailable } from '../../utils/webgl';

// Stable identity: an inline [] would be a new array every render, and the
// impression effect keys off the array it is given.
const EMPTY_EXPERIENCES: Experience[] = [];

import {
  addDiscoverMapLayers, clusterRadiusFor, SOURCE_ID, HIGHLIGHT_SOURCE_ID, HOVER_SOURCE_ID,
} from './discoverMapLayers';


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

interface DiscoverExperienceViewProps {
  activeView: ActiveView | null;
  experiences: Experience[];
  isLoading: boolean;
  onBack: () => void;
  onSelectExperience: (id: number) => void;
  selectedExperienceId: number | null;
  /** Locations of the selected experience, for map fly-to */
  selectedExperienceLocations: { id?: number; lng: number; lat: number; name?: string }[] | null;
  /** That fetch has answered, so the set above is real rather than the fallback. */
  selectedLocationsResolved: boolean;
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
  selectedLocationsResolved,
  externalHoverCoords,
  onHoverHighlightLocation,
}: DiscoverExperienceViewProps) {
  // A batch of its own, and deliberately: `includeChildren` is part of the query
  // key, and Map mode passes `false`, so this is a second, larger answer rather
  // than the one already in cache. It has to be — Discover reads a region *and
  // its descendants* (`useDiscoverExperiences`), and a batch fetched without them
  // leaves every object assigned to a descendant region, which is what a curator's
  // hand assignment writes, with no places at all: drawn as the single stand-in
  // pin this whole change exists to remove.
  const { locationsByExperience, locationsResolved } =
    useRegionLocations(activeView?.regionId ?? null, false, true);
  // Discover holds its own folds: it is a separate reading of the region, and a
  // fold is about what this reader is looking at now rather than a preference.
  const { collapsedExperienceIds, toggleCollapsedExperience } =
    useCollapsedExperiences(activeView?.regionId ?? null);

  /** Set when the reader themself moved the map — see the fit below. */
  const movedByReaderRef = useRef(false);
  /**
   * The object whose selection came from a click on the map rather than the list.
   *
   * An id rather than a flag, because this effect runs twice for one map click —
   * the fallback point first, the real places when the per-id fetch resolves — and
   * a boolean is consumed by whichever timer fires first. Slower than 350 ms and
   * the first timer ate the flag while the second framed all forty places; faster,
   * and a stale `true` swallowed the next list click, which is the one that must
   * re-frame.
   */
  const selectedFromMapIdRef = useRef<number | null>(null);
  /** The object this map last flew to, so a redraw of the same one does not. */
  const flownForRef = useRef<number | null>(null);
  /**
   * Bumped by every card hover and every leave, so an answer that arrives late
   * can tell whether the hover it belongs to is still the current one.
   */
  const hoverGenerationRef = useRef(0);
  /** The selection those two marks were made for — see the effect that clears them. */
  const flySelectionRef = useRef<number | null>(null);
  /** The current folded selection, read by the once-created hover callback. */
  const foldedSelectionRef = useRef<{ longitude: number; latitude: number } | null>(null);

  /**
   * What the fold control offers to fold: the places this surface draws for the
   * selected object — which is not the same set the marker source uses.
   *
   * Discover draws a selected object from its own per-experience fetch, every
   * location it has, unfiltered by region; the marker source draws the region
   * batch's representable places. Counting the batch here would have offered no
   * control at all for an object with forty places of which one falls in this
   * region — the reader looking at forty dots, which is exactly the sprawl the
   * fold exists for — and said "Show all 12 places" where unfolding draws 40.
   */
  const drawnPlacesOfSelected = selectedExperienceLocations && selectedExperienceLocations.length > 0
    ? selectedExperienceLocations.length
    : representablePlaces(locationsByExperience[selectedExperienceId ?? -1]).length;
  const placesOfSelected = selectedExperienceId == null ? 0 : drawnPlacesOfSelected;

  /**
   * Where an object is drawn, for the hover ring: its places, or the one point it
   * is drawn as when folded or when the batch holds none of them. Held in a ref
   * because `handleCardMouseEnter` is a long-lived callback and a fold taken a
   * moment ago must be what it rings.
   */
  const drawnCoordsRef = useRef((_expId: number): [number, number][] => []);
  drawnCoordsRef.current = (expId: number): [number, number][] => {
    const exp = experiences.find(e => e.id === expId);
    const own: [number, number][] = exp ? [[exp.longitude, exp.latitude]] : [];
    // A selected object is not drawn from the region batch here — it leaves the
    // marker source and the highlight layer draws it from the per-experience
    // fetch, every place it has. Ringing the batch's set for it would mark one of
    // forty dots, which is the thing this ring exists to stop. Folded, that layer
    // draws the object's own coordinate, so the ring has to go there too: the
    // batch would answer with the in-region place, which for an object whose
    // places are mostly elsewhere is a different point entirely.
    if (expId === selectedExpIdRef.current && selectedExperienceLocations
        && selectedExperienceLocations.length > 0) {
      if (foldedSelectionRef.current) return own;
      return selectedExperienceLocations.map(loc => [loc.lng, loc.lat] as [number, number]);
    }
    const representable = representablePlaces(locationsByExperience[expId]);
    // Folded only counts where folding is a question: one drawn place is one pin
    // either way, and the marker source would keep drawing it there.
    if (representable.length > 1 && collapsedExperienceIds.has(expId)) return own;
    if (representable.length === 0) return own;
    return representable.map(loc => [loc.longitude, loc.latitude] as [number, number]);
  };

  /**
   * The selected object when this reader has folded it — the one point it is
   * then drawn at, which is the coordinate the catalogue answers with (ADR-0028
   * decision 2) rather than a centre derived here.
   */
  const foldedSelection = useMemo(() => {
    if (selectedExperienceId == null || !collapsedExperienceIds.has(selectedExperienceId)) return null;
    // The same test the control applies, on the same set it counts: one drawn
    // place is one pin either way, and folding it would say something the map
    // cannot show.
    if (placesOfSelected < 2) return null;
    const exp = experiences.find(e => e.id === selectedExperienceId);
    return exp ? { longitude: exp.longitude, latitude: exp.latitude, name: exp.name } : null;
  }, [selectedExperienceId, collapsedExperienceIds, experiences, placesOfSelected]);
  foldedSelectionRef.current = foldedSelection;

  /** The experiences array this map last framed, so a redraw does not re-frame. */
  const fittedForRef = useRef<Experience[] | null>(null);
  /** What was selected on the previous run, to tell a deselection from a redraw. */
  const lastSelectedRef = useRef<number | null>(null);
  /** Whether the frame this map is holding was drawn with the places in hand. */
  const fittedWithPlacesRef = useRef(false);
  /** The current selection, for the card-hover callback that is created once. */
  const selectedExpIdRef = useRef<number | null>(selectedExperienceId);
  selectedExpIdRef.current = selectedExperienceId;

  // Read by the map's long-lived click handler, which is registered once.
  const toggleCollapsedRef = useRef(toggleCollapsedExperience);
  toggleCollapsedRef.current = toggleCollapsedExperience;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { isAuthenticated, isCurator, user } = useAuth();
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
    name: string; imageUrl: string | null; categoryName: string;
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
          categoryName: exp.category_name || '',
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

  // Not `utils/categoryColors.shortSourceName`: this heading has room for
  // "Public Art" where a chip does not, and the shared one shortens that to
  // "Art". The museum name is kept in step with it by hand.
  const shortSourceName = activeView
    ? activeView.categoryName
        .replace('UNESCO World Heritage Sites', 'UNESCO')
        .replace('Top Art Museums', 'Art Museums')
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

  // Discover renders the same cards from the same response, so a chip shown
  // here is an impression exactly as one in Map mode is. Reporting from only
  // one surface would make a reader's week start whenever they happened to use
  // that one.
  //
  // Reported from the filtered set and behind the loading gate — the same two
  // conditions the card list renders under (below), rather than from the whole
  // response. Today the two coincide: the query is `enabled` only with an
  // active view, `isLoading` is false whenever there is data to render, and
  // search only ever narrows a set already reported. But that is three separate
  // facts staying true, and the cost of getting it wrong is not recoverable —
  // the server keeps the first impression, so a row stamped while unrendered
  // spends the reader's week without them.
  useNewBadgeImpressions(
    isLoading ? EMPTY_EXPERIENCES : filteredExperiences, isAuthenticated, user?.id);

  // Reset search when active view changes
  useEffect(() => {
    setSearch('');
  }, [activeView?.regionId, activeView?.categoryId]);

  // ── Map init (once) ──
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
        // A folded object is one point here as well. This is the fifth path that
        // moves the camera for a selection, and framing every place of an object
        // the reader asked to see as one pin would answer a window resize by
        // spreading it back across three provinces.
        const folded = foldedSelectionRef.current;
        if (folded) {
          map.easeTo({ center: [folded.longitude, folded.latitude], duration: 400 });
          return;
        }
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

      // One point per place a reader may go to, through the same builder Map mode
      // uses so the two surfaces cannot disagree about what an object is
      // (ADR-0028 decision 1, #558). Clusters of places are the honest thing to
      // cluster: a cluster of property locators counted sites nobody could visit.
      const markers = buildExperienceMarkers(
        visibleExperiences, locationsByExperience, NO_CATEGORY_FILTER, collapsedExperienceIds);

      // No feature-level `id`: it used to be the experience's, which now repeats
      // across every one of its places, and nothing here reads it — clustering
      // does not need one, and the handlers below resolve an object through
      // `properties.id`.
      const features: GeoJSON.Feature<GeoJSON.Point>[] = markers.map((m) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.longitude, m.latitude] },
        properties: {
          id: m.experienceId,
          locationId: m.locationId,
          // No `name` here: nothing on this surface reads it. The hover card
          // resolves the object through `properties.id`, and the layer
          // expressions read `category`, `locationCount` and `point_count`.
          // `id` stays the object's, which is what the handlers ask for.
          category: m.experience.category || '',
          // 1 for a place drawn as itself, the count only for a pin standing in
          // for places it does not draw — which is what the badge means.
          locationCount: m.locationCount,
          // Whether this pin was drawn folded, which the click handler needs and
          // cannot infer: a stand-in pin looks the same from the outside.
          folded: m.folded === true,
        },
      }));

      source.setData({ type: 'FeatureCollection', features });

      // Fit to a *new* set, not to every rebuild of one. The fold rebuilds these
      // markers, and unfolding by clicking a folded pin selects nothing — so a
      // fit gated only on "nothing selected" answered that click by animating out
      // to the whole region: a reader zoomed into Aragón to look at the rock art
      // clicked the pin to see its parts and was thrown back to Europe. The batch
      // arriving is the milder version, two 800 ms animations where one belongs.
      //
      // The batch is not waited on, because `locationsResolved` is `data != null`
      // — false while it is pending and false *forever* if it fails, which would
      // leave a region's pins as specks at the initial world view with no way
      // back. So the set is framed as soon as it is drawn, and framed once more
      // when the places arrive: two animations on first load of a view rather
      // than a map that may never frame at all.
      //
      // Closing a detail panel still re-frames the region, which is the one other
      // thing this fit was doing: that is a reader saying "show me the set again",
      // and dropping it with the fold would have been collateral.
      const isNewSet = fittedForRef.current !== experiences;
      // The second fit waits on a separate, slower query, and the map is fully
      // interactive meanwhile — so it loses to a reader who has already moved it.
      // A new set still frames: that is a new region, and nothing on screen is
      // theirs to keep.
      const firstWithPlaces = !isNewSet && locationsResolved
        && !fittedWithPlacesRef.current && !movedByReaderRef.current;
      const justDeselected = lastSelectedRef.current != null && selectedExperienceId == null;
      lastSelectedRef.current = selectedExperienceId;
      if (features.length > 0 && !selectedExperienceId
          && (isNewSet || firstWithPlaces || justDeselected)) {
        fittedForRef.current = experiences;
        fittedWithPlacesRef.current = locationsResolved;
        movedByReaderRef.current = false;
        const bounds = new maplibregl.LngLatBounds();
        for (const f of features) {
          bounds.extend(f.geometry.coordinates as [number, number]);
        }
        map.fitBounds(bounds, { padding: 40, maxZoom: 10, duration: 800 });
      }
    };

    if (map.getSource(SOURCE_ID)) {
      updateData();
      return;
    }
    // Removed on cleanup, which matters now that this effect re-runs on four
    // more things than it used to: every arrival before the map has loaded — the
    // experiences query, the location batch, a fold taken early — used to leave
    // another closure attached, and on `load` they all ran in turn, each with its
    // own snapshot and each evaluating the fit.
    map.on('load', updateData);
    return () => { map.off('load', updateData); };
  }, [experiences, selectedExperienceId, locationsByExperience, collapsedExperienceIds, locationsResolved]);

  // ── Update highlight markers + delayed flyTo ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

      // Both marks belong to one selection, and a reader moves between selections
    // without passing through none: the cards stay clickable while a panel is
    // open. Cleared on every change of selection, not only on closing — otherwise
    // pin B → card A → card B is swallowed by a stale map mark, and card A → pin B
    // → card A by a stale flown mark.
    if (flySelectionRef.current !== selectedExperienceId) {
      flySelectionRef.current = selectedExperienceId;
      flownForRef.current = null;
      if (selectedFromMapIdRef.current !== selectedExperienceId) {
        selectedFromMapIdRef.current = null;
      }
    }

    const updateHighlight = () => {
      const source = map.getSource(HIGHLIGHT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      // A folded object is one point here too. The selected object is drawn by
      // this layer rather than from the marker source, so a fold that stopped at
      // the source would be undone by the act of selecting the row — which is
      // exactly when a reader is looking at it.
      if (foldedSelection) {
        source.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [foldedSelection.longitude, foldedSelection.latitude] },
            properties: { name: foldedSelection.name, locationId: null },
          }],
        });
        return;
      }

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
    // The cleanup below removes this too — same reason as the marker effect.

    // Delayed flyTo — waits for panel CSS transition to complete before centering.
    //
    // Skipped when the selection came from a click on the map: the reader is
    // already looking at one of this object's places, and framing all of them
    // takes the one they clicked off the screen — with its own pin gone from the
    // marker source in the same commit, there is nothing to click back to.
    //
    // And skipped when the selection has not changed, which is what keeps a fold
    // from moving the camera: folding the selected object, or folding an
    // unrelated one, re-runs this effect — the memo returns a new object with the
    // same values — and Map mode's chip moves nothing at all.
    const flyTimer = setTimeout(() => {
      // Nothing to fly to yet: the set on hand is the one-point fallback, which
      // is indistinguishable from a genuine single place. Flying now frames that
      // point and the next run frames the real places — two animations decided by
      // how long the fetch took. "Settled" rather than "has data", so a failed
      // fetch still frames the fallback instead of leaving the map still.
      if (!selectedLocationsResolved) return;
      if (selectedFromMapIdRef.current === selectedExperienceId) return;
      if (flownForRef.current === selectedExperienceId) return;
      flownForRef.current = selectedExperienceId;
      if (foldedSelection) {
        map.flyTo({
          center: [foldedSelection.longitude, foldedSelection.latitude],
          zoom: Math.max(map.getZoom(), 8),
          duration: 800,
        });
      } else if (selectedExperienceLocations && selectedExperienceLocations.length > 0) {
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

    return () => {
      clearTimeout(flyTimer);
      map.off('load', updateHighlight);
    };
  }, [selectedExperienceLocations, foldedSelection, selectedExperienceId, selectedLocationsResolved]);

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
    const inView = map.getBounds();
    const onScreen = drawn.filter(([lng, lat]) => inView.contains([lng, lat]));
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
  }, []);

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
        {isWebGLAvailable() ? (
          <>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

            {/* The same fold the list offers, for a reader working on the map (#558) */}
            {selectedExperienceId != null && (
              <FoldPlacesControl
                places={placesOfSelected}
                folded={collapsedExperienceIds.has(selectedExperienceId)}
                onToggle={() => toggleCollapsedExperience(selectedExperienceId)}
              />
            )}
          </>
        ) : (
          <MapUnavailable detail="The experiences below are the same ones the map would pin, and stay fully browsable." />
        )}
        {/* Loading overlay */}
        {isLoading && activeView && (
          <Box sx={{ position: 'absolute', top: 8, left: 8, bgcolor: 'background.paper', borderRadius: 1, px: 1.5, py: 0.5, boxShadow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption">Loading...</Typography>
          </Box>
        )}
        {/* Default state overlay when no source is selected. Gated on the map
            existing: it covers the pane edge to edge and is the state Discover
            opens in, so without it gated the first thing a WebGL-less visitor
            reads is "…to see experiences on the map" sitting on top of the
            explanation of why there is no map. */}
        {!activeView && isWebGLAvailable() && (
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
              {hoverPreview.categoryName && (
                <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.85 }} noWrap>
                  {hoverPreview.categoryName}
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
                {(() => {
                  if (isLoading) return 'Loading...';
                  const ofTotal = search ? ` of ${experiences.length}` : '';
                  return `${filteredExperiences.length}${ofTotal} experiences`;
                })()}
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
            {isLoading && <LoadingSpinner size={24} padding="16px 0" />}
            {!isLoading && filteredExperiences.length === 0 && (
              <EmptyState message={search ? 'No experiences match your filter.' : 'No experiences found.'} />
            )}
            {!isLoading && filteredExperiences.length > 0 && filteredExperiences.map((exp) => (
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
                onCurate={hasCuratorScope ? () => setCurationTarget(exp) : undefined}
              />
            ))}
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
          defaultCategoryId={activeView.categoryId}
        />
      )}
    </Box>
  );
}
