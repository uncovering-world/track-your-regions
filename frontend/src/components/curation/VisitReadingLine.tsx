/**
 * Jev's reading of what a visitor finds at an arriving place (#1768,
 * ADR-0087), shown and never chosen. It is what tells a part of a larger
 * place, an object kept elsewhere or a culture from a site, which the run's
 * witnesses cannot (ADR-0128): the Lupanar has a guide and photographs, and is
 * one house of Pompeii.
 *
 * Shown only where Jev reads the card as wrong — anything but a place with
 * something to see, at any confidence — and then as a warning (#1926): 196 of
 * the 296 readings on dev only echoed what the card proposes, and a curator
 * who learns to skip an echo also skips the Arch of Reunification read as
 * demolished. A *visit* reading is still stored and counted (AI Settings), but
 * draws nothing here.
 */

import { Box, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useQuery } from '@tanstack/react-query';
import { suggestVisit, type VisitSuggestion } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';

type Reading = NonNullable<VisitSuggestion['suggestion']>;

/** What Jev reads a place as, in the words the line uses. */
const READING_WORDS: Record<Reading['reading'], string> = {
  visit: 'a place with something to see',
  part: 'a part of a larger place',
  object: 'an object kept elsewhere, not a place',
  nothing: 'a place with little or nothing left to see',
  'not-a-place': 'not one place: a culture, a kingdom or a group of sites',
  'other-kind': 'a place visited for something other than its kind',
};

/**
 * Jev's confidence is the margin over its other options, so a low one is a
 * near coin toss rather than a weak yes: said as leaning, not as reading.
 */
export function readingWords(reading: Reading): string {
  const percent = `${Math.round(reading.confidence * 100)} %`;
  return reading.confidence < 0.5
    ? `Jev is unsure, leans to ${READING_WORDS[reading.reading]} · ${percent}`
    : `Jev reads it as ${READING_WORDS[reading.reading]} · ${percent}`;
}

/**
 * Jev's suspicion in the warning's words, keeping a reading under one half as
 * leaning: "Jev suspects this card is wrong: a part of a larger place · 57 %".
 */
export function suspicionWords(reading: Reading): string {
  const percent = `${Math.round(reading.confidence * 100)} %`;
  return reading.confidence < 0.5
    ? `Jev suspects this card is wrong, unsure: leans to ${READING_WORDS[reading.reading]} · ${percent}`
    : `Jev suspects this card is wrong: ${READING_WORDS[reading.reading]} · ${percent}`;
}

/**
 * The warning, where this deployment asks Jev and it read the place as
 * anything but a place with something to see; nothing otherwise, and nothing
 * while it is asked or after a failed read. Keyed by the place's name as well
 * as its id: the server answers for the place as it stands, and a card
 * showing it renamed asks again.
 */
export function VisitReadingLine({ experienceId, name }: { experienceId: number; name: string }) {
  const { data } = useQuery({
    queryKey: queryKeys.experience.visitSuggestion(experienceId, name),
    queryFn: () => suggestVisit(experienceId),
    staleTime: 300_000,
    retry: false,
  });
  const reading = data?.suggestion;
  if (!reading || reading.reading === 'visit') return null;
  // The theme's error colour and an icon, so the warning does not rest on colour alone.
  return (
    <Typography
      variant="caption" color="error" display="flex" role="note"
      sx={{ mt: 0.5, alignItems: 'center', gap: 0.5 }}
    >
      <WarningAmberIcon fontSize="inherit" aria-hidden />
      <Box component="span">{suspicionWords(reading)}</Box>
    </Typography>
  );
}
