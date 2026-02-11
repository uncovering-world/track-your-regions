/**
 * Hook for managing user's visited experiences and locations
 */

import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { authFetchJson } from '../api/fetchUtils';
import type { VisitedStatus, ExperienceVisitedStatusResponse } from '../api/experiences';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface VisitedExperienceIds {
  visitedIds: number[];
  total: number;
}

interface VisitedLocationIds {
  visitedLocationIds: number[];
  byExperience: Record<number, number[]>;
  total: number;
}

/**
 * Hook for managing experience-level visited status (backward compatible)
 */
export function useVisitedExperiences(categoryId?: number) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  // Fetch visited experience IDs
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['visited-experiences', 'ids', categoryId],
    queryFn: async (): Promise<VisitedExperienceIds> => {
      const params = categoryId ? `?categoryId=${categoryId}` : '';
      return authFetchJson(`${API_URL}/api/users/me/visited-experiences/ids${params}`);
    },
    enabled: isAuthenticated,
    staleTime: 60000, // 1 minute
  });

  // Convert to Set for O(1) lookup
  const visitedIdsSet = useMemo(() => {
    return new Set(data?.visitedIds || []);
  }, [data?.visitedIds]);

  // Mark as visited mutation
  const markVisitedMutation = useMutation({
    mutationFn: async (experienceId: number) => {
      return authFetchJson(`${API_URL}/api/users/me/visited-experiences/${experienceId}`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
    },
  });

  // Unmark as visited mutation
  const unmarkVisitedMutation = useMutation({
    mutationFn: async (experienceId: number) => {
      return authFetchJson(`${API_URL}/api/users/me/visited-experiences/${experienceId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
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
    queryFn: async (): Promise<VisitedLocationIds> => {
      const params = experienceId ? `?experienceId=${experienceId}` : '';
      return authFetchJson(`${API_URL}/api/users/me/visited-locations/ids${params}`);
    },
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
    mutationFn: async (locationId: number) => {
      return authFetchJson(`${API_URL}/api/users/me/visited-locations/${locationId}`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
      queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
    },
  });

  // Unmark location as visited mutation
  const unmarkLocationVisitedMutation = useMutation({
    mutationFn: async (locationId: number) => {
      return authFetchJson(`${API_URL}/api/users/me/visited-locations/${locationId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
      queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
    },
  });

  // Mark locations of an experience as visited (optionally filtered by region)
  const markAllLocationsMutation = useMutation({
    mutationFn: async ({ experienceId, regionId }: { experienceId: number; regionId?: number }) => {
      const params = regionId ? `?regionId=${regionId}` : '';
      return authFetchJson(`${API_URL}/api/users/me/experiences/${experienceId}/mark-all-locations${params}`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
      queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
    },
  });

  // Unmark locations of an experience as visited (optionally filtered by region)
  const unmarkAllLocationsMutation = useMutation({
    mutationFn: async ({ experienceId, regionId }: { experienceId: number; regionId?: number }) => {
      const params = regionId ? `?regionId=${regionId}` : '';
      return authFetchJson(`${API_URL}/api/users/me/experiences/${experienceId}/mark-all-locations${params}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
      queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
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
    queryFn: async (): Promise<{ viewedTreasureIds: number[] }> => {
      const params = experienceId ? `?experienceId=${experienceId}` : '';
      return authFetchJson(`${API_URL}/api/users/me/viewed-treasures/ids${params}`);
    },
    enabled: isAuthenticated,
    staleTime: 60000,
  });

  const viewedIds = useMemo(() => {
    return new Set(data?.viewedTreasureIds || []);
  }, [data?.viewedTreasureIds]);

  const markViewedMutation = useMutation({
    mutationFn: async (treasureId: number) => {
      return authFetchJson(`${API_URL}/api/users/me/viewed-treasures/${treasureId}`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['viewed-treasures'] });
      queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
      queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
    },
  });

  const unmarkViewedMutation = useMutation({
    mutationFn: async (treasureId: number) => {
      return authFetchJson(`${API_URL}/api/users/me/viewed-treasures/${treasureId}`, {
        method: 'DELETE',
      });
    },
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
    queryFn: async (): Promise<ExperienceVisitedStatusResponse> => {
      return authFetchJson(`${API_URL}/api/users/me/experiences/${experienceId}/visited-status`);
    },
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
