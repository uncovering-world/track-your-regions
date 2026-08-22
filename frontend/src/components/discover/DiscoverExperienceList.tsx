/**
 * Discover's experience list: the header, the name filter and the windowed rows.
 *
 * Split out of `DiscoverExperienceView` under the 800-line rule in
 * `docs/tech/development-guide.md` (#562). Since #573 it owns its window: the
 * rows are virtualised — a region can put 683 cards here, and mounting them all
 * is what made opening one freeze the tab — and with the window comes what only
 * the window knows: which rows were actually shown (the New-badge impressions)
 * and how to reach a row that has no element (the scroll a marker hover asks
 * for). Hover is not a prop: each row subscribes to its own "am I the one", so
 * a pointer move re-renders the row entered and the row left, not the list.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Box, Typography, IconButton, TextField, InputAdornment, Button, List,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Experience } from '../../api/experiences';
import type { ActiveView } from '../../hooks/useDiscoverExperiences';
import { subscribeToHoverTarget, useHoverActions, useHoverSelector } from '../../hooks/useHoverContext';
import { useSeenWindowIds } from '../../hooks/useSeenWindowIds';
import { useNewBadgeImpressions } from '../../hooks/useNewBadgeImpressions';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { EmptyState } from '../shared/EmptyState';
import { VirtualRow } from '../shared/VirtualRow';
import { ExperienceCard } from './ExperienceCard';

interface DiscoverExperienceRowProps {
  experience: Experience;
  isVisited: boolean;
  isSelected: boolean;
  showCheckbox: boolean;
  canCurate: boolean;
  // Every callback takes the experience it concerns rather than closing over
  // it: this component is memoised, and a closure rebuilt per parent render is
  // one unstable prop away from the memo doing nothing.
  onSelect: (id: number) => void;
  onHoverEnter: (id: number) => void;
  onHoverLeave: () => void;
  onVisitedToggle: (experienceId: number, visited: boolean, e: React.MouseEvent) => void;
  onCurate: (experience: Experience) => void;
}

/**
 * One row, subscribed to its own "am I the hovered one" boolean — the shape
 * `hoverStore.test.tsx` pins. Memoised so the whole-list renders that remain
 * (scrolling mounts a batch of rows, selection changes two) stay the only ones.
 * Exported for `discoverListWindow.test.tsx`, which guards the memo.
 */
export const DiscoverExperienceRow = memo(function DiscoverExperienceRow({
  experience,
  isVisited,
  isSelected,
  showCheckbox,
  canCurate,
  onSelect,
  onHoverEnter,
  onHoverLeave,
  onVisitedToggle,
  onCurate,
}: DiscoverExperienceRowProps) {
  const isHovered = useHoverSelector(s => s.hoveredExperienceId === experience.id);
  return (
    <ExperienceCard
      experience={experience}
      isVisited={isVisited}
      isHovered={isHovered}
      isSelected={isSelected}
      onClick={() => onSelect(experience.id)}
      onMouseEnter={() => onHoverEnter(experience.id)}
      onMouseLeave={onHoverLeave}
      onVisitedToggle={(e) => onVisitedToggle(experience.id, isVisited, e)}
      showCheckbox={showCheckbox}
      onCurate={canCurate ? () => onCurate(experience) : undefined}
    />
  );
});

interface DiscoverExperienceListProps {
  activeView: ActiveView;
  experiences: Experience[];
  filteredExperiences: Experience[];
  isLoading: boolean;
  search: string;
  setSearch: (value: string) => void;
  shortSourceName: string | null;
  rejectedCount: number;
  hasCuratorScope: boolean;
  isAuthenticated: boolean;
  visitedIds: Set<number>;
  selectedExperienceId: number | null;
  onBack: () => void;
  onSelectExperience: (id: number) => void;
  onCardMouseEnter: (id: number) => void;
  onCardMouseLeave: () => void;
  onVisitedToggle: (experienceId: number, visited: boolean, e: React.MouseEvent) => void;
  onCurate: (experience: Experience) => void;
  onAdd: () => void;
}

