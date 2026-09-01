/**
 * Experience Context - Shared state for experiences display
 *
 * Provides:
 * - experiences: fetched when regionId changes
 * - selectedExperienceId: the open card — what the address names (#644), so a
 *   card is a place a reader can send, refresh and come back to
 * - what the map is showing, so the list can answer about the view (#553)
 *
 * Hover is deliberately *not* here: what the pointer is over changes on every
 * mouse move, and a context value is one object, so keeping it here re-rendered
 * every consumer — the map included — for each event. It lives in
 * `useHoverContext`, whose provider this one nests.
 *
 * Pictures are not preloaded here any more; the block where that used to happen
 * records why, and where it happens instead.
 */

import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchExperiencesByRegion, WHOLE_REGION_LIMIT, type Experience, type ImageCredit } from '../api/experiences';
import { useAppAddress } from './useAppAddress';
import { useCollapsedExperiences } from './useCollapsedExperiences';
import { HoverProvider } from './useHoverContext';
import type { ViewBounds } from '../utils/viewBounds';

// Re-export image utilities from their canonical location for backward compatibility
export { toThumbnailUrl, extractImageUrl } from '../utils/imageUrl';


interface ExperienceContextType {
  // Experiences for current region
  experiences: Experience[];
  experiencesLoading: boolean;
  /** How many the region holds that no longer exist and are not being shown. */
  lostHidden: number;
  showLost: boolean;
  setShowLost: (show: boolean) => void;
  totalExperiences: number;

  // Current region ID (for filtering locations)
  regionId: number | null;

  // Exploration mode (right panel open)
  isExploring: boolean;

  /**
   * What the map is showing, published on `moveend` (#553).
   *
   * Null until the map has moved once, and null when there is no map at all —
   * WebGL missing, or a surface that never mounts one. Null means "no view to
   * answer about", which the list reads as the whole region rather than as an
   * empty one: a reader without a map must not lose their list.
   */
  viewBounds: ViewBounds | null;
  setViewBounds: (bounds: ViewBounds | null) => void;

  // The open card: read from the address, written into it. Opening and closing
  // are steps the visitor took, so Back undoes them.
  selectedExperienceId: number | null;
  setSelectedExperienceId: (id: number | null) => void;
  toggleSelectedExperience: (id: number) => void;

  /**
   * The card the page arrived with, until its row has settled it: the list
   * puts the focus in that card once it opens, so a reader who followed a link
   * with a keyboard or a screen reader lands in what the link named.
   */
  arrivedAtExperienceId: number | null;
  settleArrival: () => void;

  // Map fly-to trigger (set by list click, consumed by map)
  flyToExperienceId: number | null;
  triggerFlyTo: (id: number) => void;
  clearFlyTo: () => void;

  // Helper to get experience by ID
  getExperienceById: (id: number) => Experience | undefined;

  // Expanded source names (controls which markers are visible)
  expandedCategoryNames: Set<string>;
  setExpandedCategoryNames: (names: Set<string>) => void;

  /** Objects this reader asked to see as a single pin rather than as their places. */
  collapsedExperienceIds: ReadonlySet<number>;
  toggleCollapsedExperience: (id: number) => void;

  /**
   * The artwork the pointer is over, shown as an overlay on the map.
   *
   * The credit rides with the URL rather than being looked up where the overlay
   * is drawn, for the same reason the hover store carries one: the map has no
   * work in scope, and a 500 px photograph with nobody named under it is exactly
   * what the licence forbids.
   */
  artworkPreview: ArtworkPreview | null;
  setArtworkPreview: (preview: ArtworkPreview | null) => void;
}

/** A work's picture as the map's overlay needs it: the image, and whose it is. */
export interface ArtworkPreview {
  url: string;
  credit?: ImageCredit | null;
}

const ExperienceContext = createContext<ExperienceContextType | null>(null);


interface ExperienceProviderProps {
  regionId: number | null;
  isExploring: boolean;
  children: ReactNode;
}

