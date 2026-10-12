/**
 * The third door's keys (#1394): a component number with its inscription's
 * variant left out, on real numbers of the list and of Wikidata.
 */

import { describe, it, expect } from 'vitest';
import { byComponentKey, componentKey, numberedFor } from './componentItemNumbered.js';
import type { CandidateItem } from './componentItemMatching.js';

describe('componentKey', () => {
  it('leaves the variant out and keeps the part', () => {
    expect(componentKey('1593bis-006', true)).toBe('1593|006');
    expect(componentKey('1593-006', false)).toBe('1593|006');
    expect(componentKey('1555rev-001', false)).toBe('1555|001');
  });

  it("drops the list's padding and never Wikidata's", () => {
    expect(componentKey('087-001', true)).toBe('87|001');
    expect(componentKey('087-001', false)).toBe('087|001');
  });

  it('has no key for a property number without a part', () => {
    expect(componentKey('1593', true)).toBeNull();
    expect(componentKey('sportif', false)).toBeNull();
  });
});

describe('numberedFor', () => {
  const osamezuka: CandidateItem = { item: 'Q11410610', labels: [], coords: [], references: ['1593-006'] };
  const sameNumber: CandidateItem = { item: 'Q999001', labels: [], coords: [], references: ['1593bis-006'] };
  const byKey = byComponentKey([osamezuka, sameNumber]);

  it("finds the items under the point's number in another variant", () => {
    expect(numberedFor({ externalRef: '1593bis-006' }, byKey).map(c => c.item)).toEqual(['Q11410610']);
  });

  it("leaves out an item carrying the point's own reference, which the reference reader takes", () => {
    expect(numberedFor({ externalRef: '1593bis-006' }, byKey).some(c => c.item === 'Q999001')).toBe(false);
  });

  it('finds nothing for another part of the same property', () => {
    expect(numberedFor({ externalRef: '1593bis-007' }, byKey)).toEqual([]);
  });
});
