/**
 * ExperienceList - Display experiences grouped by source
 *
 * Features:
 * - Grouped by category_name (e.g., "UNESCO World Heritage Sites")
 * - Hover-to-highlight: bidirectional between list and markers
 * - Click expands inline details
 * - Checkboxes for authenticated users to mark visited
 * - Multi-location support: shows location count and expandable locations
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  lostHiddenLabel, outsideViewLabel,
  flattenGroups, rowIndexByExperienceId, experienceIdsInVisibleRange,
  type ExperienceGroupLike,
} from './ExperienceList/utils';
import { useInViewFilter } from './ExperienceList/useInViewFilter';
import { useListScrollAnchor } from './ExperienceList/useListScrollAnchor';
import { GroupHeader } from './ExperienceList/GroupHeader';
import { NoticeLink } from './ExperienceList/NoticeLink';
import { RejectedSection } from './ExperienceList/RejectedSection';
import {
  Box,
  Typography,
  List,
  Button,
} from '@mui/material';
import {
  PlaylistAdd as AssignIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useExperienceContext } from '../hooks/useExperienceContext';
import { useHoverActions } from '../hooks/useHoverContext';
import { useAuth } from '../hooks/useAuth';
import { useNewBadgeImpressions } from '../hooks/useNewBadgeImpressions';
import { useVisitedExperiences, useVisitedLocations } from '../hooks/useVisitedExperiences';
import { useRegionLocations } from '../hooks/useRegionLocations';
import {
  fetchExperienceCategories,
  unrejectExperience,
  removeExperienceFromRegion,
  type Experience,
} from '../api/experiences';
import { useNavigation } from '../hooks/useNavigation';
import { CurationDialog } from './shared/CurationDialog';
import { AddExperienceDialog } from './shared/AddExperienceDialog';
import { invalidateExperiences } from '../utils/queryInvalidation';
import { LoadingSpinner } from './shared/LoadingSpinner';
import { ExperienceListItem } from './ExperienceList/ExperienceListItem';
import { VirtualRow } from './shared/VirtualRow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSeenWindowIds } from '../hooks/useSeenWindowIds';

interface ExperienceGroup {
  categoryName: string;
  categoryPriority: number;
  experiences: Experience[];
}

interface ExperienceListProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function ExperienceList({ scrollContainerRef }: ExperienceListProps) {
  const {
    experiences,
    experiencesLoading,
    lostHidden,
    showLost,
    setShowLost,
    regionId,
    viewBounds,
    selectedExperienceId,
    toggleSelectedExperience,
    triggerFlyTo,
    setExpandedCategoryNames,
    collapsedExperienceIds,
    toggleCollapsedExperience,
  } = useExperienceContext();
  // Hover is a store, not state, and this component reads none of its values:
  // they change on every mouse move, and this render builds the whole list —
  // every group header, both dialogs, and any open card. What a hover changes is
  // read where it is drawn (the row, the place, the map's preview card), and
  // reacted to in an effect where it moves the list (`useListScrollAnchor`).
  const { store: hoverStore, setHoveredFromList } = useHoverActions();
  const { isAuthenticated, isCurator, user } = useAuth();
  const { selectedRegion } = useNavigation();
  const queryClient = useQueryClient();
  const { isMarking, isUnmarking } = useVisitedExperiences();
  const {
    markLocationVisited,
    unmarkLocationVisited,
    markAllLocations,
    unmarkAllLocations,
    isMarking: isMarkingLocation,
    isUnmarking: isUnmarkingLocation,
    isLocationVisited,
  } = useVisitedLocations();

  // Batch-fetch all locations for all experiences in the region (single request)
  const { locationsByExperience, locationsResolved } = useRegionLocations(regionId, showLost);

  // Curator state
  const [curationTarget, setCurationTarget] = useState<Experience | null>(null);
  const [rejectedSectionOpen, setRejectedSectionOpen] = useState(false);
  const [addDialogState, setAddDialogState] = useState<{
    open: boolean;
    defaultCategoryId?: number;
    defaultTab?: 0 | 1;
  }>({ open: false });

  // Fetch categories to map category names → IDs for per-group add buttons
  const { data: categoriesData } = useQuery({
    queryKey: ['experience-categories'],
    queryFn: fetchExperienceCategories,
    enabled: !!isCurator,
  });

  // Build a category name → category ID lookup
  const categoryNameToId = useMemo(() => {
    const map = new Map<string, number>();
    categoriesData?.forEach((s) => map.set(s.name, s.id));
    return map;
  }, [categoriesData]);

  // Check if any experiences have is_rejected field (indicates curator has scope for this region)
  const hasCuratorScope = isCurator && experiences.some((exp) => exp.is_rejected !== undefined);

  // Separate active and rejected experiences
  const activeExperiences = useMemo(() => experiences.filter((exp) => !exp.is_rejected), [experiences]);
  const rejectedExperiences = useMemo(() => experiences.filter((exp) => exp.is_rejected), [experiences]);

  /**
   * The list answers about the map's view rather than about the whole region
   * (#553). Nothing keys on a zoom level: when the view holds every one of the
   * region's objects the hidden count is zero and no control renders, which is
   * what a reader zoomed out far enough gets without asking for it.
   */
  const {
    listedExperiences, outsideView, isFiltered: groupsAreFiltered,
    showWholeRegion, toggleWholeRegion, totalByCategory,
  } = useInViewFilter(
    activeExperiences, locationsByExperience, viewBounds, regionId, selectedExperienceId,
    collapsedExperienceIds,
  );

  const unrejectMutation = useMutation({
    mutationFn: ({ experienceId, rId }: { experienceId: number; rId: number }) =>
      unrejectExperience(experienceId, rId),
    onSuccess: () => {
      invalidateExperiences(queryClient, { regionId });
    },
  });

  const removeFromRegionMutation = useMutation({
    mutationFn: ({ experienceId, rId }: { experienceId: number; rId: number }) =>
      removeExperienceFromRegion(experienceId, rId),
    onSuccess: () => {
      invalidateExperiences(queryClient, { regionId });
    },
  });

  // Track which groups are expanded
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Refs for scrolling to items (experiences and locations)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // `HTMLElement`, not `HTMLDivElement`: a place row is the `li` its `List`
  // parent expects — see `LocationRow`.
  const locationRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Group active experiences by category_name, sorted by display_priority
  const groups = useMemo<ExperienceGroup[]>(() => {
    const groupMap = new Map<string, { experiences: Experience[]; priority: number }>();

    for (const exp of listedExperiences) {
      const categoryName = exp.category_name || 'Experiences';
      if (!groupMap.has(categoryName)) {
        groupMap.set(categoryName, { experiences: [], priority: exp.category_priority ?? 100 });
      }
      groupMap.get(categoryName)!.experiences.push(exp);
    }

    return Array.from(groupMap.entries())
      .map(([categoryName, { experiences: exps, priority }]) => ({ categoryName, categoryPriority: priority, experiences: exps }))
      .sort((a, b) => a.categoryPriority - b.categoryPriority);
  }, [listedExperiences]);

  // Reset when the region changes, during render rather than in an effect:
  // `shownExperiences` below pairs `expandedGroups` with `groups`, and an
  // effect-based reset leaves one render where they belong to different
  // regions. With the new region already in the React Query cache there is no
  // loading render to hide it — `groups` is region B's while `expandedGroups`
  // is still A's, so the impressions effect of that commit reports whichever of
  // B's groups happens to share a name with one A had open, before auto-expand
  // opens the first group instead. That stamp is not recoverable: the server
  // keeps the first impression, so those rows spend the reader's week unseen.
  //
  // The tracker is state, not a ref, which is what makes this restart-safe.
  // `regionId` arrives through navigation, and React Router pushes that in a
  // transition — a render React may discard and replay. A ref is shared with
  // the committed fiber, so it would keep the new id across a discard while the
  // queued reset went with the discarded tree, and the replayed render would
  // find the condition already false and skip the reset entirely. State is
  // queued on the same work-in-progress tree as the reset, so the two are
  // discarded and replayed together.
  const [trackedRegionId, setTrackedRegionId] = useState(regionId);
  const hasAutoExpanded = useRef(false);
  if (regionId !== trackedRegionId) {
    setTrackedRegionId(regionId);
    hasAutoExpanded.current = false;
    setExpandedGroups(new Set());
  }

  // The parent's copy stays in an effect — setting another component's state
  // during render is what React forbids — with its own tracker, since the one
  // above belongs to the render-phase reset.
  const parentResetRegionId = useRef(regionId);
  useEffect(() => {
    if (regionId !== parentResetRegionId.current) {
      parentResetRegionId.current = regionId;
      setExpandedCategoryNames(new Set());
    }
  }, [regionId, setExpandedCategoryNames]);

  // Auto-expand first group on initial load (once per region)
  useEffect(() => {
    if (groups.length > 0 && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      const initial = new Set([groups[0].categoryName]);
      setExpandedGroups(initial);
      setExpandedCategoryNames(initial);
    }
  }, [groups, setExpandedCategoryNames]);

  // ── One flat list, so the rows can be windowed ──
  //
  // Grouped rendering and windowing do not compose: a virtualiser counts rows
  // and a group is not a row. So headers and the experiences of expanded groups
  // become one sequence, and a collapsed group contributes its header alone —
  // which is what `unmountOnExit` did before, arrived at differently.
  //
  // Measured on Europe, where the largest category holds 467: rendering them all
  // blocked the main thread for 2.5 s in one task, and 2.9 s of the 3.8 s that
  // opening a region cost was these rows (#552).
  const flatRows = useMemo(() => flattenGroups(groups, expandedGroups), [groups, expandedGroups]);

  // Where each experience sits, so the scroll hook can ask the virtualiser for a
  // row that has no element yet — the whole point of windowing is that most rows
  // do not. How it reads this map, and why most of its movements deliberately do
  // not depend on it, is `useListScrollAnchor`'s own business.
  const rowIndexByExperience = useMemo(() => rowIndexByExperienceId(flatRows), [flatRows]);

  // A row's identity, not its position. Measured heights are cached under this
  // key, and the default key is the index — which is exactly what is unstable
  // here: collapsing a group shifts every row below it, so a height measured for
  // "row 40" would be handed to whatever row moved into slot 40, and the
  // scrollbar would stay wrong until each of them happened to re-render.
  const getRowKey = useCallback(
    (index: number) => {
      const row = flatRows[index];
      if (!row) return index;
      return row.kind === 'header' ? `h:${row.group.categoryName}` : `e:${row.exp.id}`;
    },
    [flatRows],
  );

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollContainerRef.current,
    // Measured, not guessed, because in a 467-row list the guess decides where a
    // scroll lands: only the rows a reader has already passed carry a real height,
    // and every other one is this number. At 72 against a real 59 the list carried
    // some 6000 px of height that does not exist, so `scrollToIndex` aimed past its
    // row, and the total shrank as rows arrived and were measured — which moves the
    // content under a reader who is not scrolling, and shows an empty panel when the
    // position ends up beyond the shrunken end.
    //
    // Measured live on Europe: a header is 46 px, a collapsed row 59 px (65 or 85
    // where the title wraps to two or three lines). `measureElement` still corrects
    // each row as it renders, and an expanded row is five to fifteen times taller —
    // no estimate could cover both, which is what the measuring is for.
    estimateSize: (i) => (flatRows[i]?.kind === 'header' ? 46 : 62),
    getItemKey: getRowKey,
    // No `scrollMargin` here, deliberately, and it is not free: the list is not
    // the first thing in the scroll container — a curator gets the "add a
    // category" box above it — so the virtualiser's origin is the container's
    // rather than the list's and its range is off by that distance, masked in
    // practice by `overscan`. The documented remedy is the list's `offsetTop`,
    // and here that reads 102 px where the true distance is 47: `offsetTop` counts
    // from the nearest positioned ancestor, and the scroll container
    // (`RegionDescriptionSection.tsx:54`) is `position: static`, so the count
    // starts somewhere else entirely. A wrong margin shifts the range for every
    // reader, where no margin shifts it only where the box appears — #556 makes
    // the container the origin and measures it.
    overscan: 8,
  });

  // Every movement of this list, and the reasons each one is narrower than it
  // looks, live in one place — see the hook.
  const { handleCardOpened, measureRow, expectFlight } = useListScrollAnchor({
    hoverStore, selectedExperienceId,
    scrollContainerRef, itemRefs, locationRefs, virtualizer, rowIndexByExperience,
  });

  const toggleGroup = (categoryName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      setExpandedCategoryNames(next);
      return next;
    });
  };

  // Declared once, not per row. These are props of a memoised component: a
  // closure rebuilt on each render would defeat the memo entirely, and the list
  // re-renders on every hover.
  const handleHover = useCallback((exp: Experience) => setHoveredFromList(exp.id, null), [setHoveredFromList]);
  const handleLeave = useCallback(() => setHoveredFromList(null, null), [setHoveredFromList]);

  // Read through a ref, not a dependency. The selection is only consulted, never
  // rendered from, and depending on it would rebuild this handler on every
  // selection change — moving the whole-list re-render off the hover path and
  // onto the click path, where the frame is already busy flying the map.
  // ExperienceMarkers keeps its own context callbacks stable the same way.
  const selectedIdRef = useRef(selectedExperienceId);
  selectedIdRef.current = selectedExperienceId;

  const handleClick = useCallback((exp: Experience) => {
    const isClosing = selectedIdRef.current === exp.id;
    toggleSelectedExperience(exp.id);
    // Closing a card moves no camera. It used to fly back to the whole region,
    // on the theory that opening had flown you in — but by then the reader has
    // usually panned or zoomed for themselves, and throwing that away is the
    // list moving under them, which is the complaint every movement here is
    // narrowed to avoid. It also fought #553: refitting the region republishes
    // the view, so closing one card silently changed which rows are listed.
    if (!isClosing) {
      // Said before the flight so the list's re-aim knows the rows may move
      // under the card that is about to open — see `useListScrollAnchor`.
      expectFlight(exp.id);
      triggerFlyTo(exp.id);
    }
  }, [toggleSelectedExperience, triggerFlyTo, expectFlight]);

  const handleLocationVisitedToggle = useCallback((locationId: number, isVisited: boolean) => {
    if (isVisited) {
      unmarkLocationVisited(locationId);
    } else {
      markLocationVisited(locationId);
    }
  }, [markLocationVisited, unmarkLocationVisited]);

  const handleToggleAllLocations = useCallback((experienceId: number, markAsVisited: boolean) => {
    if (markAsVisited) {
      markAllLocations({ experienceId, regionId: regionId ?? undefined });
    } else {
      unmarkAllLocations({ experienceId, regionId: regionId ?? undefined });
    }
  }, [markAllLocations, unmarkAllLocations, regionId]);

  const handleLocationHover = useCallback((experienceId: number, locationId: number | null) => {
    setHoveredFromList(locationId === null ? null : experienceId, locationId);
  }, [setHoveredFromList]);

  const handleCurate = useCallback((exp: Experience) => setCurationTarget(exp), []);
  // Stable, so the two dialogs below — mounted for as long as this list is,
  // whether or not anyone has opened them — can hold their memo while the list
  // re-renders on every scroll of it.
  const closeCuration = useCallback(() => setCurationTarget(null), []);
  const closeAddDialog = useCallback(() => setAddDialogState({ open: false }), []);
  // Keyed on `.mutate`, not on the mutation. TanStack Query v5 returns a fresh
  // result object every render, so depending on the whole thing would rebuild
  // these on each one and drop the memo for every row in the Rejected section.
  // `.mutate` is stable across renders.
  const { mutate: unreject } = unrejectMutation;
  const { mutate: removeFromRegion } = removeFromRegionMutation;

  const handleUnreject = useCallback((exp: Experience) => {
    if (regionId) unreject({ experienceId: exp.id, rId: regionId });
  }, [regionId, unreject]);
  const handleRemoveFromRegion = useCallback((exp: Experience) => {
    if (regionId) removeFromRegion({ experienceId: exp.id, rId: regionId });
  }, [regionId, removeFromRegion]);

  const virtualItems = virtualizer.getVirtualItems();
  // What the viewport intersects, which is not what is mounted: `virtualItems`
  // carries the `overscan` rows on either side, deliberately below the fold. Read
  // after `getVirtualItems()` so the range belongs to this render.
  const visibleRange = virtualizer.range;
  // Rows the reader's window has actually held, accumulated per region and
  // flushed on a timer — the whole argument lives with `useSeenWindowIds`.
  const seenExperienceIds = useSeenWindowIds(
    experienceIdsInVisibleRange(flatRows, visibleRange), regionId);

  // `activeExperiences`, deliberately not the rows the view leaves: membership in
  // `seenExperienceIds` already means "this row rendered", since it is fed only
  // from `experienceIdsInVisibleRange`. Narrowing it to what is listed *now*
  // would drop rows the reader did see whose pins have left the view — and with
  // the 800 ms flush that is one ordinary drag-drag, after which the server's
  // first-impression rule means their week never starts (#553 review).
  const shownExperiences = useMemo(
    () => activeExperiences.filter(exp => seenExperienceIds.has(exp.id)),
    [activeExperiences, seenExperienceIds],
  );
  useNewBadgeImpressions(shownExperiences, isAuthenticated, user?.id);

  const isMutating = isMarking || isUnmarking || isMarkingLocation || isUnmarkingLocation;

  if (experiencesLoading) {
    return <LoadingSpinner size={24} />;
  }

  // Both notices follow the same rule — offered only where there is something
  // behind them. Almost no region holds a lost object, and at low zoom the whole
  // region is on screen, so neither line usually appears at all.
  const lostNotice = lostHidden > 0 || showLost ? (
    <NoticeLink
      label={showLost ? 'Hide places that no longer exist' : lostHiddenLabel(lostHidden)}
      onClick={() => setShowLost(!showLost)}
    />
  ) : null;

  const viewNotice = outsideView > 0 ? (
    <NoticeLink
      label={showWholeRegion ? 'Show only what is on the map' : outsideViewLabel(outsideView)}
      onClick={toggleWholeRegion}
    />
  ) : null;

  if (activeExperiences.length === 0 && rejectedExperiences.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No experiences found in this region.
        </Typography>
        {lostNotice}
      </Box>
    );
  }

  // Takes the narrower shape: a header draws a name and a count and has no use
  // for the priority the sort above needs.
  const renderGroupHeader = (group: ExperienceGroupLike) => (
    <GroupHeader
      group={group}
      expanded={expandedGroups.has(group.categoryName)}
      onToggle={() => toggleGroup(group.categoryName)}
      regionTotal={groupsAreFiltered ? totalByCategory.get(group.categoryName) ?? null : null}
      canAdd={!!hasCuratorScope && !!regionId}
      onAdd={() => setAddDialogState({
        open: true,
        defaultCategoryId: categoryNameToId.get(group.categoryName),
        defaultTab: 0,
      })}
    />
  );

  const renderExperienceItem = (exp: Experience, rejected = false) => (
    <ExperienceListItem
      key={exp.id}
      experience={exp}
      locations={locationsByExperience[exp.id]}
      locationsResolved={locationsResolved}
      isLocationVisited={isLocationVisited}
      // Hover is not passed down. It arrives at the row and at the place from
      // the store, each subscribing to its own boolean, so a mouse move does not
      // re-render this list to hand a new prop to every row it holds.
      isSelected={selectedExperienceId === exp.id}
      locationRefs={locationRefs}
      itemRefs={itemRefs}
      isCollapsed={collapsedExperienceIds.has(exp.id)}
      onToggleCollapse={toggleCollapsedExperience}
      showCheckbox={isAuthenticated}
      isLoading={isMutating}
      onHover={handleHover}
      onLeave={handleLeave}
      onClick={handleClick}
      onLocationVisitedToggle={handleLocationVisitedToggle}
      onToggleAllLocations={handleToggleAllLocations}
      onLocationHover={handleLocationHover}
      isRejected={rejected}
      onCurate={hasCuratorScope ? handleCurate : undefined}
      onUnreject={hasCuratorScope && rejected && regionId ? handleUnreject : undefined}
      onRemoveFromRegion={hasCuratorScope && rejected && regionId ? handleRemoveFromRegion : undefined}
      onCardOpened={handleCardOpened}
      // Rejected rows render outside the virtualiser and carry no `data-index`,
      // so there is nothing for it to measure them against.
      onCardLayout={rejected ? undefined : measureRow}
    />
  );

  return (
    <Box>
      {/* Curator: Add experience of a new category */}
      {hasCuratorScope && regionId && (
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AssignIcon />}
            onClick={() => setAddDialogState({ open: true, defaultTab: 0 })}
          >
            Add experience of a new category
          </Button>
        </Box>
      )}

      {/* Panned away from everything. Said in words rather than left as blank
          space, because an empty list under a region's name reads as "this region
          is empty" — which is false, and the notice below carries the count and
          the way back (#553). */}
      {listedExperiences.length === 0 && activeExperiences.length > 0 && (
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            Nothing in this view.
          </Typography>
        </Box>
      )}

      {/* The windowed list. Its height is the virtualiser's estimate of the whole
          sequence, so the scrollbar means what it always did, while only the rows
          in view — plus `overscan` — are mounted. Still a `List`, and each row is
          one `li` of it: the row's own content renders as `div`s, so a reader
          using a screen reader hears one item per row rather than a list whose
          items are nested inside anonymous boxes. */}
      <List
        disablePadding
        sx={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualItems.map((virtualRow) => {
          const row = flatRows[virtualRow.index];
          if (!row) return null;
          return (
            <VirtualRow
              key={virtualRow.key}
              virtualizer={virtualizer}
              index={virtualRow.index}
              start={virtualRow.start}
            >
              {row.kind === 'header'
                ? renderGroupHeader(row.group)
                : renderExperienceItem(row.exp)}
            </VirtualRow>
          );
        })}
      </List>

      {/* Rejected Section (curator only) */}
      {hasCuratorScope && (
        <RejectedSection
          experiences={rejectedExperiences}
          open={rejectedSectionOpen}
          onToggle={() => setRejectedSectionOpen(!rejectedSectionOpen)}
          renderRow={(exp) => renderExperienceItem(exp, true)}
        />
      )}

      {/* Curation Dialog (shared: edit, reject/unreject, take a verdict back) */}
      <CurationDialog
        experience={curationTarget}
        regionId={regionId}
        onClose={closeCuration}
      />

      {/* Add Experience to Region Dialog */}
      {regionId && (
        <AddExperienceDialog
          open={addDialogState.open}
          onClose={closeAddDialog}
          regionId={regionId}
          regionName={selectedRegion?.name}
          defaultCategoryId={addDialogState.defaultCategoryId}
          defaultTab={addDialogState.defaultTab}
        />
      )}
      {/* Last, not first: it answers "what else was here", which is a
          question you ask after reading what is here. */}
      {viewNotice}
      {lostNotice}
    </Box>
  );
}
