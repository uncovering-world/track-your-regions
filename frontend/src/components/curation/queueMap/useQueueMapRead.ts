import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchReviewQueueMap } from '../../../api/reviewQueue';
import { queryKeys } from '../../../api/queryKeys';
import type { ReviewAddress } from '../../../utils/appUrl';

/**
 * The review queue's map read (#2477): every open question the address's chips select, one
 * entry per place with its point. One query for the map, which draws it, and the page, which
 * walks to the nearest open question after an answer, so both read the same answer.
 *
 * Keyed under `reviewQueueAll`, so the refresh an answer makes takes the answered question
 * off the map as it takes it off the list. A chip changed keeps the points it had until the
 * new ones arrive (`isPlaceholderData` says which), as the list does. `chipsKey` names the
 * chips the read answers, which the map frames again on.
 */
export function useQueueMapRead(address: ReviewAddress, enabled = true) {
  const {
    q, sourceIds, kinds, regionId, runId, showAside,
  } = address;
  const chips = useMemo(() => ({
    q, sourceIds, kinds, regionId, runId, showAside,
  }), [q, sourceIds, kinds, regionId, runId, showAside]);
  const read = useQuery({
    queryKey: queryKeys.curation.reviewQueue('map', chips),
    queryFn: () => fetchReviewQueueMap(address),
    placeholderData: keepPreviousData,
    enabled,
  });
  return { read, chipsKey: JSON.stringify(chips) };
}
