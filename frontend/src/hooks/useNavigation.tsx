// @refresh reset - This file exports both a Provider component and a hook
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AdministrativeDivision, WorldView, View, Region } from '../types';
import { fetchWorldViews, fetchDivisionAncestors, fetchRootRegions, fetchRegionAncestors } from '../api';
import { useAuth } from './useAuth';

interface NavigationContextType {
  // World View
  worldViews: WorldView[];
  selectedWorldView: WorldView | null;
  selectedWorldViewId: number | null; // Available immediately from URL before full object loads
  setSelectedWorldView: (worldView: WorldView) => void;
  isCustomWorldView: boolean;

  // Administrative Division (for GADM hierarchy)
  selectedDivision: AdministrativeDivision | null;
  setSelectedDivision: (division: AdministrativeDivision | null) => void;

  // Region (for custom world views)
  selectedRegion: Region | null;
  setSelectedRegion: (region: Region | null) => void;
  rootRegions: Region[];

  // Hovered item (shared between list and map)
  hoveredRegionId: number | null;
  setHoveredRegionId: (id: number | null) => void;

  // Breadcrumbs (works for both GADM divisions and custom regions)
  divisionBreadcrumbs: AdministrativeDivision[];
  regionBreadcrumbs: Region[];

  // View
  selectedView: View | null;
  setSelectedView: (view: View | null) => void;

  // Tile cache busting - increment to force tile reload
  tileVersion: number;
  invalidateTileCache: () => void;

