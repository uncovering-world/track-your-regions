/**
 * The review screen: the queue on the left, the question under decision on the right.
 *
 * It was one column of cards, and the cards are the reason that stopped working. Each one
 * now carries what its decision rests on — both versions of a disputed text in full, the
 * object with its picture and its place, the works a rule counted — so nineteen of them
 * stacked meant reaching the twentieth question by scrolling past nineteen answers' worth
 * of evidence. Splitting them is not decoration: the evidence is what makes a list
 * necessary.
 *
 * What the page decides is smaller than it was. **The address owns the filters, the order
 * and the selected row** (ADR-0051 decision 5) — the toolbar reports a change, this page
 * writes it into the URL through `useReviewAddress`, and the URL is what the query is
 * asked with, so a filtered feed is a link and Back undoes a filter. **`useReviewQueue`
 * owns the read**: the cursor pages of the one union and the three offsets the answered
 * lists still page by. What is left here is the curator's side of it — which question is
 * open, the line that says what the last answer did, and where the two columns sit. The
 * cards answer for themselves, as they always did.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  Stack, Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import {
  bringRunBack, setRunAside, type ReviewQueueItem, type ReviewQueueKind,
} from '../../api/experiences';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { buildReviewUrl, isFilteredReview } from '../../utils/appUrl';
import { plural } from '../../utils/plural';
import { useReviewAddress, type ReviewPatch } from '../../hooks/useReviewAddress';
import { nextSelection, type RowKind } from './queueRows';
import { useReviewQueue, QUEUE_KEY } from './useReviewQueue';
import { ReviewQueueList } from './ReviewQueueList';
import { ReviewToolbar } from './feed/ReviewToolbar';
import { dayOf } from './feed/rowDate';
import { ReviewBench } from './ReviewBench';
import { AnsweredSection } from './AnsweredSection';
import { RefusedPartsCard } from './RefusedPartsCard';
import { KeptOutCard } from './ReviewQueue';
import { AnsweredWithdrawalCard } from './WithdrawnPoints';
import { useRowSelection } from './selection/useRowSelection';
import { useAnswerSelection } from './selection/useAnswerSelection';
import { SelectionBar } from './selection/SelectionBar';
import { SelectionSummary } from './selection/SelectionSummary';
import { answerVerb, lostOfferedFor } from './selection/answerWords';

/**
 * What to add to "nothing here has changed what visitors see", which is not always true.
 *
 * Two kinds are exceptions, for opposite reasons, and both have to be named when they are
 * on the page — a promise a curator can see a counter-example to on the same screen is
 * worse than no promise. A refusal was never shown at all; a withdrawn point *was*, and
 * stopped being the moment the run marked it, since the queue asks only about points whose
 * `missing_since` is set and whose row a reader could reach. The other kinds are genuinely
 * exempt: an object flagged `missing` still reads as ordinary everywhere (ADR-0022, and
 * `experienceLifecycle.ts`'s note on why a *location* is filtered on the same flag where
 * an experience is not).
 *
 * A clause per kind rather than one covering both, because they are different facts and a
 * curator with only one of them on screen should not be told about the other.
 */
