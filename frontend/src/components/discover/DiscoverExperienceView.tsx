/**
 * DiscoverExperienceView — Persistent map panel + experience list below.
 *
 * The map is always visible. Before a source is selected, it shows a welcome state.
 * When a source is selected, it shows markers for those experiences.
 * When a specific experience is selected, the map zooms to its locations.
 *
 * What is left here after the split (#562) is what only this component can hold:
 * what the map is *showing* — the marker data it feeds the source, and every
 * camera move, which is the one thing a reader can undo by moving the map
 * themselves and so needs the guards that live beside it. The parts that answer
 * to something other than the selection live one file each: `useDiscoverMap` owns
 * the instance and its listeners, `useDiscoverHover` the hover in both directions,
 * `discoverMapLayers` the sources and paint, `DiscoverExperienceList` the rows.
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import ExploreIcon from '@mui/icons-material/Explore';
import maplibregl from 'maplibre-gl';
import type { Experience } from '../../api/experiences';
import type { ActiveView } from '../../hooks/useDiscoverExperiences';
import { useRegionLocations } from '../../hooks/useRegionLocations';
import { useCollapsedExperiences } from '../../hooks/useCollapsedExperiences';
import { buildExperienceMarkers, representablePlaces } from '../experienceMarkers/buildMarkers';
import { FoldPlacesControl } from '../experienceMarkers/FoldPlacesControl';
import { DiscoverExperienceList } from './DiscoverExperienceList';
import { useAuth } from '../../hooks/useAuth';
import { useNewBadgeImpressions } from '../../hooks/useNewBadgeImpressions';
import { useVisitedExperiences } from '../../hooks/useVisitedExperiences';
import { CurationDialog } from '../shared/CurationDialog';
import { AddExperienceDialog } from '../shared/AddExperienceDialog';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { MapUnavailable } from '../shared/MapUnavailable';
import { isWebGLAvailable } from '../../utils/webgl';
import { SOURCE_ID, HIGHLIGHT_SOURCE_ID } from './discoverMapLayers';
import { useDiscoverMap } from './useDiscoverMap';
import { useDiscoverHover } from './useDiscoverHover';

/** Discover shows one category at a time, so the builder's filter has nothing to do. */
const NO_CATEGORY_FILTER: Set<string> = new Set();

// Stable identity: an inline [] would be a new array every render, and the
// impression effect keys off the array it is given.
const EMPTY_EXPERIENCES: Experience[] = [];


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

  // Hover is one mechanism across the map and the list, so it lives in one place
  // rather than as two halves of this component — see the hook.
  const {
    hoveredExperienceId, hoverPreview, cardRefsMap, listContainerRef,
    mapHoverCallbackRef, highlightHoverCallbackRef, onCardMouseEnter, onCardMouseLeave,
  } = useDiscoverHover({
    mapRef, experiences, drawnCoordsRef, selectedExpIdRef,
    externalHoverCoords, onHoverHighlightLocation,
  });

  // The selected object's places, for the fit effect's long-lived callbacks.
  const selectedLocsRef = useRef(selectedExperienceLocations);
  selectedLocsRef.current = selectedExperienceLocations;

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
  useDiscoverMap({
    mapContainerRef,
    mapRef,
    toggleCollapsedRef,
    selectedFromMapIdRef,
    movedByReaderRef,
    mapHoverCallbackRef,
    highlightHoverCallbackRef,
    onSelectExperience,
  });


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
              {/* Wherever the work appears, including here. */}
              {hoverPreview.imageUrl && <ImageCreditLine credit={hoverPreview.imageCredit} />}
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
        <DiscoverExperienceList
          activeView={activeView}
          experiences={experiences}
          filteredExperiences={filteredExperiences}
          isLoading={isLoading}
          search={search}
          setSearch={setSearch}
          shortSourceName={shortSourceName}
          rejectedCount={rejectedCount}
          hasCuratorScope={hasCuratorScope}
          isAuthenticated={isAuthenticated}
          visitedIds={visitedIds}
          hoveredExperienceId={hoveredExperienceId}
          selectedExperienceId={selectedExperienceId}
          listContainerRef={listContainerRef}
          cardRefsMap={cardRefsMap}
          onBack={onBack}
          onSelectExperience={onSelectExperience}
          onCardMouseEnter={onCardMouseEnter}
          onCardMouseLeave={onCardMouseLeave}
          onVisitedToggle={handleVisitedToggle}
          onCurate={setCurationTarget}
          onAdd={() => setAddDialogOpen(true)}
        />
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
