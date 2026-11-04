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
import { Alert, Box, Button, Chip, Stack, Typography, useTheme, type SxProps, type Theme } from '@mui/material';
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

/** Where the map stands beside the list: a dialog from a medium width; a page pane, narrower, only on the widest. */
function besideFrom(layout: 'dialog' | 'page'): 'md' | 'xl' {
  return layout === 'dialog' ? 'md' : 'xl';
}

/** The room a page pane leaves under the map and the list for the Apply bar pinned to the screen's foot. */
const APPLY_BAR_ROOM = 140;

/**
 * What the laptop's held layout reckons a row of the list at, in pixels: a
 * place's name, its chips, the line saying it counts above the window's
 * place, its article and its picture's credit, stacked in a small cell.
 */
const ROW_ROOM = 100;

/** The list's header row. */
const HEADER_ROOM = 37;

/**
 * The map's pane held over the list on a laptop, less the map: its padding,
 * the line under the map about the dashed circle, two lines where the pane is
 * narrow, and the legend.
 */
const HELD_PANE_OVERHEAD = 12 + 4 + 40 + 8 + 20 + 12;

/** The held map's height: as tall as the screen leaves room for, between the two. */
const HELD_MAP_MIN = 160;
const HELD_MAP_MAX = 280;

/** Three rows under the list's header: what the held layout always leaves the list. */
const THREE_ROWS_ROOM = HEADER_ROOM + 3 * ROW_ROOM;

/**
 * What the held map's height is taken from the screen's: the Apply bar's
 * room, the pane around the map and three rows under the header, 573 px. The
 * map is the screen less that, so the list keeps its three rows until the map
 * is down to its least.
 */
const HELD_MAP_LESS = APPLY_BAR_ROOM + HELD_PANE_OVERHEAD + THREE_ROWS_ROOM;

/**
 * The screen's height from which a laptop holds the map over the list: the
 * least map with the pane around it, three rows under the header and the
 * Apply bar's room, 733 px, rounded up. A 1440 by 900 laptop shows about 780
 * inside the browser; a 1366 by 768 one, and a laptop at 200 % zoom (450 px),
 * would leave the list too little room, and fall back.
 */
export const HELD_MIN_HEIGHT = Math.ceil((HELD_MAP_MIN + HELD_MAP_LESS) / 10) * 10;

/** The fewest pixels the held list keeps, whatever the pane turns out to take: its header and one row. */
const LIST_GUARD = HEADER_ROOM + ROW_ROOM;

/**
 * How the window lays out its map and its list, so the map stays in view
 * while the list scrolls (#2345): a curator reading down Rome's churches
 * keeps the row's dot in sight.
 *
 * - Beside the list (a dialog from a medium width, a page pane on the widest
 *   screens), the map's pane is sticky within the column beside the list,
 *   which the row stretches to the list's height. In the page the review
 *   screen scrolls as a whole and its header scrolls away with it, so the
 *   pane holds just below the screen's top, as the list of cities beside it
 *   does; in a dialog it holds at the top of the dialog's content, which
 *   scrolls on a short screen.
 * - A page pane between a medium width and the widest, a laptop's, on a
 *   screen at least `HELD_MIN_HEIGHT` tall, stacks a lower map over the list,
 *   as tall as the screen leaves room for,
 *   and the two together stand no taller than the screen above the Apply bar:
 *   the list scrolls in its own box beneath the map, so its header row stays
 *   at the top of the list and no row passes under the map. Neither the map's
 *   height nor the cap ever leaves the list fewer than three rows, and the
 *   list keeps its header and a row whatever the pane takes.
 * - On a shorter laptop screen, and on a phone, the map stands over the list
 *   and scrolls with the rest: held there, it would leave the list no room.
 */
export function crowdingLayout(layout: 'dialog' | 'page', theme: Theme): {
  body: SxProps<Theme>;
  mapPane: SxProps<Theme>;
  mapFrame: SxProps<Theme>;
  list: SxProps<Theme>;
} {
  const scrolls = { flexGrow: 1, minWidth: 0, minHeight: 0, overflow: 'auto' };
  if (layout === 'dialog') {
    return {
      body: {},
      mapPane: { p: 2, position: { md: 'sticky' }, top: { md: 0 } },
      mapFrame: { height: 420 },
      list: { ...scrolls, maxHeight: { md: '65vh' } },
    };
  }
  const held = `${theme.breakpoints.between('md', 'xl')} and (min-height:${HELD_MIN_HEIGHT}px)`;
  return {
    body: { [held]: { maxHeight: `max(calc(100vh - ${APPLY_BAR_ROOM}px), ${HELD_PANE_OVERHEAD + HELD_MAP_MIN + THREE_ROWS_ROOM}px)` } },
    mapPane: { p: 2, position: { xl: 'sticky' }, top: { xl: 16 }, [held]: { p: 1.5 } },
    mapFrame: { height: 420, [held]: { height: `clamp(${HELD_MAP_MIN}px, calc(100vh - ${HELD_MAP_LESS}px), ${HELD_MAP_MAX}px)` } },
    list: { ...scrolls, [held]: { minHeight: LIST_GUARD } },
  };
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
  const theme = useTheme();
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
  const beside = besideFrom(layout);
  const placed = crowdingLayout(layout, theme);

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
        <Stack direction={{ xs: 'column', [beside]: 'row' }} sx={{ ...placed.body, opacity: read.isPlaceholderData ? 0.6 : 1 }}>
          <Box
            sx={{
              width: { xs: '100%', [beside]: 440 }, flexShrink: 0,
              borderRight: { [beside]: 1 }, borderColor: { [beside]: 'divider' },
            }}
          >
            <Box data-testid="crowding-map-pane" sx={placed.mapPane}>
              <CrowdingMap
                around={around} staging={staging} hovered={hovered} shown={shown} frame={placed.mapFrame}
                onHover={setHovered} onPick={pick}
              />
              <Box sx={{ mt: 1 }}><StandingLegend /></Box>
            </Box>
          </Box>
          {/* In a dialog the list scrolls beside the map; in a page pane under it on a laptop, and on with the page on the widest. */}
          <Box sx={placed.list}>
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
