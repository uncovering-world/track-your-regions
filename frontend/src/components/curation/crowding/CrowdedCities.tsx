/**
 * The review page's *Crowded cities* tab (ADR-0180, #2282, #2358): the new
 * arrivals a crowded city would shadow, one line per region, kind and type on
 * the left — "Berlin · squares" — and on the right the window over that
 * group's region as its page shows it, every place of the type, a place open
 * in its own circle on a click.
 *
 * Whether such an arrival belongs in the list is a question about its
 * neighbours and about what the region's page shows, so it is asked a region
 * and a type at a time, in the window a review card opens over itself
 * (`CrowdingWindow`), drawn here in the page. The open group and the place
 * open in it are the address's (`crowd` and `place`, `utils/appUrl.ts`); a
 * group the address names opens where the filters keep it or where the list
 * does not hold it at all, and the first one the filters keep opens otherwise,
 * so the right side is never empty. The Region and Kind filters are this tab's alone and not in the
 * address: a group is a link, a narrowing of a list this short is not. The
 * Region chip searches every region as the queue's does (#2349), and a region
 * picked is read by the server, which keeps the groups within it: Berlin
 * holds the groups of its districts.
 *
 * The staged answers are kept by group and by the page, so a window's Apply
 * sends its own group's only, and a group left, by a line or by Back, keeps
 * its answers for the curator's return. Its line says how many wait there,
 * and the Apply bar of the group on screen names every other group holding
 * some, with a way to it. On a narrow screen one side shows at a time, the
 * window with a way back to the list.
 *
 * Its own chunk, which the review page loads when the tab is opened.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
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
import { useRegionChipSearch } from '../feed/useRegionChipSearch';
import { CrowdingWindow, type CrowdingOutcome } from './CrowdingWindow';
import type { Staging } from './crowdingStaging';
import {
  arrivalsIn, everyGroup, filterGroups, groupName, groupShown, kindOptions, NO_CROWD_FILTERS, regionAsked, regionOptions,
  stagedElsewhere, stagingIn, withStaging, type CrowdFilters, type GroupStagings, type StagedElsewhere,
} from './crowdedGroups';
import { useShadowedArrivals } from './useShadowedArrivals';

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

/** The other groups with answers staged, said over the Apply bar, each with the way to it. */
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
            {`${plural(entry.count, 'answer')} staged in ${entry.group ? groupName(entry.group) : 'a group no longer listed'}`}
          </Typography>
          {/* A group the list no longer holds still has its region's list: it opens by its key. */}
          <Button size="small" disabled={disabled} onClick={() => onOpen(entry)}>Open</Button>
          {!entry.group && <Button size="small" color="inherit" disabled={disabled} onClick={() => onDiscard(entry.key)}>Discard</Button>}
        </Box>
      ))}
    </Box>
  );
}

