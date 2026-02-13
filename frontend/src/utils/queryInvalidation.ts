/**
 * Shared query invalidation helpers for TanStack Query.
 *
 * Groups commonly co-invalidated query keys to reduce duplication
 * across mutation handlers. Each function accepts a QueryClient and
 * optional context parameters.
 */

import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalidate experience list caches after creating, editing, assigning,
 * or rejecting an experience. Optionally scoped to a region.
 */
export function invalidateExperiences(
  queryClient: QueryClient,
  opts?: { regionId?: number | null; experienceId?: number },
) {
  if (opts?.regionId) {
    queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', opts.regionId] });
  }
  queryClient.invalidateQueries({ queryKey: ['discover-experiences'] });
  queryClient.invalidateQueries({ queryKey: ['discover-region-counts'] });
  queryClient.invalidateQueries({ queryKey: ['experiences'] });
  if (opts?.experienceId) {
    queryClient.invalidateQueries({ queryKey: ['experience', opts.experienceId] });
    queryClient.invalidateQueries({ queryKey: ['curation-log', opts.experienceId] });
  }
}

/**
 * Invalidate visited status caches after marking/unmarking visits.
 * Used by experience visit, location visit, and treasure view mutations.
 */
export function invalidateVisitedStatus(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['visited-experiences'] });
  queryClient.invalidateQueries({ queryKey: ['visited-locations'] });
  queryClient.invalidateQueries({ queryKey: ['experience-visited-status'] });
}
