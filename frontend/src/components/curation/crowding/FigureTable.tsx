/**
 * What a crowded city's place weighs (#2400), as a table (#2454): one column
 * per measure under a heading, one row per place, numbers right-aligned in
 * tabular figures, so each figure stands above the ones it is compared with.
 * Each heading carries a hint, on hover and on keyboard focus, that says what
 * it counts (docs/tech/interface-writing.md: figures compared with each other
 * are a table, not a sentence). A value not read yet is a dash, never a zero,
 * and its hint says so.
 *
 * The headings and the cells share one fixed grid (`FIGURE_COLUMNS`), so a
 * list built of separate rows still lines its figures up under its headings.
 */

import { Box, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { ReactNode } from 'react';
import type { CrowdingGroupPlace } from '../../../api/crowding';

type Signals = Pick<CrowdingGroupPlace, 'readers' | 'wikipediaEditions' | 'guideUsed' | 'score'>;

const DASH = '—';
const NOT_MEASURED = 'Not measured yet.';

/** One measure: its heading, its hint, how wide it stands, how a value is written, and where it aligns. */
interface FigureColumn {
  heading: string;
  hint: string;
  width: string;
  align: 'right' | 'center';
  text: (signals: Signals) => string | null;
}

const count = (value: number | null) => (value === null ? null : value.toLocaleString('en'));

/** Whether a guide writes about it, or null before its guides are read. */
function guideText(used: boolean | null): string | null {
  if (used === null) return null;
  return used ? 'yes' : 'no';
}

/** The measures a place's fame is made of, and its score, in the order they are read. */
export const FIGURE_COLUMNS: readonly FigureColumn[] = [
  {
    heading: 'Readers a year', width: '7rem', align: 'right',
    hint: 'Readers of its Wikipedia articles over the last year.',
    text: signals => count(signals.readers),
  },
  {
    heading: 'Editions', width: '4.75rem', align: 'right',
    hint: 'The Wikipedia languages with an article on it.',
    text: signals => count(signals.wikipediaEditions),
  },
  {
    heading: 'In Wikivoyage', width: '6.5rem', align: 'center',
    hint: 'Whether a Wikivoyage guide writes about it.',
    text: signals => guideText(signals.guideUsed),
  },
  {
    heading: 'Score', width: '4.5rem', align: 'right',
    hint: 'How well known it is among the places of its kind and type worldwide, from 0 to 1. The three columns before it make it.',
    text: signals => (signals.score === null ? null : signals.score.toFixed(2)),
  },
];

/** The grid the headings and every row's cells share. */
export const FIGURES_GRID = FIGURE_COLUMNS.map(column => column.width).join(' ');

/** The width of the whole block, for a row that sets it beside other content. */
export const FIGURES_WIDTH = `calc(${FIGURE_COLUMNS.map(column => column.width).join(' + ')})`;

/**
 * The name column on a phone: it stays in view while the figures scroll beside it, so a
 * figure is never read without the place it belongs to. Its background is opaque, the
 * row's own tint laid over the paper, so a figure scrolled beneath it does not show through.
 */
export function stickyName(tint?: (theme: Theme) => string, own: Record<string, unknown> = {}): SxProps<Theme> {
  return theme => ({
    ...own,
    [theme.breakpoints.down('sm')]: {
      position: 'sticky', left: 0, zIndex: 1,
      backgroundColor: theme.palette.background.paper,
      backgroundImage: tint ? `linear-gradient(${tint(theme)}, ${tint(theme)})` : 'none',
    },
  });
}

/** The tint of a row the pointer is over, for its name column to carry. */
export const HOVERED_TINT = (theme: Theme) => theme.palette.action.selected;

/** A heading's hint, on hover, a tap and keyboard focus: a heading is one tab stop per table. */
function Hinted({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <Tooltip title={hint} describeChild enterTouchDelay={0}>
      <Box component="span" tabIndex={0} sx={{ borderBottom: '1px dotted', borderColor: 'text.secondary', cursor: 'help', outlineOffset: 2 }}>
        {children}
      </Box>
    </Tooltip>
  );
}

/**
 * A dash for a value not read yet, which says so on hover and a tap and is read
 * as the words: never a tab stop, since a list of new arrivals holds hundreds.
 */
function NotMeasured() {
  return (
    <Tooltip title={NOT_MEASURED} enterTouchDelay={0}>
      <Box component="span" sx={{ cursor: 'help' }}>{DASH}</Box>
    </Tooltip>
  );
}

/** The table's headings, each with its hint, inside the row that holds them. */
export function FigureHeadings() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: FIGURES_GRID, flexShrink: 0 }}>
      {FIGURE_COLUMNS.map(column => (
        <Typography key={column.heading} role="columnheader" variant="caption" color="text.secondary"
          sx={{ px: 0.75, textAlign: column.align, whiteSpace: 'nowrap' }}>
          <Hinted hint={column.hint}>{column.heading}</Hinted>
        </Typography>
      ))}
    </Box>
  );
}

/** One place's figures, in the headings' columns; a value not read yet is a dash with its hint. */
export function FigureCells({ signals, strong = false }: { signals: Signals; strong?: boolean }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: FIGURES_GRID, flexShrink: 0 }}>
      {FIGURE_COLUMNS.map(column => {
        const text = column.text(signals);
        return (
          <Typography key={column.heading} role="cell" variant="body2" color={text === null ? 'text.secondary' : 'text.primary'}
            sx={{ px: 0.75, textAlign: column.align, fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 500 : undefined }}>
            {text === null ? <NotMeasured /> : text}
          </Typography>
        );
      })}
    </Box>
  );
}
