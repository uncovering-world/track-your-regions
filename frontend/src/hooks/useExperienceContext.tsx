/**
 * Experience Context - Shared state for experiences display
 *
 * Provides:
 * - experiences: fetched when regionId changes
 * - hoveredExperienceId: shared hover state between list and markers (bidirectional)
 * - selectedExperienceId: currently expanded/selected experience (shows details in list)
 * - Image preloading for faster tooltip/detail display
 */

import { createContext, useContext, useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchExperiencesByRegion, type Experience } from '../api/experiences';

// Re-export image utilities from their canonical location for backward compatibility
export { toThumbnailUrl, extractImageUrl } from '../utils/imageUrl';

import { extractImageUrl as extractImageUrlUtil } from '../utils/imageUrl';

/**
 * Preload images in the background for faster display
 * Returns a cleanup function to cancel pending loads
 */
function preloadImages(experiences: Experience[]): () => void {
  const images: HTMLImageElement[] = [];

  experiences.forEach((exp) => {
    const url = extractImageUrlUtil(exp.image_url);
    if (url) {
      const img = new Image();
      img.src = url;
      images.push(img);
    }
  });

  // Return cleanup function to cancel pending loads
  return () => {
    images.forEach((img) => {
      img.src = ''; // Cancel loading
    });
  };
}

interface ExperienceContextType {
  // Experiences for current region
  experiences: Experience[];
  experiencesLoading: boolean;
  totalExperiences: number;

  // Current region ID (for filtering locations)
  regionId: number | null;

  // Exploration mode (right panel open)
  isExploring: boolean;

  // Hover state (shared between list and markers - bidirectional)
  hoveredExperienceId: number | null;
  hoveredLocationId: number | null; // For multi-location experiences
  hoverSource: 'marker' | 'list' | null;
  setHoveredFromMarker: (experienceId: number | null, locationId?: number | null) => void;
  setHoveredFromList: (experienceId: number | null, locationId?: number | null) => void;

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

  // Artwork preview image (shown as overlay on map)
  previewImageUrl: string | null;
  setPreviewImageUrl: (url: string | null) => void;

  // Hover preview card (shown on map when hovering markers/locations)
  hoverPreview: {
    experienceId: number;
    experienceName: string;
    locationId: number | null;
    locationName: string | null;
    categoryName: string | null;
    category: string | null;
    imageUrl: string | null;
    longitude: number;
    latitude: number;
  } | null;
  setHoverPreview: (preview: {
    experienceId: number;
    experienceName: string;
    locationId: number | null;
    locationName: string | null;
    categoryName: string | null;
    category: string | null;
    imageUrl: string | null;
    longitude: number;
    latitude: number;
  } | null) => void;
}

const ExperienceContext = createContext<ExperienceContextType | null>(null);

interface ExperienceProviderProps {
  regionId: number | null;
  isExploring: boolean;
  children: ReactNode;
}

export function ExperienceProvider({ regionId, isExploring, children }: ExperienceProviderProps) {
  const [hoveredExperienceId, setHoveredExperienceId] = useState<number | null>(null);
  const [hoveredLocationId, setHoveredLocationId] = useState<number | null>(null);
  const [hoverSource, setHoverSource] = useState<'marker' | 'list' | null>(null);
  const [selectedExperienceId, setSelectedExperienceId] = useState<number | null>(null);
  const [flyToExperienceId, setFlyToExperienceId] = useState<number | null>(null);
  const [shouldFitRegion, setShouldFitRegion] = useState(false);
  const [expandedCategoryNames, setExpandedCategoryNames] = useState<Set<string>>(new Set());
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    experienceId: number;
    experienceName: string;
    locationId: number | null;
    locationName: string | null;
    categoryName: string | null;
    category: string | null;
    imageUrl: string | null;
    longitude: number;
    latitude: number;
  } | null>(null);

  // Fetch experiences for the selected region
  const { data, isLoading } = useQuery({
    queryKey: ['experiences', 'by-region', regionId],
    queryFn: () => fetchExperiencesByRegion(regionId!, { includeChildren: false, limit: 200 }),
    enabled: !!regionId,
    staleTime: 300000, // 5 minutes
  });

  const experiences = useMemo(() => data?.experiences || [], [data?.experiences]);

  // Preload images only when exploring - cancel on region change or exploration close
  useEffect(() => {
    if (!isExploring || experiences.length === 0) {
      return;
    }

    const cancelPreload = preloadImages(experiences);

    // Cleanup: cancel pending image loads when region changes or exploration closes
    return cancelPreload;
  }, [experiences, isExploring]);

  const getExperienceById = useCallback((id: number) => {
    return experiences.find(exp => exp.id === id);
  }, [experiences]);

  const setHoveredFromMarker = useCallback((experienceId: number | null, locationId: number | null = null) => {
    setHoveredExperienceId(experienceId);
    setHoveredLocationId(locationId);
    setHoverSource(experienceId ? 'marker' : null);
    if (!experienceId) {
      setHoverPreview(null);
    }
  }, []);

  const setHoveredFromList = useCallback((experienceId: number | null, locationId: number | null = null) => {
    setHoveredExperienceId(experienceId);
    setHoveredLocationId(locationId);
    setHoverSource(experienceId ? 'list' : null);
    if (!experienceId) {
      setHoverPreview(null);
    }
  }, []);

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
    totalExperiences: data?.total || 0,
    regionId,
    isExploring,
    hoveredExperienceId,
    hoveredLocationId,
    hoverSource,
    setHoveredFromMarker,
    setHoveredFromList,
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
    previewImageUrl,
    setPreviewImageUrl,
    hoverPreview,
    setHoverPreview,
  }), [data, isLoading, experiences, regionId, isExploring, hoveredExperienceId, hoveredLocationId, hoverSource, setHoveredFromMarker, setHoveredFromList, selectedExperienceId, toggleSelectedExperience, flyToExperienceId, triggerFlyTo, clearFlyTo, shouldFitRegion, triggerFitRegion, clearFitRegion, getExperienceById, expandedCategoryNames, previewImageUrl, hoverPreview]);

  return (
    <ExperienceContext.Provider value={value}>
      {children}
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
