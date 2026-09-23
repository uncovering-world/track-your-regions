/**
 * Hook for managing user's visited experiences and locations
 */

import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { invalidateVisitedStatus } from '../utils/queryInvalidation';
import {
  fetchExperienceVisitedStatus, fetchViewedTreasureIds, fetchVisitedExperienceIds, fetchVisitedLocationIds,
  markAllLocationsVisited, markExperienceVisited, markLocationVisited, markTreasureViewed, unmarkAllLocationsVisited,
  unmarkExperienceVisited, unmarkLocationVisited, unmarkTreasureViewed, type VisitedStatus,
} from '../api/visited';

/**
 * Hook for managing experience-level visited status (backward compatible)
 */
export function useVisitedExperiences(kindId?: number) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  // Fetch visited experience IDs
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['visited-experiences', 'ids', kindId],
    queryFn: () => fetchVisitedExperienceIds(kindId),
    enabled: isAuthenticated,
    staleTime: 60000, // 1 minute
  });

  // Convert to Set for O(1) lookup
  const visitedIdsSet = useMemo(() => {
    return new Set(data?.visitedIds || []);
  }, [data?.visitedIds]);

  // Mark as visited mutation
  const markVisitedMutation = useMutation({
    mutationFn: markExperienceVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Unmark as visited mutation
  const unmarkVisitedMutation = useMutation({
    mutationFn: unmarkExperienceVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  return {
    visitedIds: visitedIdsSet,
    visitedCount: data?.total || 0,
    isLoading,
    refetch,
    markVisited: markVisitedMutation.mutate,
    unmarkVisited: unmarkVisitedMutation.mutate,
    isMarking: markVisitedMutation.isPending,
    isUnmarking: unmarkVisitedMutation.isPending,
  };
}

/**
 * Hook for managing location-level visited status (multi-location experiences)
 */
export function useVisitedLocations(experienceId?: number) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  // Fetch visited location IDs
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['visited-locations', 'ids', experienceId],
    queryFn: () => fetchVisitedLocationIds(experienceId),
    enabled: isAuthenticated,
    staleTime: 60000, // 1 minute
  });

  // Convert to Set for O(1) lookup
  const visitedLocationIdsSet = useMemo(() => {
    return new Set(data?.visitedLocationIds || []);
  }, [data?.visitedLocationIds]);

  // Get visited locations grouped by experience
  const visitedByExperience = useMemo(() => {
    return data?.byExperience || {};
  }, [data?.byExperience]);

  // Mark location as visited mutation
  const markLocationVisitedMutation = useMutation({
    mutationFn: markLocationVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Unmark location as visited mutation
  const unmarkLocationVisitedMutation = useMutation({
    mutationFn: unmarkLocationVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Mark locations of an experience as visited (optionally filtered by region)
  const markAllLocationsMutation = useMutation({
    mutationFn: ({ experienceId, regionId }: { experienceId: number; regionId?: number }) =>
      markAllLocationsVisited(experienceId, regionId),
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Unmark locations of an experience as visited (optionally filtered by region)
  const unmarkAllLocationsMutation = useMutation({
    mutationFn: ({ experienceId, regionId }: { experienceId: number; regionId?: number }) =>
      unmarkAllLocationsVisited(experienceId, regionId),
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Check if a location is visited
  const isLocationVisited = useCallback((locationId: number) => {
    return visitedLocationIdsSet.has(locationId);
  }, [visitedLocationIdsSet]);

  // Get visited status for an experience based on its locations
  const getExperienceVisitedStatus = useCallback((
    expId: number,
    totalLocations: number
  ): VisitedStatus => {
    const visitedLocations = visitedByExperience[expId]?.length || 0;
    if (visitedLocations === 0) return 'not_visited';
    if (visitedLocations >= totalLocations) return 'visited';
    return 'partial';
  }, [visitedByExperience]);

  return {
    visitedLocationIds: visitedLocationIdsSet,
    visitedByExperience,
    visitedCount: data?.total || 0,
    isLoading,
    refetch,
    markLocationVisited: markLocationVisitedMutation.mutate,
    unmarkLocationVisited: unmarkLocationVisitedMutation.mutate,
    markAllLocations: markAllLocationsMutation.mutate,
    unmarkAllLocations: unmarkAllLocationsMutation.mutate,
    isMarking: markLocationVisitedMutation.isPending || markAllLocationsMutation.isPending,
    isUnmarking: unmarkLocationVisitedMutation.isPending || unmarkAllLocationsMutation.isPending,
    isLocationVisited,
    getExperienceVisitedStatus,
  };
}

/**
 * Hook for managing viewed treasures (artwork "seen" tracking)
 */
export function useViewedTreasures(experienceId?: number) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['viewed-treasures', experienceId],
    queryFn: () => fetchViewedTreasureIds(experienceId),
    enabled: isAuthenticated,
    staleTime: 60000,
  });

  const viewedIds = useMemo(() => {
    return new Set(data?.viewedTreasureIds || []);
  }, [data?.viewedTreasureIds]);

  const markViewedMutation = useMutation({
    mutationFn: ({ treasureId, experienceId }: { treasureId: number; experienceId?: number }) =>
      markTreasureViewed(treasureId, experienceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['viewed-treasures'] });
      invalidateVisitedStatus(queryClient);
    },
  });

  const unmarkViewedMutation = useMutation({
    mutationFn: unmarkTreasureViewed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['viewed-treasures'] });
    },
  });

  return {
    viewedIds,
    viewedCount: viewedIds.size,
    isLoading,
    markViewed: markViewedMutation.mutate,
    unmarkViewed: unmarkViewedMutation.mutate,
    isMarking: markViewedMutation.isPending,
    isUnmarking: unmarkViewedMutation.isPending,
  };
}

/**
 * Hook for fetching detailed visited status for a specific experience
 */
export function useExperienceVisitedStatus(experienceId: number | null) {
  const { isAuthenticated } = useAuth();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['experience-visited-status', experienceId],
    queryFn: () => fetchExperienceVisitedStatus(experienceId!),
    enabled: isAuthenticated && experienceId !== null,
    staleTime: 60000,
  });

  return {
    visitedStatus: data?.visitedStatus || 'not_visited',
    totalLocations: data?.totalLocations || 0,
    visitedLocations: data?.visitedLocations || 0,
    locations: data?.locations || [],
    isLoading,
    refetch,
  };
}