export function ExperienceProvider({ regionId, isExploring, children }: ExperienceProviderProps) {
  const { address, go } = useAppAddress();
  // The open card is what the address names — and only while this provider is
  // on the region the address names. During a restore the region arrives after
  // the address, and this provider is still on the previous region, or on none:
  // its list must not be asked about a card of the region that is on its way.
  const onAddressedRegion = address !== null && address.regionId === regionId;
  const selectedExperienceId = onAddressedRegion ? address.experienceId : null;
  const [flyToExperienceId, setFlyToExperienceId] = useState<number | null>(null);
  const [expandedCategoryNames, setExpandedCategoryNames] = useState<Set<string>>(new Set());
  const [artworkPreview, setArtworkPreview] = useState<ArtworkPreview | null>(null);
  // Held for the region it was measured in: a view belongs to the map that was
  // showing that region, and carrying it into the next one would filter the new
  // list by the old camera for the render before the map moves.
  const [boundsFor, setBoundsFor] = useState<{ regionId: number | null; bounds: ViewBounds } | null>(null);
  const viewBounds = boundsFor !== null && boundsFor.regionId === regionId ? boundsFor.bounds : null;
  const setViewBounds = useCallback(
    (bounds: ViewBounds | null) => setBoundsFor(bounds ? { regionId, bounds } : null),
    [regionId],
  );

  // Objects that no longer exist are off by default and come back only when
  // the reader asks. The ask belongs to the region — it answers "what else was
  // here", a question about this place, not a standing preference — so it is
  // stored as *which* region it was made for rather than as a flag reset by an
  // effect. An effect runs after render, which leaves a window where the first
  // query for the new region goes out still asking for the old one's lost
  // rows; deriving it cannot have that window.
  const [lostShownFor, setLostShownFor] = useState<number | null>(null);
  const showLost = lostShownFor !== null && lostShownFor === regionId;
  const setShowLost = useCallback(
    (show: boolean) => setLostShownFor(show ? regionId ?? null : null),
    [regionId],
  );

  // Per object, per region, and never a mode — see the hook for why, and for why
  // Discover holds its own rather than sharing this one.
  const { collapsedExperienceIds, toggleCollapsedExperience } = useCollapsedExperiences(regionId);

  // Fetch experiences for the selected region
  const { data, isLoading } = useQuery({
    queryKey: ['experiences', 'by-region', regionId, showLost],
    queryFn: () => fetchExperiencesByRegion(regionId!, {
      includeChildren: false, limit: WHOLE_REGION_LIMIT, includeLost: showLost,
    }),
    enabled: !!regionId,
    staleTime: 300000, // 5 minutes
  });

  const experiences = useMemo(() => data?.experiences || [], [data?.experiences]);

  // A card this list does not hold — hidden, rejected, in another region, or
  // not there at all — is dropped from the address once the list has answered,
  // in place and in silence: one answer for all four, as the list itself gives.
  //
  // Only a *successful* answer counts. Not the empty list that stands in while
  // the real one loads, and not a failed read either: a read that did not
  // arrive says nothing about what the region holds, and treating it as "no
  // such card" would let one 500 rewrite a link somebody shared — and not give
  // it back when the API recovered, since the card would be gone from the
  // address the retry reads.
  useEffect(() => {
    if (address === null || !onAddressedRegion || selectedExperienceId === null || data === undefined) return;
    if (experiences.some(e => e.id === selectedExperienceId)) return;
    go({ ...address, experienceId: null }, { replace: true });
  }, [address, onAddressedRegion, selectedExperienceId, data, experiences, go]);

  // Bring the card's slug up to date once the list names it. A deep link
  // carries whatever slug it was made with, or none — which is the shape the
  // region's own canonicalisation leaves behind, since that write knows the
  // region's name and not the card's. In place: a correction, not a step.
  const openCard = selectedExperienceId === null
    ? undefined
    : experiences.find(e => e.id === selectedExperienceId);
  useEffect(() => {
    if (address === null || !openCard?.name) return;
    go(address, { replace: true, names: { experience: openCard.name } });
  }, [address, openCard, go]);

  // The card the page arrived with, forgotten once its row has settled it, or
  // once the reader has moved to another card before it could open.
  const [arrivedAtExperienceId, setArrivedAtExperienceId] = useState<number | null>(
    () => address?.experienceId ?? null,
  );
  const settleArrival = useCallback(() => setArrivedAtExperienceId(null), []);
  useEffect(() => {
    if (arrivedAtExperienceId === null || !onAddressedRegion) return;
    if (selectedExperienceId !== arrivedAtExperienceId) setArrivedAtExperienceId(null);
  }, [arrivedAtExperienceId, onAddressedRegion, selectedExperienceId]);

  // Written through refs so the two setters keep one identity across
  // addresses and lists: ExperienceMarkers and the list build their handlers
  // on them, and rebuild everything they draw when those change.
  const addressRef = useRef(address);
  addressRef.current = address;
  const experiencesRef = useRef(experiences);
  experiencesRef.current = experiences;
  const selectedRef = useRef(selectedExperienceId);
  selectedRef.current = selectedExperienceId;

  // Opening and closing a card are steps the visitor took: pushed, so Back
  // closes what was opened and reopens what was closed. The name rides along
  // as the slug.
  const setSelectedExperienceId = useCallback((id: number | null) => {
    const at = addressRef.current;
    if (at === null) return;
    const name = id === null ? undefined : experiencesRef.current.find(e => e.id === id)?.name;
    go(at2 => ({ ...at2, experienceId: id }), { names: { experience: name } });
  }, [go]);
  // Zero for almost every region; the list offers the toggle only above zero.
  const lostHidden = data?.lostHidden ?? 0;

  // Nothing preloads a region's pictures here any more, and removing it cost
  // nothing because it warmed bytes no view ever asks for. It fetched
  // `extractImageUrl(exp.image_url)` — the original — for every experience the
  // moment a region was explored: about 670 requests for Europe, of which roughly
  // four in five answered 403 at the time (the portal's photographs, since
  // replaced with Commons files — ADR-0043, #557) and the rest were full-size
  // files. Every surface
  // renders a `toThumbnailUrl()` variant instead (120, 250, 330, 500, 720, 960),
  // so not one of those downloads was ever displayed.
  //
  // A card's picture is warmed where it is about to be needed instead: the row
  // fetches the exact thumbnail it will render once the pointer rests on it, and a
  // card will not open until its picture has settled — see `imagePreload.ts` and
  // `useExperienceCardReady.ts`.

  const getExperienceById = useCallback((id: number) => {
    return experiences.find(exp => exp.id === id);
  }, [experiences]);

  const toggleSelectedExperience = useCallback((id: number) => {
    setSelectedExperienceId(selectedRef.current === id ? null : id);
  }, [setSelectedExperienceId]);

  const triggerFlyTo = useCallback((id: number) => {
    setFlyToExperienceId(id);
  }, []);

  const clearFlyTo = useCallback(() => {
    setFlyToExperienceId(null);
  }, []);

  const value = useMemo<ExperienceContextType>(() => ({
    experiences,
    experiencesLoading: isLoading,
    lostHidden,
    showLost,
    setShowLost,
    totalExperiences: data?.total || 0,
    regionId,
    isExploring,
    viewBounds,
    setViewBounds,
    selectedExperienceId,
    setSelectedExperienceId,
    toggleSelectedExperience,
    arrivedAtExperienceId,
    settleArrival,
    flyToExperienceId,
    triggerFlyTo,
    clearFlyTo,
    getExperienceById,
    expandedCategoryNames,
    setExpandedCategoryNames,
    collapsedExperienceIds,
    toggleCollapsedExperience,
    artworkPreview,
    setArtworkPreview,
  }), [data, isLoading, experiences, lostHidden, showLost, setShowLost, regionId, isExploring, viewBounds, setViewBounds, selectedExperienceId, setSelectedExperienceId, toggleSelectedExperience, arrivedAtExperienceId, settleArrival, flyToExperienceId, triggerFlyTo, clearFlyTo, getExperienceById, expandedCategoryNames, collapsedExperienceIds, toggleCollapsedExperience, artworkPreview]);

  return (
    <ExperienceContext.Provider value={value}>
      <HoverProvider>{children}</HoverProvider>
    </ExperienceContext.Provider>
  );
}

export function useExperienceContext(): ExperienceContextType {
  const context = useContext(ExperienceContext);
  if (!context) {
    throw new Error('useExperienceContext must be used within an ExperienceProvider');
  }
  return context;
}
