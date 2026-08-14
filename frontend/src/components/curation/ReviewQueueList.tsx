/**
 * The queue itself: every open question, one line each.
 *
 * A line rather than a card, because the list exists to be *skipped down*. What a curator
 * decides from a line is whether to open it — which object, and what is being asked — and
 * everything else belongs on the right where the decision is made. Nineteen cards stacked
 * vertically made that impossible: reaching the twentieth question meant scrolling past
 * nineteen answers' worth of evidence.
 */

import { Box, List, ListItemButton, ListSubheader, Typography } from '@mui/material';
import type { QueueRow, RowKind } from './queueRows';

/** The heading each group of rows sits under — the question, as the page states it. */
const KIND_HEADING: Record<RowKind, string> = {
  conflicts: 'The source disagrees with an edit',
  waiting: 'Waiting to be published',
  refused: 'Our own rule for this list turned these down',
  missing: 'Gone from the source',
};

export function ReviewQueueList({ rows, selected, onSelect, pagers, countLabel }: {
  rows: QueueRow[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** Per-kind paging controls, rendered under the last row of each kind. */
  pagers?: Partial<Record<RowKind, React.ReactNode>>;
  /**
   * How many of a kind, said the way that kind can support.
   *
   * The count belongs on the heading and not only in the rows: a curator wants to know how
   * much work a kind holds before deciding to start on it, and "first 25" against 19 rows
   * would be a backlog claim nothing behind it can honour.
   */
  countLabel: (kind: RowKind, n: number) => string;
}) {
  if (rows.length === 0) return null;

  return (
    <List dense disablePadding sx={{ borderRight: 1, borderColor: 'divider', height: '100%' }}>
      {rows.map((row, i) => (
        <Box key={row.key}>
          {rows[i - 1]?.kind !== row.kind && (
            <ListSubheader disableSticky sx={{ lineHeight: 2, px: 2 }}>
              {KIND_HEADING[row.kind]}
              {' '}
              ({countLabel(row.kind, rows.filter(r => r.kind === row.kind).length)})
            </ListSubheader>
          )}
          <ListItemButton
            selected={row.key === selected}
            onClick={() => onSelect(row.key)}
            sx={{ display: 'block', py: 1 }}
          >
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {row.name}
            </Typography>
            {/* The category, because it is the thing that differs down the list. The
                question is the heading this row sits under and the kind is that heading's
                own word — printing either again on every row says one thing three times
                and leaves the reader nothing to scan by. */}
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {row.category}
            </Typography>
          </ListItemButton>
          {/* Paging sits under the last row of its kind, where the list of that kind ends —
              a control at the foot of everything would page whichever kind a curator was
              not looking at. */}
          {rows[i + 1]?.kind !== row.kind && pagers?.[row.kind]}
        </Box>
      ))}
    </List>
  );
}
