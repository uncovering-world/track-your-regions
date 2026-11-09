/**
 * The crowded-city window's region view, its list (ADR-0180, #2358): a
 * region's places of one kind and type as its page shows them — those on the
 * page best known first, then the shadowed tail, each with how many
 * better-known places stand within the radius of it. A new arrival sits where
 * the rule would put it once passed.
 *
 * Each row shows what its place is (`PlaceCell`: its picture, credit and
 * article, #2345), a note on its standing, what its score is made of and the
 * score (`FameFigures`, #2400), and the answers its standing takes
 * (`AnswerButtons`). A hover says why the place stands where it stands
 * (`whyWords`) and lights its dot on the map; a click on its name opens the
 * place in its own circle.
 */

import { Box, ButtonBase, Chip, Stack, Tooltip, Typography } from '@mui/material';
import type { CrowdingAnswer, CrowdingGroupPlace } from '../../../api/crowding';
import { AnswerButtons } from './AnswerButtons';
import { drawnStanding, listPart, type DrawnStanding, type Staging } from './crowdingStaging';
import { FameFigures } from './FameFigures';
import { PlaceCell } from './PlaceCell';
import { nounOf, placeNote, whyWords, type RuleWords } from './rowWords';

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

function Row({ place, rank, first, rule, typeExempt, staging, hovered, onHover, onOpen, onAnswer }: {
  place: CrowdingGroupPlace;
  /** Its place in the group's fame order, from one. */
  rank: number;
  first: boolean;
  rule: RuleWords;
  typeExempt: boolean;
  staging: Staging;
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
        data-testid={`crowding-place-${place.membershipId}`}
        onMouseEnter={() => onHover(place.membershipId)}
        onMouseLeave={() => onHover(null)}
        sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.5, py: 1,
          borderBottom: 1, borderColor: 'divider',
          bgcolor: hovered ? 'action.selected' : undefined,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ width: 28, flexShrink: 0, pt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
          {rank}
        </Typography>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
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
            <FameFigures signals={place} />
          </PlaceCell>
        </Box>
        <Box sx={{ flexShrink: 0, maxWidth: '50%' }}>
          <AnswerButtons place={place} staging={staging} onAnswer={answer => onAnswer(place, answer)} />
        </Box>
      </Box>
    </Tooltip>
  );
}

function PartHeader({ children }: { children: string }) {
  return (
    <Box sx={{
      px: 1.5, py: 1, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider',
      position: 'sticky', top: 0, zIndex: 1,
    }}
    >
      <Typography variant="subtitle2" component="h3">{children}</Typography>
    </Box>
  );
}

export function RegionList({ places, rule, typeExempt, staging, hovered, onHover, onOpen, onAnswer }: {
  /** The group's places, best known first. */
  places: readonly CrowdingGroupPlace[];
  rule: RuleWords;
  typeExempt: boolean;
  staging: Staging;
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
      typeExempt={typeExempt}
      staging={staging}
      hovered={hovered === place.membershipId}
      onHover={onHover}
      onOpen={onOpen}
      onAnswer={onAnswer}
    />
  );
  return (
    <Box component="section" aria-label="The region's list">
      <PartHeader>{`On the region page · ${onPage}${arrivingWords} — best known first`}</PartHeader>
      {page.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
          The region page shows none of its {nounOf(rule, 2)}.
        </Typography>
      )}
      {page.map(row)}
      {tail.length > 0 && <PartHeader>{`Shadowed · ${tail.length}, in the list’s tail`}</PartHeader>}
      {tail.map(row)}
    </Box>
  );
}
