import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { QUEUE_MAP_NAMES_MAX } from '@tyr/shared/reviewQueue';
import { fetchQueueMapNames } from '../../../api/reviewQueue';
import { queryKeys } from '../../../api/queryKeys';

/**
 * The names of the places a short list on the review queue's map shows (#2501), read when
 * the list opens: the map's own read carries no names, since names on every place would
 * double what it costs, and the review list's rows hold only the page it has loaded.
 *
 * Asks for every place of the list, in its order, `QUEUE_MAP_NAMES_MAX` to a read, so a list
 * longer than one read is named whole; and nothing while no list is open. `nameOf` answers a
 * place's name once a read holds it; `pending` says a read is still on its way, so the list
 * can say it is reading rather than show a blank.
 */
export function useQueueMapNames(placeIds: readonly number[]) {
  const parts = useMemo(() => {
    const out: number[][] = [];
    for (let start = 0; start < placeIds.length; start += QUEUE_MAP_NAMES_MAX) {
      out.push(placeIds.slice(start, start + QUEUE_MAP_NAMES_MAX));
    }
    return out;
  }, [placeIds]);
  const { names, pending } = useQueries({
    queries: parts.map(ids => ({
      queryKey: queryKeys.curation.reviewQueueMapNames(ids),
      queryFn: () => fetchQueueMapNames(ids),
    })),
    combine: results => ({
      names: new Map(results.flatMap(result => result.data?.names.map(entry => [entry.placeId, entry.name] as const) ?? [])),
      pending: results.some(result => result.isPending),
    }),
  });
  const nameOf = useCallback((placeId: number) => names.get(placeId), [names]);
  return { nameOf, pending };
}