export function DiscoverExperienceList({
  activeView,
  experiences,
  filteredExperiences,
  isLoading,
  search,
  setSearch,
  shortSourceName,
  rejectedCount,
  hasCuratorScope,
  isAuthenticated,
  visitedIds,
  selectedExperienceId,
  onBack,
  onSelectExperience,
  onCardMouseEnter,
  onCardMouseLeave,
  onVisitedToggle,
  onCurate,
  onAdd,
}: DiscoverExperienceListProps) {
  const { user } = useAuth();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // A row's identity, not its position: the name filter removes rows above,
  // and a height measured for "row 40" handed to whatever moved into slot 40
  // keeps the scrollbar wrong until each row happens to re-render.
  const getRowKey = useCallback(
    (index: number) => filteredExperiences[index]?.id ?? index,
    [filteredExperiences],
  );

  const virtualizer = useVirtualizer({
    count: filteredExperiences.length,
    getScrollElement: () => scrollContainerRef.current,
    // A card is a fixed-layout strip — 56 px thumbnail, three `noWrap` lines,
    // padding — so unlike map mode's rows there is no open state to swallow the
    // estimate. `measureElement` still corrects each row as it mounts.
    estimateSize: () => 84,
    getItemKey: getRowKey,
    overscan: 8,
  });

  // Where each experience sits, for the scroll a marker hover asks for — the
  // row it names is usually not mounted, which is the point of windowing.
  const rowIndexById = useMemo(() => {
    const map = new Map<number, number>();
    filteredExperiences.forEach((exp, i) => map.set(exp.id, i));
    return map;
  }, [filteredExperiences]);
  // Read through a ref: the subscription below is registered once, and a hover
  // is not the moment to re-register it because the rows changed.
  const rowIndexRef = useRef(rowIndexById);
  rowIndexRef.current = rowIndexById;

  // ── Map hover → scroll the row into view ──
  //
  // Subscribed, never rendered from: a hover changes on every mouse move, and
  // this component builds every row it has. Only a hover from a *marker* moves
  // the list, and only one that names no place — a highlight-dot hover names a
  // place in the detail panel's list, and scrolling this one to the selected
  // card for it would move the list under a reader who is looking at the panel.
  // The jump replaces the smooth `scrollIntoView` the unwindowed list used:
  // TanStack documents smooth scrolling as unsupported beside dynamic
  // measurement, and a jump cannot slide rows under a resting pointer — which
  // is what the old `isAutoScrollingRef` guard existed to absorb.
  const { store } = useHoverActions();
  useEffect(() => subscribeToHoverTarget(store, ({ hoveredExperienceId, hoveredLocationId, hoverSource }) => {
    if (hoverSource !== 'marker' || hoveredExperienceId == null || hoveredLocationId != null) return;
    const index = rowIndexRef.current.get(hoveredExperienceId);
    if (index != null) virtualizer.scrollToIndex(index, { align: 'center' });
  }), [store, virtualizer]);

  // ── New-badge impressions: what the window has held, not what the response
  // holds ──
  //
  // The server keeps the *first* impression, so a row stamped while unrendered
  // spends the reader's personal week without them — before windowing this
  // reported the whole filtered set, which was honest exactly because every row
  // was mounted. Now the window is what a reader was shown, and the same
  // accumulate-and-flush the map-mode list uses answers it. The range excludes
  // `overscan`, which is mounted precisely because it is *not* in view. Search
  // does not reset the set: it only narrows a list whose rows were reported
  // when shown, and a row seen under an earlier filter stays seen.
  const virtualItems = virtualizer.getVirtualItems();
  // Read after `getVirtualItems()` so the range belongs to this render — the
  // property is only assigned inside the virtualiser's accessors, so read
  // first it is the previous render's. With the name filter that is a stale
  // `startIndex` sliced into the freshly narrowed array: ids of rows that were
  // never mounted, stamped as seen (the map-mode list states the same rule).
  const range = virtualizer.range;
  const idsInVisibleRange = !isLoading && range
    ? filteredExperiences.slice(range.startIndex, range.endIndex + 1).map(e => e.id)
    : [];
  const seenIds = useSeenWindowIds(
    idsInVisibleRange, `${activeView.regionId}:${activeView.categoryId}`);
  // `experiences`, deliberately not the filtered rows: membership in `seenIds`
  // already means "this row rendered", and narrowing to what the filter leaves
  // *now* would drop rows the reader did see before typing.
  const shownExperiences = useMemo(
    () => experiences.filter(exp => seenIds.has(exp.id)),
    [experiences, seenIds],
  );
  useNewBadgeImpressions(shownExperiences, isAuthenticated, user?.id);

  return (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderTop: '1px solid', borderColor: 'divider', minHeight: 0 }}>
          {/* List header with back button */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderBottom: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <IconButton size="small" onClick={onBack} aria-label="Back to the region list">
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                {shortSourceName} in {activeView.regionName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {(() => {
                  if (isLoading) return 'Loading...';
                  const ofTotal = search ? ` of ${experiences.length}` : '';
                  return `${filteredExperiences.length}${ofTotal} experiences`;
                })()}
                {hasCuratorScope && rejectedCount > 0 && (
                  <Typography component="span" variant="caption" color="error.main">
                    {' '}({rejectedCount} rejected)
                  </Typography>
                )}
              </Typography>
            </Box>
            {hasCuratorScope && activeView.regionId && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlaylistAddIcon />}
                onClick={onAdd}
                sx={{ flexShrink: 0, mr: 0.5 }}
              >
                Add
              </Button>
            )}
          </Box>

          {/* Search (only for 15+ experiences) */}
          {experiences.length > 15 && (
            <Box sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
              <TextField
                size="small"
                placeholder="Filter by name or country..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                fullWidth
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearch('')} aria-label="Clear the name filter">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />
            </Box>
          )}

          {/* Scrollable experience list — windowed: only the rows the scroll
              window covers are mounted, out of a set that reaches 683. Still a
              `List`, each row one `li` of it, so a screen reader hears one item
              per row. */}
          <Box ref={scrollContainerRef} sx={{ flex: 1, overflowY: 'auto' }}>
            {isLoading && <LoadingSpinner size={24} padding="16px 0" />}
            {!isLoading && filteredExperiences.length === 0 && (
              <EmptyState message={search ? 'No experiences match your filter.' : 'No experiences found.'} />
            )}
            {!isLoading && filteredExperiences.length > 0 && (
              <List
                disablePadding
                sx={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
              >
                {virtualItems.map((virtualRow) => {
                  const exp = filteredExperiences[virtualRow.index];
                  if (!exp) return null;
                  return (
                    <VirtualRow
                      key={virtualRow.key}
                      virtualizer={virtualizer}
                      index={virtualRow.index}
                      start={virtualRow.start}
                    >
                      <DiscoverExperienceRow
                        experience={exp}
                        isVisited={visitedIds.has(exp.id)}
                        isSelected={selectedExperienceId === exp.id}
                        showCheckbox={isAuthenticated}
                        canCurate={hasCuratorScope}
                        onSelect={onSelectExperience}
                        onHoverEnter={onCardMouseEnter}
                        onHoverLeave={onCardMouseLeave}
                        onVisitedToggle={onVisitedToggle}
                        onCurate={onCurate}
                      />
                    </VirtualRow>
                  );
                })}
              </List>
            )}
          </Box>
        </Box>
  );
}
