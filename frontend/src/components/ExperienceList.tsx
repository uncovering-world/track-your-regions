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

import { useMemo, useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Checkbox,
  Collapse,
  CircularProgress,
  IconButton,
  Button,
  Chip,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  ExpandLess,
  ExpandMore,
  Place as PlaceIcon,
  CheckCircle as CheckCircleIcon,
  MenuBook as WikiIcon,
  Language as WebsiteIcon,
  IndeterminateCheckBox as PartialIcon,
  LocationOn as LocationIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
  Block as RejectIcon,
  Undo as UnrejectIcon,
  PlaylistAdd as AssignIcon,
  Tune as CurateIcon,
  LinkOff as RemoveFromRegionIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useExperienceContext, extractImageUrl, toThumbnailUrl } from '../hooks/useExperienceContext';
import { useAuth } from '../hooks/useAuth';
import { useVisitedExperiences, useVisitedLocations, useExperienceVisitedStatus, useViewedTreasures } from '../hooks/useVisitedExperiences';
import {
  fetchExperience,
  fetchExperienceLocations,
  fetchExperienceTreasures,
  fetchExperienceCategories,
  unrejectExperience,
  removeExperienceFromRegion,
  type Experience,
  type VisitedStatus,
} from '../api/experiences';
import { useNavigation } from '../hooks/useNavigation';
import { CurationDialog } from './shared/CurationDialog';
import { AddExperienceDialog } from './shared/AddExperienceDialog';

const NEW_BADGE_DAYS = 7;

function isNewExperience(createdAt?: string): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - NEW_BADGE_DAYS);
  return created > cutoff;
}

// Category colors matching ExperienceMarkers
const categoryColors: Record<string, string> = {
  cultural: '#8B5CF6',
  natural: '#10B981',
  mixed: '#F59E0B',
};

interface ExperienceGroup {
  categoryName: string;
  categoryPriority: number;
  experiences: Experience[];
}

