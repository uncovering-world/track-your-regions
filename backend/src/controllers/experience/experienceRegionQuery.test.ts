/**
 * The list's own count of an object's points.
 *
 * It sits beside the markers the map draws from
 * `getRegionExperienceLocations`, so the two have to be answering the same
 * question. A card reading "5 locations" over four pins is the kind of
 * disagreement nobody reports and everybody notices.
 */

import { describe, it, expect } from 'vitest';
import { buildRegionQueries } from './experienceRegionQuery.js';

function locationCountSql(includeChildren: boolean): string {
  const { query } = buildRegionQueries({
    regionId: 7,
    includeChildren,
    showRejected: false,
    includeLostRows: false,
    limit: 20,
    offset: 0,
  });
  const line = query.split('\n').find(l => l.includes('as location_count'));
  expect(line).toBeDefined();
  return line as string;
}

describe('location_count', () => {
  it('counts the points still on offer, not the ones a run withdrew', () => {
    expect(locationCountSql(true)).toMatch(/missing_since IS NULL/);
  });

  it('counts them the same way when the region does not include its children', () => {
    expect(locationCountSql(false)).toMatch(/missing_since IS NULL/);
  });
});
