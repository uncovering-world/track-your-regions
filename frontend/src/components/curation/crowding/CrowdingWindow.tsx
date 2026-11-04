/**
 * The window a curator sorts a crowded city in (ADR-0180, #2282, #2358): one
 * region's places of one kind and type as its page shows them — Lazio · Places
 * of worship · church — on a map and in a list, each given the answers its
 * standing takes, and all of them applied together.
 *
 * What a curator decides is what the region's page shows, and an answer is a
 * pin on the place itself that holds wherever the place is seen, so the window
 * is the region's list rather than the circle around one arrival: those on
 * the page best known first, then the shadowed tail, the new arrivals where
 * the rule would put them. A click on a place opens it in its own circle: the
 * map zooms to the kind's radius around it, the better-known places it is
 * compared with marked, its card with the rule's reading and its own answers,
 * and a way back to the region. Answers are staged across the region and its
 * places' circles and go with one Apply; the window then reads the city again
 * and says what each answer did, by name.
 *
 * One window, two frames: `CrowdingWindowDialog` draws it over a review card
 * or a place's curation dialog, open on the card's place, and the review
 * page's *Crowded cities* tab draws it in the page beside its list of groups.
 * The frame lays the parts out, owns the staging and says which place is open,
 * so a tab that unmounts the window keeps the answers and the address keeps
 * the place; this component reads, stages, applies and reports.
 */

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Alert, Box, Button, Link, Stack, Typography, useTheme, type SxProps, type Theme } from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrowdingAnswer, CrowdingAnswerRow, CrowdingGroup, CrowdingPlaceView } from '../../../api/crowding';
import { answerCrowding, CrowdingPartlyApplied, fetchCrowdingGroup, fetchCrowdingPlace } from '../../../api/crowdingAnswers';
import { queryKeys } from '../../../api/queryKeys';
import { crowdKeyOf, type CrowdGroupRef } from '../../../utils/appUrl';
import { plural } from '../../../utils/plural';
import { LoadingSpinner } from '../../shared/LoadingSpinner';
import { CrowdingLegend, CrowdingMap } from './CrowdingMap';
import {
  answerRows, applySummary, outcomeLines, stageAnswer, type Answerable, type Staging,
} from './crowdingStaging';
import { PlaceView } from './PlaceView';
import { RegionList } from './RegionList';
import { countsLine, groupTitle, nounOf, type RuleWords } from './rowWords';

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
  /** The way back to the region from a place, the title and the rule's sentence. */
  heading: ReactNode;
  /** The map and the list or the place's card, or what stands in for them while they are read. */
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
 * place's name, its note, its article and its picture's credit, stacked
 * beside its answers, which wrap on a narrow pane.
 */
const ROW_ROOM = 100;

/** The list's header row. */
const HEADER_ROOM = 37;

/**
 * The map's pane held over the list on a laptop, less the map: its padding
 * and the legend, two lines where the pane is narrow.
 */
const HELD_PANE_OVERHEAD = 12 + 8 + 40 + 12 + 24;

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
 * keeps the place's dot in sight.
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

/** The window's heading: the way back to the region from a place, the group's title and the rule's sentence. */
function WindowHeading({ title, titleId, read, rule, onBack }: {
  title: string;
  titleId: string;
  read: CrowdingGroup | undefined;
  rule: RuleWords | null;
  /** Back to the region's list, from a place's circle; null on the list. */
  onBack: (() => void) | null;
}) {
  return (
    <>
      {onBack && (
        <Link component="button" variant="body2" onClick={onBack} sx={{ display: 'block', mb: 0.5 }}>
          {`← ${title}, the whole region`}
        </Link>
      )}
      <Typography variant="h6" component="h2" id={titleId}>{title}</Typography>
      {read && rule && (
        <Typography variant="body2" color="text.secondary">
          {countsLine(read.places)}. As the region page shows it: a place is shadowed when {rule.limit} better-known
          {' '}{nounOf(rule, 2)} stand within {rule.radiusKm} km of it, unless a curator keeps it on the page.
          {read.typeExempt && ` ${read.kind.name} never hides a place of this type, so none of these takes a pin.`}
          {read.truncated && ` Only the ${read.places.length} best known are listed.`}
        </Typography>
      )}
    </>
  );
}

/** The rule the group's kind declares, as the words need it. */
function ruleOf(read: CrowdingGroup): RuleWords {
  return { kindId: read.kind.id, kindName: read.kind.name, type: read.group.type, limit: read.kind.limit, radiusKm: read.kind.radiusKm };
}