interface ExperienceListProps {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
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
  } = useVisitedLocations();

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
      queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', regionId] });
    },
  });

  const removeFromRegionMutation = useMutation({
    mutationFn: ({ experienceId, rId }: { experienceId: number; rId: number }) =>
      removeExperienceFromRegion(experienceId, rId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', regionId] });
      queryClient.invalidateQueries({ queryKey: ['discover-region-counts'] });
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
        // Calculate position to center the element in the container
        const elementRect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const elementRelativeTop = elementRect.top - containerRect.top + container.scrollTop;
        const scrollTarget = elementRelativeTop - (container.clientHeight / 2) + (element.offsetHeight / 2);

        container.scrollTo({
          top: Math.max(0, scrollTarget),
          behavior: 'smooth'
        });
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
          const elementRect = element.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const elementRelativeTop = elementRect.top - containerRect.top + container.scrollTop;
          // Scroll to put the item at the top with a small padding
          const scrollTarget = elementRelativeTop - 8;

          container.scrollTo({
            top: Math.max(0, scrollTarget),
            behavior: 'smooth'
          });
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

  if (experiencesLoading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
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
    <Box
      key={exp.id}
      ref={(el: HTMLDivElement | null) => {
        if (el) {
          itemRefs.current.set(exp.id, el);
        } else {
          itemRefs.current.delete(exp.id);
        }
      }}
    >
      <ExperienceListItem
        experience={exp}
        regionId={regionId}
        isHovered={hoveredExperienceId === exp.id}
        isSelected={selectedExperienceId === exp.id}
        hoveredLocationId={hoveredLocationId}
        locationRefs={locationRefs}
        showCheckbox={isAuthenticated}
        isLoading={isMarking || isUnmarking || isMarkingLocation || isUnmarkingLocation}
        onHover={() => setHoveredFromList(exp.id, null)}
        onLeave={() => setHoveredFromList(null, null)}
        onClick={() => {
          const isClosing = selectedExperienceId === exp.id;
          toggleSelectedExperience(exp.id);
          if (isClosing) {
            triggerFitRegion();
          } else {
            triggerFlyTo(exp.id);
          }
        }}
        onLocationVisitedToggle={(locationId, isVisited) => {
          if (isVisited) {
            unmarkLocationVisited(locationId);
          } else {
            markLocationVisited(locationId);
          }
        }}
        onToggleAllLocations={(experienceId, markAsVisited) => {
          if (markAsVisited) {
            markAllLocations({ experienceId, regionId: regionId ?? undefined });
          } else {
            unmarkAllLocations({ experienceId, regionId: regionId ?? undefined });
          }
        }}
        onLocationHover={(locationId) => {
          if (locationId === null) {
            setHoveredFromList(null, null);
          } else {
            setHoveredFromList(exp.id, locationId);
          }
        }}
        isRejected={rejected}
        onCurate={hasCuratorScope ? () => setCurationTarget(exp) : undefined}
        onUnreject={hasCuratorScope && rejected && regionId
          ? () => unrejectMutation.mutate({ experienceId: exp.id, rId: regionId })
          : undefined}
        onRemoveFromRegion={hasCuratorScope && rejected && regionId
          ? () => removeFromRegionMutation.mutate({ experienceId: exp.id, rId: regionId })
          : undefined}
      />
    </Box>
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

// =============================================================================
// Individual List Item with Expandable Details
// =============================================================================

interface ExperienceListItemProps {
  experience: Experience;
  regionId: number | null;
  isHovered: boolean;
  isSelected: boolean;
  hoveredLocationId: number | null;
  locationRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  showCheckbox: boolean;
  isLoading: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
  onLocationVisitedToggle: (locationId: number, isVisited: boolean) => void;
  onToggleAllLocations: (experienceId: number, markAsVisited: boolean) => void;
  onLocationHover: (locationId: number | null) => void;
  onCurate?: () => void;
  onUnreject?: () => void;
  onRemoveFromRegion?: () => void;
  isRejected?: boolean;
}

function ExperienceListItem({
  experience,
  regionId,
  isHovered,
  isSelected,
  hoveredLocationId,
  locationRefs,
  showCheckbox,
  isLoading,
  onHover,
  onLeave,
  onClick,
  onLocationVisitedToggle,
  onToggleAllLocations,
  onLocationHover,
  onCurate,
  onUnreject,
  onRemoveFromRegion,
  isRejected,
}: ExperienceListItemProps) {
  const color = categoryColors[experience.category || ''] || '#6366F1';

  // Fetch locations to show count in title
  const { data: locationsData } = useQuery({
    queryKey: ['experience-locations', experience.id, regionId],
    queryFn: () => fetchExperienceLocations(experience.id, regionId ?? undefined),
    staleTime: 300000,
  });

  // Get visited status for this experience (location-level breakdown)
  const { locations: locationsWithVisitedStatus } = useExperienceVisitedStatus(experience.id);

  // Count locations and in-region locations
  const totalLocations = locationsData?.totalLocations ?? 0;
  const inRegionLocations = useMemo(() => {
    if (!locationsData?.locations) return [];
    return locationsData.locations.filter(l => l.in_region !== false);
  }, [locationsData?.locations]);
  const inRegionCount = inRegionLocations.length;
  const isMultiLocation = totalLocations > 1;

  // Compute IN-REGION visited status (not global)
  // This is what the root checkbox should reflect
  const inRegionVisitedStatus = useMemo((): 'not_visited' | 'partial' | 'visited' => {
    if (inRegionCount === 0) return 'not_visited';

    // Match in-region locations with their visited status
    const inRegionVisitedCount = inRegionLocations.filter(loc => {
      const visitedLoc = locationsWithVisitedStatus.find(v => v.id === loc.id);
      return visitedLoc?.isVisited;
    }).length;

    if (inRegionVisitedCount === 0) return 'not_visited';
    if (inRegionVisitedCount >= inRegionCount) return 'visited';
    return 'partial';
  }, [inRegionLocations, inRegionCount, locationsWithVisitedStatus]);

  // Derive checkbox state from in-region locations
  const isPartiallyVisited = inRegionVisitedStatus === 'partial';
  const isFullyVisited = inRegionVisitedStatus === 'visited';

  // Handle root checkbox click - always use batch operation (works for single and multi-location)
  const handleRootCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Toggle all in-region locations: if not all visited, mark all; else unmark all
    onToggleAllLocations(experience.id, inRegionVisitedStatus !== 'visited');
  };

  // Batch mark all in-region locations
  const handleMarkAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleAllLocations(experience.id, true);
  };

  // Batch unmark all in-region locations
  const handleUnmarkAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleAllLocations(experience.id, false);
  };

  return (
    <Box>
      {/* Main list item */}
      <ListItem
        sx={{
          pl: 2,
          cursor: 'pointer',
          bgcolor: isHovered ? 'action.hover' : isSelected ? 'primary.50' : 'transparent',
          borderLeft: isSelected ? 4 : 0,
          borderColor: 'primary.main',
          '&:hover': { bgcolor: 'action.hover' },
          borderBottom: isSelected ? 0 : '1px solid',
          borderBottomColor: 'divider',
        }}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onClick={onClick}
      >
        {/* Checkbox for visited status + batch buttons when partial */}
        {showCheckbox && (
          <ListItemIcon sx={{ minWidth: isPartiallyVisited ? 72 : 36, display: 'flex', alignItems: 'center' }}>
            <Checkbox
              edge="start"
              checked={isFullyVisited}
              indeterminate={isPartiallyVisited}
              disabled={isLoading}
              onClick={handleRootCheckboxClick}
              sx={{
                color: color,
                '&.Mui-checked': { color: '#10B981' },
                '&.MuiCheckbox-indeterminate': { color: '#F59E0B' }, // Amber for partial
              }}
            />
            {/* Batch buttons when partial - mark all / unmark all */}
            {isPartiallyVisited && (
              <Box sx={{ display: 'flex', ml: -0.5 }}>
                <Tooltip title="Mark all in region">
                  <IconButton
                    size="small"
                    onClick={handleMarkAll}
                    disabled={isLoading}
                    sx={{ p: 0.25, color: '#10B981' }}
                  >
                    <AddIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Unmark all in region">
                  <IconButton
                    size="small"
                    onClick={handleUnmarkAll}
                    disabled={isLoading}
                    sx={{ p: 0.25, color: '#EF4444' }}
                  >
                    <RemoveIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            )}
          </ListItemIcon>
        )}

        {/* Category color indicator */}
        <ListItemIcon sx={{ minWidth: 32 }}>
          <PlaceIcon sx={{ color, fontSize: 20 }} />
        </ListItemIcon>

        {/* Experience name */}
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: isSelected ? 600 : 500,
                  textDecoration: isFullyVisited ? 'line-through' : 'none',
                  color: isFullyVisited ? 'text.secondary' : isPartiallyVisited ? 'text.primary' : 'text.primary',
                  flex: 1,
                }}
              >
                {experience.name}
              </Typography>
              {isNewExperience(experience.created_at) && (
                <Chip
                  label="New"
                  size="small"
                  color="success"
                  sx={{
                    height: 18,
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    '& .MuiChip-label': { px: 0.5 },
                  }}
                />
              )}
              {isMultiLocation && (
                <Chip
                  label={inRegionCount === totalLocations ? totalLocations : `${inRegionCount}/${totalLocations}`}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                  variant="outlined"
                  color="info"
                />
              )}
            </Box>
          }
        />

        {/* Expand indicator */}
        {isSelected ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
      </ListItem>

      {/* Expanded details */}
      <Collapse in={isSelected} timeout="auto" unmountOnExit>
        <ExperienceExpandedDetails
          experience={experience}
          regionId={regionId}
          isFullyVisited={isFullyVisited}
          hoveredLocationId={hoveredLocationId}
          locationRefs={locationRefs}
          showCheckbox={showCheckbox}
          onToggleAllLocations={onToggleAllLocations}
          onLocationVisitedToggle={onLocationVisitedToggle}
          onLocationHover={onLocationHover}
          onCurate={onCurate}
          onUnreject={onUnreject}
          onRemoveFromRegion={onRemoveFromRegion}
          isRejected={isRejected}
        />
      </Collapse>
    </Box>
  );
}

