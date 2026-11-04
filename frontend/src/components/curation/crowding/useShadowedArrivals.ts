/**
 * The new arrivals a crowded city would shadow (ADR-0180, #2282), as the
 * review page reads them: the count on its *Crowded cities* tab, and the list
 * that tab draws, from one request.
 *
 * The queue's questions leave such an arrival out (`arrivalOpenSql`): it would
 * not be shown once published, and unpublished it is not in the shadowed list
 * either, so without the tab it is asked nowhere. Not narrowed by the queue's
 * filters, which choose among the queue's questions.
 *
 * With a region (#2349), the groups within it, as the server reads "within":
 * which the tab's Region chip asks for, under the key an Apply refreshes with
 * the rest.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchShadowedArrivals } from '../../../api/crowding';
import { queryKeys } from '../../../api/queryKeys';

export function useShadowedArrivals(region?: number | 'none') {
  return useQuery({
    queryKey: region === undefined ? queryKeys.curation.shadowedArrivals : queryKeys.curation.shadowedArrivalsWithin(region),
    queryFn: () => fetchShadowedArrivals(region),
    staleTime: 60_000,
  });
}
