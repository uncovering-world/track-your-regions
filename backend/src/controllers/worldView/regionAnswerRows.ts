/**
 * Regions, from the rows their queries answer to the shapes the answers declare
 * (`api/responses/regions.ts`, ADR-0066).
 *
 * A region is read by one SELECT, `REGION_SELECT_SQL`, and mapped by one
 * function, `regionOf`, whichever endpoint answers with it: the tree, a branch,
 * the ancestors and the writes all hand the client the same row. Each mapper
 * writes the keys its schema names and nothing else a query selects, so a
 * column the SELECT gains reaches a reader only once the schema names it.
 */

import type { AnchorPoint, FocusBbox, Region, RegionSearchResult } from '../../api/responses/regions.js';
import type { RegionImportStateRow, RegionsRow } from '../../db/schema.generated.js';

/** The frame and anchor as JSON arrays, for a row aliased `cg`. */
const FOCUS_SQL = `
  CASE WHEN cg.focus_bbox IS NOT NULL
    THEN json_build_array(cg.focus_bbox[1], cg.focus_bbox[2], cg.focus_bbox[3], cg.focus_bbox[4])
  END AS focus_bbox,
  CASE WHEN cg.anchor_point IS NOT NULL
    THEN json_build_array(ST_X(cg.anchor_point), ST_Y(cg.anchor_point))
  END AS anchor_point`;

/**
 * A region as every region answer reads it, for the caller to finish with its
 * own `WHERE` (on `cg`) and `ORDER BY`.
 */
export const REGION_SELECT_SQL = `
  SELECT
    cg.id, cg.world_view_id, cg.name, cg.description, cg.parent_region_id, cg.color,
    cg.is_custom_boundary, cg.uses_hull,
    ${FOCUS_SQL},
    EXISTS (SELECT 1 FROM regions c WHERE c.parent_region_id = cg.id) AS has_subregions,
    EXISTS (SELECT 1 FROM regions c WHERE c.parent_region_id = cg.id AND c.uses_hull) AS has_hull_children,
    ris.source_url, ris.region_map_url
  FROM regions cg
  LEFT JOIN region_import_state ris ON ris.region_id = cg.id`;

/** The import's two columns are null for every region no import brought (the LEFT JOIN). */
export type RegionRow = Pick<
  RegionsRow, 'id' | 'world_view_id' | 'name' | 'description' | 'parent_region_id' | 'color' | 'is_custom_boundary' | 'uses_hull'
> & Pick<RegionImportStateRow, 'source_url' | 'region_map_url'> & {
  focus_bbox: FocusBbox | null;
  anchor_point: AnchorPoint | null;
  has_subregions: boolean;
  has_hull_children: boolean;
};

export function regionOf(row: RegionRow): Region {
  return {
    id: row.id,
    worldViewId: row.world_view_id,
    name: row.name,
    description: row.description,
    parentRegionId: row.parent_region_id,
    color: row.color,
    // Both columns default to false; a null the column type still admits reads as that default.
    isCustomBoundary: row.is_custom_boundary ?? false,
    usesHull: row.uses_hull ?? false,
    focusBbox: row.focus_bbox,
    anchorPoint: row.anchor_point,
    hasSubregions: row.has_subregions,
    hasHullChildren: row.has_hull_children,
    sourceUrl: row.source_url,
    regionMapUrl: row.region_map_url,
  };
}

/** One answer of the search, as its final SELECT lists it. */
export type RegionSearchRow = Pick<RegionsRow, 'id' | 'name' | 'description' | 'parent_region_id' | 'color' | 'uses_hull'> & {
  focus_bbox: FocusBbox | null;
  anchor_point: AnchorPoint | null;
  has_subregions: boolean;
  path: string;
  relevance_score: number;
};

export function regionSearchResultOf(row: RegionSearchRow): RegionSearchResult {
  return {
    id: row.id,
    name: row.name,
    parentRegionId: row.parent_region_id,
    description: row.description,
    color: row.color,
    usesHull: row.uses_hull ?? false,
    focusBbox: row.focus_bbox,
    anchorPoint: row.anchor_point,
    hasSubregions: row.has_subregions,
    path: row.path,
    relevance_score: row.relevance_score,
  };
}
