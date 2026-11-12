/**
 * The crowded-city window's region view, its list (ADR-0180, #2358): a
 * region's places of one kind and type as its page shows them — those on the
 * page best known first, then the shadowed tail, each with how many
 * better-known places stand within the radius of it. A new arrival sits where
 * the rule would put it once passed.
 *
 * Each row shows what its place is (`PlaceCell`: its picture, credit and
 * article, #2345), a note on its standing and the answers its standing takes
 * (`AnswerButtons`), and, in a block of the same columns on every row under
 * the list's headings, what its score is made of and the score
 * (`FigureTable`, #2400, #2454). A hover says why the place stands where it stands
 * (`whyWords`) and lights its dot on the map; a click on its name opens the
 * place in its own circle.
 */

import type { ReactNode } from 'react';
import { Box, ButtonBase, Chip, Stack, Tooltip, Typography } from '@mui/material';
import type { CrowdingAnswer, CrowdingGroupPlace } from '../../../api/crowding';
import { AnswerButtons } from './AnswerButtons';
import { drawnStanding, listPart, type DrawnStanding, type Staging } from './crowdingStaging';
import { FigureCells, FigureHeadings, HOVERED_TINT, stickyName, VenueCreditLine, type FigureColumns } from './FigureTable';
import { PlaceCell } from './PlaceCell';
import { nounOf, placeNote, whyWords, type RuleWords } from './rowWords';

/** A standing's colour, the map's and the chip's: shown blue, shadowed grey, new orange, refused red. */
export const STANDING_COLOR: Record<DrawnStanding, 'primary' | 'default' | 'warning' | 'error'> = {
  shown: 'primary',
  shadowed: 'default',
  new: 'warning',
  refused: 'error',
};


/** A row's rank track, in pixels. */
const RANK_WIDTH = 28;
/** A row's name track on a phone, where the figures scroll sideways beside it. */
const NAME_WIDTH_XS = '12rem';
/** A part header's name column on a phone: the rank and name tracks with the row's gap (`gap: 1`) between them. */
const HEADER_WIDTH_XS = `calc(${RANK_WIDTH}px + 8px + ${NAME_WIDTH_XS})`;
/** Where a staged answer moves a place, said on its chip. */
const MOVED_WORDS: Record<DrawnStanding, string> = {
  shown: '→ on the page',
  shadowed: '→ shadowed',
  new: '→ new',
  refused: '→ not taken',
};

function Row({ place, rank, first, rule, typeExempt, staging, columns, hovered, onHover, onOpen, onAnswer }: {
  place: CrowdingGroupPlace;
  /** Its place in the group's fame order, from one. */
  rank: number;
  first: boolean;
  rule: RuleWords;
  typeExempt: boolean;
  staging: Staging;
  /** The table's columns: the fame and score, and the venues where the kind keeps them. */
  columns: FigureColumns;
  hovered: boolean;
  onHover: (membershipId: number | null) => void;
  onOpen: (membershipId: number) => void;
  onAnswer: (place: CrowdingGroupPlace, answer: CrowdingAnswer) => void;
}) {
  const drawn = drawnStanding(place, staging);
  const moved = drawn !== place.standing;
  const note = placeNote(place, rule, first);
  return (
    <Tooltip title={whyWords(place, rule, typeExempt)} placement="left" enterDelay={300} disableInteractive>
      <Box
        role="row"
        data-testid={`crowding-place-${place.membershipId}`}
        onMouseEnter={() => onHover(place.membershipId)}
        onMouseLeave={() => onHover(null)}
        sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.5, py: 1,
          borderBottom: 1, borderColor: 'divider',
          bgcolor: hovered ? 'action.selected' : undefined,
        }}
      >
        {/* The rank is the rows' order, which a screen reader reads already. */}
        <Typography aria-hidden variant="caption" color="text.secondary" sx={{ width: RANK_WIDTH, flexShrink: 0, pt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
          {rank}
        </Typography>
        <Box role="rowheader" sx={stickyName(hovered ? HOVERED_TINT : undefined, { flexGrow: { xs: 0, sm: 1 }, flexShrink: { xs: 0, sm: 1 }, width: { xs: NAME_WIDTH_XS, sm: 'auto' }, minWidth: 0 })}>
          <PlaceCell
            row={place}
            title={(
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <ButtonBase
                  onClick={() => onOpen(place.membershipId)}
                  sx={{ typography: 'body2', fontWeight: 600, textAlign: 'left', '&:hover': { textDecoration: 'underline' } }}
                >
                  {place.name}
                </ButtonBase>
                {place.standing === 'new' && <Chip size="small" color="warning" variant="outlined" label="New" />}
                {moved && <Chip size="small" color={STANDING_COLOR[drawn]} label={MOVED_WORDS[drawn]} />}
              </Stack>
            )}
          >
            {note && <Typography variant="caption" color="text.secondary" display="block">{note}</Typography>}
            <Box sx={{ mt: 0.5 }}>
              <AnswerButtons place={place} staging={staging} onAnswer={answer => onAnswer(place, answer)} />
            </Box>
          </PlaceCell>
        </Box>
        <FigureCells columns={columns} signals={place} />
      </Box>
    </Tooltip>
  );
}

