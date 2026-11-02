/**
 * The window a curator sorts a crowded city in (ADR-0180, #2282): every place
 * of one kind and type around a place, best known first, on a map and in a
 * list, each given one answer — List, Shadow or Don't take — and all of them
 * applied together.
 *
 * Whether a place belongs in a city's list or its shadow is a question of
 * priorities among its neighbours, not of the place alone, so the window
 * shows the whole type around: those in the list, those shadowed and the new
 * arrivals, with the rule's count for each and the curator's pin beside it.
 * A type switch moves between the kind's types, judged apart as the map judges
 * them. Answers are staged, survive a switch of type or of the place stood on,
 * and go with one Apply; the window then reads the city again and says what
 * each answer did, by name.
 *
 * Opened from a review card on that card's membership, or from the shadowed
 * arrivals' section on a group's best-known arrival, with Previous and Next
 * through the group's others: an arrival at the far edge of the first one's
 * circle has neighbours the first window does not show.
 *
 * Its own chunk: the review page loads it when a curator opens it.
 */

import { useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack,
  Typography, useMediaQuery, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrowdingAnswer, CrowdingWindowRow } from '../../../api/crowding';
import { answerCrowding, CrowdingPartlyApplied, fetchCrowdingWindow } from '../../../api/crowdingAnswers';
import { queryKeys } from '../../../api/queryKeys';
import { typePluralWord, typeWordFor } from '../../../utils/experienceTypes';
import { plural } from '../../../utils/plural';
import { LoadingSpinner } from '../../shared/LoadingSpinner';
import { CrowdingTable, StandingLegend } from './CrowdingTable';
import { answerRows, outcomeLines, stageAnswer, stagingSummary, type Staging } from './crowdingStaging';