export function CrowdedCities({ selected, selectedPlace, onSelect, onSelectPlace, stagings, onStagings, onApplied }: {
  /** The group the address names (`crowd`), or null. */
  selected: string | null;
  /** The place of that group the address opens in its own circle (`place`), or null. */
  selectedPlace: number | null;
  /** A group opened: pushed when the curator picked it, replaced when the page did. */
  onSelect: (key: string, opts?: { replace?: boolean }) => void;
  /** A place opened in its circle, or the region's list returned to: pushed. */
  onSelectPlace: (membershipId: number | null) => void;
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
  // The groups within the region picked, read by the server (#2349): the whole list's own request where none is.
  const regionRead = useShadowedArrivals(regionAsked(filters));
  const regionSearch = useRegionChipSearch(regionAsked(filters) ?? null);
  // On a narrow screen: whether the window is the side shown, rather than the list.
  const [onWindow, setOnWindow] = useState(false);
  // While an Apply runs no other group opens: the Apply's report and staging belong to the group it was pressed in.
  const [applying, setApplying] = useState(false);
  // The last Apply's report, by group: the window stays on its group after an Apply, even
  // one that answers the group's last arrival out of the list, so the report stays with it.
  const [reports, setReports] = useState<ReadonlyMap<string, CrowdingOutcome>>(new Map());

  // Both reads answered: the whole list, and the one within the region picked.
  const loaded = read.isSuccess && regionRead.isSuccess;
  const loading = read.isLoading || regionRead.isLoading;
  const failed = read.error ?? regionRead.error;
  const all = read.data?.groups ?? [];
  const within = regionRead.data?.groups ?? [];
  const groups = everyGroup(all, within);
  const visible = filterGroups(within, filters);
  const shown = groupShown(visible, groups, selected);
  const shownKey = shown ? crowdKeyOf(shown) : null;

  // The address follows the group shown — the first one the filters keep, when it names
  // none or one they hide — as a replace: the page moved, the curator did not.
  useEffect(() => {
    if (shownKey !== null && shownKey !== selected) onSelect(shownKey, { replace: true });
  }, [shownKey, selected, onSelect]);

  /** The window's staging: the group on screen's own. */
  const onStaging = useCallback((next: SetStateAction<Staging>) => {
    if (shownKey === null) return;
    onStagings(all => withStaging(all, shownKey, typeof next === 'function' ? next(stagingIn(all, shownKey)) : next));
  }, [shownKey, onStagings]);

  const onOutcome = useCallback((next: CrowdingOutcome | null) => {
    if (shownKey === null) return;
    setReports(all => {
      const kept = new Map(all);
      if (next) kept.set(shownKey, next);
      else kept.delete(shownKey);
      return kept;
    });
  }, [shownKey]);

  const open = (group: ShadowedArrivalsGroup) => {
    const key = crowdKeyOf(group);
    if (key !== shownKey) onSelect(key);
    setOnWindow(true);
  };
  /** Another group with answers staged, opened from the Apply bar: out from under the chips where they hide it. */
  const openStaged = (entry: StagedElsewhere) => {
    if (entry.group && !visible.some(group => crowdKeyOf(group) === entry.key)) setFilters(NO_CROWD_FILTERS);
    onSelect(entry.key);
    setOnWindow(true);
  };
  const elsewhere = stagedElsewhere(stagings, groups, shownKey);

  // Counted within the region once its read answers; until then the counts are not claimed.
  const regions = regionOptions(all, regionRead.data?.groups, filters);
  const kinds = kindOptions(all, regionRead.data?.groups, filters);
  // One region at a time, the one picked clearing on a second pick. A region the search
  // found that the list does not name keeps its row, so the chip can say it (#2349); the
  // only row of the menu the list does not name is the one picked, cleared here first.
  const pickRegion = (key: string) => {
    if (filters.region === key) {
      setFilters({ ...filters, region: null, searched: null });
      return;
    }
    const onList = regions.some(option => option.key === key);
    const found = regionSearch.found.find(option => option.key === key);
    setFilters({ ...filters, region: key, searched: onList ? null : found ?? null });
  };
  const filtered = filters.region !== null || filters.kinds.length > 0;
  const showList = !narrow || !onWindow;
  const showWindow = shown !== undefined && (!narrow || onWindow || visible.length === 0);

  return (
    <Box>
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 760 }}>
          New places the rule would shadow once published, which the questions leave out. Each group opens its region
          as the region page shows it: the places shown, the ones the rule shadows and the new ones, a region and a
          type at a time.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <FilterChip
            label="Region"
            value={regions.find(option => option.checked)?.label ?? ''}
            active={filters.region !== null}
            options={regions}
            pending={read.isLoading}
            single
            onToggle={pickRegion}
            search={regionSearch}
          />
          <FilterChip
            label="Kind"
            value={kinds.filter(option => option.checked).map(option => option.label).join(', ')}
            active={filters.kinds.length > 0}
            options={kinds}
            pending={loading}
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

      {loading && <LoadingSpinner padding={4} />}
      {failed && (
        <Alert severity="error">
          Could not read the crowded cities{failed instanceof Error ? `: ${failed.message}` : '.'}
        </Alert>
      )}
      {loaded && visible.length === 0 && (
        <Alert severity="success" sx={{ mb: shown ? 2 : 0 }}>
          {filtered
            ? 'No crowded city matches. Clear a filter.'
            : 'Nothing waiting. No new place would arrive in a crowded city’s shadow.'}
        </Alert>
      )}

      {(visible.length > 0 || shown) && (
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems="flex-start">
          {showList && visible.length > 0 && (
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
                  {`${plural(visible.length, 'group')} by region and type`}
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
            <Box sx={{ flexGrow: 1, minWidth: 0, width: { xs: '100%', md: 'auto' }, pl: { md: visible.length > 0 ? 2 : 0 } }}>
              {narrow && visible.length > 0 && (
                <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => setOnWindow(false)} sx={{ mb: 1 }}>
                  All crowded cities
                </Button>
              )}
              <CrowdingWindow
                // A group is its own window: its hover and its reads start afresh.
                key={shownKey}
                group={shown}
                selected={selectedPlace}
                onSelect={onSelectPlace}
                titleId="crowded-city-title"
                staging={stagingIn(stagings, shownKey ?? '')}
                onStaging={onStaging}
                onApplied={onApplied}
                outcome={shownKey === null ? null : reports.get(shownKey) ?? null}
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