  // Loading states
  isLoading: boolean;
  rootRegionsLoading: boolean;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedWorldView, setSelectedWorldView] = useState<WorldView | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<AdministrativeDivision | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [selectedView, setSelectedView] = useState<View | null>(null);
  const [divisionBreadcrumbs, setDivisionBreadcrumbs] = useState<AdministrativeDivision[]>([]);
  const [regionBreadcrumbs, setRegionBreadcrumbs] = useState<Region[]>([]);
  const [hoveredRegionId, setHoveredRegionId] = useState<number | null>(null);
  const [tileVersion, setTileVersion] = useState(0);

  // Increment tile version to force MapLibre to reload tiles
  const invalidateTileCache = useCallback(() => {
    setTileVersion(v => v + 1);
  }, []);

  // Get world view ID from URL immediately (before world views load)
  const urlWorldViewId = useMemo(() => {
    const wvParam = searchParams.get('wv');
    return wvParam ? parseInt(wvParam, 10) : null;
  }, [searchParams]);

  // Selected world view ID - available immediately from URL, falls back to selected object
  const selectedWorldViewId = selectedWorldView?.id ?? urlWorldViewId;

  // Check if current world view is custom (not GADM default)
  // URL param presence implies custom (since we don't add ?wv for default)
  const isCustomWorldView = selectedWorldView
    ? !selectedWorldView.isDefault
    : urlWorldViewId !== null;

  // Fetch world views — public endpoint, no auth required
  const { data: allWorldViews = [], isLoading: worldViewsLoading } = useQuery({
    queryKey: ['worldViews'],
    queryFn: fetchWorldViews,
    staleTime: Infinity, // World views rarely change
  });

  // Filter out GADM (isDefault) for non-admin users - GADM is admin-only
  const worldViews = useMemo(() => {
    if (isAdmin) return allWorldViews;
    return allWorldViews.filter((w: WorldView) => !w.isDefault);
  }, [allWorldViews, isAdmin]);

  // Fetch root regions for custom world views
  // Uses selectedWorldViewId for eager loading (before full world view object loads)
  const { data: rootRegions = [], isLoading: rootRegionsLoading } = useQuery({
    queryKey: ['rootRegions', selectedWorldViewId],
    queryFn: () => fetchRootRegions(selectedWorldViewId!),
    enabled: isCustomWorldView && !!selectedWorldViewId,
  });

  // Fetch ancestors for the selected region (for breadcrumbs in custom world views)
  const { data: regionAncestors } = useQuery({
    queryKey: ['regionAncestors', selectedRegion?.id],
    queryFn: () => fetchRegionAncestors(selectedRegion!.id),
    enabled: isCustomWorldView && !!selectedRegion,
  });

  // Set world view from URL param or default (only once when worldViews are first loaded)
  useEffect(() => {
    if (worldViews.length > 0 && !selectedWorldView) {
      const wvParam = searchParams.get('wv');
      let worldView: WorldView | undefined;

      if (wvParam) {
        // Try to find world view by ID from URL
        worldView = worldViews.find((w: WorldView) => w.id === parseInt(wvParam, 10));
      }

      if (!worldView) {
        // Fall back to default (GADM for admins, first custom for others)
        if (isAdmin) {
          worldView = worldViews.find((w: WorldView) => w.isDefault) || worldViews[0];
        } else {
          // Non-admins: pick first available custom world view
          worldView = worldViews[0];
        }
      }

      if (worldView) {
        setSelectedWorldView(worldView);
        setTileVersion(worldView.tileVersion ?? 0);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only depend on length to avoid re-selecting on every fetch
  }, [worldViews.length, isAdmin]);


  // Update breadcrumbs when division changes (only for GADM hierarchy)
  const { data: ancestorData } = useQuery({
    queryKey: ['ancestors', selectedDivision?.id, selectedWorldView?.id],
    queryFn: () => fetchDivisionAncestors(selectedDivision!.id, selectedWorldView!.id),
    enabled: !!selectedDivision && !!selectedWorldView && !isCustomWorldView,
  });

  useEffect(() => {
    if (ancestorData) {
      // Only update if the data actually changed (compare by stringifying)
      setDivisionBreadcrumbs(prev => {
        if (JSON.stringify(prev) === JSON.stringify(ancestorData)) {
          return prev;
        }
        return ancestorData;
      });
    } else if (!selectedDivision) {
      setDivisionBreadcrumbs(prev => prev.length === 0 ? prev : []);
    }
  }, [ancestorData, selectedDivision]);

  // Update region breadcrumbs from ancestors query (for custom world views)
  // Also enrich selectedRegion with full data (focusBbox, anchorPoint) from the
  // API response — tile features don't include these, so context layer clicks
  // create a selectedRegion without focus data. The last breadcrumb entry is
  // the selectedRegion itself, returned by the ancestors API with full data.
  useEffect(() => {
    if (regionAncestors) {
      setRegionBreadcrumbs(prev => {
        if (prev.length === regionAncestors.length && prev.every((r, i) => r.id === regionAncestors[i].id)) {
          return prev;
        }
        return regionAncestors;
      });
      // Enrich selectedRegion with full API data if it was missing focusBbox
      const lastAncestor = regionAncestors[regionAncestors.length - 1];
      if (lastAncestor && selectedRegion && lastAncestor.id === selectedRegion.id) {
        if (!selectedRegion.focusBbox && lastAncestor.focusBbox) {
          setSelectedRegion({
            ...selectedRegion,
            focusBbox: lastAncestor.focusBbox,
            anchorPoint: lastAncestor.anchorPoint,
            hasSubregions: lastAncestor.hasSubregions,
          });
        }
      }
    } else if (!selectedRegion) {
      setRegionBreadcrumbs(prev => prev.length === 0 ? prev : []);
    }
  }, [regionAncestors, selectedRegion]);

  const handleSetSelectedWorldView = useCallback((worldView: WorldView) => {
    setSelectedWorldView(worldView);
    setTileVersion(worldView.tileVersion ?? 0);
    setSelectedDivision(null);
    setSelectedRegion(null);
    setSelectedView(null);
    setDivisionBreadcrumbs([]);
    setRegionBreadcrumbs([]);

    // Persist world view selection to URL (for faster reload)
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      if (worldView.isDefault) {
        newParams.delete('wv'); // Don't clutter URL for default
      } else {
        newParams.set('wv', worldView.id.toString());
      }
      return newParams;
    }, { replace: true });
  }, [setSearchParams]);

  const handleSetSelectedDivision = useCallback((division: AdministrativeDivision | null) => {
    setSelectedDivision(division);
    if (!division) {
      setDivisionBreadcrumbs([]);
    }
  }, []);

  const handleSetSelectedRegion = useCallback((region: Region | null) => {
    setSelectedRegion(region);
    if (!region) {
      setRegionBreadcrumbs([]);
    }
  }, []);

  const value: NavigationContextType = useMemo(() => ({
    worldViews,
    selectedWorldView,
    selectedWorldViewId,
    setSelectedWorldView: handleSetSelectedWorldView,
    isCustomWorldView,
    selectedDivision,
    setSelectedDivision: handleSetSelectedDivision,
    selectedRegion,
    setSelectedRegion: handleSetSelectedRegion,
    rootRegions,
    hoveredRegionId,
    setHoveredRegionId,
    divisionBreadcrumbs,
    regionBreadcrumbs,
    selectedView,
    setSelectedView,
    tileVersion,
    invalidateTileCache,
    isLoading: worldViewsLoading,
    rootRegionsLoading,
  }), [
    worldViews,
    selectedWorldView,
    selectedWorldViewId,
    handleSetSelectedWorldView,
    isCustomWorldView,
    selectedDivision,
    handleSetSelectedDivision,
    selectedRegion,
    handleSetSelectedRegion,
    rootRegions,
    hoveredRegionId,
    divisionBreadcrumbs,
    regionBreadcrumbs,
    selectedView,
    tileVersion,
    invalidateTileCache,
    worldViewsLoading,
    rootRegionsLoading,
  ]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextType {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}
