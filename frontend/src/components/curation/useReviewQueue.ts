/**
 * The review queue as the page reads it: one list, asked for under an address.
 *
 * Everything the endpoint answers arrives through here, and it is two paging models rather
 * than one (ADR-0051 decision 2). The open kinds (`QUEUE_KINDS`) are a single keyset-paged union —
 * `useInfiniteQuery` over `paging.nextCursor`, the pages flattened through `queueRows` in
 * the order they arrived, so *Show more* appends rather than replaces. `keptOut` and
 * `answeredWithdrawals` are not open questions at all: they carry no date to order that
 * union by, only ever grow, and keep their own statement, their own offset and their own
 * pager — which is why an offset lives in this hook's state while the cursor does not.
 * `refusedParts` (#859) is the third of them and behaves identically.
 *
 * The counts and the facets are read off the **first** page: each is stated once over the
 * whole filtered union, and a later page repeats it unchanged.
 *
 * **The answered lists have a read of their own** (#840). The questions' infinite query is
 * keyed on the filters alone and always asks for the answered lists' first pages, so paging
 * an answered block never touches the pages a curator loaded with *Show more*. A list at its
 * first page is read off the questions' first page — no second request. Once one is paged, a
 * query of its own asks the same endpoint at the three offsets, keyed on the filters and the
 * offsets alone, and a paged list is read from it; it still answers a first page of
 * questions, which this read ignores, and that is the price of not having an endpoint of its
 * own for a block a curator opens to look something up. Its failure is the paged block's own
 * (`answeredFailed`), so the rest of the page stands.
 *
 * Split out of `ReviewPage.tsx` because they are two jobs: this is what the server holds,
 * and the page is what the curator does with it — the selection, the notice line and the
 * layout.
 */

import { useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchReviewQueue,
  type QueueFacets, type ReviewQueue, type ReviewQueueItem, type ReviewQueueKind,
} from '../../api/reviewQueue';
import type { ReviewAddress } from '../../utils/appUrl';
import { queueRows, type QueueRow } from './queueRows';
import { queryKeys } from '../../api/queryKeys';

/** How far an answered list has been paged, and whether anything waits behind it. */
export interface AnsweredPage {
  offset: number;
  hasMore: boolean;
}

export interface ReviewQueueRead {
  /** Every page loaded so far, in order, as one list of questions. */
  rows: QueueRow[];
  /** The filtered total the server counted, not what this page holds. */
  total: number;
  /** How many rows one page holds — the server's own `limit`, which a confirmation counts against. */
  pageSize: number;
  /** Undefined until the first page answers: the chips are there, the counts are not. */
  facets: QueueFacets | undefined;
  keptOut: ReviewQueueItem[];
  answeredWithdrawals: ReviewQueueItem[];
  refusedParts: ReviewQueueItem[];
  /**
   * The filters as one string — the address without the selected row, which names a card
   * rather than asking the server anything. A page watching *this* sees a filter change
   * and not a row click.
   */
  filterKey: string;
  /**
   * True while what is on screen still answers the *previous* address — the rows, the
   * total and the facets are kept through a filter change so the page does not blank
   * (`placeholderData` below), and for that window they describe a list the address no
   * longer names. Anything that would *write* from these rows has to wait for it to clear.
   */
  stale: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  more: () => void;
  /** Where one answered list is paged to, and whether more waits behind it. */
  pageOf: (kind: ReviewQueueKind) => AnsweredPage;
  /** The paged list's own read failed, so its block cannot show the page it was moved to. */
  answeredFailed: (kind: ReviewQueueKind) => boolean;
  /** Moves one answered list by `by` pages, never below zero. */
  step: (kind: ReviewQueueKind, by: number) => void;
}

