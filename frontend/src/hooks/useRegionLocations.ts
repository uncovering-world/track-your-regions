/**
 * Shared hook for batch-fetching all experience locations in a region.
 *
 * Replaces N+1 individual fetchExperienceLocations calls with a single
 * batch request. Used by both ExperienceMarkers (map) and ExperienceList.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchRegionExperienceLocations,
  type ExperienceLocation,
} from '../api/experiences';

export function useRegionLocations(regionId: number | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['region-locations', regionId],
    queryFn: () => fetchRegionExperienceLocations(regionId!, { includeChildren: false }),
    enabled: regionId != null,
    staleTime: 300_000, // 5 min — locations don't change often
  });

  // Convert string keys from JSON to number keys
  const locationsByExperience = useMemo<Record<number, ExperienceLocation[]>>(() => {
    if (!data?.locationsByExperience) return {};
    const result: Record<number, ExperienceLocation[]> = {};
    for (const [key, locs] of Object.entries(data.locationsByExperience)) {
      result[Number(key)] = locs;
    }
    return result;
  }, [data?.locationsByExperience]);

  return { locationsByExperience, isLoading };
}