// =============================================================================
// Expanded Details Panel
// =============================================================================

interface ExperienceExpandedDetailsProps {
  experience: Experience;
  regionId: number | null;
  isFullyVisited: boolean;
  hoveredLocationId: number | null;
  locationRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  showCheckbox: boolean;
  onToggleAllLocations: (experienceId: number, markAsVisited: boolean) => void;
  onLocationVisitedToggle: (locationId: number, isVisited: boolean) => void;
  onLocationHover: (locationId: number | null) => void;
  onCurate?: () => void;
  onUnreject?: () => void;
  onRemoveFromRegion?: () => void;
  isRejected?: boolean;
}

function ExperienceExpandedDetails({
  experience,
  regionId,
  isFullyVisited,
  hoveredLocationId,
  locationRefs,
  showCheckbox,
  onToggleAllLocations,
  onLocationVisitedToggle,
  onLocationHover,
  onCurate,
  onUnreject,
  onRemoveFromRegion,
  isRejected,
}: ExperienceExpandedDetailsProps) {
  const { isAuthenticated } = useAuth();

  // Fetch full details
  const { data: details } = useQuery({
    queryKey: ['experience', experience.id],
    queryFn: () => fetchExperience(experience.id),
    staleTime: 300000,
  });

  // Fetch locations with region filtering
  const { data: locationsData } = useQuery({
    queryKey: ['experience-locations', experience.id, regionId],
    queryFn: () => fetchExperienceLocations(experience.id, regionId ?? undefined),
    staleTime: 300000,
  });

  // Fetch contents (artworks) - only if experience has contents
  const { data: contentsData } = useQuery({
    queryKey: ['experience-contents', experience.id],
    queryFn: () => fetchExperienceTreasures(experience.id),
    staleTime: 300000,
  });

  // Get visited status with location details
  const {
    visitedStatus,
    visitedLocations,
    locations: locationsWithStatus,
  } = useExperienceVisitedStatus(experience.id);

  const totalLocations = locationsData?.totalLocations ?? 0;

  // Merge location data with visited status and in_region info
  // Use public locations as base, overlay visited status when authenticated
  const locationsWithRegionInfo = useMemo(() => {
    const publicLocs = locationsData?.locations || [];
    if (publicLocs.length === 0) return [];

    if (locationsWithStatus.length > 0) {
      // Auth data available — merge with public location data for in_region info
      return locationsWithStatus.map(loc => {
        const locationData = publicLocs.find(l => l.id === loc.id);
        return {
          ...loc,
          ordinal: locationData?.ordinal ?? 1,
          inRegion: locationData?.in_region ?? true,
        };
      });
    }

    // Not authenticated — use public locations with isVisited: false
    return publicLocs.map(loc => ({
      id: loc.id,
      name: loc.name,
      ordinal: loc.ordinal,
      longitude: loc.longitude,
      latitude: loc.latitude,
      isVisited: false,
      inRegion: loc.in_region ?? true,
    }));
  }, [locationsWithStatus, locationsData]);

  // Count in-region locations
  const inRegionCount = locationsWithRegionInfo.filter(l => l.inRegion).length;
  const inRegionVisitedCount = locationsWithRegionInfo.filter(l => l.inRegion && l.isVisited).length;

  const imageUrl = extractImageUrl(experience.image_url);
  const isMultiLocation = totalLocations > 1;

  const categoryColorMap: Record<string, { bg: string; text: string }> = {
    cultural: { bg: '#EDE9FE', text: '#7C3AED' },
    natural: { bg: '#D1FAE5', text: '#059669' },
    mixed: { bg: '#FEF3C7', text: '#D97706' },
  };

  const categoryStyle = categoryColorMap[experience.category || ''] || { bg: '#E0E7FF', text: '#4F46E5' };

  return (
    <Box
      sx={{
        pl: 2,
        pr: 2,
        py: 1.5,
        bgcolor: 'grey.50',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Image */}
      {imageUrl && (
        <Box
          component="img"
          src={toThumbnailUrl(imageUrl, 330)}
          alt={experience.name}
          sx={{
            width: '100%',
            maxHeight: 250,
            objectFit: 'contain',
            borderRadius: 1,
            mb: 2,
            bgcolor: 'grey.100',
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}

      {/* Category & Country chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        {experience.category && (
          <Chip
            label={experience.category}
            size="small"
            sx={{
              bgcolor: categoryStyle.bg,
              color: categoryStyle.text,
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          />
        )}
        {experience.country_names?.[0] && (
          <Chip label={experience.country_names[0]} size="small" variant="outlined" />
        )}
        {experience.in_danger && (
          <Chip label="In Danger" size="small" color="error" />
        )}
        {isMultiLocation && (
          <Chip
            label={`${inRegionCount}/${totalLocations} in region`}
            size="small"
            icon={<LocationIcon fontSize="small" />}
            variant="outlined"
            color="info"
          />
        )}
      </Box>

      {/* Description */}
      {experience.short_description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {experience.short_description}
        </Typography>
      )}

      {/* Date inscribed */}
      {details?.metadata?.dateInscribed != null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Inscribed: {String(details.metadata.dateInscribed as string | number)}
        </Typography>
      )}

      {/* Museum description */}
      {details?.description && !experience.short_description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {details.description}
        </Typography>
      )}

      {/* Artworks / Contents list */}
      {contentsData && contentsData.treasures.length > 0 && (
        <ArtworksList contents={contentsData.treasures} total={contentsData.total} experienceId={experience.id} />
      )}

      {/* Multi-location list */}
      {isMultiLocation && locationsWithRegionInfo.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {isAuthenticated && showCheckbox && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              In this region: {inRegionVisitedCount}/{inRegionCount} visited
            </Typography>
          )}
          {!isAuthenticated && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              {inRegionCount} location{inRegionCount !== 1 ? 's' : ''} in this region
            </Typography>
          )}
          <List
            dense
            disablePadding
            sx={{ bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
            onMouseLeave={() => onLocationHover(null)}
          >
            {locationsWithRegionInfo.map((loc) => {
              const isInRegion = loc.inRegion;
              const isLocationHovered = hoveredLocationId === loc.id;
              return (
                <Box
                  key={loc.id}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) {
                      locationRefs.current.set(loc.id, el);
                    } else {
                      locationRefs.current.delete(loc.id);
                    }
                  }}
                >
                  <ListItem
                    dense
                    sx={{
                      py: 0.5,
                      opacity: isInRegion ? 1 : 0.4,
                      bgcolor: isLocationHovered
                        ? 'primary.100'
                        : isInRegion ? 'transparent' : 'grey.100',
                      cursor: isInRegion ? 'pointer' : 'default',
                      '&:hover': isInRegion ? { bgcolor: 'action.hover' } : {},
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={() => isInRegion && onLocationHover(loc.id)}
                    secondaryAction={
                      isAuthenticated && showCheckbox ? (
                        <Checkbox
                          edge="end"
                          checked={loc.isVisited}
                          size="small"
                          disabled={!isInRegion}
                          onChange={() => isInRegion && onLocationVisitedToggle(loc.id, loc.isVisited)}
                          sx={{
                            '&.Mui-checked': { color: '#10B981' },
                          }}
                        />
                      ) : undefined
                    }
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <LocationIcon
                        fontSize="small"
                        color={isLocationHovered ? 'primary' : isInRegion ? 'action' : 'disabled'}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={loc.name || `Location ${loc.ordinal + 1}`}
                      secondary={!isInRegion ? 'Outside region' : null}
                      primaryTypographyProps={{
                        variant: 'body2',
                        sx: {
                          textDecoration: loc.isVisited ? 'line-through' : 'none',
                          color: isLocationHovered
                            ? 'primary.main'
                            : isInRegion
                              ? (loc.isVisited ? 'text.secondary' : 'text.primary')
                              : 'text.disabled',
                          fontWeight: isLocationHovered ? 600 : 400,
                        },
                      }}
                      secondaryTypographyProps={{
                        variant: 'caption',
                        sx: { fontSize: '0.65rem' },
                      }}
                    />
                  </ListItem>
                </Box>
              );
            })}
          </List>
        </Box>
      )}

      {/* Rejection reason (when viewing rejected item) */}
      {isRejected && experience.rejection_reason && (
        <Alert severity="warning" sx={{ mb: 1.5, py: 0 }} variant="outlined">
          <Typography variant="caption">
            Rejected: {experience.rejection_reason}
          </Typography>
        </Alert>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {isAuthenticated && showCheckbox && !isMultiLocation && (
          <Button
            variant={isFullyVisited ? 'outlined' : 'contained'}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onToggleAllLocations(experience.id, !isFullyVisited);
            }}
            startIcon={isFullyVisited ? <CheckCircleIcon /> : null}
            color={isFullyVisited ? 'success' : 'primary'}
          >
            {isFullyVisited ? 'Visited' : 'Mark Visited'}
          </Button>
        )}
        {isAuthenticated && showCheckbox && isMultiLocation && (
          <VisitedStatusButton
            visitedStatus={visitedStatus}
            visitedCount={visitedLocations}
            totalCount={totalLocations}
          />
        )}
        {(() => {
          const metadata = details?.metadata;
          const wikiUrl = typeof metadata?.wikipediaUrl === 'string' && metadata.wikipediaUrl ? metadata.wikipediaUrl : null;
          const websiteUrl = typeof metadata?.website === 'string' && metadata.website ? metadata.website : null;

          return (
            <>
              {wikiUrl && (
                <IconButton size="small" component="a" href={wikiUrl} target="_blank" rel="noopener noreferrer" title="Wikipedia">
                  <WikiIcon fontSize="small" />
                </IconButton>
              )}
              {websiteUrl && websiteUrl !== wikiUrl && (
                <IconButton size="small" component="a" href={websiteUrl} target="_blank" rel="noopener noreferrer" title="Official website">
                  <WebsiteIcon fontSize="small" />
                </IconButton>
              )}
            </>
          );
        })()}

        {/* Curator actions */}
        {onCurate && !isRejected && (
          <Tooltip title="Edit, reject, or manage this experience">
            <Button
              size="small"
              variant="outlined"
              startIcon={<CurateIcon />}
              onClick={(e) => { e.stopPropagation(); onCurate(); }}
              sx={{ ml: 'auto' }}
            >
              Curate
            </Button>
          </Tooltip>
        )}
        {onUnreject && isRejected && (
          <Button
            size="small"
            variant="outlined"
            color="success"
            startIcon={<UnrejectIcon />}
            onClick={(e) => { e.stopPropagation(); onUnreject(); }}
            sx={{ ml: 'auto' }}
          >
            Unreject
          </Button>
        )}
        {onRemoveFromRegion && isRejected && (
          <Tooltip title="Remove from this region entirely">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); onRemoveFromRegion(); }}
            >
              <RemoveFromRegionIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onCurate && isRejected && (
          <Tooltip title="Edit or manage this experience">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onCurate(); }}
            >
              <CurateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

