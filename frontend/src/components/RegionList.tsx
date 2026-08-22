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
import { useRegionHoverActions, useRegionHoverSelector } from '../hooks/useRegionHover';
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

/** The placement the virtualiser hands a row: everything it needs to sit still. */
interface RowPlacement {
  size: number;
  start: number;
}

interface DivisionRowProps {
  division: AdministrativeDivision;
  placement: RowPlacement;
  onClick: (division: AdministrativeDivision) => void;
  /** The store's setter — stable, so hovering costs this row's render alone. */
  onHoverChange: (id: number | null) => void;
}

/**
 * One division row, subscribed to its own "am I the hovered one" boolean.
 *
 * Hover used to be state in `NavigationContext`, so crossing this list — or the
 * map, which shares the id — re-rendered the whole list and every other
 * consumer of that context per mouse move (#573). Now a move re-renders the row
 * entered and the row left, which is the invariant `regionHoverStore.test.tsx`
 * pins.
 */
function DivisionRow({ division, placement, onClick, onHoverChange }: DivisionRowProps) {
  const isHovered = useRegionHoverSelector(id => id === division.id);
  return (
    <ListItemButton
      onClick={() => onClick(division)}
      onMouseEnter={() => onHoverChange(division.id)}
      onMouseLeave={() => onHoverChange(null)}
      selected={isHovered}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${placement.size}px`,
        transform: `translateY(${placement.start}px)`,
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

interface RegionRowProps {
  region: Region;
  placement: RowPlacement;
  visited: boolean;
  onClick: (region: Region) => void;
  onHoverChange: (id: number | null) => void;
  onToggleVisited: (regionId: number) => void;
}

function regionRowBackground(visited: boolean, isHovered: boolean): string {
  if (visited) return 'rgba(76, 175, 80, 0.1)';
  return isHovered ? 'action.hover' : 'transparent';
}

/** One region row; the same subscription shape as `DivisionRow` above. */
function RegionRow({ region, placement, visited, onClick, onHoverChange, onToggleVisited }: RegionRowProps) {
  const isHovered = useRegionHoverSelector(id => id === region.id);
  return (
    <ListItemButton
      onClick={() => onClick(region)}
      onMouseEnter={() => onHoverChange(region.id)}
      onMouseLeave={() => onHoverChange(null)}
      selected={isHovered}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${placement.size}px`,
        transform: `translateY(${placement.start}px)`,
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
            onToggleVisited(region.id);
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
}

export function RegionList() {
  const {
    selectedWorldView,
    selectedDivision,
    setSelectedDivision,
    isCustomWorldView,
    selectedRegion,
    setSelectedRegion,
    rootRegions,
    rootRegionsLoading,
  } = useNavigation();
  // The setter alone: this component renders none of the hover, so a mouse
  // move across its rows — or across the map, which writes the same store —
  // must not re-render it. Each row subscribes to its own boolean instead.
  const { setHoveredRegionId } = useRegionHoverActions();

  // Visited regions tracking (only for custom world views)
  const { isVisited, toggleVisited } = useVisitedRegions(
    isCustomWorldView ? selectedWorldView?.id : undefined
  );

  const parentRef = useRef<HTMLDivElement>(null);

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
        {virtualizer.getVirtualItems().map((virtualRow) => {
          if (isCustomWorldView) {
            const region = regions[virtualRow.index];
            return (
              <RegionRow
                key={region.id}
                region={region}
                placement={virtualRow}
                visited={isVisited(region.id)}
                onClick={handleRegionClick}
                onHoverChange={setHoveredRegionId}
                onToggleVisited={toggleVisited}
              />
            );
          }
          const division = divisions[virtualRow.index];
          return (
            <DivisionRow
              key={division.id}
              division={division}
              placement={virtualRow}
              onClick={handleDivisionClick}
              onHoverChange={setHoveredRegionId}
            />
          );
        })}
      </List>
    </Paper>
  );
}
