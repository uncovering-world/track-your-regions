import { describe, expect, it } from 'vitest';
import { DescendantMemberGeometry, MemberGeometry, RegionGeometry } from '../../api/responses/regions.js';
import {
  descendantMemberGeometryOf, hasGeometry, memberGeometryOf, regionGeometryOf, type RegionGeometryRow,
} from './regionGeometryAnswerRows.js';

/** What the client receives: JSON drops a key written as `undefined`. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const square = (lng: number, lat: number) => [[[lng, lat], [lng + 1, lat], [lng + 1, lat + 1], [lng, lat + 1], [lng, lat]]];

/**
 * Fiji as a hull region: Viti Levu west of the antimeridian and the Lau Group
 * east of it, so its stored frame runs west of east, and its hull wraps both,
 * split at the line the way GeoJSON has to carry it.
 */
const FIJI: RegionGeometryRow = {
  is_custom_boundary: false, uses_hull: true,
  geometry: { type: 'MultiPolygon', coordinates: [square(177.3, -18.3), square(-179, -18.5)] },
  hull_geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [[[177, -19], [180, -19], [180, -16], [177, -16], [177, -19]]],
      [[[-180, -19], [-178, -19], [-178, -16], [-180, -16], [-180, -19]]],
    ],
  },
  crosses_dateline: true, anchor_lng: 179.5, anchor_lat: -17.7,
};

describe('regionGeometryOf', () => {
  it('answers the outline alone when the hull was not asked for', () => {
    const answer = wire(regionGeometryOf(7361, FIJI, false));
    expect(answer.geometry).toEqual(FIJI.geometry);
    expect(answer.properties).not.toHaveProperty('displayMode');
    expect(answer.properties).not.toHaveProperty('crossesDateline');
    expect(RegionGeometry.safeParse(answer).success).toBe(true);
  });

  it('answers the hull, and that it crosses the antimeridian, when the hull was asked for', () => {
    const answer = regionGeometryOf(7361, FIJI, true);
    expect(answer.geometry).toBe(FIJI.hull_geometry);
    expect(answer.properties).toMatchObject({ displayMode: 'hull', crossesDateline: true, usesHull: true, anchorPoint: [179.5, -17.7] });
    expect(RegionGeometry.safeParse(answer).success).toBe(true);
  });

  it('falls back to the outline, and says so, for a region with no hull', () => {
    const answer = wire(regionGeometryOf(7361, { ...FIJI, hull_geometry: null }, true));
    expect(answer.geometry).toEqual(FIJI.geometry);
    expect(answer.properties.displayMode).toBe('real');
    expect(answer.properties).not.toHaveProperty('crossesDateline');
  });
});

describe('the member geometry mappers', () => {
  // A simplified outline of one piece comes back as a Polygon, of several as a MultiPolygon.
  const famagusta = {
    member_row_id: 9395, division_id: 55433, name: 'Famagusta', has_custom_geom: false,
    geometry: { type: 'Polygon' as const, coordinates: square(33.8, 35.1) },
  };

  it('answer a one-piece member as a Polygon the schema accepts', () => {
    expect(MemberGeometry.safeParse(memberGeometryOf(famagusta)).success).toBe(true);
  });

  it('carry a descendant member\'s region and the subregion it sits under', () => {
    const answer = descendantMemberGeometryOf({ ...famagusta, region_name: 'Famagusta', region_id: 5378, root_ancestor_id: 5378 });
    expect(answer.properties).toMatchObject({ regionName: 'Famagusta', regionId: 5378, rootAncestorId: 5378 });
    expect(DescendantMemberGeometry.safeParse(answer).success).toBe(true);
  });

  it('leave out a member with no outline', () => {
    expect([famagusta, { ...famagusta, geometry: null }].filter(hasGeometry)).toHaveLength(1);
  });
});
