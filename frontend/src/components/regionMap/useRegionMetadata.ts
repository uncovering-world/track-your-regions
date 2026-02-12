/**
 * Hook: region/division metadata queries + metadataById memo.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '../../hooks/useNavigation';
import {
  fetchLeafRegions,
  fetchSubregions,
  fetchRootDivisions,
  fetchSubdivisions,
} from '../../api';
import type { Region } from '../../types';

export function useRegionMetadata(
  viewingRegionId: 'all-leaf' | number,
  viewingParentId: 'root' | number,
) {
  const {
    selectedWorldView,
    selectedWorldViewId,
    isCustomWorldView,
    rootRegions,
  } = useNavigation();

  // Fetch region metadata for custom world views (no geometries)
  const { data: regionMetadata, isLoading: regionsLoading } = useQuery({
    queryKey: ['regionMetadata', selectedWorldViewId, viewingRegionId],
    queryFn: async () => {
      if (viewingRegionId === 'all-leaf') {
        return fetchLeafRegions(selectedWorldViewId!);
      }
      return fetchSubregions(viewingRegionId as number);
    },
    enabled: !!selectedWorldViewId && isCustomWorldView,
    staleTime: 30000,
  });

  // Fetch division metadata for GADM (no geometries)
  const { data: divisionMetadata, isLoading: divisionsLoading } = useQuery({
    queryKey: ['divisionMetadata', viewingParentId],
    queryFn: async () => {
      if (viewingParentId === 'root') {
        return fetchRootDivisions();
      }
      return fetchSubdivisions(viewingParentId as number);
    },
    enabled: !!selectedWorldView && !isCustomWorldView,
    staleTime: 300000,
  });

  const metadata = isCustomWorldView ? regionMetadata : divisionMetadata;
  const metadataLoading = isCustomWorldView ? regionsLoading : divisionsLoading;

  // Create a lookup map for metadata by ID
  // Include both current view metadata AND root regions for tooltip lookups
  const metadataById = useMemo(() => {
    const lookup: Record<number, {
      name: string;
      hasChildren?: boolean;
      hasSubregions?: boolean;
      color?: string;
      parentRegionId?: number | null;
      focusBbox?: [number, number, number, number] | null;
      anchorPoint?: [number, number] | null;
    }> = {};

    // Add root regions first (for hover tooltips when at root level)
    if (isCustomWorldView && rootRegions) {
      for (const region of rootRegions) {
        lookup[region.id] = {
          name: region.name,
          hasSubregions: region.hasSubregions,
          color: region.color ?? undefined,
          parentRegionId: region.parentRegionId,
          focusBbox: region.focusBbox,
          anchorPoint: region.anchorPoint,
        };
      }
    }

    // Add current view metadata (may override root regions, which is fine)
    if (metadata) {
      for (const item of metadata) {
        const region = item as Region;
        lookup[item.id] = {
          name: item.name,
          hasChildren: 'hasChildren' in item ? item.hasChildren : undefined,
          hasSubregions: 'hasSubregions' in item ? item.hasSubregions : undefined,
          color: 'color' in item ? region.color ?? undefined : undefined,
          parentRegionId: 'parentRegionId' in item ? region.parentRegionId : undefined,
          focusBbox: 'focusBbox' in item ? region.focusBbox : undefined,
          anchorPoint: 'anchorPoint' in item ? region.anchorPoint : undefined,
        };
      }
    }
    return lookup;
  }, [metadata, rootRegions, isCustomWorldView]);

  return { metadata, metadataLoading, metadataById };
}
