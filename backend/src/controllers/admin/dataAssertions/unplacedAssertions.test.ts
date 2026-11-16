/**
 * The checks of objects and places no region holds, read as the panel reads
 * them (#469). The statements themselves run against PostgreSQL in
 * `unplacedAssertions.db.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { experienceOfferedToReaderSql, standsTodaySql, offeredLocationSql } from '../../../db/readerPredicates.js';
import { unplacedAssertions } from './unplacedAssertions.js';

const byId = (id: string) => {
  const assertion = unplacedAssertions.find(a => a.id === id);
  if (!assertion) throw new Error(`no assertion ${id}`);
  return assertion;
};

const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('an object no region holds', () => {
  const assertion = byId('held-by-no-region');
  const sql = collapse(assertion.sql);

  it('asks about the reader-facing object, whole', () => {
    expect(sql).toContain(collapse(experienceOfferedToReaderSql()));
    expect(sql).toContain(collapse(standsTodaySql()));
  });

  it('asks whether any row places the object, not whether a reader may see it there', () => {
    // `readerRegionMembershipSql` answers a question about one region, and needs
    // one to be about. An object held only by a row a reader cannot see is
    // `listed-with-nowhere-to-go`'s business; this one is about being held at all.
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM experience_regions er/);
    expect(sql).not.toMatch(/assignment_type/);
  });

  it('says where the object is, since that is what makes it findable at all', () => {
    expect(assertion.describe({
      experience_id: 300, experience_name: 'Aldabra Atoll', external_id: '185',
      countries: 'Seychelles',
    })).toContain('in Seychelles, and in no region');
  });

  it('does not print an empty country as though it were one', () => {
    expect(assertion.describe({
      experience_id: 411, experience_name: 'Great Barrier Reef', external_id: '154', countries: '',
    })).toContain('in no country named');
  });

  it('names the nearest region and the next, the distance in the unit a curator reads', () => {
    // #469: Ha Long Bay's point is 6.4 km from Hải Phòng and 10.1 km from
    // Quảng Ninh, the bay's own province. The next region is what makes the
    // first a question rather than an answer.
    expect(assertion.describe({
      experience_id: 821, experience_name: 'Ha Long Bay', external_id: '672', countries: 'Viet Nam',
      suggestions: [{ view: 'Administrative', region: 'Hải Phòng', metres: 6425, next: 'Quảng Ninh', next_metres: 10124 }],
    })).toBe('Ha Long Bay (672): in Viet Nam, and in no region; nearest Hải Phòng (Administrative) at 6.4 km, '
      + 'next Quảng Ninh at 10.1 km (experience 821)');
    expect(assertion.describe({
      experience_id: 1163, experience_name: 'Island of Gorée', external_id: '26', countries: 'Senegal',
      suggestions: [{ view: 'Administrative', region: 'Dakar', metres: 14, next: null, next_metres: null }],
    })).toContain('nearest Dakar (Administrative) at 14 m, nothing else within 30 km');
  });

  it('says when no region is near enough to suggest', () => {
    expect(assertion.describe({
      experience_id: 496, experience_name: 'Malpelo', external_id: '1216', countries: 'Colombia', suggestions: null,
    })).toContain('and in no region; no region within 30 km');
  });
});

describe('a place no region holds', () => {
  const assertion = byId('offered-place-in-no-region');
  const sql = collapse(assertion.sql);

  it('asks placement\'s question, not a reader\'s', () => {
    // Placement writes from every offered point, unread ones included, so that a
    // region curator's queue is not empty (ADR-0025 decision 5). Gating this on
    // what a reader may see would call an unplaced pending point compliant.
    expect(sql).toContain(collapse(offeredLocationSql()));
    expect(sql).not.toMatch(/curation_state/);
  });

  it('leaves out a point a curator turned down, which placement skips on purpose', () => {
    // ADR-0053: still offered on the source's terms, never to be published, so
    // placement gives it no row — and without this term every refusal would
    // read as a failed placement run.
    expect(sql).toMatch(/el\.refused_at IS NULL/);
  });

  it('looks in the roll-up placement actually writes', () => {
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM experience_location_regions r/);
  });

  it('names the place as well as the object, since one object may have many', () => {
    expect(assertion.describe({
      location_id: 7042, place_name: 'Gold Beach', experience_id: 500,
      experience_name: 'Beaches of the D-Day Landings',
    })).toBe('Beaches of the D-Day Landings — Gold Beach: on offer and in no region (location 7042)');
  });
});

describe("a place's region row its points no longer give", () => {
  const assertion = byId('place-regions-out-of-step');
  const sql = collapse(assertion.sql);

  it("compares the rows with the refresh's own, over every place it covers (ADR-0197)", () => {
    expect(sql).toContain('FROM place_regions_expected(places_with_regions()) x');
    expect(sql).toContain('FULL JOIN experience_regions er');
  });

  it("never reports a curator's manual row", () => {
    expect(sql).toContain("er.assignment_type IS DISTINCT FROM 'manual'");
  });

  it('says in words who finds the place there now, and who its points say should', () => {
    expect(assertion.describe({
      experience_id: 38881, experience_name: 'Park Güell', region_name: 'Catalonia',
      expected_listing: 'offered', held_listing: null,
    })).toBe('Park Güell in Catalonia is not listed, but where it lies lists it for readers (experience 38881)');
    expect(assertion.describe({
      experience_id: 9645, experience_name: 'A museum', region_name: 'Leaf A',
      expected_listing: 'offered', held_listing: 'scope',
    })).toBe('A museum in Leaf A is listed for curators only, but where it lies lists it for readers (experience 9645)');
    expect(assertion.describe({
      experience_id: 37452, experience_name: 'Monastery of Haghpat', region_name: 'Lori',
      expected_listing: null, held_listing: 'offered',
    })).toBe('Monastery of Haghpat in Lori is listed for readers, but where it lies does not put it there (experience 37452)');
  });
});

describe('a place whose outline lies away from its point', () => {
  const assertion = byId('outline-away-from-its-place');

  it('asks the question placement asks of an outline, so the two cannot disagree (ADR-0207)', () => {
    expect(collapse(assertion.sql)).toContain('NOT outline_reaches_place(e.boundary, e.location)');
  });

  it('says how far the outline lies, in the unit a curator reads', () => {
    expect(assertion.describe({ experience_id: 22747, experience_name: 'Pergamon Altar', metres: 1_826_900 }))
      .toBe('Pergamon Altar: its outline lies 1826.9 km from its point (experience 22747)');
  });
});

describe("a whole's leaf its parts no longer give", () => {
  const assertion = byId('whole-leaves-out-of-step');
  const sql = collapse(assertion.sql);

  it("compares the rows with the refresh's own, over every whole (ADR-0206)", () => {
    expect(sql).toContain('FROM whole_leaves_expected(NULL) x');
    expect(sql).toContain('FULL JOIN whole_leaves wl ON wl.whole_id = x.whole_id AND wl.leaf_id = x.leaf_id');
    expect(sql).toContain('x.offered IS DISTINCT FROM wl.offered');
  });

  it('says in words what the whole counts, and what its parts say it should', () => {
    expect(assertion.describe({
      whole_id: 847, whole_name: 'Struve Geodetic Arc', leaf_id: 9001, leaf_name: 'Tartu Observatory',
      expected_offered: true, held_offered: null,
    })).toBe('Struve Geodetic Arc does not count Tartu Observatory, a place of its parts shown to readers '
      + '(experience 847, place 9001)');
    expect(assertion.describe({
      whole_id: 847, whole_name: 'Struve Geodetic Arc', leaf_id: 9001, leaf_name: 'Tartu Observatory',
      expected_offered: null, held_offered: true,
    })).toBe('Struve Geodetic Arc counts Tartu Observatory, which is no longer a place of its parts '
      + '(experience 847, place 9001)');
    expect(assertion.describe({
      whole_id: 57, whole_name: 'Wudang Mountains', leaf_id: 9002, leaf_name: 'Golden Hall',
      expected_offered: false, held_offered: true,
    })).toBe('Wudang Mountains counts Golden Hall as shown to readers, but it is not shown to readers '
      + '(experience 57, place 9002)');
  });
});
