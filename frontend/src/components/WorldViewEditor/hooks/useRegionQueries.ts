import { useQuery } from '@tanstack/react-query';
import {
  fetchRegions,
  fetchRegionMembers,
  searchDivisions,
} from '../../../api';
import type { Region, WorldView } from '../../../types';

interface UseRegionQueriesOptions {
  worldView: WorldView;
  open: boolean;
  selectedRegion: Region | null;
  debouncedSearch: string;
}

export function useRegionQueries({
  worldView,
  open,
  selectedRegion,
  debouncedSearch,
}: UseRegionQueriesOptions) {
  // Fetch regions for this worldView
  const { data: regions = [], isLoading: regionsLoading } = useQuery({
    queryKey: ['regions', worldView.id],
    queryFn: () => fetchRegions(worldView.id),
    enabled: open,
  });

  // Fetch members of selected region
  const { data: regionMembers = [], isLoading: membersLoading } = useQuery({
    queryKey: ['regionMembers', selectedRegion?.id],
    queryFn: () => fetchRegionMembers(selectedRegion!.id),
    enabled: !!selectedRegion,
    staleTime: 0, // Always consider stale to ensure refetch on invalidation
  });

  // Search for divisions to add (pass worldView.id for usage counting)
  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['search', debouncedSearch, worldView.id],
    queryFn: () => searchDivisions(debouncedSearch, worldView.id, 20),
    enabled: debouncedSearch.length >= 2,
  });

  return {
    regions,
    regionsLoading,
    regionMembers,
    membersLoading,
    searchResults,
    searchLoading,
  };
}
