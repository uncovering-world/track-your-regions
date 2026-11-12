/**
 * Hook for managing user's visited experiences and locations
 */

import { useMemo, useCallback } from 'react';
import { useIsMutating, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { invalidateVisitedStatus } from '../utils/queryInvalidation';
import {
  fetchExperienceVisitedStatus, fetchViewedTreasureIds, fetchVisitedExperienceIds, fetchVisitedLocationIds,
  markAllLocationsVisited, markExperienceVisited, markLocationVisited, markTreasureViewed, unmarkAllLocationsVisited,
  unmarkExperienceVisited, unmarkLocationVisited, unmarkTreasureViewed,
} from '../api/visited';
import { queryKeys } from '../api/queryKeys';
import type { VisitedStatus } from '../api/visited';

/**
 * Hook for managing experience-level visited status (backward compatible)
 */
export function useVisitedExperiences(kindId?: number) {
  const { isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch visited experience IDs
  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.visited.experiences(user?.id, kindId),
    queryFn: () => fetchVisitedExperienceIds(kindId),
    enabled: isAuthenticated,
    staleTime: 60000, // 1 minute
  });

  // Convert to Set for O(1) lookup. `visitedIds` holds the places visited
  // wholly or in part, `partialIds` those in part (#2120): one read, which
  // Map mode and Discover both draw from.
  const visitedIdsSet = useMemo(() => {
    return new Set(data?.visitedIds || []);
  }, [data?.visitedIds]);
  const partialIdsSet = useMemo(() => {
    return new Set(data?.partialIds || []);
  }, [data?.partialIds]);
  const visitedStatusOf = useCallback((experienceId: number): VisitedStatus => {
    if (!visitedIdsSet.has(experienceId)) return 'not_visited';
    return partialIdsSet.has(experienceId) ? 'partial' : 'visited';
  }, [visitedIdsSet, partialIdsSet]);
  // A whole ticked as a whole, its parts not named: what its card's button shows.
  const wholeTickedIdsSet = useMemo(() => new Set(data?.wholeTickedIds || []), [data?.wholeTickedIds]);
  const isWholeTicked = useCallback(
    (experienceId: number) => wholeTickedIdsSet.has(experienceId), [wholeTickedIdsSet],
  );

  // Mark as visited mutation
  const markVisitedMutation = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: markExperienceVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Unmark as visited mutation
  const unmarkVisitedMutation = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: unmarkExperienceVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  return {
    visitedIds: visitedIdsSet,
    partialIds: partialIdsSet,
    visitedStatusOf,
    isWholeTicked,
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
  const { isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch visited location IDs
  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.visited.locations(user?.id, experienceId),
    queryFn: () => fetchVisitedLocationIds(experienceId),
    enabled: isAuthenticated,
    staleTime: 60000, // 1 minute
  });

  // Convert to Set for O(1) lookup
  const visitedLocationIdsSet = useMemo(() => {
    return new Set(data?.visitedLocationIds || []);
  }, [data?.visitedLocationIds]);

  // Mark location as visited mutation
  const markLocationVisitedMutation = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: markLocationVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Unmark location as visited mutation
  const unmarkLocationVisitedMutation = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: unmarkLocationVisited,
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Mark locations of an experience as visited (optionally filtered by region)
  const markAllLocationsMutation = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: ({ experienceId, regionId }: { experienceId: number; regionId?: number }) =>
      markAllLocationsVisited(experienceId, regionId),
    onSuccess: () => {
      invalidateVisitedStatus(queryClient);
    },
  });

  // Unmark locations of an experience as visited (optionally filtered by region)
  const unmarkAllLocationsMutation = useMutation({
    mutationKey: queryKeys.visited.write,
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

  return {
    visitedLocationIds: visitedLocationIdsSet,
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
  };
}

/**
 * Hook for managing viewed treasures (artwork "seen" tracking)
 */
export function useViewedTreasures(experienceId?: number) {
  const { isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.visited.treasures(user?.id, experienceId),
    queryFn: () => fetchViewedTreasureIds(experienceId),
    enabled: isAuthenticated,
    staleTime: 60000,
  });

  const viewedIds = useMemo(() => {
    return new Set(data?.viewedTreasureIds || []);
  }, [data?.viewedTreasureIds]);

  const markViewedMutation = useMutation({
    mutationKey: queryKeys.visited.write,
    mutationFn: ({ treasureId, experienceId }: { treasureId: number; experienceId?: number }) =>
      markTreasureViewed(treasureId, experienceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.visited.treasuresAll });
      invalidateVisitedStatus(queryClient);
    },
  });

  const unmarkViewedMutation = useMutation({
    mutationFn: unmarkTreasureViewed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.visited.treasuresAll });
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
  const { isAuthenticated, user } = useAuth();

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.visited.status(user?.id, experienceId),
    queryFn: () => fetchExperienceVisitedStatus(experienceId!),
    enabled: isAuthenticated && experienceId !== null,
    staleTime: 60000,
  });

  return {
    visitedStatus: data?.visitedStatus || 'not_visited',
    castPoints: data?.castPoints ?? false,
    totalLocations: data?.totalLocations || 0,
    visitedLocations: data?.visitedLocations || 0,
    locations: data?.locations || [],
    isLoading,
    refetch,
  };
}

/**
 * Whether any write of this traveller's visits is on its way: a tick or untick
 * of a place or a point, a mark or unmark of many, a seen work's venue. Every
 * control that writes a visit waits on it, so a second click never races the
 * first (#2120).
 */
export function useVisitWritePending(): boolean {
  return useIsMutating({ mutationKey: queryKeys.visited.write }) > 0;
}
