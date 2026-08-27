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
 * The page owns three things and nothing else: which question is selected, where each kind
 * is paged to, and the line that says what the last answer did. The cards answer for
 * themselves, as they always did.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchReviewQueue, type ReviewQueueItem, type ReviewQueueKind } from '../../api/experiences';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import {
  queueRows, nextSelection, KINDS_BEHIND, KIND_NAME, ROW_KINDS, type RowKind,
} from './queueRows';
import { ReviewQueueList } from './ReviewQueueList';
import { ReviewBench } from './ReviewBench';
import { AnsweredSection } from './AnsweredSection';
import { KeptOutCard } from './ReviewQueue';
import { AnsweredWithdrawalCard } from './WithdrawnPoints';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // One offset per kind: the queue is one query with one limit per kind, and a shared
  // number made "show more" under one heading page every other section past its own first
  // page.
  const [offsets, setOffsets] = useState<Partial<Record<ReviewQueueKind, number>>>({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['curation', 'reviewQueue', offsets],
    queryFn: () => fetchReviewQueue({ offsets }),
  });

  const rows = useMemo(() => queueRows(data), [data]);
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
  useEffect(() => {
    if (selectedIndex >= 0) lastIndex.current = selectedIndex;
  }, [selectedIndex]);

  // Follow the list rather than hold a key that no longer exists. Answering removes a row,
  // and the selection has to land on the question that took its place — the alternative is
  // an empty bench after every answer, which is a scroll and a click per card.
  useEffect(() => {
    if (rows.length === 0) { setSelected(null); return; }
    if (selected && rows.some(r => r.key === selected)) return;
    setSelected(nextSelection(rows, lastIndex.current) ?? null);
  }, [rows, selected]);

  // Refetch whether the call succeeded or not: a failure is often the server saying the
  // item is already answered, which means this page is the stale one. `experienceId`
  // invalidates the object's own cache, shared with Discover and `CurationDialog`.
  const refresh = (message?: string, experienceId?: number) => {
    setNotice(message ?? null);
    if (experienceId !== undefined) invalidateExperiences(queryClient, { experienceId });
    return queryClient.invalidateQueries({ queryKey: ['curation', 'reviewQueue'] });
  };

  const step = (kind: ReviewQueueKind, by: number) => setOffsets(o => ({
    ...o, [kind]: Math.max(0, (o[kind] ?? 0) + by * (data?.limit ?? 25)),
  }));
  const pageOf = (kind: ReviewQueueKind) => data?.paging?.[kind] ?? { offset: 0, hasMore: false };

  /**
   * How many of a kind the list is showing, and whether that is all of them.
   *
   * "first N" only where the server says something waits behind — inferring it from a full
   * page made a kind that happened to hold exactly one page claim a backlog it did not have.
   */
  const countLabel = (kind: RowKind, n: number) => {
    const behind = KINDS_BEHIND[kind];
    if (behind.some(k => pageOf(k).offset > 0)) return `${n} more`;
    return behind.some(k => pageOf(k).hasMore) ? `first ${n}` : `${n}`;
  };

  /**
   * One control over one or more queue kinds.
   *
   * `waiting` is three queue kinds shown as one list and gets a single control, for the
   * reason the list groups them: a curator reading a row cannot tell which of the three it
   * came from, so three buttons would answer a question nobody asked. Each kind still keeps
   * its own offset — the control moves whichever of them have more.
   */
  const pagerOver = (behind: readonly ReviewQueueKind[]) => {
    const more = behind.filter(k => pageOf(k).hasMore);
    const back = behind.filter(k => pageOf(k).offset > 0);
    if (more.length === 0 && back.length === 0) return null;
    return (
      <Stack direction="row" spacing={1} sx={{ px: 2, py: 1 }}>
        <Button size="small" disabled={back.length === 0} onClick={() => back.forEach(k => step(k, -1))}>
          Previous
        </Button>
        <Button size="small" disabled={more.length === 0} onClick={() => more.forEach(k => step(k, 1))}>
          Show more
        </Button>
      </Stack>
    );
  };

  if (isLoading) return <LoadingSpinner padding={4} />;

  if (isError) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        Could not load the review queue
        {error instanceof Error ? `: ${error.message}` : '.'}
      </Alert>
    );
  }

  /**
   * The two lists of answered work, which are not questions and do not join `rows`.
   *
   * Same shape and same reason — a row that is answered appears on no other surface, so
   * this page is the only place a mis-click can be undone — one about an object a rule
   * refused, one about a point a curator decided about (#544). Written as a list rather
   * than as two blocks, because everything below treats them alike: the block at the foot,
   * and the way back from a page of them that came back empty.
   */
  const keptOut = data?.keptOut ?? [];
  const answeredWithdrawals = data?.answeredWithdrawals ?? [];
  const answeredLists: Array<{
    kind: ReviewQueueKind;
    /** The noun the toggle offers, addressed to the curator. */
    label: string;
    /**
     * The same list named for the stranded row, which supplies "on this page of" itself
     * — so "what you have kept out — previous" would say half of it twice.
     */
    shortLabel: string;
    explanation: string;
    items: ReviewQueueItem[];
    /**
     * How many the toggle says the block holds, **in the unit its label names**.
     *
     * Not `items.length` for both, because the two lists count different things. A
     * kept-out row is one object and one kept-out thing, so the rows are the number. An
     * answered withdrawal is one *object* carrying up to a page of answered *places*, and
     * the label says places — so the rows would read "(1)" over a serial nomination
     * holding ninety-three of them, and the number that corrects it would appear only
     * after the click, which is the one thing the count exists to prevent.
     *
     * Both count this page rather than the whole backlog, as the block's pager implies.
     */
    count: number;
    card: (item: ReviewQueueItem) => React.ReactNode;
  }> = [
    {
      kind: 'keptOut',
      label: 'what you have kept out',
      shortLabel: 'kept out',
      explanation: 'Answered, so not waiting on you — listed because this page is the only '
        + 'place they appear at all. A kept-out row is hidden from every list and gives '
        + 'nothing back at its own address, so if one of these was a mis-click, this is '
        + 'where it comes back.',
      items: keptOut,
      count: keptOut.length,
      card: item => <KeptOutCard key={item.id} item={item} onDone={refresh} />,
    },
    {
      kind: 'answeredWithdrawals',
      label: 'the lost places you have answered',
      shortLabel: 'lost places you have answered',
      explanation: 'Answered, so not waiting on you — and here for the same reason as the '
        + 'block above: a point with a verdict on it is on no other screen. Readers stopped '
        + 'seeing it, and it gives nothing back at its own address. Each answer is taken '
        + 'back on its own, and the place returns to the map only once nothing is left '
        + 'holding it.',
      items: answeredWithdrawals,
      count: answeredWithdrawals.reduce(
        (n, item) => n + (item.answered_points_total ?? item.answered_points?.length ?? 0), 0),
      card: item => <AnsweredWithdrawalCard key={item.id} item={item} onDone={refresh} />,
    },
  ];

  /**
   * Kinds paged forward whose page came back empty.
   *
   * Their own pager renders under the last row of that kind, so with no rows it renders
   * nowhere and the offset is stranded: answer the five rows on page 2 of the refusals and
   * the twenty-five in front of them are unreachable without a reload. The answered lists
   * belong in the same list — a collapsed block disappears whole when its page empties,
   * taking its pager with it.
   */
  const stranded: Array<{ label: string; behind: readonly ReviewQueueKind[] }> = [
    ...ROW_KINDS
      .filter(kind => !rows.some(r => r.kind === kind)
        && KINDS_BEHIND[kind].some(k => pageOf(k).offset > 0))
      .map(kind => ({ label: KIND_NAME[kind], behind: KINDS_BEHIND[kind] })),
    ...answeredLists
      .filter(list => list.items.length === 0 && pageOf(list.kind).offset > 0)
      .map(list => ({ label: list.shortLabel, behind: [list.kind] as const })),
  ];
  // `ROW_KINDS` rather than the same literal written again: the list's order is a product
  // decision that lives in one place, and two copies of it drift.
  const pagers = Object.fromEntries(
    ROW_KINDS.map(k => [k, pagerOver(KINDS_BEHIND[k])]),
  ) as Partial<Record<RowKind, React.ReactNode>>;

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

      {/* A way back for every kind that is paged forward but has nothing on this page.
          Its in-list pager renders under the last row of its kind and therefore not at all,
          which strands the offset: answer the five rows on page 2 of the refusals and the
          twenty-five in front of them become unreachable without a reload. The old
          single-column page kept this deliberately — `(offset > 0 || fullPage)` outside
          every list, under the comment about an offset past the end stranding a curator. */}
      {stranded.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary">
            Nothing left on this page of:
          </Typography>
          {stranded.map(({ label, behind }) => (
            <Button key={label} size="small" onClick={() => behind.forEach(k => step(k, -1))}>
              {label} — previous
            </Button>
          ))}
        </Stack>
      )}

      {rows.length === 0 ? (
        <Alert severity="success">
          {Object.values(offsets).some(Boolean)
            ? 'Nothing further on this page.'
            : 'Nothing waiting. Every flagged object has been answered.'}
        </Alert>
      ) : (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0} alignItems="flex-start">
          {/* The two columns scroll on their own, and that is not a nicety: sharing the
              page's scroll meant clicking a row near the foot of a nineteen-row list left
              the card rendered far above the viewport — the curator clicked and the screen
              appeared not to react. The list keeps its own scrollbar, and the bench sticks
              to the top, so the answer to a click is always where the click was. */}
          <Box
            sx={{
              width: { xs: '100%', md: 320 },
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
              onSelect={setSelected}
              pagers={pagers}
              countLabel={countLabel}
            />
          </Box>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {/* The selected row, or nothing for the one render before the effect above
                picks the next one. Falling back to `rows[0]` would flash the top of the
                list as the answer to a click somewhere else. */}
            <ReviewBench row={rows[selectedIndex]} onDone={refresh} />
          </Box>
        </Stack>
      )}

      {answeredLists.filter(list => list.items.length > 0).map(list => (
        <AnsweredSection
          key={list.kind}
          label={list.label}
          count={list.count}
          explanation={list.explanation}
          pager={pagerOver([list.kind])}
        >
          {list.items.map(list.card)}
        </AnsweredSection>
      ))}
    </Box>
  );
}