// =============================================================================
// Artworks List (for museum experiences)
// =============================================================================

const ARTWORKS_INITIAL_LIMIT = 10;

function ArtworksList({ contents, total, experienceId }: { contents: import('../api/experiences').ExperienceTreasure[]; total: number; experienceId: number }) {
  const { setPreviewImageUrl } = useExperienceContext();
  const { isAuthenticated } = useAuth();
  const { viewedIds, viewedCount, markViewed, unmarkViewed } = useViewedTreasures(experienceId);
  const [showAll, setShowAll] = useState(false);
  const displayContents = showAll ? contents : contents.slice(0, ARTWORKS_INITIAL_LIMIT);
  const hasMore = total > ARTWORKS_INITIAL_LIMIT;

  const handleToggleViewed = (treasureId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewedIds.has(treasureId)) {
      unmarkViewed(treasureId);
    } else {
      markViewed({ treasureId, experienceId });
    }
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 600 }}>
        Notable works ({total}){isAuthenticated && viewedCount > 0 && ` \u00B7 ${viewedCount} seen`}
      </Typography>
      <Box
        sx={{
          bgcolor: 'white',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        {displayContents.map((content) => {
          const isViewed = viewedIds.has(content.id);
          return (
            <Box
              key={content.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-child': { borderBottom: 0 },
              }}
            >
              {isAuthenticated && (
                <Checkbox
                  size="small"
                  checked={isViewed}
                  onClick={(e) => handleToggleViewed(content.id, e)}
                  sx={{
                    p: 0.25,
                    flexShrink: 0,
                    '&.Mui-checked': { color: '#10B981' },
                  }}
                />
              )}
              {content.image_url && (
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'grey.100',
                    borderRadius: 0.5,
                    cursor: 'pointer',
                    opacity: isViewed ? 0.5 : 1,
                  }}
                  onMouseEnter={() => setPreviewImageUrl(toThumbnailUrl(content.image_url!, 500))}
                  onMouseLeave={() => setPreviewImageUrl(null)}
                >
                  <Box
                    component="img"
                    src={toThumbnailUrl(content.image_url)}
                    alt={content.name}
                    loading="lazy"
                    sx={{
                      maxWidth: 48,
                      maxHeight: 48,
                      objectFit: 'contain',
                      borderRadius: 0.5,
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </Box>
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                    lineHeight: 1.3,
                    textDecoration: isViewed ? 'line-through' : 'none',
                    color: isViewed ? 'text.secondary' : 'text.primary',
                  }}
                  noWrap
                >
                  {content.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {[
                    content.artist,
                    content.year,
                    content.treasure_type,
                  ].filter(Boolean).join(' \u00B7 ')}
                </Typography>
              </Box>
            </Box>
          );
        })}
        {hasMore && !showAll && (
          <Box
            sx={{ textAlign: 'center', py: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            onClick={() => setShowAll(true)}
          >
            <Typography variant="caption" color="primary">
              Show all {total} works
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * Chip showing visited status for multi-location experiences
 * (Individual locations are toggled via checkboxes in the expanded list)
 */
function VisitedStatusButton({
  visitedStatus,
  visitedCount,
  totalCount,
}: {
  visitedStatus: VisitedStatus;
  visitedCount: number;
  totalCount: number;
}) {
  const statusConfig = {
    not_visited: { label: `0/${totalCount} Visited`, color: 'default' as const },
    partial: { label: `${visitedCount}/${totalCount} Visited`, color: 'warning' as const },
    visited: { label: 'All Visited', color: 'success' as const },
  };

  const config = statusConfig[visitedStatus];

  return (
    <Chip
      size="small"
      label={config.label}
      color={config.color}
      variant={visitedStatus === 'visited' ? 'filled' : 'outlined'}
      icon={
        visitedStatus === 'visited' ? <CheckCircleIcon /> :
        visitedStatus === 'partial' ? <PartialIcon /> : undefined
      }
    />
  );
}
