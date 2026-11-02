/**
 * The review page's *Crowded cities* tab (ADR-0180, #2282): the new arrivals
 * a crowded city would shadow, one line per region, kind and type on the left
 * — "Berlin · squares" — and the city's window on the right, open on the
 * group's best-known arrival with Previous and Next through the rest.
 *
 * Whether such an arrival belongs in the list is a question about its
 * neighbours, so it is asked a city and a type at a time, in the window a
 * review card opens over itself (`CrowdingWindow`), drawn here in the page.
 * The open group is the address's (`crowd`, `utils/appUrl.ts`), and the first
 * one the filters keep when it names none, so the right side is never empty.
 * The Region and Kind filters are this tab's alone and not in the address: a
 * group is a link, a narrowing of a list this short is not.
 *
 * The staged answers are kept by group and by the page, so a window's Apply
 * sends its own city's only, and a city left, by a line or by Back, keeps its
 * answers for the curator's return. Its line says how many wait there, and the
 * Apply bar of the city on screen names every other city holding some, with a
 * way to it. On a narrow screen one side shows at a time, the window with a way
 * back to the list.
 *
 * Its own chunk, which the review page loads when the tab is opened.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Alert, Box, Button, Divider, List, ListItem, Paper, Stack, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { ShadowedArrivalsGroup } from '../../../api/crowding';
import { crowdKeyOf } from '../../../utils/appUrl';
import { plural } from '../../../utils/plural';
import { LoadingSpinner } from '../../shared/LoadingSpinner';
import { FilterChip } from '../feed/FilterChip';
import { QueueLine } from '../feed/QueueLine';
import { KIND_COLOR } from '../feed/rowSpecific';
import { CrowdingReport, CrowdingWindow, type CrowdingOutcome } from './CrowdingWindow';
import type { Staging } from './crowdingStaging';
import {
  arrivalsIn, filterGroups, groupName, groupShown, kindOptions, NO_CROWD_FILTERS, regionOptions, stagedElsewhere,
  stagingIn, withStaging, type CrowdFilters, type GroupStagings, type StagedElsewhere,
} from './crowdedGroups';
import { useShadowedArrivals } from './useShadowedArrivals';

/** A group's last report, and whether it came from a group the list no longer holds. */
interface HeldReport {
  /** When it was made, counted up per Apply on the tab: the newer of two reports wins a group. */
  at: number;
  outcome: CrowdingOutcome;
  moved: boolean;
}

/** The newest report held by a group the list no longer holds, or none. */
function newestGone(reports: ReadonlyMap<string, HeldReport>, listed: ReadonlySet<string>): HeldReport | undefined {
  return [...reports]
    .filter(([key]) => !listed.has(key))
    .map(([, held]) => held)
    .reduce<HeldReport | undefined>((newest, held) => (!newest || held.at > newest.at ? held : newest), undefined);
}

/** The stripe of a group's line: an arrival's, since every one of them is one. */
const GROUP_COLOR = KIND_COLOR.arrival;

function GroupLine({ group, staged, selected, disabled, onClick }: {
  group: ShadowedArrivalsGroup;
  /** How many answers are staged in it, not yet applied. */
  staged: number;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <ListItem disablePadding>
      <QueueLine
        title={groupName(group)}
        aside={staged > 0 ? `${staged} staged` : undefined}
        color={GROUP_COLOR}
        selected={selected}
        disabled={disabled}
        onClick={onClick}
        detail={(
          <>
            {group.kindName}
            {' · '}
            <Box component="span" sx={{ fontWeight: 700, color: GROUP_COLOR }}>{plural(group.arrivals, 'new place')}</Box>
            {' a crowded city would shadow'}
          </>
        )}
      />
    </ListItem>
  );
}

