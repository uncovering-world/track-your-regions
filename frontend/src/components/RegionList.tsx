import { useCallback, useRef } from 'react';
import {
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Paper,
  Typography,
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
import { fetchRootDivisions, fetchSubdivisions, fetchSubregions, fetchRootRegions } from '../api';
import { LoadingSpinner } from './shared/LoadingSpinner';
import type { AdministrativeDivision, Region, WorldView } from '../types';

async function fetchDivisionsForView(
  worldView: WorldView | null,
  selectedDivision: AdministrativeDivision | null,
): Promise<AdministrativeDivision[]> {
  if (!worldView) return [];
  if (selectedDivision) return fetchSubdivisions(selectedDivision.id, worldView.id);
  return fetchRootDivisions(worldView.id);
}

function pickLoadingFlag(args: {
  isCustomWorldView: boolean;
  selectedRegion: Region | null;
  divisionsLoading: boolean;
  rootRegionsLoading: boolean;
  subregionsLoading: boolean;
  siblingsLoading: boolean;
}): boolean {
  if (!args.isCustomWorldView) return args.divisionsLoading;
  if (!args.selectedRegion) return args.rootRegionsLoading;
  return args.selectedRegion.hasSubregions === true ? args.subregionsLoading : args.siblingsLoading;
}

function pickRegions(args: {
  isCustomWorldView: boolean;
  selectedRegion: Region | null;
  rootRegions: Region[];
  subregions: Region[];
  siblings: Region[];
}): Region[] {
  if (!args.isCustomWorldView) return [];
  if (!args.selectedRegion) return args.rootRegions;
  return args.selectedRegion.hasSubregions === true ? args.subregions : args.siblings;
}

function emptyListMessage(
  isCustomWorldView: boolean,
  selectedRegion: Region | null,
  selectedDivision: AdministrativeDivision | null,
): string {
  if (isCustomWorldView) {
    return selectedRegion ? 'No subregions' : 'No regions defined. Click Edit to add regions.';
  }
  return selectedDivision ? 'No subdivisions' : 'No divisions found';
}

export function RegionList() {
  const {
    selectedWorldView,
    selectedDivision,
    setSelectedDivision,
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

  const regionRowBackground = (visited: boolean, isHovered: boolean): string => {
    if (visited) return 'rgba(76, 175, 80, 0.1)';
    return isHovered ? 'action.hover' : 'transparent';
  };

  const parentRef = useRef<HTMLDivElement>(null);

  const renderDivisionRow = (
    division: AdministrativeDivision,
    virtualRow: { size: number; start: number },
  ) => {
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
  };

  const renderRegionRow = (
    region: Region,
    virtualRow: { size: number; start: number },
  ) => {
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
          backgroundColor: regionRowBackground(visited, isHovered),
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
            {visited
              ? <CheckCircleIcon fontSize="small" />
              : <CheckCircleOutlineIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </ListItemButton>
    );
  };

  // Fetch divisions for GADM hierarchy
  const { data: divisions = [], isLoading: divisionsLoading } = useQuery({
    queryKey: ['divisions', selectedWorldView?.id, selectedDivision?.id],
    queryFn: () => fetchDivisionsForView(selectedWorldView, selectedDivision),
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

  // For custom world views:
  // - If no region selected: show root regions (for navigation)
  // - If region with subregions selected: show subregions
  // - If leaf region selected: show siblings
  const isLoading = pickLoadingFlag({
    isCustomWorldView,
    selectedRegion,
    divisionsLoading,
    rootRegionsLoading,
    subregionsLoading,
    siblingsLoading,
  });
  const regions = pickRegions({
    isCustomWorldView,
    selectedRegion,
    rootRegions,
    subregions,
    siblings,
  });

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
    // Leaf regions get highlighted via selection; non-leaves drill in via the
    // selectedRegion-driven navigation effect.
    setSelectedRegion(region);
  }, [setSelectedRegion]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  // Show message if no items
  if (itemCount === 0) {
    return (
      <Paper sx={{ p: 2 }}>
        <Typography color="text.secondary" align="center">
          {emptyListMessage(isCustomWorldView, selectedRegion, selectedDivision)}
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
        {virtualizer.getVirtualItems().map((virtualRow) => isCustomWorldView
          ? renderRegionRow(regions[virtualRow.index], virtualRow)
          : renderDivisionRow(divisions[virtualRow.index], virtualRow))}
      </List>
    </Paper>
  );
}
