/**
 * Hook for the Discover page — tree-based region navigation with experience counts.
 *
 * Manages:
 * - Region tree navigation (breadcrumbs, current level children)
 * - Experience counts per category at each tree level
 * - Active view state: which region+category is being explored
 * - Loading experiences for the active view
 * - Selected experience for inline detail
 *
 * Discover keeps no place of its own (#644). The region in question is the one
 * `useNavigation` holds — so the map and Discover share one place, and the
 * header carries it across — and the category list and the open card are read
 * from the address: `/discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1`.
 *
 * `r` is the region the visitor is looking at. With a category list open it is
 * the region whose list it is, and the tree stands at its parent — exactly the
 * state a chip click produces, since chips sit on the rows of a level. Without
 * one, the tree stands at the region itself.
 */

import { useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchExperienceRegionCounts,
  fetchExperienceCategories,
  fetchExperiencesByRegion,
  fetchExperienceLocations,
  WHOLE_REGION_LIMIT,
} from '../api/experiences';
import type { Region } from '../types';
import { useNavigation } from './useNavigation';
import { useAppAddress } from './useAppAddress';

/** The active experience view: region + category selection */
export interface ActiveView {
  regionId: number;
  regionName: string;
  categoryId: number;
  categoryName: string;
}

/** Breadcrumb item for tree navigation */
export interface DiscoverBreadcrumb {
  regionId: number | null; // null = root level
  regionName: string;
}

