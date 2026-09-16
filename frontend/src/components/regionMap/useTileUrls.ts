/**
 * Hook: Martin tile URL construction with cache-busting.
 */

import { useMemo } from 'react';
import { useNavigation } from '../../hooks/useNavigation';
import { MARTIN_URL } from '../../api';

export interface ContextLayer {
  /** Tile URL for this ancestor's siblings (= parent's children) */
  url: string;
  /** Region ID to highlight as "selected" in this layer (the ancestor itself) */
  highlightId: number;
}

interface BreadcrumbEntry {
  id: number;
  parentRegionId?: number | null;
}

export function useTileUrls(
  viewingRegionId: 'all-leaf' | number,
  viewingParentId: 'root' | number,
  breadcrumbs?: BreadcrumbEntry[],
  hasSubregions?: boolean,
  /** The kind the world layer draws, or null for every kind at once (#910). */
  worldKindId?: number | null,
) {
  const {
    selectedWorldView,
    selectedWorldViewId,
    isCustomWorldView,
    tileVersion,
  } = useNavigation();

  // Build tile URL for current view
  const tileUrl = useMemo(() => {
    if (!selectedWorldViewId && !selectedWorldView) return null;

    const versionParam = `&_v=${tileVersion}`;
    let url: string;

    if (isCustomWorldView) {
      const wvId = selectedWorldViewId ?? selectedWorldView?.id;
      if (viewingRegionId === 'all-leaf') {
        url = `${MARTIN_URL}/tile_world_view_all_leaf_regions/{z}/{x}/{y}?world_view_id=${wvId}${versionParam}`;
      } else {
        url = `${MARTIN_URL}/tile_region_subregions/{z}/{x}/{y}?parent_id=${viewingRegionId}${versionParam}`;
      }
    } else {
      if (viewingParentId === 'root') {
        url = `${MARTIN_URL}/tile_gadm_root_divisions/{z}/{x}/{y}?_v=${tileVersion}`;
      } else {
        url = `${MARTIN_URL}/tile_gadm_subdivisions/{z}/{x}/{y}?parent_id=${viewingParentId}${versionParam}`;
      }
    }

    return url;
  }, [selectedWorldViewId, selectedWorldView, isCustomWorldView, viewingRegionId, viewingParentId, tileVersion]);

  // Island boundaries tile URL (for hull regions)
  const islandTileUrl = useMemo(() => {
    if (!isCustomWorldView || !selectedWorldViewId) return null;

    // The world view is not optional here. `tile_region_islands` filters on
    // `uses_hull` alone, so a request carrying no scope answered with the islands
    // of every hull region in the database — drawn over whichever world view was
    // open, and clickable, so a click resolved to another world view's region
    // (#660). A parent id already belongs to one world view; the root branch is
    // the one that had no scope at all.
    const scope = `world_view_id=${selectedWorldViewId}`;
    const parentParam = viewingRegionId === 'all-leaf' ? '' : `&parent_id=${viewingRegionId}`;

    return `${MARTIN_URL}/tile_region_islands/{z}/{x}/{y}?${scope}${parentParam}&_v=${tileVersion}`;
  }, [isCustomWorldView, selectedWorldViewId, viewingRegionId, tileVersion]);

  // Root regions border overlay URL (only at root level for hover highlighting)
  const rootRegionsBorderUrl = useMemo(() => {
    if (!isCustomWorldView || !selectedWorldViewId) return null;
    if (viewingRegionId !== 'all-leaf') return null;

    return `${MARTIN_URL}/tile_world_view_root_regions/{z}/{x}/{y}?world_view_id=${selectedWorldViewId}&_v=${tileVersion}`;
  }, [isCustomWorldView, selectedWorldViewId, viewingRegionId, tileVersion]);

  // Context layers — one per ancestor level, showing each ancestor's siblings.
  // For non-leaf regions: all breadcrumbs (children are in main tiles, context shows ancestors).
  // For leaf regions: breadcrumbs minus the last entry (siblings already in main tiles).
  // Ordered root-to-leaf (outermost first, matching breadcrumb order).
  const contextLayers = useMemo((): ContextLayer[] => {
    if (!isCustomWorldView || !selectedWorldViewId) return [];
    if (!breadcrumbs || breadcrumbs.length === 0) return [];

    // For leaf regions, exclude the last breadcrumb (the leaf itself) —
    // its siblings are already visible in the main tile source.
    const crumbs = hasSubregions === true
      ? breadcrumbs
      : breadcrumbs.slice(0, -1);

    if (crumbs.length === 0) return [];

    const versionParam = `&_v=${tileVersion}`;
    // selectedWorldViewId is guaranteed non-null by the early return above
    const wvId = selectedWorldViewId;
    const layers: ContextLayer[] = [];

    for (const crumb of crumbs) {
      if (crumb.parentRegionId == null) {
        layers.push({
          url: `${MARTIN_URL}/tile_world_view_root_regions/{z}/{x}/{y}?world_view_id=${wvId}${versionParam}`,
          highlightId: crumb.id,
        });
      } else {
        layers.push({
          url: `${MARTIN_URL}/tile_region_subregions/{z}/{x}/{y}?parent_id=${crumb.parentRegionId}${versionParam}`,
          highlightId: crumb.id,
        });
      }
    }

    return layers;
  }, [isCustomWorldView, selectedWorldViewId, breadcrumbs, hasSubregions, tileVersion]);

  /**
   * The catalogue's points, for the world layer (#910).
   *
   * The one source here that names no world view, and deliberately: a place
   * belongs to the catalogue rather than to a lens, which is also what puts the
   * places no region holds (#470) on a map at all. There is nothing for a scope
   * to protect either — the function answers only what a reader-facing read
   * answers, and says so in its own body (`db/init/01-schema.sql`).
   *
   * Omitted rather than emptied when every kind is wanted, and the reason is
   * worth keeping because the obvious "simplification" here is
   * `kind_id=${worldKindId ?? ''}`. The function answers a value it cannot read
   * with an **empty tile** (`db/init/01-schema.sql`), so emitting the parameter
   * with nothing after it would draw nothing at all — silently, and where every
   * kind was meant. Naming no kind and naming an unreadable one are two
   * different requests, and only one of them is this one.
   */
  const worldPointsUrl = useMemo(() => {
    const kindParam = worldKindId == null ? '' : `kind_id=${worldKindId}&`;
    return `${MARTIN_URL}/tile_experience_points/{z}/{x}/{y}?${kindParam}_v=${tileVersion}`;
  }, [worldKindId, tileVersion]);

  return { tileUrl, islandTileUrl, rootRegionsBorderUrl, contextLayers, worldPointsUrl };
}