/** The map and, beside it, the region's list or the open place's card; or what stands in for them while they are read. */
function WindowBody({ layout, read, circle, placeLoading, failed, inRegion, staging, hovered, onHover, onOpen, onAnswer }: {
  layout: 'dialog' | 'page';
  read: CrowdingGroup | undefined;
  /** The open place's circle; undefined on the region's list, or while it is first read. */
  circle: CrowdingPlaceView | undefined;
  /** The previous place's circle is shown while the next one loads. */
  placeLoading: boolean;
  failed: unknown;
  inRegion: boolean;
  staging: Staging;
  hovered: number | null;
  onHover: (membershipId: number | null) => void;
  onOpen: (membershipId: number | null) => void;
  onAnswer: (place: Answerable, answer: CrowdingAnswer) => void;
}) {
  const theme = useTheme();
  const beside = besideFrom(layout);
  const placed = crowdingLayout(layout, theme);
  if (failed) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Could not read {inRegion ? 'the region’s places' : 'the place'}{failed instanceof Error ? `: ${failed.message}` : '.'}
      </Alert>
    );
  }
  const rule = read ? ruleOf(read) : null;
  const shown = inRegion ? read : circle;
  if (!read || !rule || !shown) return <LoadingSpinner padding={4} />;
  // The previous place's card while the next one loads: a press there would answer the place being left.
  const frozen = !inRegion && placeLoading;
  const map = circle && !inRegion
    ? { kind: 'place' as const, view: circle }
    : { kind: 'region' as const, places: read.places, rule, typeExempt: read.typeExempt };
  return (
    <Stack direction={{ xs: 'column', [beside]: 'row' }} sx={placed.body}>
      <Box
        sx={{
          width: { xs: '100%', [beside]: 440 }, flexShrink: 0,
          borderRight: { [beside]: 1 }, borderColor: { [beside]: 'divider' },
        }}
      >
        <Box data-testid="crowding-map-pane" sx={placed.mapPane}>
          <CrowdingMap view={map} staging={staging} hovered={hovered} frame={placed.mapFrame} onHover={onHover} onOpen={onOpen} />
          <Box sx={{ mt: 1 }}><CrowdingLegend view={map.kind} /></Box>
        </Box>
      </Box>
      {/* In a dialog the list scrolls beside the map; in a page pane under it on a laptop, and on with the page on the widest. */}
      <Box sx={placed.list}>
        {map.kind === 'region' ? (
          <RegionList
            places={read.places} rule={rule} typeExempt={read.typeExempt} staging={staging}
            hovered={hovered} onHover={onHover} onOpen={onOpen} onAnswer={onAnswer}
          />
        ) : (
          <Box sx={{ opacity: placeLoading ? 0.6 : 1 }}>
            <PlaceView
              view={map.view} rule={rule} staging={staging} frozen={frozen}
              hovered={hovered} onHover={onHover} onOpen={onOpen}
              onAnswer={answer => onAnswer(map.view.place, answer)}
            />
          </Box>
        )}
      </Box>
    </Stack>
  );
}

/** The staged answers' summary, Reset and Apply. */
function ApplyBar({ summary, limit, staged, applying, onReset, onApply }: {
  /** What the staged answers do and what the region page will show; null with none staged. */
  summary: string | null;
  limit: number;
  staged: number;
  applying: boolean;
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <>
      <Box sx={{ flexGrow: 1, minWidth: 240 }}>
        <Typography variant="body2">{summary ?? 'Answers are staged across the region and applied together.'}</Typography>
        <Typography variant="caption" color="text.secondary">
          Each answer is about its place alone, wherever it is seen. Show anyway keeps a place on the region page, one of
          the {limit}; Shadow keeps it in the tail; Don’t take refuses it. Answering a new place publishes it.
        </Typography>
      </Box>
      <Button disabled={staged === 0 || applying} onClick={onReset}>Reset</Button>
      <Button variant="contained" disabled={staged === 0 || applying} onClick={onApply}>
        {staged === 0 ? 'Apply' : `Apply ${plural(staged, 'answer')}`}
      </Button>
    </>
  );
}

