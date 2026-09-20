/**
 * The map's two layers, coloured by the group each shape belongs to.
 *
 * Pure on purpose: a colour is a function of the groups and of which group a
 * division sits in, not of anything the map is doing — so the tab can hand the
 * answer straight to a `Source`.
 *
 * Split out of `MapViewTab.tsx`, which had reached the length the lint draws
 * the line at (#933).
 */

import type { SubdivisionGroup } from './types';
import { getGroupColor } from './types';

/** The divisions being grouped, each carrying its group's index, colour and name. */
export function mapDataWithColors(
  mapGeometries: GeoJSON.FeatureCollection | null,
  getDivisionGroupIdx: (divisionId: number, memberRowId?: number) => number | null,
  subdivisionGroups: SubdivisionGroup[],
): GeoJSON.FeatureCollection {
  if (!mapGeometries) return { type: 'FeatureCollection', features: [] };

  const features = mapGeometries.features.map(f => {
    const divId = f.properties?.id;
    const memberRowId = f.properties?.memberRowId;
    const groupIdx = getDivisionGroupIdx(divId, memberRowId);

    return {
      ...f,
      properties: {
        ...f.properties,
        groupIdx: groupIdx ?? -1, // Use -1 for unassigned to avoid null in MapLibre expressions
        groupColor: groupIdx !== null ? getGroupColor(subdivisionGroups[groupIdx], groupIdx) : '#cccccc',
        groupName: groupIdx !== null ? subdivisionGroups[groupIdx]?.name : 'Unassigned',
      },
    };
  });

  return { type: 'FeatureCollection', features };
}

/**
 * What already sits under the region, coloured by the group its root ancestor
 * became — grey where no group claims it.
 */
export function descendantDataWithColors(
  descendantGeometries: GeoJSON.FeatureCollection | null,
  subdivisionGroups: SubdivisionGroup[],
): GeoJSON.FeatureCollection {
  if (!descendantGeometries) return { type: 'FeatureCollection', features: [] };

  // Build lookup: existingRegionId -> groupIdx
  const regionIdToGroupIdx: Record<number, number> = {};
  for (let i = 0; i < subdivisionGroups.length; i++) {
    const rid = subdivisionGroups[i].existingRegionId;
    if (rid != null) regionIdToGroupIdx[rid] = i;
  }

  const features = descendantGeometries.features.map(f => {
    const rootAncestorId = f.properties?.rootAncestorId as number | undefined;
    const groupIdx = rootAncestorId != null ? (regionIdToGroupIdx[rootAncestorId] ?? -1) : -1;

    return {
      ...f,
      properties: {
        ...f.properties,
        groupIdx,
        groupColor: groupIdx >= 0 ? getGroupColor(subdivisionGroups[groupIdx], groupIdx) : '#9e9e9e',
      },
    };
  });

  return { type: 'FeatureCollection', features };
}
