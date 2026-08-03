import { memo, useMemo } from 'react';
import {
  Box,
  Typography,
  ListItem,
  ListItemText,
  ListItemIcon,
  Checkbox,
  Collapse,
  IconButton,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  ExpandLess,
  ExpandMore,
  Place as PlaceIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
} from '@mui/icons-material';
import type {
  Experience,
  ExperienceLocation,
} from '../../api/experiences';
import { LifecycleChip } from '../shared/LifecycleChip';
import { getCategoryPrimaryColor, VISITED_GREEN, PARTIAL_AMBER } from '../../utils/categoryColors';
import { ExperienceExpandedDetails } from './ExperienceExpandedDetails';
import { isNewExperience, resolveRowBgColor } from './utils';

export interface ExperienceListItemProps {
  experience: Experience;
  locations?: ExperienceLocation[];
  /** The batch settled — an in-region count derived from `locations` is meaningful. */
  locationsResolved: boolean;
  isLocationVisited: (locationId: number) => boolean;
  isHovered: boolean;
  isSelected: boolean;
  hoveredLocationId: number | null;
  locationRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  /**
   * Registered by the row itself. The parent used to wrap each row in a `<Box>`
   * carrying this ref, which put one unmemoised MUI component per experience
   * back on the hover path — 148 of them re-rendering on every mouse move, worth
   * about 400 ms a hover even with this component memoised.
   */
  itemRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  showCheckbox: boolean;
  isLoading: boolean;
  // Every callback takes the experience it concerns rather than closing over it.
  // A closure would be a new function on each parent render, and this component
  // is memoised — one unstable prop and the memo does nothing.
  onHover: (experience: Experience) => void;
  onLeave: () => void;
  onClick: (experience: Experience) => void;
  onLocationVisitedToggle: (locationId: number, isVisited: boolean) => void;
  onToggleAllLocations: (experienceId: number, markAsVisited: boolean) => void;
  onLocationHover: (experienceId: number, locationId: number | null) => void;
  onCurate?: (experience: Experience) => void;
  onUnreject?: (experience: Experience) => void;
  onRemoveFromRegion?: (experience: Experience) => void;
  isRejected?: boolean;
}

/**
 * Memoised, and that is the point rather than a nicety: hovering one row changes
 * state the whole list reads, so without this every row in the region re-renders
 * its MUI subtree on every mouse move between rows. Measured at 200 experiences
 * before this: a single hover cost a 2.5 s frame, with React attributing 1.7 s
 * to MuiPaperRoot alone.
 *
 * The memo only holds while every prop is referentially stable across a parent
 * render — see the callback signatures above, and `hoveredLocationId`, which the
 * parent narrows to this experience's own locations so a location hover
 * elsewhere does not invalidate every row.
 */
function ExperienceListItemComponent({
  experience,
  locations,
  locationsResolved,
  isLocationVisited,
  isHovered,
  isSelected,
  hoveredLocationId,
  locationRefs,
  itemRefs,
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
  const color = getCategoryPrimaryColor(experience.category);

  // Use batch locations from parent (shared hook) — no per-item fetch
  const totalLocations = locations?.length ?? (experience.location_count ?? 0);
  const inRegionLocations = useMemo(() => {
    if (!locations) return [];
    return locations.filter(l => l.in_region !== false);
  }, [locations]);
  const inRegionCount = inRegionLocations.length;
  const isMultiLocation = totalLocations > 1;

  // Compute IN-REGION visited status using global isLocationVisited
  const inRegionVisitedStatus = useMemo((): 'not_visited' | 'partial' | 'visited' => {
    if (inRegionCount === 0) return 'not_visited';

    const inRegionVisitedCount = inRegionLocations.filter(loc => isLocationVisited(loc.id)).length;

    if (inRegionVisitedCount === 0) return 'not_visited';
    if (inRegionVisitedCount >= inRegionCount) return 'visited';
    return 'partial';
  }, [inRegionLocations, inRegionCount, isLocationVisited]);

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
    <Box
      ref={(el: HTMLDivElement | null) => {
        if (el) {
          itemRefs.current.set(experience.id, el);
        } else {
          itemRefs.current.delete(experience.id);
        }
      }}
    >
      {/* Main list item */}
      <ListItem
        sx={{
          pl: 2,
          cursor: 'pointer',
          bgcolor: resolveRowBgColor(isHovered, isSelected),
          borderLeft: isSelected ? 4 : 0,
          borderColor: 'primary.main',
          '&:hover': { bgcolor: 'action.hover' },
          borderBottom: isSelected ? 0 : '1px solid',
          borderBottomColor: 'divider',
        }}
        onMouseEnter={() => onHover(experience)}
        onMouseLeave={onLeave}
        onClick={() => onClick(experience)}
      >
        {/* Checkbox for visited status + batch buttons when partial.
            Disabled until the batch settles, and for a stronger reason than the
            chip's: the visited state is derived from in-region locations, so an
            unresolved batch makes `inRegionCount` 0, which short-circuits
            `inRegionVisitedStatus` to 'not_visited' — every row would render
            unchecked, indistinguishable from genuinely unvisited, and stay that
            way rather than flicker. The toggle inherits it: it passes
            `inRegionVisitedStatus !== 'visited'`, always true while unresolved,
            so a fully-visited experience could be re-marked but never unmarked
            and the click would look like it did nothing. */}
        {showCheckbox && (
          <ListItemIcon sx={{ minWidth: isPartiallyVisited ? 72 : 36, display: 'flex', alignItems: 'center' }}>
            <Checkbox
              edge="start"
              checked={isFullyVisited}
              indeterminate={isPartiallyVisited}
              disabled={isLoading || !locationsResolved}
              onClick={handleRootCheckboxClick}
              sx={{
                color: color,
                '&.Mui-checked': { color: VISITED_GREEN },
                '&.MuiCheckbox-indeterminate': { color: PARTIAL_AMBER }, // Amber for partial
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
                  color: isFullyVisited ? 'text.secondary' : 'text.primary',
                  flex: 1,
                }}
              >
                {experience.name}
              </Typography>
              <LifecycleChip state={experience} />
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
              {/* While the batch is unresolved the row shows the plain count it
                  already has from the experience, rather than an in-region
                  ratio it cannot know yet — `inRegionCount` would be 0 against
                  a denominator that arrived from somewhere else. */}
              {isMultiLocation && (
                <Chip
                  label={!locationsResolved || inRegionCount === totalLocations
                    ? totalLocations
                    : `${inRegionCount}/${totalLocations}`}
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
          locations={locations}
          locationsResolved={locationsResolved}
          isLocationVisited={isLocationVisited}
          isFullyVisited={isFullyVisited}
          hoveredLocationId={hoveredLocationId}
          locationRefs={locationRefs}
          showCheckbox={showCheckbox}
          onToggleAllLocations={onToggleAllLocations}
          onLocationVisitedToggle={onLocationVisitedToggle}
          onLocationHover={(locationId) => onLocationHover(experience.id, locationId)}
          onCurate={onCurate && (() => onCurate(experience))}
          onUnreject={onUnreject && (() => onUnreject(experience))}
          onRemoveFromRegion={onRemoveFromRegion && (() => onRemoveFromRegion(experience))}
          isRejected={isRejected}
        />
      </Collapse>
    </Box>
  );
}

export const ExperienceListItem = memo(ExperienceListItemComponent);
