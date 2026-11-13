/**
 * The review page's *Crowded cities* tab (ADR-0180, #2282, #2358, #2487): the
 * new arrivals a crowded city would shadow, one line per region, kind and type
 * on the left — "Berlin · squares" — and on the right the window over that
 * group's region as its page shows it, every place of the type, a place open
 * in its own circle on a click.
 *
 * Whether such an arrival belongs in the list is a question about its
 * neighbours and about what the region's page shows, so it is asked a region
 * and a type at a time, in the window (`CrowdingWindow`). It is the one screen
 * every way in opens: a review card's *Squares around* and a curation
 * dialog's kind link here with the place alone in the address
 * (`crowdedPlaceUrl`), and the tab reads the place's group and writes it in,
 * as a replace, so Back returns to the card. The open group and the place
 * open in it are the address's (`crowd` and `place`, `utils/appUrl.ts`); a
 * group the address names opens where the filters keep it or where the list
 * does not hold it at all, and the first one the filters keep opens otherwise,
 * so the right side is never empty. While a group is open the list of groups
 * folds to a narrow bar on a wide screen, so the map stands beside the table;
 * the bar's button unfolds it. The Region and Kind filters are this tab's alone and not in the
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
  Alert, Box, Button, Divider, IconButton, List, ListItem, Paper, Stack, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import { useQuery } from '@tanstack/react-query';
import type { ShadowedArrivalsGroup } from '../../../api/crowding';
import { fetchCrowdingPlace } from '../../../api/crowdingAnswers';
import { queryKeys } from '../../../api/queryKeys';
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

/**
 * Which sides of the tab show. On a narrow screen one at a time: the list, or
 * the window with a way back to it. On a wide one the window beside the list,
 * which folds to a bar while a group is open once folded, and unfolds from it.
 */
function sidesShown({ narrow, onWindow, folded, open, listed }: {
  narrow: boolean;
  /** On a narrow screen, whether the window is the side shown. */
  onWindow: boolean;
  folded: boolean;
  /** Whether a group is open. */
  open: boolean;
  /** Whether the list holds a group to show. */
  listed: boolean;
}): { list: boolean; bar: boolean; window: boolean; marksOpen: boolean; folds: boolean; backToList: boolean } {
  if (narrow) {
    // While nothing is open — a way in's place that cannot be read — the list stands, so the curator is never
    // left with nowhere to go.
    return {
      list: listed && (!onWindow || !open), bar: false, window: open && (onWindow || !listed),
      marksOpen: false, folds: false, backToList: listed,
    };
  }
  const bar = listed && open && folded;
  return { list: listed && !bar, bar, window: open, marksOpen: true, folds: open, backToList: false };
}

