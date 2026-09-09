/**
 * The review queue as the page reads it: one list, asked for under an address.
 *
 * Everything the endpoint answers arrives through here, and it is two paging models rather
 * than one (ADR-0051 decision 2). The seven open kinds are a single keyset-paged union —
 * `useInfiniteQuery` over `paging.nextCursor`, the pages flattened through `queueRows` in
 * the order they arrived, so *Show more* appends rather than replaces. `keptOut` and
 * `answeredWithdrawals` are not open questions at all: they carry no date to order that
 * union by, only ever grow, and keep their own statement, their own offset and their own
 * pager — which is why an offset lives in this hook's state while the cursor does not.
 *
 * The counts, the facets and both answered lists are read off the **first** page: each is
 * stated once over the whole filtered union, and a later page repeats it unchanged.
 *
 * **Paging an answered list restarts the union at its first page**, and it is a real cost
 * rather than a subtlety: the two offsets sit in the infinite query's key, because they are
 * sent with every request and one endpoint answers both models. Change one and React Query
 * has a different query — the pages a curator loaded with *Show more* are dropped and
 * re-read from the cursor's start, while the answered block they were actually paging moves
 * by one. It is tolerable only because the two lists are collapsed sections a curator opens
 * to look something up rather than the list they work down, and because the reload is a
 * refetch of pages the server would answer identically. The fix is not a smaller query key —
 * the offsets genuinely change what the endpoint returns — but a read of its own for the two
 * lists that are not open questions, which is filed as a follow-up rather than folded into
 * this change.
 *
 * Split out of `ReviewPage.tsx` because they are two jobs: this is what the server holds,
 * and the page is what the curator does with it — the selection, the notice line and the
 * layout.
 */

import { useMemo, useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
  fetchReviewQueue,
  type QueueFacets, type ReviewQueue, type ReviewQueueItem, type ReviewQueueKind,
} from '../../api/experiences';
import type { ReviewAddress } from '../../utils/appUrl';
import { queueRows, type QueueRow } from './queueRows';

/** Every query the page's answers invalidate — the union's pages under whatever filter. */
export const QUEUE_KEY = ['curation', 'reviewQueue'];

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
  /** Moves one answered list by `by` pages, never below zero. */
  step: (kind: ReviewQueueKind, by: number) => void;
}

export function useReviewQueue(address: ReviewAddress): ReviewQueueRead {
  // One offset per answered list, and only those two — see the docblock.
  const [offsets, setOffsets] = useState<Partial<Record<ReviewQueueKind, number>>>({});
  const keptOutOffset = offsets.keptOut ?? 0;
  const answeredWithdrawalsOffset = offsets.answeredWithdrawals ?? 0;

  const filters = useMemo(() => ({ ...address, row: null }), [address]);
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const {
    data, isLoading, isPlaceholderData, isError, error,
    hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useInfiniteQuery({
    // `row` is out of the key deliberately: opening a question must not re-read the list
    // it was opened from. The object is hashed by value, so the address re-rendering with
    // an equal one refetches nothing.
    queryKey: [...QUEUE_KEY, filters, keptOutOffset, answeredWithdrawalsOffset],
    queryFn: ({ pageParam }) => fetchReviewQueue({
      ...filters, cursor: pageParam, keptOutOffset, answeredWithdrawalsOffset,
    }),
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

  return {
    rows,
    total: first?.total ?? 0,
    pageSize: first?.limit ?? 25,
    facets: first?.facets,
    keptOut: first?.keptOut ?? [],
    answeredWithdrawals: first?.answeredWithdrawals ?? [],
    filterKey,
    stale: isPlaceholderData,
    isLoading,
    isError,
    error,
    hasMore: hasNextPage,
    loadingMore: isFetchingNextPage,
    more: () => { void fetchNextPage(); },
    pageOf: kind => first?.paging?.[kind] ?? { offset: 0, hasMore: false },
    step: (kind, by) => setOffsets(o => ({
      ...o, [kind]: Math.max(0, (o[kind] ?? 0) + by * (first?.limit ?? 25)),
    })),
  };
}
