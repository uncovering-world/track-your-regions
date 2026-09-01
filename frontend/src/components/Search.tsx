/**
 * The navigation pane's search: regions, and the places inside them (#592).
 *
 * Two questions with one box. Regions are searched inside the world view the
 * reader is in — a region belongs to one. Experiences are searched across the
 * whole catalogue, because a name is a name wherever the object sits, and each
 * answer says whether this world view can open it;
 * `ExperienceSearchResults` carries that rule.
 */

import { useState, useCallback } from 'react';
import { TextField, List, ListItemButton, ListItemText, ListSubheader, Paper, CircularProgress, Typography, InputAdornment } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '../hooks/useNavigation';
import { useAppAddress } from '../hooks/useAppAddress';
import { searchDivisions, searchRegions } from '../api';
import { searchExperiences, type ExperienceRegionRef, type ExperienceSearchResult } from '../api/experiences';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ExperienceSearchResults } from './ExperienceSearchResults';
import type { AdministrativeDivisionWithPath } from '../types';
import type { RegionSearchResult } from '../api';

/** Enough to be a name rather than a letter, and what the API itself requires. */
const MIN_QUERY = 2;
/** A jump-to list, not a browse: the region's own list is where everything is. */
const EXPERIENCE_LIMIT = 10;

export function Search() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const { selectedWorldView, isCustomWorldView, setSelectedDivision, setSelectedRegion } = useNavigation();
  const { address, go } = useAppAddress();

  // Search divisions (GADM worldview)
  const { data: divisionResults = [], isLoading: divisionsLoading } = useQuery({
    queryKey: ['search', 'divisions', debouncedQuery, selectedWorldView?.id],
    queryFn: () => searchDivisions(debouncedQuery, selectedWorldView!.id),
    enabled: debouncedQuery.length >= MIN_QUERY && !!selectedWorldView && !isCustomWorldView,
    staleTime: 60000,
  });

  // Search regions (custom worldview)
  const { data: regionResults = [], isLoading: regionsLoading } = useQuery({
    queryKey: ['search', 'regions', debouncedQuery, selectedWorldView?.id],
    queryFn: () => searchRegions(selectedWorldView!.id, debouncedQuery),
    enabled: debouncedQuery.length >= MIN_QUERY && !!selectedWorldView && isCustomWorldView,
    staleTime: 60000,
  });

  // Search experiences — the whole catalogue, and so keyed on the query alone:
  // the same answer serves every world view, and which of its rows can be
  // opened is decided when they are drawn rather than when they are fetched.
  const { data: experienceSearch, isLoading: experiencesLoading } = useQuery({
    queryKey: ['search', 'experiences', debouncedQuery],
    queryFn: () => searchExperiences(debouncedQuery, EXPERIENCE_LIMIT),
    enabled: debouncedQuery.length >= MIN_QUERY,
    staleTime: 60000,
  });
  const experienceResults = experienceSearch?.results ?? [];

  const isLoading = (isCustomWorldView ? regionsLoading : divisionsLoading) || experiencesLoading;

  const handleSelectDivision = useCallback((division: AdministrativeDivisionWithPath) => {
    setSelectedDivision({
      id: division.id,
      name: division.name,
      parentId: division.parentId,
      hasChildren: division.hasChildren,
      focusBbox: division.focusBbox,
      anchorPoint: division.anchorPoint,
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
      usesHull: region.usesHull,
      focusBbox: region.focusBbox,
      anchorPoint: region.anchorPoint,
    });
    setQuery('');
  }, [setSelectedRegion, selectedWorldView]);

  /**
   * Open the card where this world view holds it: one address, written whole.
   *
   * The region is not selected here first — the address *is* the selection
   * (`useAddressedRegion`), and writing both would be two steps for one thing
   * the visitor did. Pushed rather than replaced, so Back returns to where the
   * search was typed, and named, so the link reads as the place from the start
   * rather than after the list has answered.
   */
  const handleSelectExperience = useCallback(
    (result: ExperienceSearchResult, region: ExperienceRegionRef) => {
      go({
        mode: address?.mode ?? 'map',
        worldViewId: region.world_view_id,
        regionId: region.id,
        experienceId: result.id,
        categoryId: null,
      }, { names: { region: region.name, experience: result.name } });
      setQuery('');
    },
    [address?.mode, go],
  );

  /** The default world view owns no regions, so nothing is openable under it. */
  const openableWorldViewId = isCustomWorldView ? selectedWorldView?.id ?? null : null;

  const regionRows = isCustomWorldView ? regionResults : divisionResults;
  const hasResults = regionRows.length > 0 || experienceResults.length > 0;

  return (
    <Paper elevation={0} sx={{ mb: 2, position: 'relative' }}>
      <TextField
        fullWidth
        size="small"
        placeholder="Search regions and experiences..."
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

      {debouncedQuery.length >= MIN_QUERY && hasResults && (
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
          {regionRows.length > 0 && (
            <List
              dense
              subheader={(
                <ListSubheader disableSticky sx={{ lineHeight: '28px' }}>
                  {isCustomWorldView ? 'Regions' : 'Divisions'}
                </ListSubheader>
              )}
            >
              {isCustomWorldView
                ? regionResults.map((region) => (
                    <PlaceRow
                      key={region.id}
                      name={region.name}
                      path={region.path}
                      onClick={() => handleSelectRegion(region)}
                    />
                  ))
                : divisionResults.map((division) => (
                    <PlaceRow
                      key={division.id}
                      name={division.name}
                      path={division.path}
                      onClick={() => handleSelectDivision(division)}
                    />
                  ))
              }
            </List>
          )}

          <ExperienceSearchResults
            results={experienceResults}
            worldViewId={openableWorldViewId}
            onSelect={handleSelectExperience}
          />
        </Paper>
      )}

      {debouncedQuery.length >= MIN_QUERY && !isLoading && !hasResults && (
        <Paper elevation={3} sx={{ position: 'absolute', top: '100%', left: 0, right: 0, p: 2, zIndex: 1000 }}>
          <Typography variant="body2" color="text.secondary" align="center">
            No results found
          </Typography>
        </Paper>
      )}
    </Paper>
  );
}

/** A region or a division: the same row either way, and one click each. */
function PlaceRow({ name, path, onClick }: { name: string; path?: string; onClick: () => void }) {
  return (
    <ListItemButton onClick={onClick}>
      <ListItemText
        primary={name}
        secondary={path}
        secondaryTypographyProps={{
          sx: {
            fontSize: '0.75rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      />
    </ListItemButton>
  );
}
