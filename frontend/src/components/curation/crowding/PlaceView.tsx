/**
 * The crowded-city window's place view (ADR-0180, #2358): one place of a
 * group in its own circle, beside the map that draws it. Its card shows what
 * the place is — its picture with its credit as a line, enlarged on a press
 * (ADR-0182), and its article — the rule's reading of it with its exact count, and its own
 * answers, which are about it alone. Below, a table (#2454): every place of
 * its type within the radius, the ones the card's button counts, as one list
 * by fame with the place itself at its own rank and marked there
 * (`circleRows`, #2486), each with its figures in the headings' columns
 * (`FigureTable`, #2400) and its distance. A row above the place is better
 * known and one below less known; a row says in words what the rule does with
 * it where its rank does not (#2420). Each opens its own circle, and the order
 * is the same in every circle, so opening a neighbour moves only the mark: its
 * row is scrolled to only where it is out of view. On a narrow screen the
 * table scrolls sideways.
 */

import { useEffect, useRef, useState, type Ref } from 'react';
import { alpha, Box, ButtonBase, Chip, Link, Paper, Stack, Typography } from '@mui/material';
import type { Theme } from '@mui/material';
import type { CrowdingAnswer, CrowdingPlaceView } from '../../../api/crowding';
import { extractImageUrl, toThumbnailUrl } from '../../../utils/imageUrl';
import { safeHref } from '../../../utils/safeHref';
import { ImageCreditLine } from '../../shared/ImageCreditLine';
import { PictureLightbox } from '../../shared/PictureLightbox';
import { ReaderEditionBeside } from '../../shared/WikipediaArticleLink';
import { AnswerButtons } from './AnswerButtons';
import { circleHeading, circleRows, type CircleRow } from './circleGroups';
import { drawnStanding, type Staging } from './crowdingStaging';
import { FigureCells, FigureHeadings, figuresWidth, HOVERED_TINT, stickyName, VenueCreditLine, type FigureColumns } from './FigureTable';
import { STANDING_COLOR } from './RegionList';
import { distanceWords, nounOf, ruleReading, type RuleWords } from './rowWords';

/**
 * The place's picture at a card's size, its credit as a line under it (ADR-0182)
 * while it is on screen; a press opens it enlarged with the full credit
 * (`PictureLightbox`).
 */
function Picture({ name, imageUrl, credit }: Pick<CrowdingPlaceView['place'], 'name' | 'imageUrl'> & {
  credit: CrowdingPlaceView['place']['imageCredit'];
}) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const image = extractImageUrl(imageUrl);
  const small = image ? toThumbnailUrl(image, 250) : '';
  if (!small || failedFor === small) return null;
  return (
    <Box sx={{ flexShrink: 0, width: 160 }}>
      <ButtonBase
        onClick={() => setOpen(true)}
        aria-label={`${name} — enlarge the picture`}
        sx={{ borderRadius: 1, overflow: 'hidden', cursor: 'zoom-in', display: 'block' }}
      >
        <Box component="img" src={small} alt={name} onError={() => setFailedFor(small)}
          sx={{ width: 160, height: 120, objectFit: 'cover', display: 'block' }} />
      </ButtonBase>
      <ImageCreditLine credit={credit} surface="line" />
      <PictureLightbox open={open} onClose={() => setOpen(false)} imageUrl={imageUrl} title={name} credit={credit} />
    </Box>
  );
}

/** The width the table keeps on a narrow screen, where it scrolls sideways rather than squeeze its columns. */
const tableMinWidth = (columns: FigureColumns) => ({ xs: 'max-content', sm: `calc(${figuresWidth(columns)} + 28rem)` });

/** A row's grid: its rank, its name, its figures, its standing and its distance. On a phone the name column is fixed, and held in view. */
const rowGrid = (columns: FigureColumns) => ({
  display: 'grid', alignItems: 'center', columnGap: 1,
  gridTemplateColumns: {
    xs: `2rem 10rem ${figuresWidth(columns)} 4.5rem 4.5rem`,
    sm: `2rem minmax(10rem, 1fr) ${figuresWidth(columns)} 4.5rem 4.5rem`,
  },
});