export function useReviewQueue(address: ReviewAddress): ReviewQueueRead {
  // One offset per answered list, and only those three — see the docblock.
  const [offsets, setOffsets] = useState<Partial<Record<ReviewQueueKind, number>>>({});
  const keptOutOffset = offsets.keptOut ?? 0;
  const answeredWithdrawalsOffset = offsets.answeredWithdrawals ?? 0;
  const refusedPartsOffset = offsets.refusedParts ?? 0;

  const filters = useMemo(() => ({ ...address, row: null }), [address]);
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  // A filter is a different list, in which the offset a curator had paged to means
  // nothing — the page stays mounted across a filter change, so *Show more* on an
  // answered block and then a new source chip would ask the new filter at the old
  // offset and answer with a block that is empty or missing its first page.
  //
  // Adjusted during the render rather than in an effect, and the difference is a
  // request: an effect runs *after* the render that changed the filter, and these
  // offsets are in the query key below — so that render would start a fetch at the
  // old offset and only the next one ask for zero. Two requests per filter change,
  // and with `keepPreviousData` the first one's answer can paint the wrong block
  // before the second lands. React re-renders before committing this, so the key is
  // read with the offsets already cleared. (`ReviewPage`'s reset of its selection
  // index is an effect because a ref is not a query key; this is.)
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setOffsets({});
  }

  const {
    data, isLoading, isPlaceholderData, isError, error,
    hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useInfiniteQuery({
    // `row` is out of the key deliberately: opening a question must not re-read the list
    // it was opened from. The object is hashed by value, so the address re-rendering with
    // an equal one refetches nothing.
    queryKey: queryKeys.curation.reviewQueue('questions', filters),
    queryFn: ({ pageParam }) => fetchReviewQueue({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ReviewQueue) => last.paging?.nextCursor ?? undefined,
    // The previous filter's answer stays on screen until the new one arrives, rather than
    // the whole read emptying: without it the toolbar prints "0 open" and the region and
    // run menus say they have nothing between every keystroke of a search, which reads as
    // an answer rather than as a wait. `stale` below is how a caller tells the two apart.
    placeholderData: keepPreviousData,
  });

  const pages = data?.pages;
  const rows = useMemo(() => (pages ?? []).flatMap(page => queueRows(page)), [pages]);
  const first = pages?.[0];

  // The answered lists once one of them is paged, and only then: at the first pages they
  // are the questions' first page's own. Under `reviewQueueAll`, so an answer that
  // invalidates the queue re-reads these too.
  const paged = keptOutOffset + answeredWithdrawalsOffset + refusedPartsOffset > 0;
  const { data: answeredPage, isError: answeredError } = useQuery({
    queryKey: queryKeys.curation.reviewQueue(
      'answered', filters, keptOutOffset, answeredWithdrawalsOffset, refusedPartsOffset,
    ),
    queryFn: () => fetchReviewQueue({
      ...filters, keptOutOffset, answeredWithdrawalsOffset, refusedPartsOffset,
    }),
    enabled: paged,
    // The block keeps the page it showed until the next one arrives: the previous answered
    // page of *this* filter, or the first pages the questions carry. React Query hands over
    // the last query that held data whatever its key, which can be another filter's page,
    // with its answers live on it.
    placeholderData: (previous, previousQuery) => (
      previousQuery && JSON.stringify(previousQuery.queryKey[3]) === filterKey ? previous : first
    ),
  });
  /** A paged list reads its own query; a list at its first page, the questions' first page. */
  const sourceOf = (kind: ReviewQueueKind) => ((offsets[kind] ?? 0) > 0 ? answeredPage : first);

  return {
    rows,
    total: first?.total ?? 0,
    pageSize: first?.limit ?? 25,
    facets: first?.facets,
    keptOut: sourceOf('keptOut')?.keptOut ?? [],
    answeredWithdrawals: sourceOf('answeredWithdrawals')?.answeredWithdrawals ?? [],
    refusedParts: sourceOf('refusedParts')?.refusedParts ?? [],
    filterKey,
    stale: isPlaceholderData,
    isLoading,
    isError,
    error,
    hasMore: hasNextPage,
    loadingMore: isFetchingNextPage,
    more: () => { void fetchNextPage(); },
    pageOf: kind => sourceOf(kind)?.paging?.[kind] ?? { offset: offsets[kind] ?? 0, hasMore: false },
    answeredFailed: kind => (offsets[kind] ?? 0) > 0 && answeredError,
    step: (kind, by) => setOffsets(o => ({
      ...o, [kind]: Math.max(0, (o[kind] ?? 0) + by * (first?.limit ?? 25)),
    })),
  };
}
