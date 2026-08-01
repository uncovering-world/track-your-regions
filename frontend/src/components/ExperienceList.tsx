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
import { ownedHoveredLocationId } from './ExperienceList/utils';
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
  const { isAuthenticated, isCurator } = useAuth();
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
  const { locationsByExperience, locationsResolved } = useRegionLocations(regionId);

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

  // Reset when region changes
  const hasAutoExpanded = useRef(false);
  const prevRegionId = useRef(regionId);
  useEffect(() => {
    if (regionId !== prevRegionId.current) {
      prevRegionId.current = regionId;
      hasAutoExpanded.current = false;
      setExpandedGroups(new Set());
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

  // Scroll to item only when hovered from map marker (not from list hover)
  // Use manual scrolling to avoid affecting page scroll
  // If hoveredLocationId is set and the location is visible, scroll to it; otherwise scroll to the experience
  useEffect(() => {
    if (hoveredExperienceId && hoverSource === 'marker' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;

      // Try to get the location element first (if expanded), then fall back to experience
      let element: HTMLDivElement | undefined;
      if (hoveredLocationId) {
        element = locationRefs.current.get(hoveredLocationId);
      }
      // Fall back to experience item if location ref not found (not expanded)
      if (!element) {
        element = itemRefs.current.get(hoveredExperienceId);
      }

      if (element) {
        scrollToCenter(container, element);
      }
    }
  }, [hoveredExperienceId, hoveredLocationId, hoverSource, scrollContainerRef]);

  // Scroll selected item to TOP when clicked so description is visible
  // Wait for Collapse animation to complete before scrolling
  useEffect(() => {
    if (selectedExperienceId && scrollContainerRef.current) {
      const container = scrollContainerRef.current;

      // Wait for Collapse animation to finish (MUI default is ~300ms)
      const timeoutId = setTimeout(() => {
        const element = itemRefs.current.get(selectedExperienceId);
        if (element && container) {
          scrollToTop(container, element);
        }
      }, 350);

      return () => clearTimeout(timeoutId);
    }
  }, [selectedExperienceId, scrollContainerRef]);

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

  const isMutating = isMarking || isUnmarking || isMarkingLocation || isUnmarkingLocation;

  if (experiencesLoading) {
    return <LoadingSpinner size={24} />;
  }

  if (activeExperiences.length === 0 && rejectedExperiences.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No experiences found in this region.
        </Typography>
      </Box>
    );
  }

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

      <List disablePadding>
        {groups.map((group) => (
        <Box key={group.categoryName}>
          {/* Group Header */}
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

          {/* Group Items */}
          <Collapse in={expandedGroups.has(group.categoryName)} timeout="auto" unmountOnExit>
            <List disablePadding>
              {group.experiences.map((exp) => renderExperienceItem(exp))}
            </List>
          </Collapse>
        </Box>
      ))}
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
              {rejectedExperiences.map((exp) => renderExperienceItem(exp, true))}
            </List>
          </Collapse>
        </Box>
      )}

      {/* Curation Dialog (shared: edit + reject/unreject) */}
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
    </Box>
  );
}
