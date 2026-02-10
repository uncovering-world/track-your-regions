/**
 * Hook for the Discover page — tree-based region navigation with experience counts.
 *
 * Manages:
 * - Region tree navigation (breadcrumbs, current level children)
 * - Experience counts per source at each tree level
 * - Active view state: which region+source is being explored
 * - Loading experiences for the active view
 * - Selected experience for inline detail
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchExperienceRegionCounts,
  fetchExperienceSources,
  fetchExperiencesByRegion,
  fetchExperienceLocations,
} from '../api/experiences';
import { useNavigation } from './useNavigation';

/** The active experience view: region + source selection */
export interface ActiveView {
  regionId: number;
  regionName: string;
  sourceId: number;
  sourceName: string;
}

/** Breadcrumb item for tree navigation */
export interface DiscoverBreadcrumb {
  regionId: number | null; // null = root level
  regionName: string;
}

export function useDiscoverExperiences() {
  const { selectedWorldView, selectedWorldViewId, worldViews, setSelectedWorldView } = useNavigation();

  // Tree navigation state
  const [breadcrumbs, setBreadcrumbs] = useState<DiscoverBreadcrumb[]>([]);
  const [activeView, setActiveView] = useState<ActiveView | null>(null);
  const [selectedExperienceId, setSelectedExperienceId] = useState<number | null>(null);

  // Current parent region (last breadcrumb, or null for root)
  const currentParentId = breadcrumbs.length > 0
    ? breadcrumbs[breadcrumbs.length - 1].regionId
    : null;

  // Fetch experience sources (for icon/name mapping)
  const { data: sources = [] } = useQuery({
    queryKey: ['experience-sources'],
    queryFn: fetchExperienceSources,
    staleTime: 300000,
  });

  // Fetch region counts for current tree level
  const { data: regionCounts = [], isLoading: countsLoading } = useQuery({
    queryKey: ['discover-region-counts', selectedWorldViewId, currentParentId],
    queryFn: () => fetchExperienceRegionCounts(selectedWorldViewId!, currentParentId ?? undefined),
    enabled: !!selectedWorldViewId,
    staleTime: 120000,
  });

  // Active sources (only those with counts at this level)
  const activeSources = useMemo(() => {
    const sourceIds = new Set<number>();
    for (const rc of regionCounts) {
      for (const sid of Object.keys(rc.source_counts)) {
        sourceIds.add(Number(sid));
      }
    }
    return sources.filter(s => s.is_active && sourceIds.has(s.id));
  }, [sources, regionCounts]);

  // Total experience count per source at current level
  const levelTotals = useMemo(() => {
    const totals: Record<number, number> = {};
    for (const rc of regionCounts) {
      for (const [sid, count] of Object.entries(rc.source_counts)) {
        totals[Number(sid)] = (totals[Number(sid)] || 0) + count;
      }
    }
    return totals;
  }, [regionCounts]);

  // Fetch experiences for active view (region + source)
  const { data: experiencesData, isLoading: experiencesLoading } = useQuery({
    queryKey: ['discover-experiences', activeView?.regionId, activeView?.sourceId],
    queryFn: () => fetchExperiencesByRegion(activeView!.regionId, {
      includeChildren: true,
      limit: 500,
    }),
    enabled: !!activeView,
    staleTime: 120000,
    select: (data) => {
      // Filter to only the selected source
      if (!activeView) return data;
      return {
        ...data,
        experiences: data.experiences.filter(e => {
          const sourceMatch = sources.find(s => s.name === e.source_name);
          return sourceMatch && sourceMatch.id === activeView.sourceId;
        }),
      };
    },
  });

  const experiences = useMemo(
    () => experiencesData?.experiences ?? [],
    [experiencesData?.experiences],
  );

  // Fetch locations for the selected experience (for map display)
  const { data: selectedLocationsData } = useQuery({
    queryKey: ['experience-locations', selectedExperienceId],
    queryFn: () => fetchExperienceLocations(selectedExperienceId!),
    enabled: !!selectedExperienceId,
    staleTime: 300000,
  });

  // Locations for the map: when experience is selected, show its locations
  const selectedExperienceLocations = useMemo(() => {
    if (!selectedExperienceId) return null;
    if (selectedLocationsData?.locations && selectedLocationsData.locations.length > 0) {
      return selectedLocationsData.locations.map(l => ({
        id: l.id,
        lng: l.longitude,
        lat: l.latitude,
        name: l.name || undefined,
      }));
    }
    // Fallback to experience's main coordinates
    const exp = experiences.find(e => e.id === selectedExperienceId);
    if (exp) return [{ lng: exp.longitude, lat: exp.latitude }];
    return null;
  }, [selectedExperienceId, selectedLocationsData, experiences]);

  // Navigate into a region (drill down)
  const navigateToRegion = useCallback((regionId: number, regionName: string) => {
    setBreadcrumbs(prev => [...prev, { regionId, regionName }]);
    setActiveView(null);
    setSelectedExperienceId(null);
  }, []);

  // Navigate to a breadcrumb level
  const navigateToBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      // Root level
      setBreadcrumbs([]);
    } else {
      setBreadcrumbs(prev => prev.slice(0, index + 1));
    }
    setActiveView(null);
    setSelectedExperienceId(null);
  }, []);

  // Open experience view for a region + source
  const openExperienceView = useCallback((
    regionId: number,
    regionName: string,
    sourceId: number,
    sourceName: string
  ) => {
    setActiveView({ regionId, regionName, sourceId, sourceName });
    setSelectedExperienceId(null);
  }, []);

  // Close experience view (back to tree)
  const closeExperienceView = useCallback(() => {
    setActiveView(null);
    setSelectedExperienceId(null);
  }, []);

  // Reset on world view change
  const changeWorldView = useCallback((wv: typeof worldViews[0]) => {
    setSelectedWorldView(wv);
    setBreadcrumbs([]);
    setActiveView(null);
    setSelectedExperienceId(null);
  }, [setSelectedWorldView]);

  return {
    // World view
    worldViews,
    selectedWorldView,
    selectedWorldViewId,
    changeWorldView,

    // Tree navigation
    breadcrumbs,
    currentParentId,
    regionCounts,
    countsLoading,
    navigateToRegion,
    navigateToBreadcrumb,

    // Sources
    sources,
    activeSources,
    levelTotals,

    // Experience view
    activeView,
    openExperienceView,
    closeExperienceView,
    experiences,
    experiencesLoading,

    // Detail panel
    selectedExperienceId,
    setSelectedExperienceId,
    selectedExperienceLocations,
  };
}