const OWN_TINT = (theme: Theme) => alpha(theme.palette.warning.main, 0.08);

/** The table's heading row: the figures' headings with their hints, between the place's name and its distance. */
function HeadingRow({ columns }: { columns: FigureColumns }) {
  return (
    <Box role="row" sx={{ ...rowGrid(columns), px: 1.5, pt: 1, pb: 0.5 }}>
      <span />
      <Typography role="columnheader" variant="caption" color="text.secondary" sx={stickyName()}>Place</Typography>
      <FigureHeadings columns={columns} />
      <span role="columnheader" aria-label="Where it stands" />
      <Typography role="columnheader" variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>Distance</Typography>
    </Box>
  );
}

/** A neighbour's standing in words where it is not shown on the region page. */
const STANDING_WORDS: Record<CrowdingPlaceView['around'][number]['standing'], string> = { shown: '', new: 'new', shadowed: 'shadowed' };

/** Whether a row stands outside the screen or outside a box that scrolls around it. */
function outOfView(row: HTMLElement): boolean {
  const { top, bottom } = row.getBoundingClientRect();
  let shownTop = 0;
  let shownBottom = window.innerHeight;
  for (let box = row.parentElement; box; box = box.parentElement) {
    const { overflowY } = window.getComputedStyle(box);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const edges = box.getBoundingClientRect();
    shownTop = Math.max(shownTop, edges.top);
    shownBottom = Math.min(shownBottom, edges.bottom);
  }
  return top < shownTop || bottom > shownBottom;
}

/**
 * A row of the circle at its rank: the place itself, marked, or a place around
 * it, its name opening its own circle and its note under the name. Either way
 * its figures and its distance stand in the headings' columns.
 */
