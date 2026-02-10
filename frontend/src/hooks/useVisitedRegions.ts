/**
 * Hook for managing visited regions state
 * Only fetches/updates for authenticated users
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchVisitedRegionsByWorldView,
  markRegionVisited,
  unmarkRegionVisited,
  type VisitedRegion,
} from '../api';
import { useAuth } from './useAuth';

export function useVisitedRegions(worldViewId: number | undefined) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const queryKey = ['visited-regions', worldViewId];

  // Fetch visited regions for this world view (only if authenticated)
  const { data: visitedRegions = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchVisitedRegionsByWorldView(worldViewId!),
    enabled: !!worldViewId && isAuthenticated,
    staleTime: 30000, // 30 seconds
  });

  // Create a Set for quick lookup
  const visitedRegionIds = new Set(visitedRegions.map(vr => vr.region_id));

  // Check if a region is visited
  const isVisited = (regionId: number) => visitedRegionIds.has(regionId);

  // Toggle visited mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ regionId, visited }: { regionId: number; visited: boolean }) => {
      if (!isAuthenticated) {
        throw new Error('Sign in to track visited regions');
      }
      if (visited) {
        return markRegionVisited(regionId);
      } else {
        return unmarkRegionVisited(regionId);
      }
    },
    // Optimistic update
    onMutate: async ({ regionId, visited }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousVisited = queryClient.getQueryData<VisitedRegion[]>(queryKey);

      // Optimistically update
      queryClient.setQueryData<VisitedRegion[]>(queryKey, (old = []) => {
        if (visited) {
          // Add to list
          return [...old, { region_id: regionId, visited_at: new Date().toISOString(), notes: null }];
        } else {
          // Remove from list
          return old.filter(vr => vr.region_id !== regionId);
        }
      });

      return { previousVisited };
    },
    // If mutation fails, rollback
    onError: (_err, _vars, context) => {
      if (context?.previousVisited) {
        queryClient.setQueryData(queryKey, context.previousVisited);
      }
    },
    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Toggle function
  const toggleVisited = (regionId: number) => {
    const currentlyVisited = isVisited(regionId);
    toggleMutation.mutate({ regionId, visited: !currentlyVisited });
  };

  return {
    visitedRegions,
    visitedRegionIds,
    isLoading,
    isVisited,
    toggleVisited,
    isToggling: toggleMutation.isPending,
    // Whether user can toggle visited status (requires auth)
    canToggle: isAuthenticated,
  };
}