/**
 * A part of the list, the region page's or its tail's, under a header that
 * names it and carries the figures' headings. From `sm` up the header sticks
 * while the part scrolls, so a figure is never read without its heading; on a
 * phone the table scrolls sideways instead, and the header stays at the top
 * of its part. There the part's words wrap within the rows' rank and name
 * tracks, so each heading stands over its column whatever the words' length.
 */
function Part({ words, columns, children }: { words: string; columns: FigureColumns; children: ReactNode }) {
  return (
    <Box role="rowgroup" aria-label={words}>
      <Box role="row" sx={{
        display: 'flex', alignItems: 'flex-end', gap: 1, px: 1.5, py: 1,
        bgcolor: 'background.paper', backgroundImage: theme => `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
        borderBottom: 1, borderColor: 'divider', position: 'sticky', top: 0, zIndex: 2,
      }}
      >
        <Box role="columnheader" sx={{ flex: { xs: `0 0 ${HEADER_WIDTH_XS}`, sm: '1 1 0' }, minWidth: 0 }}>
          <Typography variant="subtitle2" component="h3">{words}</Typography>
        </Box>
        <FigureHeadings columns={columns} />
      </Box>
      {children}
    </Box>
  );
}

export function RegionList({ places, rule, typeExempt, staging, columns, hovered, onHover, onOpen, onAnswer }: {
  /** The group's places, best known first. */
  places: readonly CrowdingGroupPlace[];
  rule: RuleWords;
  typeExempt: boolean;
  staging: Staging;
  /** The table's columns: the fame and score, and the venues where the kind keeps them. */
  columns: FigureColumns;
  hovered: number | null;
  onHover: (membershipId: number | null) => void;
  /** A place's name clicked: its own circle opens. */
  onOpen: (membershipId: number) => void;
  onAnswer: (place: CrowdingGroupPlace, answer: CrowdingAnswer) => void;
}) {
  const ranked = places.map((place, index) => ({ place, rank: index + 1 }));
  const page = ranked.filter(({ place }) => listPart(place) === 'page');
  const tail = ranked.filter(({ place }) => listPart(place) === 'tail');
  // The page's part holds the new arrivals the rule would show once published, said apart:
  // the region page shows them only once a curator passes them.
  const arriving = page.filter(({ place }) => place.standing === 'new').length;
  const onPage = page.length - arriving;
  const arrivingWords = arriving > 0 ? `, and ${arriving} new that would be` : '';
  const row = ({ place, rank }: { place: CrowdingGroupPlace; rank: number }) => (
    <Row
      key={place.membershipId}
      place={place}
      rank={rank}
      first={rank === 1}
      rule={rule}
      columns={columns}
      typeExempt={typeExempt}
      staging={staging}
      hovered={hovered === place.membershipId}
      onHover={onHover}
      onOpen={onOpen}
      onAnswer={onAnswer}
    />
  );
  // Only a phone scrolls the table sideways: a scroll box there is also the scrollport the
  // part headers stick to, and on a wider screen the pane around the list scrolls instead.
  return (
    <Box component="section" aria-label="The region's list" sx={{ overflowX: { xs: 'auto', sm: 'visible' } }}>
      <Box role="table" aria-label="The region's places and their figures" sx={{ minWidth: { xs: 'max-content', sm: 0 } }}>
        <Part words={`On the region page · ${onPage}${arrivingWords} — best known first`} columns={columns}>
          {page.length === 0 && (
            <Box role="row">
              <Typography role="cell" variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                The region page shows none of its {nounOf(rule, 2)}.
              </Typography>
            </Box>
          )}
          {page.map(row)}
        </Part>
        {tail.length > 0 && <Part words={`Shadowed · ${tail.length}, in the list’s tail`} columns={columns}>{tail.map(row)}</Part>}
      </Box>
      <VenueCreditLine columns={columns} />
    </Box>
  );
}
