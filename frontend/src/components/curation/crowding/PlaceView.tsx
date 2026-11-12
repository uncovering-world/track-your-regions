/**
 * The crowded-city window's place view (ADR-0180, #2358): one place of a
 * group in its own circle, beside the map that draws it. Its card shows what
 * the place is — its picture with its credit as a line, enlarged on a press
 * (ADR-0182), and its article — the rule's reading of it with its exact count, and its own
 * answers, which are about it alone. Below, a table (#2454): the place's own
 * row first and marked, then every place of its type within the radius, the
 * ones the card's button counts, in their groups (`circleGroups`, #2420): the
 * better known it is compared with, the less known, and the ones not measured
 * yet. Each is listed best known first, with its figures in the headings'
 * columns (`FigureTable`, #2400) and its distance, and each opens its own
 * circle. On a narrow screen the table scrolls sideways.
 */

import { useState } from 'react';
import { alpha, Box, ButtonBase, Chip, Link, Paper, Stack, Typography } from '@mui/material';
import type { Theme } from '@mui/material';
import type { CrowdingAnswer, CrowdingPlaceView } from '../../../api/crowding';
import { extractImageUrl, toThumbnailUrl } from '../../../utils/imageUrl';
import { safeHref } from '../../../utils/safeHref';
import { ImageCreditLine } from '../../shared/ImageCreditLine';
import { PictureLightbox } from '../../shared/PictureLightbox';
import { ReaderEditionBeside } from '../../shared/WikipediaArticleLink';
import { AnswerButtons } from './AnswerButtons';
import { CIRCLE_GROUPS, circleGroups, circleHeading, GROUP_WORDS, uncountedReason } from './circleGroups';
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

/** The place itself, first and marked, so each of its figures stands above the ones it is compared with. */
function OwnRow({ place, columns }: { place: CrowdingPlaceView['place']; columns: FigureColumns }) {
  return (
    <Box role="row" aria-label={`${place.name}, this place`} sx={{ ...rowGrid(columns), px: 1.5, py: 0.75, bgcolor: OWN_TINT, borderBottom: 1, borderColor: 'divider' }}>
      <Typography aria-hidden variant="caption" color="warning.dark">this</Typography>
      <Typography role="rowheader" variant="body2" fontWeight={500} sx={stickyName(OWN_TINT)}>{place.name}</Typography>
      <FigureCells columns={columns} signals={place} strong />
      <span role="cell" />
      <span role="cell" />
    </Box>
  );
}

/** A neighbour's standing in words where it is not shown on the region page. */
const STANDING_WORDS: Record<CrowdingPlaceView['around'][number]['standing'], string> = { shown: '', new: 'new', shadowed: 'shadowed' };

/** A place around it: its rank in its group, its name opening its own circle, its figures and its distance. */
function NeighbourRow({ entry, index, reason, columns, hovered, onHover, onOpen }: {
  entry: CrowdingPlaceView['around'][number];
  index: number;
  /** Why the rule does not count it, where it is better known and still not counted. */
  reason?: string;
  columns: FigureColumns;
  hovered: boolean;
  onHover: (membershipId: number | null) => void;
  onOpen: (membershipId: number) => void;
}) {
  return (
    <Box
      onMouseEnter={() => onHover(entry.membershipId)}
      onMouseLeave={() => onHover(null)}
      role="row"
      sx={{ ...rowGrid(columns), px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: hovered ? 'action.selected' : undefined }}
    >
      {/* The rank is the rows' order, which a screen reader reads already. */}
      <Typography aria-hidden variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{index + 1}</Typography>
      <Box role="rowheader" sx={stickyName(hovered ? HOVERED_TINT : undefined, { minWidth: 0 })}>
        <ButtonBase
          onClick={() => onOpen(entry.membershipId)}
          sx={{ typography: 'body2', justifyContent: 'flex-start', textAlign: 'left', '&:hover': { textDecoration: 'underline' } }}
        >
          {entry.name}
        </ButtonBase>
        {reason && <Typography variant="caption" color="text.secondary" display="block">{reason}</Typography>}
      </Box>
      <FigureCells columns={columns} signals={entry} />
      <Typography role="cell" variant="caption" color="text.secondary">
        {STANDING_WORDS[entry.standing]}
      </Typography>
      <Typography role="cell" variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
        {distanceWords(entry.distanceM)}
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
  const groups = circleGroups(view);
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
        <OwnRow place={place} columns={columns} />
        {CIRCLE_GROUPS.filter(group => groups[group].length > 0).map(group => (
          <Box key={group} role="rowgroup" aria-label={GROUP_WORDS[group]}>
            <Box role="row">
              <Box role="cell" sx={{ display: 'inline-block', position: 'sticky', left: 0 }}>
                <Typography variant="overline" component="h4" color="text.secondary" sx={{ px: 1.5, pt: 1, lineHeight: 1.6 }}>
                  {`${GROUP_WORDS[group]} · ${groups[group].length}`}
                </Typography>
              </Box>
            </Box>
            {groups[group].map((entry, index) => (
              <NeighbourRow key={entry.membershipId} entry={entry} index={index}
                reason={group === 'uncounted' ? uncountedReason(entry) : undefined} columns={columns} hovered={hovered === entry.membershipId}
                onHover={onHover} onOpen={onOpen} />
            ))}
          </Box>
        ))}
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
