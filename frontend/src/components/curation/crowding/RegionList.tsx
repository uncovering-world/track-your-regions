/**
 * The crowded-city window's region view, its list (ADR-0180, #2358): a
 * region's places of one kind and type as its page shows them — those on the
 * page best known first, then the shadowed tail, each with how many
 * better-known places stand within the radius of it. A new arrival sits where
 * the rule would put it once passed.
 *
 * Drawn by the window's one table (`CrowdingTable`, #2487), the rows a
 * place's circle is drawn by: each row its rank, its picture with its credit,
 * its name with its standing, a note on what the rule does with it, its
 * article and the answers its standing takes (`AnswerButtons`), then its
 * figures in the headings' columns (`FigureTable`, #2400, #2454). The page's
 * part and the tail are labelled dividers inside the table. A hover or a focus
 * at its name says why the place stands where it stands (`whyWords`), and a
 * hover lights its dot on the map; a click on its name opens the place in its
 * own circle.
 */

import { Box, Typography } from '@mui/material';
import type { CrowdingAnswer, CrowdingGroupPlace } from '../../../api/crowding';
import { AnswerButtons } from './AnswerButtons';
import { CrowdingRow, CrowdingTable, DividerRow } from './CrowdingTable';
import { drawnStanding, listPart, type Staging } from './crowdingStaging';
import { VenueCreditLine, type FigureColumns } from './FigureTable';
import { nounOf, placeNote, whyWords, type RuleWords } from './rowWords';

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
    <CrowdingRow
      key={place.membershipId}
      testId={`crowding-place-${place.membershipId}`}
      place={{ ...place, drawn: drawnStanding(place, staging), signals: place }}
      rank={rank}
      shown={place}
      note={placeNote(place, rule, rank === 1)}
      why={whyWords(place, rule, typeExempt)}
      answers={<AnswerButtons place={place} staging={staging} onAnswer={answer => onAnswer(place, answer)} />}
      columns={columns}
      hovered={hovered === place.membershipId}
      onHover={onHover}
      onOpen={onOpen}
    />
  );
  return (
    <Box component="section" aria-label="The region's list">
      <CrowdingTable label="The region's places and their figures" columns={columns}>
        <DividerRow words={`On the region page · ${onPage}${arrivingWords} — best known first`} />
        {page.length === 0 && (
          <Box role="row">
            <Typography role="cell" variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
              The region page shows none of its {nounOf(rule, 2)}.
            </Typography>
          </Box>
        )}
        {page.map(row)}
        {tail.length > 0 && <DividerRow words={`Shadowed · ${tail.length}, in the list’s tail`} />}
        {tail.map(row)}
      </CrowdingTable>
      <VenueCreditLine columns={columns} />
    </Box>
  );
}
