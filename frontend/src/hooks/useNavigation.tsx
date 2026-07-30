// @refresh reset - This file exports both a Provider component and a hook
import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AdministrativeDivision, WorldView, Region } from '../types';
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

  // Tile cache busting - increment to force tile reload
  tileVersion: number;
  invalidateTileCache: () => void;

  // Loading states
  isLoading: boolean;
  rootRegionsLoading: boolean;
}

const NavigationContext = createContext<NavigationContextType | null>(null);


/**
 * Which world view to show when the current one is absent from the visible list:
 * the one named in the URL if it is there, otherwise the default (admins) or the
 * first available (everyone else).
 */
function pickWorldView(worldViews: WorldView[], wvParam: string | null, isAdmin: boolean): WorldView | undefined {
  if (wvParam) {
    const fromUrl = worldViews.find((w) => w.id === parseInt(wvParam, 10));
    if (fromUrl) return fromUrl;
  }
  if (isAdmin) return worldViews.find((w) => w.isDefault) ?? worldViews[0];
  return worldViews[0];
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading: authLoading, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedWorldView, setSelectedWorldView] = useState<WorldView | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<AdministrativeDivision | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
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

  // Fetch world views — deliberately *not* until the session has resolved.
  //
  // The server filters this list by visibility (`getWorldViews`), so the answer
  // depends on who is asking: an admin also sees the unpublished ones. Asking
  // before `initAuth` has restored the session sends no token and gets the
  // anonymous list — and gets it as a 200 with fewer rows rather than a 401, so
  // `authFetchJson`'s 401 retry never runs and `staleTime: Infinity` then holds
  // that answer for the rest of the session. The symptom was an admin whose
  // picker offered only the published world view, the hidden base-layer mirror
  // missing until a manual reload happened to win the race.
  //
  // `authLoading` is false for a visitor with no session too — this waits for
  // auth to be *settled*, not for a user to exist.
  const {
    data: worldViews = [],
    isLoading: worldViewsQueryLoading,
    isSuccess: worldViewsLoaded,
    isFetching: worldViewsFetching,
  } = useQuery({
    // Keyed by who is asking, because that is what the answer depends on. One
    // shared key made the anonymous list and the admin list compete for the same
    // cache entry, which is what turned a startup race into a session-long wrong
    // answer. Under separate keys they cannot overwrite each other, and a login
    // or logout stops addressing the old entry rather than having to invalidate
    // it in time.
    queryKey: ['worldViews', user?.id ?? 'anon'],
    queryFn: fetchWorldViews,
    // Correctness comes from the key above; this only avoids spending a request
    // on an anonymous answer that is about to be replaced.
    enabled: !authLoading,
    staleTime: Infinity, // World views rarely change
  });
  // A disabled query reports isLoading false, which would read as "loaded, and
  // there are none". The wait is part of loading from the UI's point of view.
  const worldViewsLoading = authLoading || worldViewsQueryLoading;

  // Keyed on the ids rather than the array: the query returns a new array on
  // every fetch, and length alone would miss a same-size list with different
  // members. Named rather than inlined into the dependency array so the rule can
  // check it statically — an expression there is a warning even under the
  // suppression, which only covers the missing-dependency half.
  const visibleWorldViewIds = worldViews.map((w: WorldView) => w.id).join(',');

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

  // Set the world view from the URL param or the default — and re-check it
  // whenever the list itself changes, which it does when the identity does.
  //
  // Selecting once was not enough: the list is filtered by visibility, so
  // logging out can remove the world view that is currently selected. Keeping it
  // would leave an admin's unpublished world view on screen for an anonymous
  // visitor, with `rootRegions` still fetching by its id. This reconciliation is
  // what makes the identity-keyed list take effect downstream.
  useEffect(() => {
    // Only ever reconcile against an answer, never against the empty default
    // that stands in while the query is disabled or in flight.
    if (!worldViewsLoaded) return;

    // Nor against a settled answer that is already known to be out of date.
    // invalidateQueries keeps status 'success' and the previous data while it
    // refetches, and HierarchySwitcher's create flow invalidates and then selects
    // the new world view in the same batch — an id the stale list cannot contain.
    // Reconciling there would bounce the admin off the world view they just made.
    if (worldViewsFetching) return;

    if (worldViews.length === 0) {
      if (selectedWorldView) {
        setSelectedWorldView(null);
        clearWorldViewContext();
      }
      // Outside the guard above: with nothing ever selected there is no context
      // to clear, but `?wv` still names a world view this caller cannot see, and
      // this is the one branch that never gets a second chance — no selection is
      // made, so nothing re-runs. Left in place it keeps isCustomWorldView true
      // and selectedWorldViewId pointing at that id, so rootRegions stays enabled
      // and 404s on every load, and the address bar goes on advertising it.
      if (urlWorldViewId !== null) syncWorldViewParam(null);
      return;
    }

    if (selectedWorldView && worldViews.some((w: WorldView) => w.id === selectedWorldView.id)) return;

    const worldView = pickWorldView(worldViews, searchParams.get('wv'), isAdmin);
    if (!worldView) return;

    if (selectedWorldView) {
      // Replacing one the caller can no longer see: a full switch, because
      // leaving its region and breadcrumbs rendered — with `?wv=` still naming
      // it — is the outcome this effect exists to remove. Dropping it halfway is
      // worse than not dropping it at all.
      applyWorldView(worldView);
    } else {
      // First pick, not a change: nothing to clear, and clearing would be
      // destructive. rootRegions is enabled from the URL before any world view
      // object exists, and the sidebar renders outside MainDisplay's loading
      // gate, so a region can be chosen before the list lands — a window this
      // change widened by making the list wait on the session.
      setSelectedWorldView(worldView);
      setTileVersion(worldView.tileVersion ?? 0);

      // The region context stays, but the URL must not: `?wv=` still naming the
      // world view just rejected leaves the picker and the address bar
      // disagreeing, re-shares a dead link, and keeps selectedWorldViewId
      // falling back to that id on every load — one 404 root-regions request per
      // visit before it corrects. Only when the URL named something else, so a
      // bare `/` stays bare.
      if (urlWorldViewId !== null && urlWorldViewId !== worldView.id) {
        syncWorldViewParam(worldView);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- worldViews by id, not identity
  }, [worldViewsLoaded, worldViewsFetching, visibleWorldViewIds, isAdmin, selectedWorldView]);


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

  // What a departing world view leaves behind. Separate from applyWorldView
  // because it is also needed when there is nothing to arrive: an empty list
  // still has to drop the old context, and dropping only `selectedWorldView`
  // makes things worse — both derived values fall back to the URL, so
  // isCustomWorldView becomes true and selectedWorldViewId becomes the departed
  // id, leaving rootRegions enabled and requesting it as an anonymous caller.
  const clearWorldViewContext = useCallback(() => {
    setSelectedDivision(null);
    setSelectedRegion(null);
    setDivisionBreadcrumbs([]);
    setRegionBreadcrumbs([]);
  }, []);

  /** Keep `?wv` in step; `null` and the default world view both mean "no param". */
  const syncWorldViewParam = useCallback((worldView: WorldView | null) => {
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      if (!worldView || worldView.isDefault) {
        newParams.delete('wv'); // Don't clutter URL for default
      } else {
        newParams.set('wv', worldView.id.toString());
      }
      return newParams;
    }, { replace: true });
  }, [setSearchParams]);

  // Everything a world view *change* entails, in one place, so the automatic
  // reconciliation and the manual switch cannot drift apart.
  const applyWorldView = useCallback((worldView: WorldView) => {
    setSelectedWorldView(worldView);
    setTileVersion(worldView.tileVersion ?? 0);
    clearWorldViewContext();
    syncWorldViewParam(worldView);
  }, [clearWorldViewContext, syncWorldViewParam]);

  const handleSetSelectedWorldView = applyWorldView;

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