export function useDiscoverExperiences() {
  const {
    selectedWorldView, selectedWorldViewId, worldViews, setSelectedWorldView,
    selectedRegion, setSelectedRegion, regionBreadcrumbs,
  } = useNavigation();
  const { address, go } = useAppAddress();

  const categoryId = address?.mode === 'discover' ? address.categoryId : null;
  const listOpen = categoryId !== null && selectedRegion !== null;

  // The trail to the region in question. The ancestors read answers it for
  // certain; until it does — it fires on every selection — the trail is what a
  // click already knows: one step down from the last level, or back up to one
  // of its own entries. Without this the crumbs would lag every click by one
  // request, and drop the region just entered for its duration.
  const trail = useMemo((): Region[] => {
    if (!selectedRegion) return [];
    const last = regionBreadcrumbs[regionBreadcrumbs.length - 1];
    if (last?.id === selectedRegion.id) return regionBreadcrumbs;
    const at = regionBreadcrumbs.findIndex(r => r.id === selectedRegion.id);
    if (at !== -1) return regionBreadcrumbs.slice(0, at + 1);
    if (last && selectedRegion.parentRegionId === last.id) return [...regionBreadcrumbs, selectedRegion];
    return [selectedRegion];
  }, [selectedRegion, regionBreadcrumbs]);

  // The tree level: the region itself, or — with its list open — its parent,
  // where the chip was clicked.
  const levelTrail = listOpen ? trail.slice(0, -1) : trail;
  const currentParentId = listOpen
    ? (selectedRegion.parentRegionId ?? null)
    : (selectedRegion?.id ?? null);
  const breadcrumbs = useMemo(
    (): DiscoverBreadcrumb[] => levelTrail.map(r => ({ regionId: r.id, regionName: r.name })),
    [levelTrail],
  );

  // Fetch experience categories (for icon/name mapping)
  const { data: categories = [] } = useQuery({
    queryKey: ['experience-categories'],
    queryFn: fetchExperienceCategories,
    staleTime: 300000,
  });

  // Fetch region counts for current tree level
  const { data: regionCounts = [], isLoading: countsLoading } = useQuery({
    queryKey: ['discover-region-counts', selectedWorldViewId, currentParentId],
    queryFn: () => fetchExperienceRegionCounts(selectedWorldViewId!, currentParentId ?? undefined),
    enabled: !!selectedWorldViewId,
    staleTime: 120000,
  });

  // Active categories (only those with counts at this level)
  const activeCategories = useMemo(() => {
    const categoryIds = new Set<number>();
    for (const rc of regionCounts) {
      for (const sid of Object.keys(rc.category_counts)) {
        categoryIds.add(Number(sid));
      }
    }
    return categories.filter(s => s.is_active && categoryIds.has(s.id));
  }, [categories, regionCounts]);

  // Total experience count per source at current level
  const levelTotals = useMemo(() => {
    const totals: Record<number, number> = {};
    for (const rc of regionCounts) {
      for (const [sid, count] of Object.entries(rc.category_counts)) {
        totals[Number(sid)] = (totals[Number(sid)] || 0) + count;
      }
    }
    return totals;
  }, [regionCounts]);

  // The open list: the region in question and the category the address names.
  const activeView = useMemo((): ActiveView | null => {
    if (!listOpen) return null;
    const category = categories.find(c => c.id === categoryId);
    if (!category) return null;
    return { regionId: selectedRegion.id, regionName: selectedRegion.name, categoryId: category.id, categoryName: category.name };
  }, [listOpen, categories, categoryId, selectedRegion]);

  // A category nobody knows is dropped from the address, in place, once the
  // categories have answered — before that, every category is unknown.
  useEffect(() => {
    if (address === null || categoryId === null || categories.length === 0) return;
    if (categories.some(c => c.id === categoryId)) return;
    go({ ...address, categoryId: null }, { replace: true });
  }, [address, categoryId, categories, go]);

  // The card the address names — of this region, and only once the region is
  // here: during a restore the address arrives first.
  const addressedExperienceId = address !== null && selectedRegion !== null && address.regionId === selectedRegion.id
    ? address.experienceId
    : null;

  // Fetch experiences for active view (region + source)
  const { data: experiencesData, isLoading: experiencesLoading } = useQuery({
    // Keyed on the region alone. The response is category-independent — the
    // filter below runs in `select`, per observer — so carrying `categoryId` in
    // the key gave each tab its own cache entry and refetched the whole region
    // on every switch. That was wasteful at 500 rows and is more so now that a
    // region is fetched whole. The `['discover-experiences']` prefix used for
    // invalidation is unchanged.
    //
    // Read for an open list, and also for a card the address names without a
    // category — the header writes that on the way from the map — so that the
    // category can be read off the object below.
    queryKey: ['discover-experiences', selectedRegion?.id],
    // The category filter runs in `select` below, on what came back — so a
    // truncated response is filtered, not a filtered response truncated. At 500
    // that lost the smaller categories first: Europe holds 69 museums among 661
    // experiences, and `Museo del Prado` sorts past the cut.
    queryFn: () => fetchExperiencesByRegion(selectedRegion!.id, {
      includeChildren: true,
      limit: WHOLE_REGION_LIMIT,
    }),
    enabled: selectedRegion !== null && (listOpen || addressedExperienceId !== null),
    staleTime: 120000,
    select: (data) => {
      // Filter to only the selected category
      if (!activeView) return data;
      return {
        ...data,
        experiences: data.experiences.filter(e => {
          const categoryMatch = categories.find(s => s.name === e.category_name);
          return categoryMatch && categoryMatch.id === activeView.categoryId;
        }),
      };
    },
  });

  const experiences = useMemo(
    () => experiencesData?.experiences ?? [],
    [experiencesData?.experiences],
  );

  // A card without a category: the category is the object's own, so it is read
  // off the object and written into the address in place; an object the region
  // does not hold is dropped the same way. Not before the categories and the
  // region have answered — until then every object is unknown — and a read that
  // failed is not an answer: it must not spend a shared link on a hiccup.
  useEffect(() => {
    if (address === null || addressedExperienceId === null || categoryId !== null) return;
    if (categories.length === 0 || !experiencesData) return;
    const object = experiencesData?.experiences.find(e => e.id === addressedExperienceId);
    const category = object ? categories.find(c => c.name === object.category_name) : undefined;
    go(
      category ? { ...address, categoryId: category.id } : { ...address, experienceId: null },
      { replace: true, names: { experience: object?.name } },
    );
  }, [address, addressedExperienceId, categoryId, categories, experiencesData, go]);

  const selectedExperienceId = activeView ? addressedExperienceId : null;

  // A card the open list does not hold — hidden, rejected, elsewhere, of
  // another category, or not there at all — is dropped from the address once
  // the list has answered, in place and in silence: one answer for all of them.
  // A *successful* answer, for the reason above.
  useEffect(() => {
    if (address === null || selectedExperienceId === null || !experiencesData) return;
    if (experiences.some(e => e.id === selectedExperienceId)) return;
    go({ ...address, experienceId: null }, { replace: true });
  }, [address, selectedExperienceId, experiencesData, experiences, go]);

  // Bring the card's slug up to date once the list names it, the way the region
  // brings its own: a deep link carries whatever slug it was made with, or none.
  const openCard = selectedExperienceId === null
    ? undefined
    : experiences.find(e => e.id === selectedExperienceId);
  useEffect(() => {
    if (address === null || !openCard?.name) return;
    go(address, { replace: true, names: { experience: openCard.name } });
  }, [address, openCard, go]);

  // Fetch locations for the selected experience (for map display)
  const { data: selectedLocationsData, isPending: selectedLocationsPending } = useQuery({
    queryKey: ['experience-locations', selectedExperienceId],
    queryFn: () => fetchExperienceLocations(selectedExperienceId!),
    enabled: !!selectedExperienceId,
    staleTime: 300000,
  });

  // Locations for the map: when experience is selected, show its locations
  const selectedExperienceLocations = useMemo(() => {
    if (!selectedExperienceId) return null;
    if (selectedLocationsData?.locations && selectedLocationsData.locations.length > 0) {
      return selectedLocationsData.locations.map(l => ({
        id: l.id,
        lng: l.longitude,
        lat: l.latitude,
        name: l.name || undefined,
      }));
    }
    // Fallback to experience's main coordinates
    const exp = experiences.find(e => e.id === selectedExperienceId);
    if (exp) return [{ lng: exp.longitude, lat: exp.latitude }];
    return null;
  }, [selectedExperienceId, selectedLocationsData, experiences]);

  /** What a row of the current level knows about itself: enough to be selected. */
  const rowRegion = useCallback((regionId: number, regionName: string): Region => ({
    id: regionId,
    worldViewId: selectedWorldViewId ?? 0,
    name: regionName,
    description: null,
    parentRegionId: currentParentId,
    color: null,
  }), [selectedWorldViewId, currentParentId]);

  // Navigate into a region (drill down): the region is the level now.
  const navigateToRegion = useCallback((regionId: number, regionName: string) => {
    setSelectedRegion(rowRegion(regionId, regionName), { categoryId: null });
  }, [setSelectedRegion, rowRegion]);

  // Navigate to a breadcrumb level: one of the trail's own entries, or the root.
  const navigateToBreadcrumb = useCallback((index: number) => {
    setSelectedRegion(index < 0 ? null : levelTrail[index] ?? null, { categoryId: null });
  }, [setSelectedRegion, levelTrail]);

  // Open experience view for a region + source: the region is in question, the
  // tree stays at its parent.
  const openExperienceView = useCallback((
    regionId: number,
    regionName: string,
    categoryId: number,
    _categoryName: string,
  ) => {
    setSelectedRegion(rowRegion(regionId, regionName), { categoryId });
  }, [setSelectedRegion, rowRegion]);

  // Close experience view (back to tree): the level the list was opened from.
  const closeExperienceView = useCallback(() => {
    setSelectedRegion(levelTrail[levelTrail.length - 1] ?? null, { categoryId: null });
  }, [setSelectedRegion, levelTrail]);

  // Open or close a card: a step the visitor took, so Back undoes it.
  const setSelectedExperienceId = useCallback((id: number | null) => {
    if (address === null) return;
    const name = id === null ? undefined : experiences.find(e => e.id === id)?.name;
    go(at => ({ ...at, experienceId: id }), { names: { experience: name } });
  }, [address, experiences, go]);

  // Switching from the Discover picker. The reset of everything above is not
  // Discover's to do: it derives from the region `useNavigation` clears on a
  // switch, in the same commit, so no render escapes with the new world view
  // and the old level.
  const changeWorldView = useCallback((wv: typeof worldViews[0]) => {
    setSelectedWorldView(wv);
  }, [setSelectedWorldView]);

  return {
    // World view
    worldViews,
    selectedWorldView,
    selectedWorldViewId,
    changeWorldView,

    // Tree navigation
    breadcrumbs,
    currentParentId,
    regionCounts,
    countsLoading,
    navigateToRegion,
    navigateToBreadcrumb,

    // Sources
    categories,
    activeCategories,
    levelTotals,

    // Experience view
    activeView,
    openExperienceView,
    closeExperienceView,
    experiences,
    experiencesLoading,

    // Detail panel
    selectedExperienceId,
    setSelectedExperienceId,
    selectedExperienceLocations,
    /**
     * The selected object's own location fetch has *settled* — so
     * `selectedExperienceLocations` is as good as it will get, rather than the
     * one-point fallback, which is indistinguishable from a genuine single place.
     * The map waits for this before framing a selection, or it frames the
     * fallback point and then frames again when the places arrive.
     *
     * Settled rather than "has data", deliberately: a failed fetch never gets
     * data, and gating on presence would mean a list click that opens a panel and
     * a map that never moves. The fallback point is a worse frame than the places
     * and a better one than none.
     */
    selectedLocationsResolved: !selectedExperienceId || !selectedLocationsPending,
  };
}
