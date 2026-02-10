import { useState, useCallback } from 'react';
import { TextField, List, ListItemButton, ListItemText, Paper, CircularProgress, Typography, InputAdornment } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '../hooks/useNavigation';
import { searchDivisions, searchRegions } from '../api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { AdministrativeDivisionWithPath } from '../types';
import type { RegionSearchResult } from '../api';

export function Search() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const { selectedWorldView, isCustomWorldView, setSelectedDivision, setSelectedRegion } = useNavigation();

  // Search divisions (GADM worldview)
  const { data: divisionResults = [], isLoading: divisionsLoading } = useQuery({
    queryKey: ['search', 'divisions', debouncedQuery, selectedWorldView?.id],
    queryFn: () => searchDivisions(debouncedQuery, selectedWorldView!.id),
    enabled: debouncedQuery.length >= 2 && !!selectedWorldView && !isCustomWorldView,
    staleTime: 60000,
  });

  // Search regions (custom worldview)
  const { data: regionResults = [], isLoading: regionsLoading } = useQuery({
    queryKey: ['search', 'regions', debouncedQuery, selectedWorldView?.id],
    queryFn: () => searchRegions(selectedWorldView!.id, debouncedQuery),
    enabled: debouncedQuery.length >= 2 && !!selectedWorldView && isCustomWorldView,
    staleTime: 60000,
  });

  const isLoading = isCustomWorldView ? regionsLoading : divisionsLoading;

  const handleSelectDivision = useCallback((division: AdministrativeDivisionWithPath) => {
    setSelectedDivision({
      id: division.id,
      name: division.name,
      parentId: division.parentId,
      hasChildren: division.hasChildren,
    });
    setQuery('');
  }, [setSelectedDivision]);

  const handleSelectRegion = useCallback((region: RegionSearchResult) => {
    setSelectedRegion({
      id: region.id,
      worldViewId: selectedWorldView!.id,
      name: region.name,
      description: region.description,
      parentRegionId: region.parentRegionId,
      color: region.color,
      hasSubregions: region.hasSubregions,
      isArchipelago: region.isArchipelago,
      focusBbox: region.focusBbox,
      anchorPoint: region.anchorPoint,
    });
    setQuery('');
  }, [setSelectedRegion, selectedWorldView]);

  const results = isCustomWorldView ? regionResults : divisionResults;

  return (
    <Paper elevation={0} sx={{ mb: 2, position: 'relative' }}>
      <TextField
        fullWidth
        size="small"
        placeholder="Search regions..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon color="action" />
            </InputAdornment>
          ),
          endAdornment: isLoading ? (
            <InputAdornment position="end">
              <CircularProgress size={20} />
            </InputAdornment>
          ) : null,
        }}
      />

      {debouncedQuery.length >= 2 && results.length > 0 && (
        <Paper
          elevation={3}
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          <List dense>
            {isCustomWorldView
              ? regionResults.map((region) => (
                  <ListItemButton
                    key={region.id}
                    onClick={() => handleSelectRegion(region)}
                  >
                    <ListItemText
                      primary={region.name}
                      secondary={region.path}
                      secondaryTypographyProps={{
                        sx: {
                          fontSize: '0.75rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }
                      }}
                    />
                  </ListItemButton>
                ))
              : divisionResults.map((division) => (
                  <ListItemButton
                    key={division.id}
                    onClick={() => handleSelectDivision(division)}
                  >
                    <ListItemText
                      primary={division.name}
                      secondary={division.path}
                      secondaryTypographyProps={{
                        sx: {
                          fontSize: '0.75rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }
                      }}
                    />
                  </ListItemButton>
                ))
            }
          </List>
        </Paper>
      )}

      {debouncedQuery.length >= 2 && !isLoading && results.length === 0 && (
        <Paper elevation={3} sx={{ position: 'absolute', top: '100%', left: 0, right: 0, p: 2, zIndex: 1000 }}>
          <Typography variant="body2" color="text.secondary" align="center">
            No results found
          </Typography>
        </Paper>
      )}
    </Paper>
  );
}
