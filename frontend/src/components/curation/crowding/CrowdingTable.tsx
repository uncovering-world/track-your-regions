/**
 * The crowded-city window's one table (#2487): the region's list and a place's
 * circle are drawn by the same rows under one row of headings, so a curator
 * reads both the same way. A row is a place at its rank: its picture as a
 * small thumbnail with its © badge (`DenseThumbnail`, ADR-0182), its name —
 * a button that opens its circle — with its standing as a compact chip, a
 * note where its rank does not say what the rule does with it, its article,
 * and the answers its standing takes at the line's end, wrapping under the
 * name where the row is too narrow for them; then its
 * figures in the headings' columns (`FigureTable`, #2400, #2454), and, in a
 * circle, its distance. Why a place stands where it stands opens at its name,
 * on hover and on focus, never away over the map. A part of the list — the
 * region page's, its shadowed tail — is a labelled divider inside the table,
 * not a second heading row. On a phone the table scrolls sideways with the
 * name held in view.
 */

import type { ReactNode, Ref } from 'react';
import { alpha, Box, ButtonBase, Chip, Link, Stack, Tooltip, Typography } from '@mui/material';
import type { Theme } from '@mui/material';
import type { CrowdingGroupPlace } from '../../../api/crowding';
import { safeHref } from '../../../utils/safeHref';
import { DenseThumbnail } from '../../shared/DenseThumbnail';
import { ReaderEditionBeside } from '../../shared/WikipediaArticleLink';
import type { DrawnStanding } from './crowdingStaging';
import { FigureCells, FigureHeadings, figuresWidth, HOVERED_TINT, stickyName, type FigureColumns } from './FigureTable';

/** A standing's colour, the map's and the chip's: shown blue, shadowed grey, new orange, refused red. */
export const STANDING_COLOR: Record<DrawnStanding, 'primary' | 'default' | 'warning' | 'error'> = {
  shown: 'primary',
  shadowed: 'default',
  new: 'warning',
  refused: 'error',
};

/** Where a staged answer moves a place, said on its chip. */
const MOVED_WORDS: Record<DrawnStanding, string> = {
  shown: '→ on the page',
  shadowed: '→ shadowed',
  new: '→ new',
  refused: '→ not taken',
};

/** The thumbnail's side, in pixels. */
const THUMB = 40;

/** The open place's own row in its circle. */
const OWN_TINT = (theme: Theme) => alpha(theme.palette.warning.main, 0.08);

/**
 * The grid every row and the heading row share: rank, picture, name, the
 * figures' block and, in a circle, the distance. On a phone the name track is
 * fixed, and held in view while the figures scroll beside it.
 */
function rowGrid(columns: FigureColumns, distance: boolean) {
  const tail = distance ? ' 4.5rem' : '';
  return {
    display: 'grid', alignItems: 'center', columnGap: 1,
    gridTemplateColumns: {
      xs: `2rem ${THUMB}px 13rem ${figuresWidth(columns)}${tail}`,
      sm: `2rem ${THUMB}px minmax(13rem, 1fr) ${figuresWidth(columns)}${tail}`,
    },
  };
}

/**
 * The table and its one heading row, which sticks while the rows scroll: from
 * a tablet's width to a laptop's within the box the window's list scrolls in
 * (`CROWDING_LAYOUT`), which also scrolls the table sideways where it is wider,
 * and from a laptop's width on the page. On a phone the table scrolls sideways
 * in a box of its own, and its headings scroll with the page.
 */
export function CrowdingTable({ label, columns, distance = false, children }: {
  label: string;
  columns: FigureColumns;
  /** Whether the rows carry a distance, as a circle's do. */
  distance?: boolean;
  children: ReactNode;
}) {
  return (
    <Box sx={{ overflowX: { xs: 'auto', sm: 'visible' } }}>
      <Box role="table" aria-label={label} sx={{ minWidth: { xs: 'max-content', sm: `calc(${figuresWidth(columns)} + 22rem)` } }}>
        <Box
          role="row"
          sx={{
            ...rowGrid(columns, distance), px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider',
            position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper',
          }}
        >
          <span />
          <span />
          <Typography role="columnheader" variant="caption" color="text.secondary" sx={stickyName()}>Place</Typography>
          <FigureHeadings columns={columns} />
          {distance && (
            <Typography role="columnheader" variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>Distance</Typography>
          )}
        </Box>
        {children}
      </Box>
    </Box>
  );
}

