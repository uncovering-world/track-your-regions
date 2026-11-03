/**
 * The crowded-city window's list (ADR-0180, #2282): every place of the type
 * around the window's place, best known first, each with what the rule reads
 * of it and the three answers a curator gives it.
 *
 * A row carries readers a year, Wikipedia editions, whether a guide uses it,
 * its score and the rule's count — how many places of its type within the
 * radius count above it. A line marks where the rule's ten end: from the
 * first row the rule shadows down. The standing chip says where the place
 * stands now, the pin chip what a curator kept it as, with the rule's own
 * reading beside it where the two differ, so a pin never hides the rule.
 */

import {
  Box, Button, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { Fragment } from 'react';
import type { CrowdingAnswer, CrowdingWindowRow } from '../../../api/crowding';
import {
  answersOffered, chosenAnswer, drawnStanding, ruleLineAt, type DrawnStanding, type Staging,
} from './crowdingStaging';
import { outrankedWords, pinChip, standingChip } from './rowWords';

/** A standing's colour, the map's and the chip's: listed blue, shadowed grey, new orange, refused red. */
export const STANDING_COLOR: Record<DrawnStanding, 'primary' | 'default' | 'warning' | 'error'> = {
  listed: 'primary',
  shadowed: 'default',
  new: 'warning',
  refused: 'error',
};

/** The answers, in the order the buttons stand, with their words and colour when pressed. */
const ANSWERS: Array<{ answer: CrowdingAnswer; label: string; color: 'primary' | 'inherit' | 'error' }> = [
  { answer: 'list', label: 'List', color: 'primary' },
  { answer: 'shadow', label: 'Shadow', color: 'inherit' },
  { answer: 'refuse', label: 'Don’t take', color: 'error' },
  { answer: 'clear', label: 'Clear', color: 'inherit' },
];

/** Why a row takes no pin, said on its disabled buttons. */
function noPinReason(row: CrowdingWindowRow): string | undefined {
  if (!row.canAnswer) return 'Outside your scope';
  if (row.holdsWorks) return 'It holds works a reader is shown, so it is always shown and takes no pin';
  if (!row.pinnable) return 'Its kind never hides a place of this type, so it takes no pin';
  return undefined;
}

/** The row's DOM id, which a marker's click scrolls to. */
export function rowDomId(membershipId: number): string {
  return `crowding-row-${membershipId}`;
}

/** Whether a guide uses the place, or a dash before its guides are read. */
function guideWords(used: boolean | null): string {
  if (used === null) return '—';
  return used ? 'yes' : 'no';
}

const numberCell = (value: number | null) => (value === null ? '—' : value.toLocaleString('en'));

function RowAnswers({ row, staging, frozen, onAnswer }: {
  row: CrowdingWindowRow;
  staging: Staging;
  frozen: boolean;
  onAnswer: (row: CrowdingWindowRow, answer: CrowdingAnswer) => void;
}) {
  const offered = answersOffered(row);
  const chosen = chosenAnswer(row, staging);
  const why = noPinReason(row);
  return (
    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
      {ANSWERS.filter(({ answer }) => answer !== 'clear' || row.pin !== null).map(({ answer, label, color }) => (
        // A disabled button takes no pointer events, so the reason hangs on the span around it.
        <span key={answer} title={!offered[answer] ? why : undefined}>
          <Button
            size="small"
            variant={chosen === answer ? 'contained' : 'outlined'}
            color={color}
            disabled={frozen || !offered[answer]}
            aria-pressed={chosen === answer}
            onClick={() => onAnswer(row, answer)}
            sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
          >
            {label}
          </Button>
        </span>
      ))}
    </Stack>
  );
}

export function CrowdingTable({ rows, centreId, centreName, typeWord, radiusKm, limit, staging, frozen = false, hovered, onHover, onShow, onAnswer }: {
  rows: readonly CrowdingWindowRow[];
  centreId: number;
  centreName: string;
  /** The type's plural, lowercased, as the line names it: "squares". */
  typeWord: string;
  radiusKm: number;
  limit: number;
  staging: Staging;
  /** The rows of the previous read, shown while the next one loads: they take no new answer. */
  frozen?: boolean;
  hovered: number | null;
  onHover: (membershipId: number | null) => void;
  /** A click on a row: its dot is brought into the map's view. */
  onShow: (membershipId: number) => void;
  onAnswer: (row: CrowdingWindowRow, answer: CrowdingAnswer) => void;
}) {
  const lineAt = ruleLineAt(rows);
  return (
    <Table size="small" stickyHeader aria-label="Places around">
      <TableHead>
        <TableRow>
          <TableCell>#</TableCell>
          <TableCell>Place</TableCell>
          <TableCell align="right">Readers a year</TableCell>
          <TableCell align="right">Editions</TableCell>
          <TableCell>Guide</TableCell>
          <TableCell align="right">Score</TableCell>
          <TableCell align="right">Better within {radiusKm} km</TableCell>
          <TableCell align="right">Answer</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, index) => {
          const standing = drawnStanding(row, staging);
          const pin = pinChip(row);
          return (
            <Fragment key={row.membershipId}>
              {index === lineAt && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ bgcolor: 'warning.light', color: 'warning.contrastText', py: 0.5 }}>
                    <Typography variant="caption">
                      The rule’s {limit} end here: below, a place with {limit} better-known {typeWord} within
                      {' '}{radiusKm} km of it is shadowed, unless a curator keeps it in the list.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              <TableRow
                id={rowDomId(row.membershipId)}
                hover
                selected={hovered === row.membershipId}
                // The card's place stands out by its edge, so a hover on it still shows.
                sx={row.membershipId === centreId ? theme => ({ boxShadow: `inset 4px 0 0 ${theme.palette.primary.main}` }) : undefined}
                onMouseEnter={() => onHover(row.membershipId)}
                onMouseLeave={() => onHover(null)}
                // A hover only lights the row's dot; a click or a tap brings it into the map's view.
                onClick={() => { onHover(row.membershipId); onShow(row.membershipId); }}
              >
                <TableCell>{index + 1}</TableCell>
                <TableCell sx={{ minWidth: 180 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                    <Chip size="small" label={standing === row.standing ? standingChip(row) : `${standingChip(row)} → ${standingWord(standing)}`}
                      color={STANDING_COLOR[standing]} variant={standing === 'shadowed' ? 'outlined' : 'filled'} />
                    {pin && <Chip size="small" variant="outlined" label={pin} />}
                    {row.holdsWorks && <Chip size="small" variant="outlined" label="holds works · always shown" />}
                  </Stack>
                  {row.membershipId === centreId && (
                    <Typography variant="caption" color="text.secondary" display="block">the card’s place</Typography>
                  )}
                  {row.outranksCentre && (
                    <Typography variant="caption" color="text.secondary" display="block">counts above {centreName}</Typography>
                  )}
                </TableCell>
                <TableCell align="right">{numberCell(row.readers)}</TableCell>
                <TableCell align="right">{numberCell(row.wikipediaEditions)}</TableCell>
                <TableCell>{guideWords(row.guideUsed)}</TableCell>
                <TableCell align="right">{row.score === null ? 'not scored' : row.score.toFixed(2)}</TableCell>
                <TableCell align="right">{outrankedWords(row)}</TableCell>
                <TableCell align="right"><RowAnswers row={row} staging={staging} frozen={frozen} onAnswer={onAnswer} /></TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Where a staged answer moves a row, after the arrow on its chip. */
function standingWord(standing: DrawnStanding): string {
  return { listed: 'list', shadowed: 'shadow', new: 'new', refused: 'not taken' }[standing];
}

/** The map's and the list's legend, so the colours read the same in both. */
export function StandingLegend() {
  const swatch = (standing: DrawnStanding, label: string) => (
    <Stack direction="row" spacing={0.75} alignItems="center" key={standing}>
      <Box sx={{
        width: 12, height: 12, borderRadius: '50%',
        bgcolor: standing === 'shadowed' ? 'background.paper' : `${STANDING_COLOR[standing]}.main`,
        border: 2, borderColor: standing === 'shadowed' ? 'grey.600' : `${STANDING_COLOR[standing]}.main`,
      }} />
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      {swatch('listed', 'in the list')}
      {swatch('shadowed', 'shadowed')}
      {swatch('new', 'new')}
      {swatch('refused', 'not taken')}
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'warning.main', outline: 3, outlineColor: 'primary.dark', outlineStyle: 'solid' }} />
        <Typography variant="caption">the card’s place</Typography>
      </Stack>
    </Stack>
  );
}
