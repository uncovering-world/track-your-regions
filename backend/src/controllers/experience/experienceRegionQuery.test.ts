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
  const match = query.match(/\(SELECT COUNT\(\*\)::int FROM \(SELECT el_own\.\* FROM experience_locations el_own WHERE el_own\.experience_id = e\.id[\s\S]*?as location_count,/);
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

/**
 * What a reader can look at inside: the offered, published treasures a place
 * holds (#753). A church admitted for its own fame counts zero; one admitted
 * for its Pietà counts it.
 */
describe('treasure_count', () => {
  it('counts the treasures a place offers, in a region that includes its children', () => {
    const { query } = buildRegionQueries({
      regionId: 7,
      includeChildren: true,
      showRejected: false,
      includeLostRows: false,
      limit: 20,
      offset: 0,
    });
    expect(query).toContain('(SELECT COUNT(*)::int FROM experience_treasures et');
    expect(query).toContain('JOIN treasures t ON t.id = et.treasure_id');
    expect(query).toContain('et.missing_since IS NULL');
    expect(query).toContain(') as treasure_count');
  });

  it('counts them the same way when the region does not include its children', () => {
    const { query } = buildRegionQueries({
      regionId: 7,
      includeChildren: false,
      showRejected: false,
      includeLostRows: false,
      limit: 20,
      offset: 0,
    });
    expect(query).toContain('(SELECT COUNT(*)::int FROM experience_treasures et');
    expect(query).toContain('JOIN treasures t ON t.id = et.treasure_id');
    expect(query).toContain('et.missing_since IS NULL');
    expect(query).toContain(') as treasure_count');
  });
});

/**
 * The count statements answer a different question — how many experiences
 * a region holds, gated by the lifecycle rule alone — and never carry a
 * per-object column. Both per-object counts belong to the list only; a
 * future addition beside either one, made to the wrong statement, should
 * fail here rather than ship an unused column on the aggregate read.
 */
describe('the count statements carry no per-object columns', () => {
  it('has no location_count or treasure_count, with children included', () => {
    const { countQuery } = buildRegionQueries({
      regionId: 7,
      includeChildren: true,
      showRejected: false,
      includeLostRows: false,
      limit: 20,
      offset: 0,
    });
    expect(countQuery).not.toContain('location_count');
    expect(countQuery).not.toContain('treasure_count');
  });

  it('has no location_count or treasure_count, without children', () => {
    const { countQuery } = buildRegionQueries({
      regionId: 7,
      includeChildren: false,
      showRejected: false,
      includeLostRows: false,
      limit: 20,
      offset: 0,
    });
    expect(countQuery).not.toContain('location_count');
    expect(countQuery).not.toContain('treasure_count');
  });
});

describe('the type a row is shown with', () => {
  it('is its membership\'s, and grouped with it where children are included', () => {
    // The type within a kind is the membership's (ADR-0084), so it is no longer
    // functionally dependent on the place's key: the grouped statement names it
    // or Postgres refuses the whole read.
    const { query } = buildRegionQueries({
      regionId: 7, includeChildren: true, showRejected: false, includeLostRows: false, limit: 20, offset: 0,
    });
    expect(query).toContain('m.type,');
    expect(query).toContain('GROUP BY e.id, m.kind_id, m.type,');
  });
});

describe('whether the caller may curate each row (#613)', () => {
  const base = { regionId: 7, showRejected: true, includeLostRows: false, limit: 20, offset: 0 };

  it('says yes to every row for an admin, without asking the assignments', () => {
    for (const includeChildren of [true, false]) {
      const { query } = buildRegionQueries({ ...base, includeChildren, userId: 3, curateAs: 'admin' });
      expect(query).toContain('TRUE AS can_curate');
      expect(query).not.toContain('ca_up');
    }
  });

  it("asks a curator's assignments of each row, with the caller bound as $4", () => {
    for (const includeChildren of [true, false]) {
      const { query, params } = buildRegionQueries({ ...base, includeChildren, userId: 3, curateAs: 'curator' });
      expect(query).toMatch(/ca_up\.user_id = \$4 AND ca_up\.scope_type = 'region'[\s\S]*\) AS can_curate/);
      expect(query).toContain('ca.user_id = $4');
      expect(params[3]).toBe(3);
    }
  });

  it('carries no answer for a caller who curates nothing', () => {
    for (const includeChildren of [true, false]) {
      const { query } = buildRegionQueries({ ...base, showRejected: false, includeChildren, userId: 3 });
      expect(query).not.toContain('can_curate');
    }
  });
});
