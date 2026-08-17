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
  ownedHoveredLocationId, lostHiddenLabel,
  flattenGroups, rowIndexByExperienceId, experienceIdsInVisibleRange,
  type ExperienceGroupLike,
} from './ExperienceList/utils';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Collapse,
  IconButton,
  Button,
  Tooltip,
  Link,
} from '@mui/material';
import {
  ExpandLess,
  ExpandMore,
  Add as AddIcon,
  Block as RejectIcon,
  PlaylistAdd as AssignIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useExperienceContext } from '../hooks/useExperienceContext';
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
import { scrollToCenter, scrollToTop } from '../utils/scrollUtils';
import { invalidateExperiences } from '../utils/queryInvalidation';
import { LoadingSpinner } from './shared/LoadingSpinner';
import { ExperienceListItem } from './ExperienceList/ExperienceListItem';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * How often, at most, the rows the window has held are reported as seen.
 *
 * Long enough that a scroll through a freshly published region is a handful of
 * requests rather than one per render, short enough that a reader who glances
 * and leaves has still been counted.
 */
const SEEN_FLUSH_MS = 800;

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
    hoveredExperienceId,
    hoveredLocationId,
    hoverSource,
    setHoveredFromList,
    selectedExperienceId,
    toggleSelectedExperience,
    triggerFlyTo,
    triggerFitRegion,
    setExpandedCategoryNames,
  } = useExperienceContext();
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
  // Which experiences the reader's window has held, for the New-badge impression
  // below. Accumulated across scrolling and reset per region.
  const [seenExperienceIds, setSeenExperienceIds] = useState<Set<number>>(() => new Set());
  // Rows seen since the last flush, and the flush itself. Declared here because
  // the region-change block below clears them, and that block runs during render.
  const pendingSeen = useRef<Set<number>>(new Set());
  const seenFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for scrolling to items (experiences and locations)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const locationRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Group active experiences by category_name, sorted by display_priority
  const groups = useMemo<ExperienceGroup[]>(() => {
    const groupMap = new Map<string, { experiences: Experience[]; priority: number }>();

    for (const exp of activeExperiences) {
      const categoryName = exp.category_name || 'Experiences';
      if (!groupMap.has(categoryName)) {
        groupMap.set(categoryName, { experiences: [], priority: exp.category_priority ?? 100 });
      }
      groupMap.get(categoryName)!.experiences.push(exp);
    }

    return Array.from(groupMap.entries())
      .map(([categoryName, { experiences: exps, priority }]) => ({ categoryName, categoryPriority: priority, experiences: exps }))
      .sort((a, b) => a.categoryPriority - b.categoryPriority);
  }, [activeExperiences]);

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
    // What the reader has laid eyes on belongs to the region they were in. Reset
    // here rather than in an effect for the same reason the rest of this block is
    // here: one render carrying region B's rows against A's seen-set would report
    // impressions for rows nobody has seen, and the server keeps the first one.
    // The rows still waiting to be flushed go with it, or region A's would be
    // reported once the timer came round against region B's list.
    setSeenExperienceIds(new Set());
    pendingSeen.current = new Set();
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

  // Where each experience sits, so the two scroll effects below can ask the
  // virtualiser for a row that has no element yet — the whole point of windowing
  // is that most rows do not.
  //
  // Read through a ref, the way `selectedIdRef` below already is, and deliberately
  // absent from those effects' dependencies. The map is rebuilt whenever the rows
  // change, and a change of rows is not a change of selection: depending on it
  // would scroll the reader back to the selected row every time a group is
  // expanded or the region's experiences are refetched.
  const rowIndexByExperience = useMemo(() => rowIndexByExperienceId(flatRows), [flatRows]);
  const rowIndexRef = useRef(rowIndexByExperience);
  rowIndexRef.current = rowIndexByExperience;

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
    // A guess, corrected by `measureElement` on every row that renders: a
    // collapsed experience is one line, an expanded one carries its locations
    // underneath and can be ten times taller. Without measurement the scrollbar
    // would jump as the reader expands rows.
    estimateSize: (i) => (flatRows[i]?.kind === 'header' ? 56 : 72),
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

  // Scroll to item only when hovered from map marker (not from list hover)
  // Use manual scrolling to avoid affecting page scroll
  // If hoveredLocationId is set and the location is visible, scroll to it; otherwise scroll to the experience
  useEffect(() => {
    if (hoveredExperienceId && hoverSource === 'marker' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;

      // A location element exists only inside a row that is both expanded and
      // rendered; prefer it, because it is the precise thing being hovered.
      const locationElement = hoveredLocationId
        ? locationRefs.current.get(hoveredLocationId)
        : undefined;
      if (locationElement) {
        scrollToCenter(container, locationElement);
        return;
      }

      // Otherwise ask the virtualiser rather than the DOM. This is the case
      // windowing creates: the row the marker points at is usually not rendered,
      // so `itemRefs` has nothing for it, and before this the hover silently
      // scrolled nowhere for every row outside the window.
      const index = rowIndexRef.current.get(hoveredExperienceId);
      if (index != null) {
        // `behavior` stays the virtualiser's default. The helpers this replaced
        // glided (`scrollUtils.ts` passes `smooth`), but TanStack documents smooth
        // scrolling as unsupported alongside the dynamic measurement the rows
        // need, and a jump to the right row beats a glide to a stale offset.
        virtualizer.scrollToIndex(index, { align: 'center' });
        return;
      }

      // Rendered but absent from the flat list, which is what a rejected row is:
      // those render outside the virtualiser, so they have an element and no
      // index. Keep the element path for them.
      const element = itemRefs.current.get(hoveredExperienceId);
      if (element) scrollToCenter(container, element);
    }
  }, [hoveredExperienceId, hoveredLocationId, hoverSource, scrollContainerRef, virtualizer]);

  // Scroll selected item to TOP when clicked so description is visible
  // Wait for Collapse animation to complete before scrolling
  useEffect(() => {
    if (selectedExperienceId && scrollContainerRef.current) {
      const container = scrollContainerRef.current;

      // The delay outlives the group animation it was written for: selecting a
      // row now expands it in place, and the row grows over a frame or two while
      // its locations mount and are measured. Scrolling before that lands on the
      // old height.
      const timeoutId = setTimeout(() => {
        const index = rowIndexRef.current.get(selectedExperienceId);
        if (index != null) {
          virtualizer.scrollToIndex(index, { align: 'start' });
          return;
        }
        const element = itemRefs.current.get(selectedExperienceId);
        if (element && container) scrollToTop(container, element);
      }, 350);

      return () => clearTimeout(timeoutId);
    }
  }, [selectedExperienceId, scrollContainerRef, virtualizer]);

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
    if (isClosing) {
      triggerFitRegion();
    } else {
      triggerFlyTo(exp.id);
    }
  }, [toggleSelectedExperience, triggerFitRegion, triggerFlyTo]);

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

  // Rows the reader's window has actually held, accumulated. Windowing is what
  // makes this answerable: before it, expanding a group of 467 stamped all 467 as
  // seen while the reader had passed ten, and the server keeps the *first*
  // impression — so those rows spent the reader's personal week unseen, which is
  // precisely what that week exists to prevent. Accumulated rather than "in view
  // now", because scrolling away does not unsee a row.
  //
  // State rather than a ref, so the memo below has something real to depend on:
  // a ref mutated in place tells React nothing, and the impressions call would
  // keep reporting the previous set.
  //
  // Flushed on a timer rather than per render, which is what windowing costs
  // here: the set used to change once per region and now changes as the reader
  // scrolls, and each change is a request. `authenticatedLimiter` allows 60 a
  // minute per IP across every authenticated call, and a curator publishing a
  // sync's arrivals in one go is precisely how a region comes to hold hundreds
  // of rows carrying the mark. Ids accumulate between flushes, so this bounds
  // how often the rows are reported, never which of them are.
  const virtualItems = virtualizer.getVirtualItems();
  // What the viewport intersects, which is not what is mounted: `virtualItems`
  // carries the `overscan` rows on either side, deliberately below the fold. Read
  // after `getVirtualItems()` so the range belongs to this render.
  const visibleRange = virtualizer.range;
  useEffect(() => {
    const fresh = experienceIdsInVisibleRange(flatRows, visibleRange)
      .filter(id => !seenExperienceIds.has(id) && !pendingSeen.current.has(id));
    for (const id of fresh) pendingSeen.current.add(id);
    if (pendingSeen.current.size === 0 || seenFlushTimer.current) return;
    seenFlushTimer.current = setTimeout(() => {
      seenFlushTimer.current = null;
      const batch = pendingSeen.current;
      pendingSeen.current = new Set();
      // Empty when a region change cleared the pending set while this was in
      // flight; setting state anyway would report the new region's list against
      // a set that gained nothing.
      if (batch.size === 0) return;
      setSeenExperienceIds(prev => {
        const next = new Set(prev);
        for (const id of batch) next.add(id);
        return next;
      });
    }, SEEN_FLUSH_MS);
  }, [visibleRange, flatRows, seenExperienceIds]);

  // A flush landing after the list is gone belongs to nobody.
  useEffect(() => () => {
    if (seenFlushTimer.current) clearTimeout(seenFlushTimer.current);
    seenFlushTimer.current = null;
    pendingSeen.current = new Set();
  }, []);

  const shownExperiences = useMemo(
    () => activeExperiences.filter(exp => seenExperienceIds.has(exp.id)),
    [activeExperiences, seenExperienceIds],
  );
  useNewBadgeImpressions(shownExperiences, isAuthenticated, user?.id);

  const isMutating = isMarking || isUnmarking || isMarkingLocation || isUnmarkingLocation;

  if (experiencesLoading) {
    return <LoadingSpinner size={24} />;
  }

  // Offered only where there is something behind it. Almost no region holds a
  // lost object, and a permanent control for a rare state is noise; a line that
  // appears when the region has one explains itself.
  const lostNoticeLabel = showLost
    ? 'Hide places that no longer exist'
    : lostHiddenLabel(lostHidden);
  const lostNotice = lostHidden > 0 || showLost ? (
    <Box sx={{ px: 2, pb: 1 }}>
      <Link
        component="button"
        variant="caption"
        underline="hover"
        onClick={() => setShowLost(!showLost)}
        sx={{ color: 'text.secondary' }}
      >
        {lostNoticeLabel}
      </Link>
    </Box>
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
    <ListItem
      component="div"
      onClick={() => toggleGroup(group.categoryName)}
      sx={{
        bgcolor: 'grey.100',
        cursor: 'pointer',
        '&:hover': { bgcolor: 'grey.200' },
      }}
    >
      <ListItemText
        primary={
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {group.categoryName} ({group.experiences.length})
          </Typography>
        }
      />
      {/* Per-source "+" button to create a new experience under this source */}
      {hasCuratorScope && regionId && (
        <Tooltip title={`Add new ${group.categoryName.toLowerCase().replace(/^top /, '')}`}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              const categoryId = categoryNameToId.get(group.categoryName);
              setAddDialogState({ open: true, defaultCategoryId: categoryId, defaultTab: 0 });
            }}
            sx={{ mr: 0.5 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {expandedGroups.has(group.categoryName) ? <ExpandLess /> : <ExpandMore />}
    </ListItem>
  );

  const renderExperienceItem = (exp: Experience, rejected = false) => (
    <ExperienceListItem
      key={exp.id}
      experience={exp}
      locations={locationsByExperience[exp.id]}
      locationsResolved={locationsResolved}
      isLocationVisited={isLocationVisited}
      isHovered={hoveredExperienceId === exp.id}
      isSelected={selectedExperienceId === exp.id}
      // Narrowed to this experience's own locations. Passed whole, a hover on
      // any location anywhere would change this prop for every row and undo
      // the memo for the entire list.
      hoveredLocationId={ownedHoveredLocationId(locationsByExperience[exp.id], hoveredLocationId)}
      locationRefs={locationRefs}
      itemRefs={itemRefs}
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
            <Box
              component="li"
              key={virtualRow.key}
              data-index={virtualRow.index}
              // Measured rather than assumed: a row's height changes when the
              // reader expands it, and `estimateSize` is only the first guess.
              ref={virtualizer.measureElement}
              sx={{
                listStyle: 'none',
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.kind === 'header'
                ? renderGroupHeader(row.group)
                : renderExperienceItem(row.exp)}
            </Box>
          );
        })}
      </List>

      {/* Rejected Section (curator only) */}
      {hasCuratorScope && rejectedExperiences.length > 0 && (
        <Box>
          <ListItem
            component="div"
            onClick={() => setRejectedSectionOpen(!rejectedSectionOpen)}
            sx={{
              bgcolor: 'error.50',
              cursor: 'pointer',
              '&:hover': { bgcolor: 'grey.200' },
              borderTop: '2px solid',
              borderColor: 'error.200',
            }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <RejectIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'error.main' }}>
                  Rejected ({rejectedExperiences.length})
                </Typography>
              }
            />
            {rejectedSectionOpen ? <ExpandLess /> : <ExpandMore />}
          </ListItem>
          <Collapse in={rejectedSectionOpen} timeout="auto" unmountOnExit>
            <List disablePadding>
              {/* One `li` per row here too. These rows are not windowed — they
                  are few, and they are the one path that reaches the scroll
                  effects' element fallback, having an element but no row index. */}
              {rejectedExperiences.map((exp) => (
                <Box component="li" key={exp.id} sx={{ listStyle: 'none' }}>
                  {renderExperienceItem(exp, true)}
                </Box>
              ))}
            </List>
          </Collapse>
        </Box>
      )}

      {/* Curation Dialog (shared: edit, reject/unreject, take a verdict back) */}
      <CurationDialog
        experience={curationTarget}
        regionId={regionId}
        onClose={() => setCurationTarget(null)}
      />

      {/* Add Experience to Region Dialog */}
      {regionId && (
        <AddExperienceDialog
          open={addDialogState.open}
          onClose={() => setAddDialogState({ open: false })}
          regionId={regionId}
          regionName={selectedRegion?.name}
          defaultCategoryId={addDialogState.defaultCategoryId}
          defaultTab={addDialogState.defaultTab}
        />
      )}
      {/* Last, not first: it answers "what else was here", which is a
          question you ask after reading what is here. */}
      {lostNotice}
    </Box>
  );
}
