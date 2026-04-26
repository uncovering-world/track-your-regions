import { useMemo } from 'react';
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
import { getCategoryPrimaryColor, VISITED_GREEN, PARTIAL_AMBER } from '../../utils/categoryColors';
import { ExperienceExpandedDetails } from './ExperienceExpandedDetails';
import { isNewExperience, resolveRowBgColor } from './utils';

export interface ExperienceListItemProps {
  experience: Experience;
  locations?: ExperienceLocation[];
  isLocationVisited: (locationId: number) => boolean;
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

export function ExperienceListItem({
  experience,
  locations,
  isLocationVisited,
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
    <Box>
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
          locations={locations}
          isLocationVisited={isLocationVisited}
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
