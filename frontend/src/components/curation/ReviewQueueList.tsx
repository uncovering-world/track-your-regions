/**
 * The queue itself: every open question, one line each, under a sticky heading.
 *
 * A line rather than a card, because the list exists to be *skipped down*. What a curator
 * decides from a line is whether to open it — which object, and what is being asked — and
 * everything else belongs on the right where the decision is made. Nineteen cards stacked
 * vertically made that impossible: reaching the twentieth question meant scrolling past
 * nineteen answers' worth of evidence.
 *
 * The rows arrive in one of two complete orders the server's keys phase already chose
 * (ADR-0051 decision 2) — this file only draws a heading at each transition, and counts what
 * sits under it once every page is loaded; it does not sort, and it never guesses at a
 * group it holds only part of. `date` groups by the day a question was asked (a row still
 * in flight has no day yet, and sits under *Still running* wherever it falls); `question`
 * groups by kind, coloured the way the kind's own chip is. One pager, not the old one per
 * kind, because the list is one keyset-paged union now rather than seven offset ones.
 */

import {
  Fragment, useEffect, useRef, type KeyboardEvent,
} from 'react';
import {
  Box, Button, List, ListItem, ListItemButton, ListSubheader, Typography,
} from '@mui/material';
import { KIND_COLOR, rowQuestionWord, type QueueRow, type RowKind } from './queueRows';
import { dayOf, dayLabel, dateShort } from './feed/rowDate';
import { COUNT_SX } from './feed/FilterChip';

/** The heading each group of rows sits under, in question order — the question, as the page states it. */
const KIND_HEADING: Record<RowKind, string> = {
  conflicts: 'The source disagrees with an edit',
  waiting: 'Waiting to be published',
  withdrawn: 'Places these objects are made of are gone',
  refused: 'Our own rule for this list turned these down',
  missing: 'Gone from the source',
};

/** A group's heading a transition in `rows` opens — never computed for a row that continues its predecessor's group. */
interface Heading {
  label: string;
  /**
   * How many rows sit under it, or `null` while another page is still to come.
   *
   * A number beside "Sat 5 Sep" is read as that day's questions, and a page holds 25 of a
   * backlog that said "1,255 open" two lines above — so the heading claimed a total it had
   * no way of knowing. It is only ever right once every page is loaded, and until then no
   * number is the honest answer; the list's own label still says how much of the whole is
   * on screen.
   */
  count: number | null;
  /** The question's own colour in `question` order; unset (neutral) in `date` order. */
  color?: string;
}

/** `question` groups by kind; `date` groups by day — or `Still running` for a row with no `askedAt` yet. */
function groupKey(row: QueueRow, sort: 'date' | 'question'): string {
  if (sort === 'question') return row.kind;
  return row.askedAt === null ? 'running' : dayOf(row.askedAt);
}

function groupLabel(row: QueueRow, sort: 'date' | 'question', today: string): string {
  if (sort === 'question') return KIND_HEADING[row.kind];
  return row.askedAt === null ? 'Still running' : dayLabel(dayOf(row.askedAt), today);
}

/**
 * The heading standing in front of each row, `null` where the row continues the one before
 * it.
 *
 * A count only once `whole` — every page loaded — because until then the number would be
 * this page's share of the group rather than the group, and a reader has no way to tell
 * the two apart. The run under the heading, not every row sharing its key: a question from
 * a run still in flight sits under *Still running* wherever it falls, which splits a day
 * around it, and counting by key would give both halves the day's whole total.
 */
function headings(
  rows: QueueRow[], sort: 'date' | 'question', today: string, whole: boolean,
): (Heading | null)[] {
  const keys = rows.map(row => groupKey(row, sort));
  return rows.map((row, i) => {
    if (i > 0 && keys[i - 1] === keys[i]) return null;
    let run = 0;
    while (i + run < rows.length && keys[i + run] === keys[i]) run += 1;
    return {
      label: groupLabel(row, sort, today),
      count: whole ? run : null,
      color: sort === 'question' ? KIND_COLOR[row.kind] : undefined,
    };
  });
}

/**
 * The colour a row's own left border and question word draw in — `KIND_COLOR[row.kind]`,
 * except a `waiting` row grouping an arrival, which reads as the arrival's own green so a
 * band of them stands out from the blue of a held change (`rowQuestionWord`'s own rule,
 * mirrored here because the border needs the same answer).
 */
function rowColor(row: QueueRow): string {
  return row.kind === 'waiting' && row.subs.includes('arrival') ? KIND_COLOR.arrival : KIND_COLOR[row.kind];
}

