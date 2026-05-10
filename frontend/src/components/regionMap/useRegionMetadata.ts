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
import type { AdministrativeDivision, Region } from '../../types';

interface MetadataEntry {
  name: string;
  hasChildren?: boolean;
  hasSubregions?: boolean;
  color?: string;
  parentRegionId?: number | null;
  focusBbox?: [number, number, number, number] | null;
  anchorPoint?: [number, number] | null;
}

type MetadataLookup = Record<number, MetadataEntry>;

function isRegion(item: { id: number; name: string }): item is Region {
  return 'hasSubregions' in item || 'parentRegionId' in item;
}

function addRootRegionsToLookup(lookup: MetadataLookup, rootRegions: Region[]): void {
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

function addRegionToLookup(lookup: MetadataLookup, region: Region): void {
  lookup[region.id] = {
    name: region.name,
    hasSubregions: region.hasSubregions,
    color: region.color ?? undefined,
    parentRegionId: region.parentRegionId,
    focusBbox: region.focusBbox,
    anchorPoint: region.anchorPoint,
  };
}

function addDivisionToLookup(lookup: MetadataLookup, division: AdministrativeDivision): void {
  lookup[division.id] = {
    name: division.name,
    hasChildren: division.hasChildren,
  };
}

function addMetadataItemsToLookup(
  lookup: MetadataLookup,
  metadata: Array<Region | AdministrativeDivision>,
): void {
  for (const item of metadata) {
    if (isRegion(item)) {
      addRegionToLookup(lookup, item);
    } else {
      addDivisionToLookup(lookup, item);
    }
  }
}

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
    const lookup: MetadataLookup = {};
    if (isCustomWorldView && rootRegions) addRootRegionsToLookup(lookup, rootRegions);
    if (metadata) addMetadataItemsToLookup(lookup, metadata);
    return lookup;
  }, [metadata, rootRegions, isCustomWorldView]);

  return { metadata, metadataLoading, metadataById };
}
