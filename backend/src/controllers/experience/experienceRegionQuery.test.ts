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

/**
 * The `(SELECT COUNT(*) ... ) as location_count` subquery, whole. A single
 * line stopped being enough once the count gained a second predicate
 * (ADR-0025's `curation_state`) that a reader-facing card must agree with:
 * the subquery now spans the line offering `missing_since` and the line
 * gating `curation_state`, so pinning either alone would let the other drift.
 */
function locationCountSql(includeChildren: boolean): string {
  const { query } = buildRegionQueries({
    regionId: 7,
    includeChildren,
    showRejected: false,
    includeLostRows: false,
    limit: 20,
    offset: 0,
  });
  const match = query.match(/\(SELECT COUNT\(\*\)::int FROM experience_locations el[\s\S]*?as location_count,/);
  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[0];
}

describe('location_count', () => {
  it('counts the points still on offer, not the ones a run withdrew', () => {
    expect(locationCountSql(true)).toMatch(/missing_since IS NULL/);
  });

  it('counts them the same way when the region does not include its children', () => {
    expect(locationCountSql(false)).toMatch(/missing_since IS NULL/);
  });

  it('counts only what has been passed, unconditionally, even for a curator', () => {
    // A region list has no "show me the unread ones too" toggle and no
    // curator relaxation (ADR-0025): this count must read the same for every
    // caller, or a curator comparing regions could never trust either number.
    // That is a deliberate disagreement with `/:id/locations`, not an
    // invariant to keep in step with it — that read *is* relaxed for a
    // curator whose scope reaches the experience, so the same curator who
    // opens the page and sees 2 locations can see this card say 1. The
    // catalogue's count and one caller's expanded view are different
    // questions, and this predicate answers the first.
    expect(locationCountSql(true)).toMatch(/el\.curation_state <> 'pending'/);
    expect(locationCountSql(false)).toMatch(/el\.curation_state <> 'pending'/);
  });
});
