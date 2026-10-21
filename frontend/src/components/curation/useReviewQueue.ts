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
 * keyed on the filters and the row a link opened the list at, and always asks for the answered lists' first pages, so paging
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  fetchReviewQueue,
  type QueueFacets, type ReviewQueue, type ReviewQueueItem, type ReviewQueueKind,
} from '../../api/reviewQueue';
import type { ReviewAddress } from '../../utils/appUrl';
import { queueRows, serverRowOf, type QueueRow } from './queueRows';
import { queryKeys } from '../../api/queryKeys';

/** Where a page of questions starts: after a cursor, or, for a linked list's first page, at a row. */
interface QueuePageParam {
  cursor?: string;
  anchor?: string;
}

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
  /**
   * The list was opened at a linked row past its top, so the rows above it are not
   * loaded and *Show more* will not load them: a heading may not count a group as
   * whole even once every later page is in.
   */
  startsPastTop: boolean;
  /** Reads the list again from its top, for the questions above the row a link opened it at. */
  openAtTop: () => void;
  /**
   * The selected row left the loaded pages and the server is being asked whether it still
   * holds a question (#1779). Until it answers, the row is neither answered nor in the list,
   * so nothing may move the selection off it.
   */
  settling: boolean;
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
  // The row the list was opened at, or null for its top: a link's row, or the row kept
  // through a change of order. It is in the query key, so a link to a row the list does
  // not hold reads a list that starts there (below), while a click on a loaded row moves
  // nothing.
  const [opening, setOpening] = useState<string | null>(address.row);
  const [lastRow, setLastRow] = useState(address.row);
  // Where the list a link opened began, as its first page said (`paging.from`): the first
  // page is read again from that key rather than from the row, which an answer takes out
  // of the list — read again at the row, the list would open at its top, away from the
  // question after it. Per list, so a new one starts from its own row.
  const fromRef = useRef<{ list: string; from: string } | null>(null);
  // The row the latest first page was read *at*, or null when it was read from the top or
  // from the key a linked list began at. Only a read at the row can say the row is gone.
  const [readAt, setReadAt] = useState<string | null>(null);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setOffsets({});
    setOpening(address.row);
  }
  const list = JSON.stringify([filters, opening]);

  const {
    data, isLoading, isPlaceholderData, isError, error,
    hasNextPage, isFetchingNextPage, fetchNextPage, refetch,
  } = useInfiniteQuery({
    // `row` is out of the key deliberately: opening a question must not re-read the list
    // it was opened from. `opening` is in it, and moves only for a link (below). The object is hashed by value, so the address re-rendering with
    // an equal one refetches nothing.
    queryKey: queryKeys.curation.reviewQueue('questions', filters, opening),
    queryFn: async ({ pageParam }) => {
      const firstOfLink = pageParam.anchor !== undefined;
      const from = firstOfLink && fromRef.current?.list === list ? fromRef.current.from : undefined;
      const anchor = from ? undefined : pageParam.anchor;
      const page = await fetchReviewQueue({ ...filters, cursor: pageParam.cursor, anchor, from });
      if (pageParam.cursor === undefined) setReadAt(anchor ?? null);
      // Every question from the key the list began at down has been answered: the ones
      // above it are all that is left, and the list reads them from its top rather than
      // calling itself empty.
      if (from && queueRows(page).length === 0 && page.total > 0) {
        fromRef.current = null;
        setReadAt(null);
        return fetchReviewQueue({ ...filters, cursor: pageParam.cursor });
      }
      if (firstOfLink && page.paging?.from) fromRef.current = { list, from: page.paging.from };
      return page;
    },
    // A link names its row (ADR-0051 decision 5), and the row is often past the first
    // page: the first page of a list opened with one asks for the page one key before
    // that row, so the list arrives with it on screen (#843). Only the first page of a
    // new list carries it — later pages follow the cursor — and a refetch re-reads the
    // same anchor — by the key the list began at once it is known (`fromRef`) — recomputing
    // the cursors from there, so the pages stay one chain. A row the filters exclude
    // anchors nothing and the list opens at its top.
    initialPageParam: { anchor: serverRowOf(opening) ?? undefined } as QueuePageParam,
    getNextPageParam: (last: ReviewQueue): QueuePageParam | undefined => (
      last.paging?.nextCursor ? { cursor: last.paging.nextCursor } : undefined
    ),
    // The previous filter's answer stays on screen until the new one arrives, rather than
    // the whole read emptying: without it the toolbar prints "0 open" and the region and
    // run menus say they have nothing between every keystroke of a search, which reads as
    // an answer rather than as a wait. `stale` below is how a caller tells the two apart.
    placeholderData: keepPreviousData,
  });

  const pages = data?.pages;
  const rows = useMemo(() => (pages ?? []).flatMap(page => queueRows(page)), [pages]);
  const first = pages?.[0];

  // A new address row the list does not hold is a link — a click picks a loaded row, and
  // the page's own move after an answer picks one too — so the list is read again
  // starting at it, whatever this list had cached. Adjusted during the render, like the
  // filter above, so the page never writes a row out of the list the link replaced.
  if (address.row !== lastRow) {
    setLastRow(address.row);
    if (address.row !== null && !rows.some(row => row.key === address.row)) setOpening(address.row);
  }

  // The selected row gone from the loaded pages after a re-read is one of two things, and
  // the list cannot tell them apart (#1779): answered, or moved. A row's date is its newest
  // question, so answering that one can sort a place holding an older question past the
  // pages loaded — the Hermitage, whose Art Museums question from run 177 put it under
  // today and whose Archaeology question from run 169 is still open. One read anchored at
  // the row asks the server: still there, and the list is read again starting at it, the
  // way a link opens one (#843), with the selection kept; not there, and it was answered.
  // Only a page read *at* the row answers that by itself: a linked list re-reads from the
  // key it began at (`fromRef`), which a re-dated row can have left.
  const [probe, setProbe] = useState<{ key: string; gone: boolean } | null>(null);
  const sought = address.row;
  const missing = sought !== null && data !== undefined && !isPlaceholderData
    && !rows.some(row => row.key === sought);
  const asking = missing && readAt !== serverRowOf(sought) && !(probe?.key === sought && probe.gone);
  // Found again in the list, whatever was decided about it before (a top read marks it
  // gone): a later answer that moves it is asked about afresh.
  if (probe !== null && probe.key === sought && !missing && data !== undefined
    && !isPlaceholderData) setProbe(null);
  // What the address names now, for a probe answering after the curator moved on: a late
  // "still there" must not read the list again at a row they left, or under old filters.
  const current = useRef({ row: sought, filterKey });
  useEffect(() => { current.current = { row: sought, filterKey }; }, [sought, filterKey]);
  useEffect(() => {
    if (!asking || sought === null || probe?.key === sought) return;
    setProbe({ key: sought, gone: false });
    const askedUnder = filterKey;
    const holds = (page: ReviewQueue) => queueRows(page).some(row => row.key === sought);
    fetchReviewQueue({ ...filters, anchor: serverRowOf(sought) ?? undefined })
      .then(page => {
        // Dropped, and forgotten: a curator who comes back to the row is asked about afresh
        // rather than held on a probe nobody is waiting for.
        if (current.current.row !== sought || current.current.filterKey !== askedUnder) {
          setProbe(p => (p?.key === sought && !p.gone ? null : p));
          return;
        }
        if (!holds(page)) { setProbe({ key: sought, gone: true }); return; }
        // Read again at the row: a new list for a row the list was not opened at, or the
        // same list re-read without the key it began at, for one it was (a link).
        fromRef.current = null;
        if (opening === sought) void refetch();
        else setOpening(sought);
      })
      .catch(() => setProbe({ key: sought, gone: true }));
  }, [asking, sought, probe, filters, filterKey, opening, refetch]);

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
    startsPastTop: Boolean(first?.paging?.from),
    // The curator asked for the top: the row they had open is not looked for again there.
    openAtTop: () => {
      fromRef.current = null;
      if (address.row !== null) setProbe({ key: address.row, gone: true });
      setOpening(null);
    },
    settling: asking,
    step: (kind, by) => setOffsets(o => ({
      ...o, [kind]: Math.max(0, (o[kind] ?? 0) + by * (first?.limit ?? 25)),
    })),
  };
}