/** A part of the list, named inside the table: the region page's, or its shadowed tail. */
export function DividerRow({ words }: { words: string }) {
  return (
    <Box role="row" sx={{ px: 1.5, py: 0.75, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
      <Box role="cell" sx={{ position: { xs: 'sticky', sm: 'static' }, left: 12, width: 'fit-content' }}>
        <Typography variant="subtitle2" component="h3">{words}</Typography>
      </Box>
    </Box>
  );
}

/** What a row needs of a place's picture and article: absent for a neighbour the group's list does not hold. */
type Shown = Pick<CrowdingGroupPlace, 'imageUrl' | 'imageCredit' | 'wikipediaUrl'>;

export interface RowPlace {
  membershipId: number;
  name: string;
  /** Its standing now, and the one a staged answer gives it. */
  standing: CrowdingGroupPlace['standing'];
  drawn: DrawnStanding;
  /** The figures the headings' columns show. */
  signals: Pick<CrowdingGroupPlace, 'readers' | 'wikipediaEditions' | 'guideUsed' | 'score' | 'venues'>;
}

export function CrowdingRow({
  place, rank, shown, own = false, standingWords = false, note, why, answers, distance, columns, hovered, rowRef, testId,
  onHover, onOpen,
}: {
  place: RowPlace;
  rank: number | null;
  /** Its picture and article, where the window holds them. */
  shown: Shown | null;
  /** The open place's own row in its circle: marked, and not a way to open itself. */
  own?: boolean;
  /** Whether a shadowed place says so on a chip: in a circle, where no divider names the tail. */
  standingWords?: boolean;
  /** What the rule does with it where its rank does not say it. */
  note: string | null;
  /** Why it stands where it stands, opened at its name. */
  why: string | null;
  /** The answers its standing takes, at the end of its name's line; null where it takes none here. */
  answers: ReactNode;
  /** Its distance from the circle's place, in a circle; undefined in the region's list. */
  distance?: string;
  columns: FigureColumns;
  hovered: boolean;
  /** The row's element, for a table that scrolls to it. */
  rowRef?: Ref<HTMLDivElement>;
  testId?: string;
  onHover: (membershipId: number | null) => void;
  onOpen: (membershipId: number) => void;
}) {
  const moved = place.drawn !== place.standing;
  let tint: ((theme: Theme) => string) | undefined;
  if (own) tint = OWN_TINT;
  else if (hovered) tint = HOVERED_TINT;
  const articleHref = safeHref(shown?.wikipediaUrl ?? null);
  const name = own ? (
    <Typography variant="body2" fontWeight={600}>{place.name}</Typography>
  ) : (
    <ButtonBase
      onClick={() => onOpen(place.membershipId)}
      sx={{ typography: 'body2', fontWeight: 500, textAlign: 'left', '&:hover': { textDecoration: 'underline' } }}
    >
      {place.name}
    </ButtonBase>
  );
  const nameLine = (
    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
      {name}
      {own && <Typography variant="caption" color="warning.dark">this place</Typography>}
      {place.standing === 'new' && <Chip size="small" color="warning" variant="outlined" label="New" />}
      {standingWords && place.standing === 'shadowed' && <Chip size="small" variant="outlined" label="Shadowed" />}
      {moved && <Chip size="small" color={STANDING_COLOR[place.drawn]} label={MOVED_WORDS[place.drawn]} />}
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
      {articleHref && (
        // A click on the article only opens the article.
        <Stack direction="row" spacing={1} component="span" onClick={event => event.stopPropagation()}>
          <Link href={articleHref} target="_blank" rel="noopener noreferrer" variant="caption" underline="hover">Wikipedia</Link>
          {/* The English article stays the reference; the reader's edition is offered beside it (#2209). */}
          <ReaderEditionBeside article={shown?.wikipediaUrl ?? null} />
        </Stack>
      )}
    </Stack>
  );
  return (
    <Box
      ref={rowRef}
      role="row"
      aria-label={own ? `${place.name}, this place` : undefined}
      data-testid={testId}
      onMouseEnter={() => onHover(place.membershipId)}
      onMouseLeave={() => onHover(null)}
      sx={{ ...rowGrid(columns, distance !== undefined), px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: tint }}
    >
      {/* The rank is the rows' order, which a screen reader reads already. */}
      <Typography aria-hidden variant="caption" color={own ? 'warning.dark' : 'text.secondary'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {rank ?? ''}
      </Typography>
      <Box>
        <DenseThumbnail imageUrl={shown?.imageUrl} title={place.name} credit={shown?.imageCredit} width={THUMB} height={THUMB} reserve />
      </Box>
      <Box role="rowheader" sx={stickyName(tint, { minWidth: 0 })}>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap columnGap={1.5} rowGap={0.5}>
          {why ? (
            // The reason opens at the name it explains, on hover and on keyboard focus.
            <Tooltip title={why} placement="bottom-start" enterDelay={300} disableInteractive>
              <Box sx={{ minWidth: 0 }}>{nameLine}</Box>
            </Tooltip>
          ) : <Box sx={{ minWidth: 0 }}>{nameLine}</Box>}
          {answers && <Box sx={{ ml: 'auto' }}>{answers}</Box>}
        </Stack>
      </Box>
      <FigureCells columns={columns} signals={place.signals} strong={own} />
      {distance !== undefined && (
        <Typography role="cell" variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {distance}
        </Typography>
      )}
    </Box>
  );
}