export function CrowdingWindowDialog({ memberships, groupName, onClose }: {
  /** The places the window stands on in turn: one from a card, a group's arrivals best known first from the queue. */
  memberships: readonly number[];
  /** The group's name, where the window steps through one: "Berlin · squares". */
  groupName?: string;
  /** Closed; with what the answers applied did, where any were applied. */
  onClose: (message?: string) => void;
}) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  const queryClient = useQueryClient();
  const [at, setAt] = useState(0);
  const [type, setType] = useState<string | null>(null);
  const [staging, setStaging] = useState<Staging>(new Map());
  const [hovered, setHovered] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ lines: string[]; error?: string } | null>(null);
  const [appliedLines, setAppliedLines] = useState<string[]>([]);
  const membershipId = memberships[at];

  const read = useQuery({
    queryKey: queryKeys.curation.crowdingWindow(membershipId, type),
    queryFn: () => fetchCrowdingWindow(membershipId, type),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const around = read.data;

  const apply = useMutation({
    mutationFn: () => answerCrowding(answerRows(staging)),
    onSuccess: result => settle(outcomeLines(result)),
    onError: (error: unknown) => {
      if (error instanceof CrowdingPartlyApplied) {
        // Only the answers a page settled leave the staging; the ones never sent stay staged to send again.
        const settled = new Set([...error.applied.answered, ...error.applied.refused].map(entry => entry.membershipId));
        settle(outcomeLines(error.applied), error.message, settled);
      }
      else setOutcome({ lines: [], error: error instanceof Error ? error.message : 'The answers could not be applied' });
    },
  });

  /**
   * After an Apply: the report, a clean staging, and the city read again —
   * every window, since a pin recounts its neighbours. The lists and the queue
   * the answers changed are the opener's to refresh, once the window closes.
   */
  function settle(lines: string[], error?: string, settled?: ReadonlySet<number>) {
    setOutcome({ lines, error });
    setAppliedLines(before => [...before, ...lines]);
    setStaging(current => (settled ? new Map([...current].filter(([id]) => !settled.has(id))) : new Map()));
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.crowdingWindowAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.shadowedArrivals });
  }

  const close = () => onClose(appliedLines.length > 0 ? appliedLines.join(' ') : undefined);
  const onAnswer = (row: CrowdingWindowRow, answer: CrowdingAnswer) => setStaging(current => stageAnswer(current, row, answer));
  const step = (by: number) => { setAt(current => current + by); setType(null); setHovered(null); };

  const summary = around ? stagingSummary(around.rows, staging) : null;
  const typeWords = around ? typePluralWord(around.kind.id, around.kind.name, around.type) : '';

  return (
    <Dialog
      open
      fullWidth
      maxWidth="xl"
      fullScreen={narrow}
      // A click beside the window or a stray Escape must not throw away answers
      // not yet applied: with any staged, only the close button closes it.
      onClose={() => { if (staging.size === 0 && !apply.isPending) close(); }}
      aria-labelledby="crowding-window-title"
    >
      <DialogTitle id="crowding-window-title" component="div" sx={{ pr: 7 }}>
        <Typography variant="h6" component="h2">
          {around ? `${typeWords} around ${around.centre.name} · ${around.kind.radiusKm} km` : 'Places around'}
        </Typography>
        {around && (
          <Typography variant="body2" color="text.secondary">
            All the {typeWords.toLowerCase()} of {around.kind.name} within {around.kind.radiusKm} km — in the list,
            shadowed and new — best known first. A place is shown unless {around.kind.limit} better-known places of
            its type stand within {around.kind.radiusKm} km of it; the rest wait in the shadowed list.
            {around.typeExempt && ` ${around.kind.name} never hides a place of this type, so none of these takes a pin.`}
          </Typography>
        )}
        {around && around.types.length > 1 && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">Type:</Typography>
            {around.types.map(entry => (
              <Chip
                key={entry.type ?? 'none'}
                label={`${entry.type === null ? 'no type' : typeWordFor(around.kind.id, entry.type)} · ${entry.places}${entry.exempt ? ' · never hidden' : ''}`}
                color={entry.type === around.type ? 'primary' : 'default'}
                variant={entry.type === around.type ? 'filled' : 'outlined'}
                // A place with no type is read only from a place that has none: the read names a type to switch to.
                disabled={entry.type === null && around.centre.type !== null}
                onClick={() => setType(entry.type === around.centre.type ? null : entry.type)}
              />
            ))}
          </Stack>
        )}
        {memberships.length > 1 && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Typography variant="body2">
              {groupName ? `${groupName}: ` : ''}arrival {at + 1} of {memberships.length}
            </Typography>
            <Button size="small" disabled={at === 0} onClick={() => step(-1)}>Previous</Button>
            <Button size="small" disabled={at === memberships.length - 1} onClick={() => step(1)}>Next</Button>
          </Stack>
        )}
        {/* Not while an Apply runs: the opener refreshes the queue from what the window reports on close. */}
        <IconButton aria-label="Close the window" onClick={close} disabled={apply.isPending} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {read.isError && (
          <Alert severity="error" sx={{ m: 2 }}>
            Could not read the places around{read.error instanceof Error ? `: ${read.error.message}` : '.'}
          </Alert>
        )}
        {!around && read.isLoading && <LoadingSpinner padding={4} />}
        {around && (
          <Stack direction={{ xs: 'column', md: 'row' }} sx={{ opacity: read.isPlaceholderData ? 0.6 : 1 }}>
            <Box sx={{ width: { xs: '100%', md: 440 }, flexShrink: 0, p: 2, borderRight: { md: 1 }, borderColor: { md: 'divider' } }}>
              <StandingLegend />
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0, maxHeight: { md: '65vh' }, overflow: 'auto' }}>
              {around.rows.length === 0
                ? <Typography sx={{ p: 2 }} color="text.secondary">No place of this type stands within {around.kind.radiusKm} km.</Typography>
                : (
                  <CrowdingTable
                    rows={around.rows}
                    centreId={around.centre.membershipId}
                    centreName={around.centre.name}
                    typeWord={typeWords.toLowerCase()}
                    radiusKm={around.kind.radiusKm}
                    limit={around.kind.limit}
                    staging={staging}
                    hovered={hovered}
                    onHover={setHovered}
                    onAnswer={onAnswer}
                  />
                )}
            </Box>
          </Stack>
        )}
      </DialogContent>

      {outcome && (
        <Alert severity={outcome.error ? 'warning' : 'success'} onClose={() => setOutcome(null)} sx={{ mx: 2, mt: 1 }}>
          {outcome.lines.map(line => <Box key={line}>{line}</Box>)}
          {outcome.error && (
            <Box>{outcome.lines.length > 0 ? 'The rest were not applied' : 'The answers were not applied'}: {outcome.error}</Box>
          )}
        </Alert>
      )}

      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, py: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 240 }}>
          {summary && (
            <Typography variant="body2">
              New here: {summary.arrivals}, answered {summary.arrivalsAnswered}. Changed among those already in:
              {' '}{summary.admittedChanged}.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            List keeps a place on the map and in the list, one of the {around?.kind.limit ?? 10}; Shadow keeps it in the
            shadowed list only; Don’t take refuses it. Keeping a new place publishes it.
          </Typography>
        </Box>
        <Button disabled={staging.size === 0 || apply.isPending} onClick={() => setStaging(new Map())}>Reset</Button>
        <Button variant="contained" disabled={staging.size === 0 || apply.isPending} onClick={() => apply.mutate()}>
          {staging.size === 0 ? 'Apply' : `Apply ${plural(staging.size, 'answer')}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
