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
 * One window, two frames: `CrowdingWindowDialog` draws it over a review card
 * or a place's curation dialog, and the review page's *Crowded cities* tab
 * draws it in the page beside its list of cities. The frame lays the parts
 * out and owns the staging, so a tab that unmounts the window keeps the
 * answers; this component reads, stages, applies and reports.
 */

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrowdingAnswer, CrowdingAnswerRow, CrowdingWindowRow } from '../../../api/crowding';
import { answerCrowding, CrowdingPartlyApplied, fetchCrowdingWindow } from '../../../api/crowdingAnswers';
import { queryKeys } from '../../../api/queryKeys';
import { typePluralWord, typeWordFor } from '../../../utils/experienceTypes';
import { plural } from '../../../utils/plural';
import { LoadingSpinner } from '../../shared/LoadingSpinner';
import { CrowdingMap } from './CrowdingMap';
import { CrowdingTable, rowDomId, StandingLegend } from './CrowdingTable';
import { answerRows, outcomeLines, stageAnswer, stagingSummary, type Staging } from './crowdingStaging';

/** What the last Apply did, by name, and why the rest did not go where some did not. */
export interface CrowdingOutcome {
  lines: string[];
  error?: string;
}

/** What an Apply did, said by name, and what did not go and why; closed with its cross. */
export function CrowdingReport({ outcome, onClose, sx }: {
  outcome: CrowdingOutcome;
  onClose: () => void;
  sx?: SxProps<Theme>;
}) {
  return (
    <Alert severity={outcome.error ? 'warning' : 'success'} onClose={onClose} sx={sx}>
      {outcome.lines.map(line => <Box key={line}>{line}</Box>)}
      {outcome.error && (
        <Box>{outcome.lines.length > 0 ? 'The rest were not applied' : 'The answers were not applied'}: {outcome.error}</Box>
      )}
    </Alert>
  );
}

/** The window's parts, which its frame lays out. */
export interface CrowdingWindowParts {
  /** The title, the rule's sentence, the type switch and the step through a group's arrivals. */
  heading: ReactNode;
  /** The map and the list, or what stands in for them while they are read. */
  body: ReactNode;
  /** What the last Apply did, by name; null before one. */
  outcome: ReactNode;
  /** The staged answers' summary, Reset and Apply. */
  actions: ReactNode;
  /** True while an Apply runs: the frame lets nobody leave until the report is in. */
  applying: boolean;
}

/** The answers a request carried, by membership. */
function sentAnswers(rows: readonly CrowdingAnswerRow[]): ReadonlyMap<number, CrowdingAnswer> {
  return new Map(rows.map(row => [row.membershipId, row.answer]));
}