export function ReviewQueueList({
  rows, selected, onSelect, sort, today, hasMore, loadingMore, onMore, total, stale,
}: {
  rows: QueueRow[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** Which complete order the rows already arrived in — this file only groups, never sorts. */
  sort: 'date' | 'question';
  today: string;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** The filtered total, not just what this page loaded — the list's own name for a screen reader tabbing into it, since `rows.length` alone cannot say whether more waits below. */
  total: number;
  /**
   * Whether the rows on screen still answer the *previous* filter — `keepPreviousData`
   * showing yesterday's page while today's is in flight. A row a curator clicks or moves
   * the keyboard onto here may not exist in the filter that is actually loading, so both
   * the click and the key move are refused outright, before either touches `pending` or
   * `focusNext`: arming either one over a row that turns out not to exist is exactly what
   * let a key move outlive the click guard that used to sit in the page instead (a `j`
   * during this window left `pending` and `focusNext` set, and the next real move — after
   * the address had already moved on its own — read them as if the stale move had
   * happened, landing one row further than asked and pulling focus off the bench). The
   * list is the one place a selection can originate, so it is where a stale one has to be
   * refused before anything downstream of it is set.
   */
  stale: boolean;
}) {
  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  /**
   * Whether the focus should follow the selection into the row below.
   *
   * Set by `handleKeyDown` and by nothing else, because the page moves the selection by
   * itself as well — on the first load, and onto the neighbour of every question that is
   * answered — and focusing there would pull the caret out of whatever the curator is
   * working in on the bench. A key move is the one case where focus has to go with the
   * selection: without it Enter still activates the row the mouse last touched, and the
   * selection snaps back to a question several moves behind.
   */
  const focusNext = useRef(false);
  /**
   * The key this list last asked for, which runs ahead of the `selected` prop.
   *
   * `selected` is `address.row`, and the address write lands in a transition — a component
   * can still be holding the row parsed from the *previous* URL after `go` has already been
   * called (`useReviewAddress`'s own docblock). A second key press inside that window would
   * otherwise recompute its move from the same stale `selected`, ask for the same row again,
   * and have `go` discard it as the address it is already at — which is what turned holding
   * `j` down a page of rows into skipping most of them.
   */
  const pending = useRef<string | null>(null);

  useEffect(() => {
    // The address has caught up with whatever this list last asked for — or moved on its
    // own, which is exactly the case a stale `pending` must not be left standing over.
    // Either way the next move computes from `selected` again.
    pending.current = null;
    // Optional chains on both the ref and the method: jsdom does not implement
    // `scrollIntoView`, and a row that just left the page (answered, filtered
    // out) leaves the ref briefly null before the next render picks a new one.
    selectedRowRef.current?.scrollIntoView?.({ block: 'nearest' });
    if (!focusNext.current) return;
    focusNext.current = false;
    selectedRowRef.current?.focus?.();
  }, [selected]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Refused before either ref is touched — see the `stale` prop's doc comment.
    if (stale) return;
    // A search box or a future edit field living inside this same scrolling
    // container must keep its own letters — `j` and `k` are ordinary text there.
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    let delta = 0;
    if (e.key === 'j' || e.key === 'ArrowDown') delta = 1;
    else if (e.key === 'k' || e.key === 'ArrowUp') delta = -1;
    else return;
    e.preventDefault();
    const from = pending.current ?? selected;
    const index = rows.findIndex(r => r.key === from);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    // Set against `selected`, not `from`: the effect below clears the flag only when
    // `selected` itself changes, so arming it on `from` (the pending key) can leave it set
    // across a second press that lands back on the address's own row, where the effect
    // never runs to clear it — the flag then survives to be spent on the page's own next
    // selection move instead. Deciding against `selected` fixes that: a move back to the
    // row already at that address explicitly clears the flag rather than merely skipping
    // the arm, and the same assignment covers the end-of-list case, where `next` is the
    // row already open and `next.key === selected` clears it the same way.
    focusNext.current = next.key !== selected;
    pending.current = next.key;
    onSelect(next.key);
  };

  if (rows.length === 0) return null;
  // `!hasMore` is "every page is loaded": only then is a group's run of rows the group.
  const rowHeadings = headings(rows, sort, today, !hasMore);

  return (
    <Box
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={`${rows.length.toLocaleString('en')} of ${total.toLocaleString('en')} questions loaded`}
      sx={{
        borderRight: 1, borderColor: 'divider', height: '100%', overflowY: 'auto',
      }}
    >
      <List dense disablePadding>
        {rows.map((row, i) => {
          const heading = rowHeadings[i];
          const color = rowColor(row);
          const word = rowQuestionWord(row);
          return (
            // A fragment, not a `Box`: `List` is a `<ul>`, and a `<div>` wrapper made every
            // row a non-item of the list — with the heading's own `<li>` nested inside it.
            // The heading is a `ListSubheader` (an `li` already) and the row is a
            // `ListItemButton` inside a `ListItem`, so the `ul` holds list items only.
            <Fragment key={row.key}>
              {heading && (
                <ListSubheader
                  sx={{
                    lineHeight: 2,
                    px: 2,
                    display: 'flex',
                    color: heading.color ?? 'text.secondary',
                  }}
                >
                  <span>{heading.label}</span>
                  {heading.count !== null && (
                    <Box component="span" sx={COUNT_SX}>{heading.count.toLocaleString('en')}</Box>
                  )}
                </ListSubheader>
              )}
              <ListItem disablePadding>
                <ListItemButton
                  ref={row.key === selected ? selectedRowRef : undefined}
                  selected={row.key === selected}
                  onClick={() => { if (!stale) onSelect(row.key); }}
                  sx={{
                    // `block` over the button's own flex row, so the two lines stack; the
                    // width comes from `ListItem`'s flex, which the button grows into.
                    display: 'block', py: 1, borderLeft: '3px solid', borderLeftColor: color,
                  }}
                >
                  <Box sx={{
                    display: 'flex', alignItems: 'baseline', gap: 1,
                  }}
                  >
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}>
                      {row.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {dateShort(row.askedAt, today)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {row.category}
                    {' · '}
                    <Box component="span" sx={{ fontWeight: 700, color }}>{word}</Box>
                    {row.specific ? `: ${row.specific}` : null}
                  </Typography>
                </ListItemButton>
              </ListItem>
            </Fragment>
          );
        })}
      </List>
      {hasMore && (
        <Box sx={{ p: 1 }}>
          <Button fullWidth size="small" disabled={loadingMore} onClick={onMore}>
            Show more
          </Button>
        </Box>
      )}
    </Box>
  );
}