export function CrowdingWindow({
  group, selected, onSelect, titleId, staging, onStaging, onApplied, outcome: heldOutcome, onOutcome, onApplying, layout, frame,
}: {
  /** The group the window lists: a region, a kind and a type. */
  group: CrowdGroupRef;
  /** The place open in its own circle, by membership; null for the region's list. */
  selected: number | null;
  /** A place opened, or the region's list returned to. */
  onSelect: (membershipId: number | null) => void;
  /** The title's id, which the frame labels itself with. */
  titleId: string;
  /** The answers staged, the frame's to keep. */
  staging: Staging;
  onStaging: Dispatch<SetStateAction<Staging>>;
  /** After an Apply: what it did, by name, for the frame to pass on to the lists and the queue it changed. */
  onApplied: (lines: string[]) => void;
  /** The last Apply's report, where the frame keeps it, by group; left out, the window keeps its own. */
  outcome?: CrowdingOutcome | null;
  onOutcome?: (outcome: CrowdingOutcome | null) => void;
  /** Told when an Apply starts and ends, for a frame that holds the way out while one runs. */
  onApplying?: (applying: boolean) => void;
  /** A dialog sets the map beside the list from a medium width; a page pane, narrower, only on the widest. */
  layout: 'dialog' | 'page';
  frame: (parts: CrowdingWindowParts) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState<number | null>(null);
  const [ownOutcome, setOwnOutcome] = useState<CrowdingOutcome | null>(null);
  const outcome = onOutcome ? heldOutcome ?? null : ownOutcome;
  const setOutcome = onOutcome ?? setOwnOutcome;

  const groupRead = useQuery({
    queryKey: queryKeys.curation.crowdingGroup(crowdKeyOf(group)),
    queryFn: () => fetchCrowdingGroup(group),
    retry: false,
  });
  const placeRead = useQuery({
    queryKey: queryKeys.curation.crowdingPlace(selected ?? 0),
    queryFn: () => fetchCrowdingPlace(selected ?? 0),
    enabled: selected !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const read = groupRead.data;
  const circle = selected === null ? undefined : placeRead.data;

  // The rows sent are the staging as it stood at the press: an answer staged while the
  // pages go is not among them, and stays staged when they settle.
  const apply = useMutation({
    mutationFn: (rows: CrowdingAnswerRow[]) => answerCrowding(rows),
    onSuccess: (result, rows) => {
      // A place not taken is in no list any more: its circle gives way to the region's.
      if (result.answered.some(row => row.membershipId === selected && row.refused)) onSelect(null);
      settle(outcomeLines(result), undefined, sentAnswers(rows));
    },
    onError: (error: unknown, rows) => {
      if (error instanceof CrowdingPartlyApplied) {
        // Only the answers a page settled leave the staging; the ones never sent stay staged to send again.
        const settled = new Set([...error.applied.answered, ...error.applied.refused].map(entry => entry.membershipId));
        // The pages that went may have refused the open place: its circle gives way to the region's.
        if (error.applied.answered.some(row => row.membershipId === selected && row.refused)) onSelect(null);
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
   * the city read again — every group and circle, since a pin recounts its
   * neighbours. The lists and the queue the answers changed are the frame's to
   * refresh, from what `onApplied` hands it.
   */
  function settle(lines: string[], error: string | undefined, settled: ReadonlyMap<number, CrowdingAnswer>) {
    setOutcome({ lines, error });
    onApplied(lines);
    // An answer changed while the pages went is a new one, and stays staged.
    onStaging(current => new Map([...current].filter(([id, staged]) => settled.get(id) !== staged.answer)));
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.crowdingWindowAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.shadowedArrivals });
  }

  const onAnswer = (place: Answerable, answer: CrowdingAnswer) => onStaging(current => stageAnswer(current, place, answer));
  const open = (membershipId: number | null) => { setHovered(null); onSelect(membershipId); };

  const rule = read ? ruleOf(read) : null;
  const heading = (
    <WindowHeading
      title={read && rule ? groupTitle(read.group.regionName, rule) : 'A crowded city'}
      titleId={titleId} read={read} rule={rule} onBack={selected === null ? null : () => open(null)}
    />
  );
  const body = (
    <WindowBody
      layout={layout} read={read} circle={circle} placeLoading={placeRead.isPlaceholderData}
      failed={groupRead.error ?? (selected === null ? null : placeRead.error)} inRegion={selected === null}
      staging={staging} hovered={hovered} onHover={setHovered} onOpen={open} onAnswer={onAnswer}
    />
  );
  const report = outcome && <CrowdingReport outcome={outcome} onClose={() => setOutcome(null)} sx={{ mx: 2, mt: 1 }} />;
  const actions = (
    <ApplyBar
      summary={staging.size > 0 && read && rule ? applySummary(staging, read.places, rule) : null}
      limit={rule?.limit ?? 10} staged={staging.size} applying={apply.isPending}
      onReset={() => onStaging(new Map())} onApply={() => apply.mutate(answerRows(staging))}
    />
  );

  return frame({ heading, body, outcome: report, actions, applying: apply.isPending });
}
