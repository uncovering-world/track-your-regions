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

/**
 * `locationsResolved` is what consumers must gate an in-region count on.
 *
 * The counts are derived by filtering this map, so an absent answer and a
 * genuine zero are the same shape at the point of use — and the chip that reads
 * them takes its denominator from `experience.location_count` instead, which
 * arrives with the experience. A failed or pending batch therefore renders a
 * confident `0/N` rather than nothing. That was reported as a data bug when the
 * batch was 404ing; the 404 is fixed, but any other failure — 500, offline, an
 * aborted navigation — produces the same misleading chip unless the caller can
 * tell "no locations here" from "no answer yet".
 */
export function useRegionLocations(regionId: number | null, includeLost = false) {
  const { data } = useQuery({
    // `includeLost` is part of the key: the two answers are different sets, and
    // sharing a cache entry would leave a revealed row without its markers
    // until the batch happened to be refetched.
    queryKey: ['region-locations', regionId, includeLost],
    queryFn: () => fetchRegionExperienceLocations(regionId!, { includeChildren: false, includeLost }),
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

  return {
    locationsByExperience,
    /**
     * There is a batch in hand — counts derived from it mean something.
     *
     * Presence of data is the whole test. `isLoading` is `isPending &&
     * isFetching`, and `isPending` means no data, so it adds nothing here. And
     * `isError` would take away more than it gives: a query that already holds
     * data and then fails a *background* refetch reports `status: 'error'` with
     * the data preserved, which is reachable with this staleTime and the global
     * `retry: 1`. Revoking on that would disable visit tracking across the
     * sidebar while every location is still on screen, for a batch that is
     * complete and correct — it is only stale.
     */
    locationsResolved: data != null,
  };
}