/** The other cities with answers staged, said over the Apply bar, each with the way to it. */
function StagedElsewhereLine({ entries, disabled, onOpen, onDiscard }: {
  entries: readonly StagedElsewhere[];
  disabled: boolean;
  onOpen: (entry: StagedElsewhere) => void;
  onDiscard: (key: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <Box sx={{ width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Not applied elsewhere:</Typography>
      {entries.map(entry => (
        <Box key={entry.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2">
            {`${plural(entry.count, 'answer')} staged in ${entry.group ? groupName(entry.group) : 'a city no longer listed'}`}
          </Typography>
          {entry.group
            ? <Button size="small" disabled={disabled} onClick={() => onOpen(entry)}>Open</Button>
            : <Button size="small" color="inherit" disabled={disabled} onClick={() => onDiscard(entry.key)}>Discard</Button>}
        </Box>
      ))}
    </Box>
  );
}

export function CrowdedCities({ selected, onSelect, stagings, onStagings, onApplied }: {
  /** The group the address names (`crowd`), or null. */
  selected: string | null;
  /** A group opened: pushed when the curator picked it, replaced when the page did. */
  onSelect: (key: string, opts?: { replace?: boolean }) => void;
  /** The answers staged, by group: the page's to keep across the tabs. */
  stagings: GroupStagings;
  onStagings: Dispatch<SetStateAction<GroupStagings>>;
  /** After an Apply: the queue and the lists to read again. */
  onApplied: () => void;
}) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  const read = useShadowedArrivals();
  const [filters, setFilters] = useState<CrowdFilters>(NO_CROWD_FILTERS);
  // On a narrow screen: whether the window is the side shown, rather than the list.
  const [onWindow, setOnWindow] = useState(false);
  // While an Apply runs no other city opens: the Apply's report and staging belong to the city it was pressed in.
  const [applying, setApplying] = useState(false);
  // The last Apply's report, by group, each held by one group: an Apply that answers a
  // group's every arrival takes the group out of the list, and its report then moves to the
  // group the tab lands on, there alone, until another group's Apply reports. Where no group
  // is left to land on, it is said over the empty list.
  const [reports, setReports] = useState<ReadonlyMap<string, HeldReport>>(new Map());
  const reportCount = useRef(0);

  const groups = read.data?.groups ?? [];
  const visible = filterGroups(groups, filters);
  const shown = groupShown(visible, selected);
  const shownKey = shown ? crowdKeyOf(shown) : null;

  // The address follows the group shown — the first one the filters keep, when it names
  // none or one the list no longer holds — as a replace: the page moved, the curator did not.
  useEffect(() => {
    if (shownKey !== null && shownKey !== selected) onSelect(shownKey, { replace: true });
  }, [shownKey, selected, onSelect]);

  /** The window's staging: the group on screen's own. */
  const onStaging = useCallback((next: SetStateAction<Staging>) => {
    if (shownKey === null) return;
    onStagings(all => withStaging(all, shownKey, typeof next === 'function' ? next(stagingIn(all, shownKey)) : next));
  }, [shownKey, onStagings]);

  // A report whose group left the list is handed to the group shown, replacing that group's
  // own where it is the newer of the two; either way it leaves the group that is gone, so no
  // later group shows it.
  const listed = groups.map(crowdKeyOf).join('\n');
  useEffect(() => {
    if (!read.isSuccess || shownKey === null) return;
    const keys = new Set(listed.split('\n'));
    setReports(all => {
      const newest = newestGone(all, keys);
      if (!newest) return all;
      const kept = new Map([...all].filter(([key]) => keys.has(key)));
      const own = kept.get(shownKey);
      if (!own || own.at < newest.at) kept.set(shownKey, { ...newest, moved: true });
      return kept;
    });
  }, [listed, shownKey, read.isSuccess]);
  const onOutcome = useCallback((next: CrowdingOutcome | null) => {
    if (shownKey === null) return;
    reportCount.current += 1;
    const at = reportCount.current;
    setReports(all => {
      const kept = new Map(all);
      if (next) {
        // A report moved here from a group that is gone has been read once a new one comes.
        [...kept].forEach(([key, held]) => { if (held.moved) kept.delete(key); });
        kept.set(shownKey, { outcome: next, moved: false, at });
      } else kept.delete(shownKey);
      return kept;
    });
  }, [shownKey]);
  // The last group answered out of the list leaves no window to say what its Apply did.
  const listedKeys = new Set(listed.split('\n'));
  const loose = read.isSuccess && shownKey === null ? newestGone(reports, listedKeys) : undefined;

  const open = (group: ShadowedArrivalsGroup) => {
    const key = crowdKeyOf(group);
    if (key !== shownKey) onSelect(key);
    setOnWindow(true);
  };
  /** Another city with answers staged, opened from the Apply bar: out from under the chips where they hide it. */
  const openStaged = (entry: StagedElsewhere) => {
    if (entry.group && !visible.includes(entry.group)) setFilters(NO_CROWD_FILTERS);
    onSelect(entry.key);
    setOnWindow(true);
  };
  const elsewhere = stagedElsewhere(stagings, groups, shownKey);

  const regions = regionOptions(groups, filters);
  const kinds = kindOptions(groups, filters);
  const filtered = filters.region !== null || filters.kinds.length > 0;
  const showList = !narrow || !onWindow;
  const showWindow = shown !== undefined && (!narrow || onWindow);

  return (
    <Box>
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 760 }}>
          New places the rule would shadow once published, which the questions leave out. Each is sorted among the
          places of its type around it, a city and a type at a time.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <FilterChip
            label="Region"
            value={regions.find(option => option.checked)?.label ?? ''}
            active={filters.region !== null}
            options={regions}
            pending={read.isLoading}
            single
            onToggle={key => setFilters({ ...filters, region: filters.region === key ? null : key })}
          />
          <FilterChip
            label="Kind"
            value={kinds.filter(option => option.checked).map(option => option.label).join(', ')}
            active={filters.kinds.length > 0}
            options={kinds}
            pending={read.isLoading}
            onToggle={key => setFilters({
              ...filters,
              kinds: filters.kinds.includes(key) ? filters.kinds.filter(k => k !== key) : [...filters.kinds, key],
            })}
          />
          {filtered && (
            <Button size="small" color="inherit" onClick={() => setFilters(NO_CROWD_FILTERS)} sx={{ textTransform: 'none' }}>
              Clear all
            </Button>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {`${arrivalsIn(visible).toLocaleString('en')} new`}
          </Typography>
        </Box>
      </Box>

      {read.isLoading && <LoadingSpinner padding={4} />}
      {read.isError && (
        <Alert severity="error">
          Could not read the crowded cities{read.error instanceof Error ? `: ${read.error.message}` : '.'}
        </Alert>
      )}
      {loose && (
        <CrowdingReport
          outcome={loose.outcome}
          onClose={() => setReports(all => new Map([...all].filter(([key]) => listedKeys.has(key))))}
          sx={{ mb: 2 }}
        />
      )}
      {read.isSuccess && visible.length === 0 && (
        <Alert severity="success">
          {filtered
            ? 'No crowded city matches. Clear a filter.'
            : 'Nothing waiting. No new place would arrive in a crowded city’s shadow.'}
        </Alert>
      )}

      {visible.length > 0 && (
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems="flex-start">
          {showList && (
            <Box
              sx={{
                width: { xs: '100%', md: 400 },
                flexShrink: 0,
                maxHeight: { md: 'calc(100vh - 220px)' },
                overflowY: 'auto',
                position: { md: 'sticky' },
                top: { md: 16 },
                borderRight: { md: 1 },
                borderColor: { md: 'divider' },
              }}
            >
              <Box sx={{
                display: 'flex', alignItems: 'center', px: 2, height: 40,
                borderBottom: 1, borderColor: 'divider',
                position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 2,
              }}
              >
                <Typography variant="caption" color="text.secondary">
                  {`${plural(visible.length, 'group')} by city and type`}
                </Typography>
              </Box>
              <List dense disablePadding aria-label="Crowded cities">
                {visible.map(group => (
                  <GroupLine
                    key={crowdKeyOf(group)}
                    group={group}
                    staged={stagingIn(stagings, crowdKeyOf(group)).size}
                    // On a narrow screen the list stands alone, so no line reads as open.
                    selected={!narrow && crowdKeyOf(group) === shownKey}
                    disabled={applying}
                    onClick={() => open(group)}
                  />
                ))}
              </List>
            </Box>
          )}
          {showWindow && (
            <Box sx={{ flexGrow: 1, minWidth: 0, width: { xs: '100%', md: 'auto' }, pl: { md: 2 } }}>
              {narrow && (
                <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => setOnWindow(false)} sx={{ mb: 1 }}>
                  All crowded cities
                </Button>
              )}
              <CrowdingWindow
                // A group is its own window: its step through the arrivals and its type start afresh.
                key={shownKey}
                memberships={shown.membershipIds}
                groupName={groupName(shown)}
                titleId="crowded-city-title"
                staging={stagingIn(stagings, shownKey ?? '')}
                onStaging={onStaging}
                onApplied={onApplied}
                outcome={shownKey === null ? null : reports.get(shownKey)?.outcome ?? null}
                onOutcome={onOutcome}
                onApplying={setApplying}
                layout="page"
                frame={({ heading, body, outcome, actions }) => (
                  <Paper variant="outlined" component="section" aria-labelledby="crowded-city-title">
                    <Box sx={{ p: 2 }}>{heading}</Box>
                    <Divider />
                    {body}
                    {outcome}
                    {/* Pinned to the foot of the screen, so Apply is in reach down a long list; not
                        on a phone, where the bar would cover a quarter of the window. */}
                    <Box sx={{
                      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, px: 2, py: 1.5,
                      borderTop: 1, borderColor: 'divider', position: { md: 'sticky' }, bottom: 0, zIndex: 1,
                      bgcolor: 'background.paper', borderRadius: '0 0 4px 4px',
                    }}
                    >
                      <StagedElsewhereLine
                        entries={elsewhere}
                        disabled={applying}
                        onOpen={openStaged}
                        onDiscard={key => onStagings(all => withStaging(all, key, new Map()))}
                      />
                      {actions}
                    </Box>
                  </Paper>
                )}
              />
            </Box>
          )}
        </Stack>
      )}

    </Box>
  );
}