export function visibilityCaveat(kinds: Set<RowKind>): string {
  const clauses: string[] = [];
  if (kinds.has('withdrawn')) {
    clauses.push('the places an object lost, which readers stopped seeing the moment the'
      + ' run noticed');
  }
  if (kinds.has('refused')) {
    clauses.push('the rows our own rule for a list turned down, which are hidden already'
      + ' and say why');
  }
  if (clauses.length === 0) return '.';
  return ` — except ${clauses.join(', and ')}.`;
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const { address, go } = useReviewAddress();
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useReviewQueue(address);
  const { rows, total } = queue;

  /**
   * The selected row is the address's, when the list still holds it.
   *
   * `row` naming nothing — a deep link into a question someone else answered, or the row
   * this curator just answered away — is not an error and not an empty bench: the page
   * picks the next question below and writes it back.
   */
  const selected = address.row !== null && rows.some(r => r.key === address.row)
    ? address.row : null;
  const selectedIndex = rows.findIndex(r => r.key === selected);

  /**
   * Where the curator was, kept across the refetch that removes the row they answered.
   *
   * `selectedIndex` is recomputed from the *current* rows, so the instant the answered row
   * leaves the queue it reads -1 — and -1 means "nothing was selected", which sends the
   * selection to the top of the list. That is the behaviour this page was built to avoid,
   * and it survived because `nextSelection` is tested in isolation while the wiring that
   * feeds it was not tested at all.
   */
  const lastIndex = useRef(0);

  // A filter is a different list, in which the index the curator had reached says nothing:
  // `nextSelection` clamps, so row 40 of the old list would open the new one at the last
  // of its three rows. A filtered list starts at the top.
  //
  // Declared *before* the tracker below, because effects run in declaration order within
  // one commit and Back can change the filter and restore a row in the same one: reset
  // last and the restored row's index is thrown away — the curator lands back on their
  // question, answers it, and is sent to row 1.
  //
  // Order is only half the guard, though: the tracker also has to *run* in that commit,
  // and `selectedIndex` on its own does not make it. The restored row can sit at the same
  // index it had before, and the order toggle — the one filter change that keeps `row`
  // (see `onFilterChange`) — usually leaves the index alone entirely. So the tracker
  // watches `queue.filterKey` too, and re-reads the real index after every reset. A
  // toolbar filter that clears `row` is unaffected either way: `selectedIndex` is -1 and
  // the tracker declines to write.
  useEffect(() => { lastIndex.current = 0; }, [queue.filterKey]);

  useEffect(() => {
    if (selectedIndex >= 0) lastIndex.current = selectedIndex;
  }, [selectedIndex, queue.filterKey]);

  // Follow the list rather than hold a key that no longer exists. Answering removes a row,
  // and the selection has to land on the question that took its place — the alternative is
  // an empty bench after every answer, which is a scroll and a click per card. Written
  // with `replace`: the page moved the selection, the curator did not, so Back must not
  // have to step back through it.
  // `queue.stale` is the guard that makes this safe beside `keepPreviousData`: through a
  // filter change the previous answer's rows stay on screen so the page does not blank,
  // and writing a `row` out of them would put a question the new address does not contain
  // into the address — which the next render would then have to correct. It waits.
  useEffect(() => {
    if (queue.stale || rows.length === 0 || selected !== null) return;
    const next = nextSelection(rows, lastIndex.current);
    if (next !== undefined) go({ row: next }, { replace: true });
  }, [rows, selected, go, queue.stale]);

  // A change that names a different list clears the row with it: the question the curator
  // had open was chosen out of a list that no longer exists, and the effect above picks the
  // first row of the new one.
  //
  // The question is asked of the *list*, not of which keys the patch carries. A control's
  // patch mirrors the raw input it took — the search box's `q` is what the curator typed,
  // trailing space and all — while the address only ever holds the normalised form
  // (`normaliseReviewQ`, applied inside `buildReviewUrl`). Asking "does the patch carry `q`"
  // would clear the row on a keystroke whose *normalised* value never moved; asking "does
  // the built URL move" does not, because a patch that resolves to the same list builds the
  // same URL as the one already open.
  //
  // **Order and the set-aside toggle are the two exemptions**, and for the same reason:
  // reordering is the same questions read the other way round, and showing set-aside rows
  // adds to the list without narrowing it — either way the row a curator was reading is
  // still on the list, so clearing the selection would take them off the card they were
  // deciding on for no reason the curator asked for. `sort` and `showAside` are pinned to
  // their current values before the comparison, so a patch touching only one of them (or
  // both) always reads as the same list; a patch that carries a real filter alongside one of
  // them still clears the row, because the filter half of the comparison moves regardless.
  // (`filterKey`, below, still changes on the `showAside` path, so `lastIndex` resets to 0
  // there even though `row` survives — the remembered scroll position is lost, the row on
  // screen is not, which is the part a curator can see.)
  //
  // A control may report its change as a function of the address rather than as a finished
  // patch — a chip ticked twice in one open menu computes the second tick from the first
  // (`useReviewAddress`'s docblock says why the rendered address is not enough) — so the
  // patch is resolved inside `go`, against the address `go` itself is about to merge onto,
  // and only then compared for the exemption.
  const onFilterChange = useCallback((next: ReviewPatch) => {
    go(current => {
      const patch = typeof next === 'function' ? next(current) : next;
      const sameList = buildReviewUrl({
        ...current, ...patch, sort: current.sort, showAside: current.showAside, row: null,
      }) === buildReviewUrl({ ...current, row: null });
      return sameList ? patch : { ...patch, row: null };
    });
  }, [go]);

  // Refetch whether the call succeeded or not: a failure is often the server saying the
  // item is already answered, which means this page is the stale one. `experienceId`
  // invalidates the object's own cache, shared with Discover and `CurationDialog`.
  //
  // Invalidating an infinite query re-reads *every* page it has loaded, in sequence from
  // the first cursor, so a curator who pressed Show more four times pays four reads for
  // one answer. Accepted: the alternative is a list still offering the row just answered.
  const refresh = (message?: string, experienceId?: number) => {
    setNotice(message ?? null);
    if (experienceId !== undefined) invalidateExperiences(queryClient, { experienceId });
    return queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  };

  /**
   * A run's batch put aside or brought back (ADR-0051 decision 4), then the queue re-read.
   *
   * Re-read either way, for the reason every answer here does — a failure usually means
   * the server already holds the state that was asked for, which makes this page the stale
   * one. The reason lands in the same notice line an answer's does: there is nowhere else
   * on this page to say it, and a menu row that silently does nothing is worse.
   */
  const runAside = (call: Promise<unknown>, failure: string) => {
    setNotice(null);
    call
      .catch((e: unknown) => {
        const reason = e instanceof Error ? `: ${e.message}` : '.';
        setNotice(`${failure}${reason}`);
      })
      .finally(() => { queryClient.invalidateQueries({ queryKey: QUEUE_KEY }); });
  };

  /**
   * The ticks (#852), transient and cleared when the list changes under them —
   * with a line saying so, since a curator who ticked forty rows and changed a
   * chip has to know the forty are gone before they press Accept.
   */
  const onSelectionCleared = useCallback((count: number) => {
    setNotice(`The ${plural(count, 'ticked question')} ${count === 1 ? 'was' : 'were'} cleared: `
      + 'the filters changed, so the list it was ticked on is a different one.');
  }, []);
  const selection = useRowSelection(rows, queue.filterKey, onSelectionCleared);
  const tickedRows = rows.filter(row => selection.keys.has(row.key));
  const answering = useAnswerSelection({
    address, rows: tickedRows, selection, total, pageSize: queue.pageSize, facets: queue.facets, setNotice,
  });
  const batchOpen = tickedRows.length > 0 || selection.allMatching;
  // *Lost* is decided against the filters as well as the ticks: an all-matching
  // selection reaches rows the ticks do not show.
  const lost = lostOfferedFor(tickedRows, selection.allMatching, address.kinds);

  /** One answered list's own pager, under its rows inside the collapsed block. */
  const pagerOver = (kind: ReviewQueueKind) => {
    const { offset, hasMore } = queue.pageOf(kind);
    if (!hasMore && offset === 0) return null;
    return (
      <Stack direction="row" spacing={1} sx={{ px: 2, py: 1 }}>
        <Button size="small" disabled={offset === 0} onClick={() => queue.step(kind, -1)}>
          Previous
        </Button>
        <Button size="small" disabled={!hasMore} onClick={() => queue.step(kind, 1)}>
          Show more
        </Button>
      </Stack>
    );
  };

  if (queue.isError) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        Could not load the review queue
        {queue.error instanceof Error ? `: ${queue.error.message}` : '.'}
      </Alert>
    );
  }

  /**
   * The three lists of answered work, which are not questions and do not join `rows`.
   *
   * Same shape and same reason — a row that is answered appears on no other surface, so
   * this page is the only place a mis-click can be undone — one about an object a rule
   * refused, one about a point a curator decided about (#544), one about a point or work
   * a curator turned down (#859). Written as a list rather than as three blocks, because
   * everything below treats them alike.
   */
  const answeredLists: Array<{
    kind: ReviewQueueKind;
    /** The noun the toggle offers, addressed to the curator. */
    label: string;
    explanation: string;
    items: ReviewQueueItem[];
    /**
     * How many the toggle says the block holds, **in the unit its label names**.
     *
     * Not `items.length` for all, because the lists count different things. A
     * kept-out row is one object and one kept-out thing, so the rows are the number. An
     * answered withdrawal is one *object* carrying up to a page of answered *places*, and
     * the label says places — so the rows would read "(1)" over a serial nomination
     * holding ninety-three of them, and the number that corrects it would appear only
     * after the click, which is the one thing the count exists to prevent.
     *
     * All three count this page rather than the whole backlog, as the block's pager implies.
     */
    count: number;
    card: (item: ReviewQueueItem) => React.ReactNode;
  }> = [
    {
      kind: 'keptOut',
      label: 'what you have kept out',
      explanation: 'Answered, so not waiting on you — listed because this page is the only '
        + 'place they appear at all. A kept-out row is hidden from every list and gives '
        + 'nothing back at its own address, so if one of these was a mis-click, this is '
        + 'where it comes back.',
      items: queue.keptOut,
      count: queue.keptOut.length,
      card: item => <KeptOutCard key={item.id} item={item} onDone={refresh} />,
    },
    {
      kind: 'answeredWithdrawals',
      label: 'the lost places you have answered',
      explanation: 'Answered, so not waiting on you — and here for the same reason as the '
        + 'block above: a point with a verdict on it is on no other screen. Readers stopped '
        + 'seeing it, and it gives nothing back at its own address. Each answer is taken '
        + 'back on its own, and the place returns to the map only once nothing is left '
        + 'holding it.',
      items: queue.answeredWithdrawals,
      count: queue.answeredWithdrawals.reduce(
        (n, item) => n + (item.answered_points_total ?? item.answered_points?.length ?? 0), 0),
      card: item => <AnsweredWithdrawalCard key={item.id} item={item} onDone={refresh} />,
    },
    {
      kind: 'refusedParts',
      label: 'the points and works you have turned down',
      explanation: 'Answered, so not waiting on you — and here for the reason both blocks '
        + 'above are: a part you turned down is on no screen at all. Readers never saw it, '
        + 'and turning it down took it out of every question. Asking about one again puts '
        + 'the question back and nothing else: it returns to the object’s contents card, '
        + 'where publishing it is still what shows it — unless the source has stopped '
        + 'listing the part since, or the object itself has a question of its own, which '
        + 'its row says. Then the question comes back and nothing else follows.',
      items: queue.refusedParts,
      // Parts, not rows, and both kinds of them: the label names points and works,
      // and one object can hold twelve of each.
      count: queue.refusedParts.reduce(
        (n, item) => n
          + (item.refused_points_total ?? item.refused_points?.length ?? 0)
          + (item.refused_works_total ?? item.refused_works?.length ?? 0), 0),
      card: item => <RefusedPartsCard key={item.id} item={item} onDone={refresh} />,
    },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>Review</Typography>
      {/* Exceptions are named only where they are on the page. Said unconditionally the
          sentence tells a curator with none of them in front of them that something here
          is already hidden from readers, which is the opposite of what it promises. */}
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Decisions a sync run cannot make on its own. Nothing here has changed what visitors
        see{visibilityCaveat(new Set(rows.map(r => r.kind)))}
      </Typography>

      {notice && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* Outside the loading branch on purpose: a filter that matches nothing takes the
          list away with it, and *Clear all* is the way back out of that. */}
      <ReviewToolbar
        address={address}
        facets={queue.facets}
        total={total}
        onChange={onFilterChange}
        onSetAside={runId => runAside(setRunAside(runId), `Could not set run ${runId} aside`)}
        onBringBack={runId => runAside(bringRunBack(runId), `Could not bring run ${runId} back`)}
      />

      {queue.isLoading && <LoadingSpinner padding={4} />}

      {!queue.isLoading && rows.length === 0 && (
        <Alert severity="success">
          {isFilteredReview(address)
            ? 'Nothing matches. Clear a filter or the search.'
            : 'Nothing waiting. Every flagged object has been answered.'}
        </Alert>
      )}

      {!queue.isLoading && rows.length > 0 && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0} alignItems="flex-start">
          {/* The two columns scroll on their own, and that is not a nicety: sharing the
              page's scroll meant clicking a row near the foot of a nineteen-row list left
              the card rendered far above the viewport — the curator clicked and the screen
              appeared not to react. The list keeps its own scrollbar, and the bench sticks
              to the top, so the answer to a click is always where the click was. */}
          <Box
            sx={{
              // 400, not 320: a row carries an object's name and, under it, its kind
              // and what is being asked of it. At 320 both truncate after a few words —
              // "Cultural Landscape and Archaeolo…" over "UNESCO World Heritage Sites ·
              // holds a change: …" — which leaves the list unable to do the one thing it
              // is for, which is telling one question from the next without opening it.
              width: { xs: '100%', md: 400 },
              flexShrink: 0,
              maxHeight: { xs: 320, md: 'calc(100vh - 220px)' },
              overflowY: 'auto',
              position: { md: 'sticky' },
              top: { md: 16 },
            }}
          >
            <ReviewQueueList
              rows={rows}
              selected={selected}
              onSelect={key => go({ row: key })}
              sort={address.sort}
              today={dayOf(new Date().toISOString())}
              hasMore={queue.hasMore}
              loadingMore={queue.loadingMore}
              onMore={queue.more}
              total={total}
              stale={queue.stale}
              selection={selection}
            />
          </Box>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {/* The selected row, or nothing for the one render before the effect above
                picks the next one. Falling back to `rows[0]` would flash the top of the
                list as the answer to a click somewhere else. With more than one row
                ticked the bench sums the selection instead (#852); one tick, or none,
                and the card is what it always was. */}
            {tickedRows.length > 1 || selection.allMatching
              ? (
                <SelectionSummary
                  rows={tickedRows}
                  allMatching={selection.allMatching}
                  reach={answering.reach}
                  facets={queue.facets}
                  sourceIds={address.sourceIds}
                  runId={address.runId}
                  showAside={address.showAside}
                  lost={lost}
                  total={total}
                />
              )
              : <ReviewBench row={rows[selectedIndex]} onDone={refresh} />}
          </Box>
        </Stack>
      )}

      <SelectionBar
        rows={tickedRows}
        allMatching={selection.allMatching}
        reach={answering.reach}
        lost={lost}
        total={total}
        progress={answering.progress}
        onAnswer={answering.answer}
        onClear={selection.clear}
      />
      {/* Room under the columns for the bar, which is page-fixed: without it the
          last rows of a long list sit behind it. */}
      {batchOpen && <Box sx={{ height: 96 }} />}

      {/* Asked once: past one page and for all matching — otherwise the count is on
          the bar and every answer can be undone from the foot of this page. Names what
          it will do per kind, in the cards' words, so "Accept 1,078 proposals" is never
          the whole of what a curator agrees to. */}
      <Dialog open={answering.confirming !== null} onClose={answering.cancel}>
        <DialogTitle>
          {answerVerb(answering.confirming)}
          {' '}
          {selection.allMatching
            ? `all ${total.toLocaleString('en')} matching these filters?`
            : `${plural(tickedRows.length, 'proposal')}?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {answering.confirmLines.map(line => <li key={line}>{line}</li>)}
            </Box>
            {answering.confirmNote && (
              <Box component="p" sx={{ mb: 0 }}>{answering.confirmNote}</Box>
            )}
            {selection.allMatching && (
              <Box component="p" sx={{ mb: 0 }}>
                The counts above are every question these filters match, not only the rows
                on screen; the answer goes to all of them, a page at a time, and the bar says
                how far it has got.
              </Box>
            )}
            <Box component="p" sx={{ mb: 0 }}>
              Each object is answered on its own and recorded on its own, so the line
              afterwards names anything that refused. Every answer has a take-back, at the
              foot of this page.
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={answering.cancel}>Cancel</Button>
          <Button variant="contained" onClick={answering.confirm}>
            {answerVerb(answering.confirming)}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Drawn on its offset as well as its rows: a block paged forward and then answered
          down to nothing would otherwise vanish with the only control that could go back,
          stranding the offset until a reload. */}
      {answeredLists
        .filter(list => list.items.length > 0 || queue.pageOf(list.kind).offset > 0)
        .map(list => (
          <AnsweredSection
            key={list.kind}
            label={list.label}
            count={list.count}
            explanation={list.explanation}
            pager={pagerOver(list.kind)}
          >
            {list.items.map(list.card)}
          </AnsweredSection>
        ))}
    </Box>
  );
}
