/**
 * Hook: Martin tile URL construction with cache-busting.
 */

import { useMemo } from 'react';
import { useNavigation } from '../../hooks/useNavigation';
import { MARTIN_URL } from '../../api';

export function useTileUrls(
  viewingRegionId: 'all-leaf' | number,
  viewingParentId: 'root' | number,
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

  // Island boundaries tile URL (for archipelagos)
  const islandTileUrl = useMemo(() => {
    if (!isCustomWorldView || !selectedWorldViewId) return null;

    const versionParam = `&_v=${tileVersion}`;

    if (viewingRegionId === 'all-leaf') {
      return `${MARTIN_URL}/tile_region_islands/{z}/{x}/{y}?_v=${tileVersion}`;
    } else {
      return `${MARTIN_URL}/tile_region_islands/{z}/{x}/{y}?parent_id=${viewingRegionId}${versionParam}`;
    }
  }, [isCustomWorldView, selectedWorldViewId, viewingRegionId, tileVersion]);

  // Root regions border overlay URL (only at root level for hover highlighting)
  const rootRegionsBorderUrl = useMemo(() => {
    if (!isCustomWorldView || !selectedWorldViewId) return null;
    if (viewingRegionId !== 'all-leaf') return null;

    return `${MARTIN_URL}/tile_world_view_root_regions/{z}/{x}/{y}?world_view_id=${selectedWorldViewId}&_v=${tileVersion}`;
  }, [isCustomWorldView, selectedWorldViewId, viewingRegionId, tileVersion]);

  return { tileUrl, islandTileUrl, rootRegionsBorderUrl };
}
