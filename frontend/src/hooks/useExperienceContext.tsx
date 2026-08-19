/**
 * Experience Context - Shared state for experiences display
 *
 * Provides:
 * - experiences: fetched when regionId changes
 * - selectedExperienceId: currently expanded/selected experience (shows details in list)
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

import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchExperiencesByRegion, WHOLE_REGION_LIMIT, type Experience } from '../api/experiences';
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

  // Selected/expanded experience (shows inline details in list)
  selectedExperienceId: number | null;
  setSelectedExperienceId: (id: number | null) => void;
  toggleSelectedExperience: (id: number) => void;

  // Map fly-to trigger (set by list click, consumed by map)
  flyToExperienceId: number | null;
  triggerFlyTo: (id: number) => void;
  clearFlyTo: () => void;

  // Trigger to fit region bounds (when closing expanded item)
  shouldFitRegion: boolean;
  triggerFitRegion: () => void;
  clearFitRegion: () => void;

  // Helper to get experience by ID
  getExperienceById: (id: number) => Experience | undefined;

  // Expanded source names (controls which markers are visible)
  expandedCategoryNames: Set<string>;
  setExpandedCategoryNames: (names: Set<string>) => void;

  /** Objects this reader asked to see as a single pin rather than as their places. */
  collapsedExperienceIds: ReadonlySet<number>;
  toggleCollapsedExperience: (id: number) => void;

  // Artwork preview image (shown as overlay on map)
  previewImageUrl: string | null;
  setPreviewImageUrl: (url: string | null) => void;
}

const ExperienceContext = createContext<ExperienceContextType | null>(null);


interface ExperienceProviderProps {
  regionId: number | null;
  isExploring: boolean;
  children: ReactNode;
}

export function ExperienceProvider({ regionId, isExploring, children }: ExperienceProviderProps) {
  const [selectedExperienceId, setSelectedExperienceId] = useState<number | null>(null);
  const [flyToExperienceId, setFlyToExperienceId] = useState<number | null>(null);
  const [shouldFitRegion, setShouldFitRegion] = useState(false);
  const [expandedCategoryNames, setExpandedCategoryNames] = useState<Set<string>>(new Set());
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
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
  // Zero for almost every region; the list offers the toggle only above zero.
  const lostHidden = data?.lostHidden ?? 0;

  // Nothing preloads a region's pictures here any more, and removing it cost
  // nothing because it warmed bytes no view ever asks for. It fetched
  // `extractImageUrl(exp.image_url)` — the original — for every experience the
  // moment a region was explored: about 670 requests for Europe, of which roughly
  // four in five answer 403 (#557) and the rest are full-size files. Every surface
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
    setSelectedExperienceId(prev => prev === id ? null : id);
  }, []);

  const triggerFlyTo = useCallback((id: number) => {
    setFlyToExperienceId(id);
  }, []);

  const clearFlyTo = useCallback(() => {
    setFlyToExperienceId(null);
  }, []);

  const triggerFitRegion = useCallback(() => {
    setShouldFitRegion(true);
  }, []);

  const clearFitRegion = useCallback(() => {
    setShouldFitRegion(false);
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
    flyToExperienceId,
    triggerFlyTo,
    clearFlyTo,
    shouldFitRegion,
    triggerFitRegion,
    clearFitRegion,
    getExperienceById,
    expandedCategoryNames,
    setExpandedCategoryNames,
    collapsedExperienceIds,
    toggleCollapsedExperience,
    previewImageUrl,
    setPreviewImageUrl,
  }), [data, isLoading, experiences, lostHidden, showLost, setShowLost, regionId, isExploring, viewBounds, setViewBounds, selectedExperienceId, toggleSelectedExperience, flyToExperienceId, triggerFlyTo, clearFlyTo, shouldFitRegion, triggerFitRegion, clearFitRegion, getExperienceById, expandedCategoryNames, collapsedExperienceIds, toggleCollapsedExperience, previewImageUrl]);

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