function CircleRowView({ row, columns, hovered, ownRef, onHover, onOpen }: {
  row: CircleRow;
  columns: FigureColumns;
  hovered: boolean;
  /** The open place's row, for the table to scroll to when another place opens. */
  ownRef: Ref<HTMLDivElement>;
  onHover: (membershipId: number | null) => void;
  onOpen: (membershipId: number) => void;
}) {
  const signals = row.own ? row.place : row.entry;
  let tint: ((theme: Theme) => string) | undefined;
  if (row.own) tint = OWN_TINT;
  else if (hovered) tint = HOVERED_TINT;
  return (
    <Box
      ref={row.own ? ownRef : undefined}
      onMouseEnter={() => onHover(signals.membershipId)}
      onMouseLeave={() => onHover(null)}
      role="row"
      aria-label={row.own ? `${signals.name}, this place` : undefined}
      sx={{ ...rowGrid(columns), px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: tint }}
    >
      {/* The rank is the rows' order, which a screen reader reads already. */}
      <Typography aria-hidden variant="caption" color={row.own ? 'warning.dark' : 'text.secondary'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {row.rank ?? ''}
      </Typography>
      <Box role="rowheader" sx={stickyName(tint, { minWidth: 0 })}>
        {row.own ? (
          <>
            <Typography variant="body2" fontWeight={500}>{signals.name}</Typography>
            <Typography variant="caption" color="warning.dark" display="block">this place</Typography>
          </>
        ) : (
          <>
            <ButtonBase
              onClick={() => onOpen(signals.membershipId)}
              sx={{ typography: 'body2', justifyContent: 'flex-start', textAlign: 'left', '&:hover': { textDecoration: 'underline' } }}
            >
              {signals.name}
            </ButtonBase>
            {row.note && <Typography variant="caption" color="text.secondary" display="block">{row.note}</Typography>}
          </>
        )}
      </Box>
      <FigureCells columns={columns} signals={signals} strong={row.own} />
      <Typography role="cell" variant="caption" color="text.secondary">
        {row.own ? '' : STANDING_WORDS[row.entry.standing]}
      </Typography>
      <Typography role="cell" variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
        {row.own ? '' : distanceWords(row.entry.distanceM)}
      </Typography>
    </Box>
  );
}

export function PlaceView({ view, rule, staging, columns, frozen = false, hovered, onHover, onOpen, onAnswer }: {
  view: CrowdingPlaceView;
  rule: RuleWords;
  staging: Staging;
  /** The table's columns: the fame and score, and the venues where the kind keeps them. */
  columns: FigureColumns;
  frozen?: boolean;
  hovered: number | null;
  onHover: (membershipId: number | null) => void;
  /** A place around it clicked: its own circle opens. */
  onOpen: (membershipId: number) => void;
  onAnswer: (answer: CrowdingAnswer) => void;
}) {
  const { place } = view;
  const rows = circleRows(view);
  const ownRow = useRef<HTMLDivElement>(null);
  const shownPlace = useRef(place.membershipId);
  // Another place opened from the table or the map: the rows the two circles share keep their order, so the
  // table stays where it is, and the newly marked row is scrolled to only where it is out of view.
  useEffect(() => {
    if (shownPlace.current === place.membershipId) return;
    shownPlace.current = place.membershipId;
    const row = ownRow.current;
    if (row && outOfView(row)) row.scrollIntoView({ block: 'nearest' });
  }, [place.membershipId]);
  const articleHref = safeHref(place.wikipediaUrl);
  const drawn = drawnStanding(place, staging);
  // What the rule counts above it and the circle does not list: new arrivals outside the caller's
  // scope, and ones whose source no longer offers them (an admin meets only the second kind).
  const unlisted = view.comparedUnlisted;
  const noun = nounOf(rule, 2);

  return (
    <Stack spacing={1.5} sx={{ p: 2 }}>
      <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <Picture name={place.name} imageUrl={place.imageUrl} credit={place.imageCredit} />
        <Stack spacing={0.75} sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h6" component="h3">{place.name}</Typography>
            {place.standing === 'new' && <Chip size="small" color="warning" variant="outlined" label="New" />}
            {drawn !== place.standing && <Chip size="small" color={STANDING_COLOR[drawn]} label="answer staged" />}
          </Stack>
          {articleHref && (
            <Stack direction="row" spacing={1}>
              <Link href={articleHref} target="_blank" rel="noopener noreferrer" variant="body2" underline="hover">Wikipedia</Link>
              <ReaderEditionBeside article={place.wikipediaUrl} />
            </Stack>
          )}
          <Typography variant="body2">{ruleReading(place, rule, view.typeExempt)}</Typography>
          <AnswerButtons place={place} staging={staging} frozen={frozen} size="medium" onAnswer={onAnswer} />
          <Typography variant="caption" color="text.secondary">
            The answer is about {place.name} alone. Every other {nounOf(rule, 1)} keeps its own standing.
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" component="section" aria-label="The places around it">
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" component="h3">{circleHeading(view, rule)}</Typography>
        </Box>
        <Box role="table" aria-label="Its figures and the places around it" sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: tableMinWidth(columns) }}>
        <HeadingRow columns={columns} />
        {rows.map(row => {
          const id = row.own ? row.place.membershipId : row.entry.membershipId;
          return (
            <CircleRowView key={id} row={row} columns={columns} hovered={hovered === id} ownRef={ownRow}
              onHover={onHover} onOpen={onOpen} />
          );
        })}
        </Box>
        </Box>
        <VenueCreditLine columns={columns} />
        {unlisted > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ px: 1.5, py: 0.75 }}>
            {`${unlisted} more better known are not listed here: outside your scope, or no longer offered by their source.`}
          </Typography>
        )}
        {place.ruleCrowded && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
            For the rule to show it, fewer than {rule.limit} {noun} better known than it would have to stand within
            {' '}{rule.radiusKm} km.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