export function CrowdingWindow({
  memberships, groupName, titleId, staging, onStaging, onApplied, outcome: heldOutcome, onOutcome, onApplying, layout, frame,
}: {
  /** The places the window stands on in turn: one from a card, a group's arrivals best known first from the list. */
  memberships: readonly number[];
  /** The group's name, where the window steps through one: "Berlin · squares". */
  groupName?: string;
  /** The title's id, which the frame labels itself with. */
  titleId: string;
  /** The answers staged, the frame's to keep. */
  staging: Staging;
  onStaging: Dispatch<SetStateAction<Staging>>;
  /** After an Apply: what it did, by name, for the frame to pass on to the lists and the queue it changed. */
  onApplied: (lines: string[]) => void;
  /**
   * The last Apply's report, where the frame keeps it: a page pane that may be
   * left for another group mid-Apply, or whose group an Apply empties, holds it
   * by group. Left out, the window keeps its own.
   */
  outcome?: CrowdingOutcome | null;
  onOutcome?: (outcome: CrowdingOutcome | null) => void;
  /** Told when an Apply starts and ends, for a frame that holds the way out while one runs. */
  onApplying?: (applying: boolean) => void;
  /** A dialog sets the map beside the list from a medium width; a page pane, narrower, only on the widest. */
  layout: 'dialog' | 'page';
  frame: (parts: CrowdingWindowParts) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // The row a click asked the map to show, counted so a second click on the same row shows it again.
  const [shown, setShown] = useState<{ id: number; n: number } | null>(null);
  const show = (id: number) => setShown(current => ({ id, n: (current?.n ?? 0) + 1 }));
  const [ownOutcome, setOwnOutcome] = useState<CrowdingOutcome | null>(null);
  const outcome = onOutcome ? heldOutcome ?? null : ownOutcome;
  const setOutcome = onOutcome ?? setOwnOutcome;
  // Within the group as it is now: an Apply that publishes an arrival takes it out of its group's list.
  const at = Math.min(step, memberships.length - 1);
  const membershipId = memberships[at];

  const read = useQuery({
    queryKey: queryKeys.curation.crowdingWindow(membershipId, type),
    queryFn: () => fetchCrowdingWindow(membershipId, type),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const around = read.data;

  // The rows sent are the staging as it stood at the press: an answer staged while the
  // pages go is not among them, and stays staged when they settle.
  const apply = useMutation({
    mutationFn: (rows: CrowdingAnswerRow[]) => answerCrowding(rows),
    onSuccess: (result, rows) => settle(outcomeLines(result), undefined, sentAnswers(rows)),
    onError: (error: unknown, rows) => {
      if (error instanceof CrowdingPartlyApplied) {
        // Only the answers a page settled leave the staging; the ones never sent stay staged to send again.
        const settled = new Set([...error.applied.answered, ...error.applied.refused].map(entry => entry.membershipId));
        settle(outcomeLines(error.applied), error.message, sentAnswers(rows.filter(row => settled.has(row.membershipId))));
      }
      else setOutcome({ lines: [], error: error instanceof Error ? error.message : 'The answers could not be applied' });
    },
  });

  useEffect(() => { onApplying?.(apply.isPending); }, [apply.isPending, onApplying]);
  // A window left while its Apply runs (Back to another group) does not hold the frame's way out.
  useEffect(() => () => onApplying?.(false), [onApplying]);

  /**
   * After an Apply: the report, the settled answers out of the staging, and
   * the city read again — every window, since a pin recounts its neighbours.
   * The lists and the queue the answers changed are the frame's to refresh,
   * from what `onApplied` hands it.
   */
  function settle(lines: string[], error: string | undefined, settled: ReadonlyMap<number, CrowdingAnswer>) {
    setOutcome({ lines, error });
    onApplied(lines);
    // An answer changed while the pages went is a new one, and stays staged.
    onStaging(current => new Map([...current].filter(([id, staged]) => settled.get(id) !== staged.answer)));
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.crowdingWindowAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.shadowedArrivals });
  }

  const onAnswer = (row: CrowdingWindowRow, answer: CrowdingAnswer) => onStaging(current => stageAnswer(current, row, answer));
  const stepBy = (by: number) => { setStep(at + by); setType(null); setHovered(null); };
  const pick = (id: number) => document.getElementById(rowDomId(id))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const summary = around ? stagingSummary(around.rows, staging) : null;
  const typeWords = around ? typePluralWord(around.kind.id, around.kind.name, around.type) : '';
  const beside = layout === 'dialog' ? 'md' : 'xl';

  const heading = (
    <>
      <Typography variant="h6" component="h2" id={titleId}>
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
          <Button size="small" disabled={at === 0} onClick={() => stepBy(-1)}>Previous</Button>
          <Button size="small" disabled={at === memberships.length - 1} onClick={() => stepBy(1)}>Next</Button>
        </Stack>
      )}
    </>
  );

  const body = (
    <>
      {read.isError && (
        <Alert severity="error" sx={{ m: 2 }}>
          Could not read the places around{read.error instanceof Error ? `: ${read.error.message}` : '.'}
        </Alert>
      )}
      {!around && read.isLoading && <LoadingSpinner padding={4} />}
      {around && (
        <Stack direction={{ xs: 'column', [beside]: 'row' }} sx={{ opacity: read.isPlaceholderData ? 0.6 : 1 }}>
          <Box
            sx={{
              width: { xs: '100%', [beside]: 440 }, flexShrink: 0, p: 2,
              borderRight: { [beside]: 1 }, borderColor: { [beside]: 'divider' },
            }}
          >
            <CrowdingMap around={around} staging={staging} hovered={hovered} shown={shown} onHover={setHovered} onPick={pick} />
            <Box sx={{ mt: 1 }}><StandingLegend /></Box>
          </Box>
          {/* In a dialog the list scrolls beside the map; in the page it runs on with the page. */}
          <Box sx={{ flexGrow: 1, minWidth: 0, overflow: 'auto', maxHeight: layout === 'dialog' ? { md: '65vh' } : undefined }}>
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
                  // The previous place's or type's rows while the next read loads: a click
                  // there would stage an answer about a row the curator is leaving.
                  frozen={read.isPlaceholderData}
                  hovered={hovered}
                  onHover={setHovered}
                  onShow={show}
                  onAnswer={onAnswer}
                />
              )}
          </Box>
        </Stack>
      )}
    </>
  );

  const report = outcome && <CrowdingReport outcome={outcome} onClose={() => setOutcome(null)} sx={{ mx: 2, mt: 1 }} />;

  const actions = (
    <>
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
      <Button disabled={staging.size === 0 || apply.isPending} onClick={() => onStaging(new Map())}>Reset</Button>
      <Button variant="contained" disabled={staging.size === 0 || apply.isPending} onClick={() => apply.mutate(answerRows(staging))}>
        {staging.size === 0 ? 'Apply' : `Apply ${plural(staging.size, 'answer')}`}
      </Button>
    </>
  );

  return frame({ heading, body, outcome: report, actions, applying: apply.isPending });
}
