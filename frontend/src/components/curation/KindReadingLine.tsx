/**
 * Jev's reading of which kind, live or planned, an arriving place belongs to
 * (#2342, ADR-0087), shown and never chosen. A curator meeting Michelangelo's
 * David in Monuments & memorials knew it was not a monument; the line says
 * where it belongs instead, or that no kind does.
 *
 * Shown only where Jev names something other than the kind the place is
 * arriving in, as the visit reading is (#1926): an echo of the card is a line
 * a curator learns to skip. The line is words alone. A live kind is chosen
 * when the curator opens the arrival's own "Belongs in another kind…"
 * (`suggestedKindOf`), so one control moves a place; the line promises
 * nothing of it, since the form offers only the kinds the curator's scope
 * reaches, and opens with nothing chosen otherwise. Where the place has a
 * membership in that kind already (`held`) the form cannot offer it, and the
 * line says where the place stands there instead,
 * in it, arriving there too or kept out of it. A planned kind, named with its
 * issue where the register has one, asks whether the place belongs there,
 * and the answer is recorded for when the kind is built.
 */

import { Box, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { answerPlannedKind, suggestKind, type KindSuggestion } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';

type Reading = NonNullable<KindSuggestion['suggestion']>;
type Held = NonNullable<NonNullable<Reading['kind']>['held']>;

/** Where the place stands in the kind Jev names, which it cannot be moved into. */
const HELD_WORDS: Record<Held, (kind: string) => string> = {
  offered: kind => `it is in ${kind} already`,
  arriving: kind => `it is arriving in ${kind} too`,
  kept_out: kind => `it was kept out of ${kind} earlier`,
};

/** What Jev names, in the line's words: a kind, a planned kind with its issue, or none. */
function namedWords(reading: Reading): string {
  if (reading.kind) return reading.kind.name;
  if (reading.plannedKind) {
    const issue = reading.plannedKind.issue ? `, issue #${reading.plannedKind.issue}` : '';
    return `${reading.plannedKind.name} — a kind not built yet${issue}`;
  }
  return 'no kind of the catalogue, built or planned';
}

/**
 * Jev's confidence is the margin over its other options, so a low one is a
 * near coin toss rather than a weak yes: said as leaning, not as reading.
 */
function kindReadingWords(reading: Reading): string {
  const percent = `${Math.round(reading.confidence * 100)} %`;
  return reading.confidence < 0.5
    ? `Jev is unsure which kind this is, leans to ${namedWords(reading)} · ${percent}`
    : `Jev reads this as ${namedWords(reading)} · ${percent}`;
}

/**
 * The stored reading of a place, asked of Jev the first time (the server
 * answers for the place as it stands): one query the line and the card's
 * "Belongs in another kind…" share, keyed by the place's name as well as its
 * id, so a card showing it renamed asks again.
 */
export function useKindReading(experienceId: number, name: string, enabled = true): Reading | null {
  const { data } = useQuery({
    queryKey: queryKeys.experience.kindSuggestion(experienceId, name),
    queryFn: () => suggestKind(experienceId),
    staleTime: 300_000,
    retry: false,
    enabled,
  });
  return data?.suggestion ?? null;
}

/**
 * The live kind "Belongs in another kind…" opens with: the one Jev names,
 * unless it is the kind the place arrives in or one the place is in already,
 * which the form cannot offer.
 */
export function suggestedKindOf(reading: Reading | null, arrivingKindId: number): number | undefined {
  const kind = reading?.kind;
  return kind && !kind.held && kind.id !== arrivingKindId ? kind.id : undefined;
}

/** The planned kind's question, or the answer the curator gave. */
function PlannedAnswer({ experienceId, name, planned }: {
  experienceId: number; name: string; planned: NonNullable<Reading['plannedKind']>;
}) {
  const queryClient = useQueryClient();
  const answer = useMutation({
    mutationFn: (belongs: boolean) => answerPlannedKind(experienceId, { plannedKind: planned.slug, belongs }),
    // The stored reading is read again, at no cost, with the answer on it.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.experience.kindSuggestion(experienceId, name) }),
  });
  if (planned.belongs !== null) {
    return (
      <Box component="span">
        {planned.belongs
          ? ` You said it belongs there; it is listed for when ${planned.name} is built.`
          : ' You said it does not belong there.'}
        <Button size="small" sx={{ ml: 0.5, py: 0, minWidth: 0 }} disabled={answer.isPending}
          onClick={() => answer.mutate(!planned.belongs)}>
          Change
        </Button>
      </Box>
    );
  }
  return (
    <Stack direction="row" spacing={1} component="span" sx={{ display: 'inline-flex', ml: 1 }}>
      <Button size="small" sx={{ py: 0 }} disabled={answer.isPending} onClick={() => answer.mutate(true)}>
        It belongs there
      </Button>
      <Button size="small" color="inherit" sx={{ py: 0 }} disabled={answer.isPending} onClick={() => answer.mutate(false)}>
        It does not
      </Button>
    </Stack>
  );
}

/**
 * The line, where this deployment asks Jev and it named another kind or none;
 * nothing otherwise, and nothing while it is asked or after a failed read.
 */
export function KindReadingLine({ experienceId, name, arrivingKindId }: {
  experienceId: number;
  name: string;
  /** The kind the place is arriving in: a reading naming it is an echo, and draws nothing. */
  arrivingKindId: number;
}) {
  const reading = useKindReading(experienceId, name);
  if (!reading || reading.kind?.id === arrivingKindId) return null;
  const { kind } = reading;
  return (
    <Typography variant="caption" color="text.secondary" display="block" role="note" sx={{ mt: 0.5 }}>
      <Box component="span">{kindReadingWords(reading)}</Box>
      {kind?.held && <Box component="span">{` · ${HELD_WORDS[kind.held](kind.name)}`}</Box>}
      {reading.plannedKind && <PlannedAnswer experienceId={experienceId} name={name} planned={reading.plannedKind} />}
    </Typography>
  );
}
