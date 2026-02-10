import { useCallback, useRef } from 'react';
import {
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Paper,
  Typography,
  CircularProgress,
  Box,
  IconButton,
  Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigation } from '../hooks/useNavigation';
import { useVisitedRegions } from '../hooks/useVisitedRegions';
import { fetchRootDivisions, fetchSubdivisions, fetchViewDivisions, fetchSubregions, fetchRootRegions } from '../api';
import type { AdministrativeDivision, Region } from '../types';

export function RegionList() {
  const {
    selectedWorldView,
    selectedDivision,
    setSelectedDivision,
    selectedView,
    hoveredRegionId,
    setHoveredRegionId,
    isCustomWorldView,
    selectedRegion,
    setSelectedRegion,
    rootRegions,
    rootRegionsLoading,
  } = useNavigation();

  // Visited regions tracking (only for custom world views)
  const { isVisited, toggleVisited } = useVisitedRegions(
    isCustomWorldView ? selectedWorldView?.id : undefined
  );

  const parentRef = useRef<HTMLDivElement>(null);

  // Fetch divisions for GADM hierarchy
  const { data: divisions = [], isLoading: divisionsLoading } = useQuery({
    queryKey: ['divisions', selectedWorldView?.id, selectedDivision?.id, selectedView?.id],
    queryFn: async () => {
      if (!selectedWorldView) return [];

      // If a view is selected, show view divisions
      if (selectedView) {
        return fetchViewDivisions(selectedView.id);
      }

      // If a division is selected, show its subdivisions
      if (selectedDivision) {
        return fetchSubdivisions(selectedDivision.id, selectedWorldView.id);
      }

      // Otherwise show root divisions
      return fetchRootDivisions(selectedWorldView.id);
    },
    enabled: !!selectedWorldView && !isCustomWorldView,
  });

  // Fetch subregions for selected region (only if it has subregions)
  const { data: subregions = [], isLoading: subregionsLoading } = useQuery({
    queryKey: ['subregions', selectedRegion?.id],
    queryFn: () => fetchSubregions(selectedRegion!.id),
    enabled: isCustomWorldView && !!selectedRegion && selectedRegion.hasSubregions === true,
  });

  // Fetch siblings for leaf regions (regions with same parent)
  // Also runs if hasSubregions is undefined (treat as no subregions)
  const { data: siblings = [], isLoading: siblingsLoading } = useQuery({
    queryKey: ['subregions', selectedRegion?.parentRegionId ?? 'root'],
    queryFn: () => selectedRegion?.parentRegionId
      ? fetchSubregions(selectedRegion.parentRegionId)
      : fetchRootRegions(selectedWorldView!.id),
    enabled: isCustomWorldView && !!selectedRegion && selectedRegion.hasSubregions !== true,
  });

  // Use appropriate data based on world view type
  const isLoading = isCustomWorldView
    ? (selectedRegion
        ? (selectedRegion.hasSubregions === true ? subregionsLoading : siblingsLoading)
        : rootRegionsLoading)
    : divisionsLoading;

  // For custom world views:
  // - If no region selected: show root regions (for navigation)
  // - If region with subregions selected: show subregions
  // - If leaf region selected: show siblings
  const regions = isCustomWorldView
    ? (selectedRegion
        ? (selectedRegion.hasSubregions === true ? subregions : siblings)
        : rootRegions)
    : [];

  // Virtual list for performance
  const itemCount = isCustomWorldView ? regions.length : divisions.length;
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const handleDivisionClick = useCallback((division: AdministrativeDivision) => {
    setSelectedDivision(division);
  }, [setSelectedDivision]);

  const handleRegionClick = useCallback((region: Region) => {
    // Only navigate into regions that have subregions
    // For leaf regions, just select them (they'll be highlighted on map)
    if (region.hasSubregions) {
      setSelectedRegion(region);
    } else {
      // For leaf regions, we still set them as selected for highlighting
      // but we don't try to fetch subregions
      setSelectedRegion(region);
    }
  }, [setSelectedRegion]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Show message if no items
  if (itemCount === 0) {
    return (
      <Paper sx={{ p: 2 }}>
        <Typography color="text.secondary" align="center">
          {isCustomWorldView
            ? (selectedRegion ? 'No subregions' : 'No regions defined. Click Edit to add regions.')
            : (selectedDivision ? 'No subdivisions' : 'No divisions found')
          }
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      ref={parentRef}
      sx={{
        height: 400,
        overflow: 'auto',
        border: 1,
        borderColor: 'grey.300',
      }}
    >
      <List
        sx={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          if (isCustomWorldView) {
            // Render region item (custom world view)
            const region = regions[virtualRow.index];
            const isHovered = hoveredRegionId === region.id;
            const visited = isVisited(region.id);
            return (
              <ListItemButton
                key={region.id}
                onClick={() => handleRegionClick(region)}
                onMouseEnter={() => setHoveredRegionId(region.id)}
                onMouseLeave={() => setHoveredRegionId(null)}
                selected={isHovered}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  backgroundColor: visited
                    ? 'rgba(76, 175, 80, 0.1)'
                    : (isHovered ? 'action.hover' : 'transparent'),
                  borderLeft: `4px solid ${region.color || '#3388ff'}`,
                }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: region.color || '#3388ff' }} />
                </ListItemIcon>
                <ListItemText
                  primary={region.name}
                  primaryTypographyProps={{
                    noWrap: true,
                    sx: { fontSize: '0.9rem' },
                  }}
                />
                <Tooltip title={visited ? 'Mark as not visited' : 'Mark as visited'}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVisited(region.id);
                    }}
                    sx={{
                      ml: 1,
                      color: visited ? 'success.main' : 'action.disabled',
                    }}
                  >
                    {visited ? (
                      <CheckCircleIcon fontSize="small" />
                    ) : (
                      <CheckCircleOutlineIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              </ListItemButton>
            );
          } else {
            // Render division item (GADM)
            const division = divisions[virtualRow.index];
            const isHovered = hoveredRegionId === division.id;
            return (
              <ListItemButton
                key={division.id}
                onClick={() => handleDivisionClick(division)}
                onMouseEnter={() => setHoveredRegionId(division.id)}
                onMouseLeave={() => setHoveredRegionId(null)}
                selected={isHovered}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  backgroundColor: isHovered ? 'action.hover' : 'transparent',
                }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Box
                    sx={{
                      width: division.hasChildren ? 10 : 8,
                      height: division.hasChildren ? 10 : 8,
                      borderRadius: '50%',
                      bgcolor: division.hasChildren ? 'primary.main' : 'grey.400',
                    }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={division.name}
                  primaryTypographyProps={{
                    noWrap: true,
                    sx: { fontSize: '0.9rem' },
                  }}
                />
              </ListItemButton>
            );
          }
        })}
      </List>
    </Paper>
  );
}
