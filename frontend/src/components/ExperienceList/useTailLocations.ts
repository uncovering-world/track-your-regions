/**
 * The points of the tail's places whose cards the reader opened (#2201).
 *
 * The region's batch of points (`useRegionLocations`) answers for the places
 * the list shows, and a crowded-out place is not one (ADR-0172). A tail row
 * still needs its points: they are what its visited box and its card's places
 * are read over. So the open card's points are read on their own, from the
 * place's own read with `in_region` asked of the region, once its card opens —
 * one request where the card already makes two, never one per row, since every
 * one of them is under the limiter the list's own reads share. A card opened
 * once keeps its points for as long as the cache does, so its row keeps its
 * box after it folds; a row never opened has no points in hand, and its box
 * waits, as every row's does until the batch settles.
 */

import { useMemo, useState } from 'react';
import { useQueries, type QueryObserverResult } from '@tanstack/react-query';
import {
  fetchExperienceLocations, type ExperienceLocationsResponse, type RegionExperienceLocation,
} from '../../api/experiences';
import { queryKeys } from '../../api/queryKeys';

/** Stable, so `useQueries` hands back the same array while no answer changes. */
const answersOf = (results: Array<QueryObserverResult<ExperienceLocationsResponse>>) => results.map(r => r.data);

/** The points a reader is shown, as the region batch carries them: no unread one, and no path. */
function asRegionPoints(answer: ExperienceLocationsResponse): RegionExperienceLocation[] {
  return answer.locations
    .filter(loc => loc.curation_state !== 'pending')
    .map(loc => ({
      id: loc.id,
      experience_id: loc.experience_id,
      name: loc.name,
      external_ref: loc.external_ref,
      ordinal: loc.ordinal,
      longitude: loc.longitude,
      latitude: loc.latitude,
      approximate: loc.approximate,
      created_at: loc.created_at,
      curated_fields: loc.curated_fields,
      in_region: loc.in_region,
      image_url: loc.image_url,
      image_credit: loc.image_credit,
      wikipedia_url: loc.wikipedia_url,
      region_path: null,
    }));
}

/** By place id, the points of every tail card opened in this region; `cardId` is the one open now, or null. */
export function useTailLocations(
  regionId: number | null,
  cardId: number | null,
): Readonly<Record<number, RegionExperienceLocation[]>> {
  const [opened, setOpened] = useState<{ regionId: number | null; ids: readonly number[] }>({ regionId, ids: [] });
  const ids = opened.regionId === regionId ? opened.ids : [];
  // During render, as the list resets its groups: the card's points are asked
  // for in the render that opens it.
  if (cardId !== null && !ids.includes(cardId)) setOpened({ regionId, ids: [...ids, cardId] });

  const answers = useQueries({
    queries: ids.map(id => ({
      queryKey: queryKeys.experience.locationsIn(id, regionId),
      queryFn: () => fetchExperienceLocations(id, regionId ?? undefined),
      enabled: regionId !== null,
      staleTime: 300_000,
    })),
    combine: answersOf,
  });

  return useMemo(() => {
    const held: Record<number, RegionExperienceLocation[]> = {};
    for (const answer of answers) if (answer) held[answer.experienceId] = asRegionPoints(answer);
    return held;
  }, [answers]);
}
