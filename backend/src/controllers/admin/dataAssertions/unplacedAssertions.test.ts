/**
 * The checks of objects and places no region holds, read as the panel reads
 * them (#469). The statements themselves run against PostgreSQL in
 * `unplacedAssertions.db.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { experienceOfferedToReaderSql, hideLostSql, offeredLocationSql } from '../../../db/readerPredicates.js';
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
    expect(sql).toContain(collapse(hideLostSql()));
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
