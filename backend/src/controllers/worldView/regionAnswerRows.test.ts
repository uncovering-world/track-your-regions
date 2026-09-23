import { describe, expect, it } from 'vitest';
import { Region, RegionSearchResult } from '../../api/responses/regions.js';
import { regionOf, regionSearchResultOf, type RegionRow } from './regionAnswerRows.js';

/** Zürich, of the Europe tree of the dev data, as the region SELECT hands it over. */
const ZURICH: RegionRow = {
  id: 7349, world_view_id: 5, name: 'Zürich', description: null, parent_region_id: 7323, color: null,
  is_custom_boundary: false, uses_hull: false,
  focus_bbox: [8.358933449, 47.163570405, 8.986018181, 47.698986054], anchor_point: [8.672475815, 47.431278229],
  has_subregions: false, has_hull_children: false, source_url: null, region_map_url: null,
};

describe('regionOf', () => {
  it('answers a region the schema accepts', () => {
    expect(Region.safeParse(regionOf(ZURICH)).success).toBe(true);
  });

  it('reads a null flag as the column default, false', () => {
    const region = regionOf({ ...ZURICH, is_custom_boundary: null, uses_hull: null });
    expect(region.isCustomBoundary).toBe(false);
    expect(region.usesHull).toBe(false);
  });

  it('does not serve a column the schema does not name', () => {
    const region = regionOf({ ...ZURICH, geom_area_km2: 1729 } as RegionRow);
    expect(region).not.toHaveProperty('geom_area_km2');
    expect(region).not.toHaveProperty('geomAreaKm2');
  });
});

describe('regionSearchResultOf', () => {
  it('answers a match the schema accepts, with its path', () => {
    const match = regionSearchResultOf({ ...ZURICH, path: 'Europe > Switzerland > Zürich', relevance_score: 318 });
    expect(match.path).toBe('Europe > Switzerland > Zürich');
    expect(RegionSearchResult.safeParse(match).success).toBe(true);
  });
});
