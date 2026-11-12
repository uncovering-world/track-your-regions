/**
 * What a crowded city's place weighs (#2400), as a table (#2454): one column
 * per measure under a heading, one row per place, numbers right-aligned in
 * tabular figures, so each figure stands above the ones it is compared with.
 * Each heading carries a hint, on hover and on keyboard focus, that says what
 * it counts (docs/tech/interface-writing.md: figures compared with each other
 * are a table, not a sentence). A value not read yet is a dash, never a zero,
 * and its hint says so.
 *
 * The headings and the cells share one fixed grid (`figureColumns`), so a
 * list built of separate rows still lines its figures up under its headings.
 * A kind whose places the place pass counts venues around (ADR-0192) has a
 * fifth column, after the score, since the venues are no part of it.
 */

import { Box, Link, Tooltip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import type { ReactNode } from 'react';
import type { CrowdingGroupPlace } from '../../../api/crowding';

type Signals = Pick<CrowdingGroupPlace, 'readers' | 'wikipediaEditions' | 'guideUsed' | 'score' | 'venues'>;

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
const FAME_COLUMNS: readonly FigureColumn[] = [
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

/** A place's venues: a count around its point, or a figure per 100 m along a street read along its line (ADR-0194). */
function venueText({ venues }: Signals): string | null {
  if (venues === null) return null;
  return venues.per100m ? `${venues.figure.toFixed(1)} / 100 m` : Math.round(venues.figure).toLocaleString('en');
}

/** The venue column's hint: what it counts, within what, and that the score does not read it. */
function venueHint(radiusM: number | null): string {
  const around = radiusM === null ? '' : `within ${radiusM} m of it, or `;
  return `Cafés, restaurants, bars and other places to eat or drink ${around}per 100 m along a street read along its line. Not part of the score.`;
}

const VENUES = 'Venues';

/** The columns a group's table holds, a fifth for a kind whose venues are kept. */
export type FigureColumns = readonly FigureColumn[];

/** The table's columns for a kind: its fame and score, and its venues where a place pass keeps them. */
export function figureColumns(kind: { readsVenues: boolean; venueRadiusM: number | null }): FigureColumns {
  if (!kind.readsVenues) return FAME_COLUMNS;
  return [...FAME_COLUMNS, { heading: VENUES, width: '7rem', align: 'right', hint: venueHint(kind.venueRadiusM), text: venueText }];
}

/** Whether a table holds the venue column, which shows OpenStreetMap's data and so carries its credit. */
export const showsVenues = (columns: FigureColumns) => columns.some(column => column.heading === VENUES);

/**
 * The credit the venue column owes OpenStreetMap (ADR-0059 decision 3): its
 * figures are counted from the OpenStreetMap layer's cafés, restaurants and
 * bars, so the credit stands under the table, visible without interaction,
 * and only where the column does.
 */
export function VenueCreditLine({ columns }: { columns: FigureColumns }) {
  if (!showsVenues(columns)) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.75 }}>
      {'Venues counted on OpenStreetMap · '}
      <Link href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">
        © OpenStreetMap contributors
      </Link>
    </Typography>
  );
}

/** The grid the headings and every row's cells share. */
const gridOf = (columns: FigureColumns) => columns.map(column => column.width).join(' ');

/** The width of the whole block, for a row that sets it beside other content. */
export const figuresWidth = (columns: FigureColumns) => `calc(${columns.map(column => column.width).join(' + ')})`;

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
export function FigureHeadings({ columns }: { columns: FigureColumns }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: gridOf(columns), flexShrink: 0 }}>
      {columns.map(column => (
        <Typography key={column.heading} role="columnheader" variant="caption" color="text.secondary"
          sx={{ px: 0.75, textAlign: column.align, whiteSpace: 'nowrap' }}>
          <Hinted hint={column.hint}>{column.heading}</Hinted>
        </Typography>
      ))}
    </Box>
  );
}

/** One place's figures, in the headings' columns; a value not read yet is a dash with its hint. */
export function FigureCells({ columns, signals, strong = false }: { columns: FigureColumns; signals: Signals; strong?: boolean }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: gridOf(columns), flexShrink: 0 }}>
      {columns.map(column => {
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
