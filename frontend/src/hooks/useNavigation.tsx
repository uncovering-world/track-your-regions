// @refresh reset - This file exports both a Provider component and a hook
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdministrativeDivision, WorldView, Region } from '../types';
import { fetchWorldViews, fetchDivisionAncestors, fetchRootRegions } from '../api';
import { useAuth } from './useAuth';
import { useAppAddress } from './useAppAddress';
import { useAddressedRegion, type SelectRegionOptions } from './useAddressedRegion';
import { RegionHoverProvider } from './useRegionHover';

export type { SelectRegionOptions } from './useAddressedRegion';

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

  // Region (for custom world views). The selection is in the address — see
  // `useAddressedRegion` — so setting it writes the address too.
  selectedRegion: Region | null;
  setSelectedRegion: (region: Region | null, options?: SelectRegionOptions) => void;
  rootRegions: Region[];

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
 * the one the address names if it is there, otherwise the default (admins) or
 * the first available (everyone else).
 */
function pickWorldView(worldViews: WorldView[], urlWorldViewId: number | null, isAdmin: boolean): WorldView | undefined {
  if (urlWorldViewId !== null) {
    const fromUrl = worldViews.find((w) => w.id === urlWorldViewId);
    if (fromUrl) return fromUrl;
  }
  if (isAdmin) return worldViews.find((w) => w.isDefault) ?? worldViews[0];
  return worldViews[0];
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading: authLoading, user } = useAuth();
  const { address, go } = useAppAddress();
  const [selectedWorldView, setSelectedWorldView] = useState<WorldView | null>(null);
  /** What the address named the last time the reconciliation ran; see followUrlWorldView. */
  const lastSeenUrlWorldViewId = useRef<number | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<AdministrativeDivision | null>(null);
  const [divisionBreadcrumbs, setDivisionBreadcrumbs] = useState<AdministrativeDivision[]>([]);
  const [tileVersion, setTileVersion] = useState(0);

  // Increment tile version to force MapLibre to reload tiles
  const invalidateTileCache = useCallback(() => {
    setTileVersion(v => v + 1);
  }, []);

  // The world view the address names, known before anything has loaded. Null
  // off the map too — the account and admin pages carry no place.
  const urlWorldViewId = address?.worldViewId ?? null;

  // Selected world view ID - available immediately from URL, falls back to selected object
  const selectedWorldViewId = selectedWorldView?.id ?? urlWorldViewId;

  // Check if current world view is custom (not GADM default)
  // An address naming a world view implies custom: the default writes no segment.
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

  // The region: selected here, named in the address, restored from it. Its
  // effects are declared before the reconciliation below on purpose — on a
  // Back across a world-view switch the follow asks for the new region first,
  // and the switch's clearing of the old context must not cancel that ask.
  const { selectedRegion, setSelectedRegion, regionBreadcrumbs, clearRegion } = useAddressedRegion({
    address, go, isCustomWorldView, authLoading,
  });


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

  // What a departing world view leaves behind. Separate from applyWorldView
  // because it is also needed when there is nothing to arrive: an empty list
  // still has to drop the old context, and dropping only `selectedWorldView`
  // makes things worse — both derived values fall back to the URL, so
  // isCustomWorldView becomes true and selectedWorldViewId becomes the departed
  // id, leaving rootRegions enabled and requesting it as an anonymous caller.
  const clearWorldViewContext = useCallback(() => {
    setSelectedDivision(null);
    setDivisionBreadcrumbs([]);
    clearRegion();
  }, [clearRegion]);

  /**
   * Write the world view into the address, and nothing under it: a switch drops
   * the region and the card from the address as `clearWorldViewContext` drops
   * them from state. `null` and the default world view both write no segment.
   * Off the map — the account and admin pages — there is no place to write.
   *
   * Keyed on the mode alone rather than the whole address, so that every
   * callback built on this one keeps its identity across the addresses it
   * writes; the reconciliation effect depends on them.
   */
  const mode = address?.mode ?? null;
  const writeWorldView = useCallback((worldView: WorldView | null, replace: boolean) => {
    if (mode === null) return;
    go({
      mode,
      worldViewId: !worldView || worldView.isDefault ? null : worldView.id,
      regionId: null,
      experienceId: null,
      categoryId: null,
    }, { replace });
  }, [mode, go]);

  // Everything a world view *change* entails, in one place, so the automatic
  // reconciliation and the manual switch cannot drift apart. `write` says what
  // happens to the address: a switch the visitor made is pushed, so Back returns
  // to the world view they left; a correction replaces; and following an address
  // that already names the world view writes nothing — a write here would drop
  // the region that address may still carry, before the region's own follow has
  // had the chance to restore it.
  const applyWorldView = useCallback((worldView: WorldView, write: 'push' | 'replace' | 'none') => {
    setSelectedWorldView(worldView);
    setTileVersion(worldView.tileVersion ?? 0);
    clearWorldViewContext();
    if (write !== 'none') writeWorldView(worldView, write === 'replace');
  }, [clearWorldViewContext, writeWorldView]);

  /** Nothing is visible: drop the selection, its context, and the stale param. */
  const dropWorldView = useCallback(() => {
    if (selectedWorldView) {
      setSelectedWorldView(null);
      clearWorldViewContext();
    }
    // Outside the guard above: with nothing ever selected there is no context to
    // clear, but the address still names a world view this caller cannot see,
    // and this is the one branch that never gets a second chance — no selection
    // is made, so nothing re-runs. Left in place it keeps isCustomWorldView true
    // and selectedWorldViewId pointing at that id, so rootRegions stays enabled
    // and 404s on every load, and the address bar goes on advertising it.
    if (urlWorldViewId !== null) writeWorldView(null, true);
  }, [selectedWorldView, urlWorldViewId, clearWorldViewContext, writeWorldView]);

  /**
   * Reconcile the selection against the address, reporting whether it handled
   * the state. Reached by editing the address bar, opening a shared link in a
   * tab that already has a selection, or going back across a switch (#465).
   *
   * Handles two: the address names a visible world view other than the selected
   * one, which is followed; and it names one this caller cannot see while the
   * selection is still fine, in which case the address is retired rather than
   * the selection. Everything else falls through to the reconciliation below.
   *
   * Acts only when the address itself moved, which is what `urlChanged` reports.
   * Without it the branch cannot tell a URL edit from its own write still in
   * flight: a switch sets the selection urgently and writes the address through
   * the router's startTransition, so there is a commit carrying the new
   * selection beside the old address — and following that would send the user
   * back to the world view they just left.
   *
   * Cannot loop: a switch writes the address it selected, so the next run finds
   * them equal, or finds no world view at all when it is the default one; and
   * following writes nothing.
   */
  const followUrlWorldView = useCallback((visible: WorldView[], urlChanged: boolean) => {
    if (!urlChanged) return false;
    if (!selectedWorldView) return false;
    // Two different nulls, and only one of them is an address. A bare `/` names
    // the default world view — that is what adopting made true, and it is why
    // Back across a switch away from the default has to land back on it. A page
    // that carries no place at all (`/account`, `/admin`, `/review`) names
    // nothing, and reading it as the default would switch an admin off the
    // world view they were on the moment they open the admin panel.
    if (address === null) return false;
    if (urlWorldViewId === selectedWorldView.id) return false;

    const fromUrl = urlWorldViewId === null
      ? pickWorldView(visible, null, isAdmin)
      : visible.find((w: WorldView) => w.id === urlWorldViewId);
    if (fromUrl) {
      // A bare address can resolve to the world view already selected, which is
      // no switch at all — and acting on it would clear the region under it.
      if (fromUrl.id === selectedWorldView.id) return false;
      // Following writes nothing where the address already says it — which is
      // what the address naming it means, whichever world view it is. Keyed on
      // that rather than on `isDefault`, so Back into `/wv/5/r/7100-malta`
      // leaves the address exactly as it found it: a write there rebuilds it as
      // the world view alone and the region has to put it back, two navigations
      // and a replaced history entry where none was needed.
      //
      // What still gets written is an address standing in for one that was
      // never built: a bare `/` resolving to a custom world view, which must be
      // named or nothing under it is addressable (the hole `adoptWorldView`
      // climbs out of just below), and an explicit `/wv/1` for the default,
      // whose canonical form is bare.
      const wanted = fromUrl.isDefault ? null : fromUrl.id;
      applyWorldView(fromUrl, urlWorldViewId === wanted ? 'none' : 'replace');
      return true;
    }

    // Named something this caller cannot see. Retire the address against the
    // selection — but only while that selection is itself still visible, which
    // is the case this branch is for: nothing downstream corrects it, because
    // the guard below returns precisely because the selection is fine, so the
    // address would stand until the next full load.
    //
    // When neither is visible, say so and fall through. The reconciliation
    // replaces the selection and rewrites the address in the same pass; retiring
    // it here would write an id this caller cannot see either, and cost a
    // second pass to undo.
    if (!visible.some((w: WorldView) => w.id === selectedWorldView.id)) return false;

    writeWorldView(selectedWorldView, true);
    return true;
  }, [selectedWorldView, urlWorldViewId, address, isAdmin, applyWorldView, writeWorldView]);

  /** First pick, not a change: take the world view without clearing anything. */
  const adoptWorldView = useCallback((worldView: WorldView) => {
    setSelectedWorldView(worldView);
    setTileVersion(worldView.tileVersion ?? 0);

    // The address must name the world view that was adopted, whenever it does
    // not already. A bare `/` stays bare only for the default world view, which
    // writes no segment: for any other, leaving `/` alone would leave nothing
    // under the world view addressable at all — `buildAppUrl` drops the region
    // and card segments without a world view, so a selection could never reach
    // the address, and the address is now the only store for the open card. The
    // site root is the entry every visitor without a link uses, and an
    // anonymous caller is published nothing *but* custom world views.
    //
    // A region chosen under a world view the address named and the list then
    // rejected goes with it: it belongs to a world view this caller cannot see,
    // and the address now says which world view a region is in. Only then —
    // this is the first pick, so on a bare `/` there is nothing to clear, and
    // clearing would be the destructive act the branch above avoids.
    const wanted = worldView.isDefault ? null : worldView.id;
    if (urlWorldViewId !== wanted) {
      if (urlWorldViewId !== null) clearRegion();
      writeWorldView(worldView, true);
    }
  }, [urlWorldViewId, clearRegion, writeWorldView]);

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
      dropWorldView();
      return;
    }

    // The URL names a visible world view other than the one selected, so follow
    // it. Reached by editing the address bar, opening a shared link in a tab that
    // already has a selection, or going back across a switch. Placed above the
    // guard below deliberately: that guard returns whenever the selection is
    // still visible, which is exactly when this case arises, so it used to
    // swallow it and leave the picker and the address bar disagreeing (#465).
    //
    // Cannot loop. Following writes nothing, and a switch writes the address it
    // selected, so the next run either finds them equal or finds no world view
    // at all — a default one writes none — and falls through to the guard below.
    // Read once per run, and only past the guards above, so an address that
    // moves while the list is still in flight is still pending when it lands.
    const urlChanged = urlWorldViewId !== lastSeenUrlWorldViewId.current;
    lastSeenUrlWorldViewId.current = urlWorldViewId;

    if (followUrlWorldView(worldViews, urlChanged)) return;

    if (selectedWorldView && worldViews.some((w: WorldView) => w.id === selectedWorldView.id)) {
      // The selection stands — but the address has to name it wherever there is
      // an address to name it in, and two paths arrive here without one.
      //
      // A world view adopted on a page that carries no place — `/verify-email`,
      // the OAuth callback, `/admin` bouncing a non-admin — had nowhere to write
      // itself, and all three then navigate to `/`. Arriving there is not a
      // change of world view, so nothing else would ever write it, and the
      // session would be left with nothing under the world view addressable at
      // all.
      //
      // And an address naming the default explicitly, `/wv/1`, is one
      // `buildAppUrl` never writes: typed while the default is already
      // selected, it reads as no switch at all, so this is what retires it.
      //
      // Idempotent: the write is skipped once the address agrees, and a page
      // with no address is left alone.
      const wanted = selectedWorldView.isDefault ? null : selectedWorldView.id;
      if (address !== null && urlWorldViewId !== wanted) writeWorldView(selectedWorldView, true);
      return;
    }

    const worldView = pickWorldView(worldViews, urlWorldViewId, isAdmin);
    if (!worldView) return;

    if (selectedWorldView) {
      // Replacing one the caller can no longer see: a full switch, because
      // leaving its region and breadcrumbs rendered — with the address still
      // naming it — is the outcome this effect exists to remove. Dropping it
      // halfway is worse than not dropping it at all. A correction, so the
      // address is replaced rather than pushed.
      applyWorldView(worldView, 'replace');
    } else {
      // First pick, not a change: nothing to clear, and clearing would be
      // destructive. rootRegions is enabled from the URL before any world view
      // object exists, and the sidebar renders outside MainDisplay's loading
      // gate, so a region can be chosen before the list lands — a window this
      // change widened by making the list wait on the session.
      adoptWorldView(worldView);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- worldViews by id, not identity
  }, [worldViewsLoaded, worldViewsFetching, visibleWorldViewIds, isAdmin, selectedWorldView,
      urlWorldViewId, address, writeWorldView, dropWorldView, followUrlWorldView, adoptWorldView]);

  // A switch the visitor made: pushed, so Back returns to the world view they left.
  const handleSetSelectedWorldView = useCallback(
    (worldView: WorldView) => applyWorldView(worldView, 'push'),
    [applyWorldView],
  );

  const handleSetSelectedDivision = useCallback((division: AdministrativeDivision | null) => {
    setSelectedDivision(division);
    if (!division) {
      setDivisionBreadcrumbs([]);
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
    setSelectedRegion,
    rootRegions,
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
    setSelectedRegion,
    rootRegions,
    divisionBreadcrumbs,
    regionBreadcrumbs,
    tileVersion,
    invalidateTileCache,
    worldViewsLoading,
    rootRegionsLoading,
  ]);

  // The hovered region rides its own store rather than this context — it
  // changes on every mouse move over the region map, and here it re-rendered
  // all twelve consumers of this context per move (#573). Mounted by this
  // provider the way `ExperienceProvider` mounts `HoverProvider`, so every
  // surface that navigates regions can read it.
  return (
    <NavigationContext.Provider value={value}>
      <RegionHoverProvider>{children}</RegionHoverProvider>
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