/** The list of groups, a line each, with the way to fold it beside the open group on a wide screen. */
function GroupList({ groups, stagings, openKey, disabled, onOpen, onFold }: {
  groups: readonly ShadowedArrivalsGroup[];
  stagings: GroupStagings;
  /** The open group's line; null where no line reads as open. */
  openKey: string | null;
  disabled: boolean;
  onOpen: (group: ShadowedArrivalsGroup) => void;
  /** Folds the list to a bar; null where it does not fold. */
  onFold: (() => void) | null;
}) {
  return (
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
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {`${plural(groups.length, 'group')} by region and type`}
        </Typography>
        {onFold && (
          <Tooltip title="Fold the list beside the open group">
            <IconButton size="small" aria-label="Fold the list beside the open group" onClick={onFold}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <List dense disablePadding aria-label="Crowded cities">
        {groups.map(group => (
          <GroupLine
            key={crowdKeyOf(group)}
            group={group}
            staged={stagingIn(stagings, crowdKeyOf(group)).size}
            selected={crowdKeyOf(group) === openKey}
            disabled={disabled}
            onClick={() => onOpen(group)}
          />
        ))}
      </List>
    </Box>
  );
}

/** Where a way in's place could not be read: said, and no group opened in its stead. */
function WayInFailure({ failed }: { failed: unknown }) {
  if (failed === null) return null;
  return (
    <Alert severity="error">
      Could not read the place{failed instanceof Error ? `: ${failed.message}` : '.'}
    </Alert>
  );
}

/**
 * The group a way in's place belongs to (#2487): a review card and a curation
 * dialog name the place alone, and its group is read off the place. While it
 * is read, or where it cannot be, the tab is `waiting` and opens no group, so
 * the first one never stands in for it.
 */
function useWayInGroup(selected: string | null, selectedPlace: number | null): {
  /** The place's group, once read; null where the address names a group or no place. */
  key: string | null;
  /** The place, where the group shown is its own. */
  placeIn: (shownKey: string | null) => number | null;
  waiting: boolean;
  reading: boolean;
  failed: unknown;
} {
  const place = selected === null ? selectedPlace : null;
  const read = useQuery({
    queryKey: queryKeys.curation.crowdingPlace(place ?? 0),
    queryFn: () => fetchCrowdingPlace(place ?? 0),
    enabled: place !== null,
    retry: false,
  });
  const group = place === null ? undefined : read.data?.group;
  const key = group ? crowdKeyOf(group) : null;
  return {
    key,
    placeIn: shownKey => (key !== null && shownKey === key ? place : null),
    waiting: place !== null && !read.isSuccess,
    reading: place !== null && read.isPending,
    failed: place !== null && read.isError ? read.error : null,
  };
}

/** The list of groups folded beside an open group: its name on its side, and the way to unfold it. */
function FoldedGroups({ group, staged, onUnfold }: {
  /** The open group, where the list holds it. */
  group: ShadowedArrivalsGroup | undefined;
  /** Answers staged in the other groups, which the folded list hides. */
  staged: number;
  onUnfold: () => void;
}) {
  return (
    <Box
      component="nav"
      aria-label="Crowded cities"
      sx={{
        width: 56, flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 1.5, pt: 1, borderRight: 1, borderColor: 'divider',
      }}
    >
      <Tooltip title="Show every crowded city">
        <IconButton aria-label="Show every crowded city" onClick={onUnfold}>
          <FormatListBulletedIcon />
        </IconButton>
      </Tooltip>
      {staged > 0 && (
        <Typography variant="caption" color="primary" sx={{ textAlign: 'center', lineHeight: 1.2 }}>{`${staged} staged`}</Typography>
      )}
      {group && (
        <Typography
          variant="body2"
          aria-hidden
          sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', fontWeight: 500, color: 'text.secondary' }}
        >
          {groupName(group)}
        </Typography>
      )}
    </Box>
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
  /** The place the address opens in its own circle (`place`), or null; named alone, the tab reads its group. */
  selectedPlace: number | null;
  /**
   * A group opened: pushed when the curator picked it, replaced when the page did — with the place a
   * way in named, once its group is read.
   */
  onSelect: (key: string, opts?: { replace?: boolean; place?: number }) => void;
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
  // A group or a place the address names — a way in, a link — opens on it: on a narrow screen the
  // window is the side shown, and on a wide one the list stands folded beside it.
  const named = selected !== null || selectedPlace !== null;
  // On a narrow screen: whether the window is the side shown, rather than the list.
  const [onWindow, setOnWindow] = useState(named);
  // While an Apply runs no other group opens: the Apply's report and staging belong to the group it was pressed in.
  const [applying, setApplying] = useState(false);
  // The last Apply's report, by group: the window stays on its group after an Apply, even
  // one that answers the group's last arrival out of the list, so the report stays with it.
  const [reports, setReports] = useState<ReadonlyMap<string, CrowdingOutcome>>(new Map());
  // A wide screen folds the list while a group is open: one the address named, or one the curator picked.
  const [folded, setFolded] = useState(named);

  const wayIn = useWayInGroup(selected, selectedPlace);

  // Both reads answered: the whole list, and the one within the region picked.
  const loaded = read.isSuccess && regionRead.isSuccess;
  const loading = read.isLoading || regionRead.isLoading;
  const failed = read.error ?? regionRead.error;
  const all = read.data?.groups ?? [];
  const within = regionRead.data?.groups ?? [];
  const groups = everyGroup(all, within);
  const visible = filterGroups(within, filters);
  const shown = wayIn.waiting ? undefined : groupShown(visible, groups, wayIn.key ?? selected);
  const shownKey = shown ? crowdKeyOf(shown) : null;

  // The address follows the group shown — the place's own, the first one the filters keep when it
  // names none or one they hide — as a replace: the page moved, the curator did not. The place a
  // way in named stays open in its group.
  const wayInPlace = wayIn.placeIn(shownKey);
  useEffect(() => {
    if (shownKey === null || shownKey === selected) return;
    onSelect(shownKey, wayInPlace === null ? { replace: true } : { replace: true, place: wayInPlace });
  }, [shownKey, selected, wayInPlace, onSelect]);

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
    setFolded(true);
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
  const side = sidesShown({ narrow, onWindow, folded, open: shown !== undefined, listed: visible.length > 0 });
  const shownGroup = groups.find(group => crowdKeyOf(group) === shownKey);
  const stagedOther = elsewhere.reduce((sum, entry) => sum + entry.count, 0);

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

      {(loading || wayIn.reading) && <LoadingSpinner padding={4} />}
      <WayInFailure failed={wayIn.failed} />
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
          {side.bar && (
            <FoldedGroups group={shownGroup} staged={stagedOther} onUnfold={() => setFolded(false)} />
          )}
          {side.list && (
            <GroupList
              groups={visible}
              stagings={stagings}
              // On a narrow screen the list stands alone, so no line reads as open, and nothing folds it.
              openKey={side.marksOpen ? shownKey : null}
              disabled={applying}
              onOpen={open}
              onFold={side.folds ? () => setFolded(true) : null}
            />
          )}
          {side.window && shown && (
            <Box sx={{ flexGrow: 1, minWidth: 0, width: { xs: '100%', md: 'auto' }, pl: { md: visible.length > 0 ? 2 : 0 } }}>
              {side.backToList && (
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
