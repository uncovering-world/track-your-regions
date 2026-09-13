import { describe, it, expect } from 'vitest';
import {
  MUSEUM_ROOTS, FIND_CLASSES, NOT_A_FIND, NATURE_CATEGORY, DEPARTMENT_CATEGORIES,
  buildArchaeologyTrees, ANCIENT_CUTOFF_YEAR, NATURAL_HISTORY_ROOT, ARTEFACT_ROOT,
  ARCHAEOLOGICAL_PARK,
} from './classes.js';

describe('archaeology classes', () => {
  it('names the two museum roots the survey used', () => {
    expect(Object.keys(MUSEUM_ROOTS).sort()).toEqual(['Q3329412', 'Q3330834']);
  });
  it('reads the category that says what a museum is, and the ones that name a department', () => {
    expect(NATURE_CATEGORY.test('Archaeological museums in France')).toBe(true);
    expect(NATURE_CATEGORY.test('Museums of ancient Rome in Russia')).toBe(false);
    expect(DEPARTMENT_CATEGORIES.some((c) => c.test('Egyptological collections in Russia'))).toBe(true);
    expect(DEPARTMENT_CATEGORIES.some((c) => c.test('Art museums and galleries in Paris'))).toBe(false);
  });
  it('keeps fossils and diamonds out of the finds', () => {
    expect(NOT_A_FIND.Q40614).toMatch(/fossil/);
    expect(FIND_CLASSES.Q40614).toBeUndefined();
  });
  it('builds the three trees as sets', () => {
    const trees = buildArchaeologyTrees({
      museum: ['Q3329412'], park: [], naturalHistory: ['Q1970365'], artefact: ['Q220659'],
    });
    expect(trees.museum.has('Q3329412')).toBe(true);
  });
  it('takes the whole park tree out of the museum set, keeps it, and floors the other two', () => {
    const t = buildArchaeologyTrees({
      museum: ['Q3329412', 'Q3363945', 'Q11665453'],
      park: ['Q3363945', 'Q11665453'],
      naturalHistory: [],
      artefact: [],
    });
    expect(t.museum.has('Q3363945')).toBe(false);
    expect(t.museum.has('Q11665453')).toBe(false);
    expect(t.museum.has('Q3329412')).toBe(true);
    // Kept, not discarded: the category door needs something to ask.
    expect(t.park.has('Q11665453')).toBe(true);
    expect(t.park.has(ARCHAEOLOGICAL_PARK)).toBe(true);
    expect(t.naturalHistory.has(NATURAL_HISTORY_ROOT)).toBe(true);
    expect(t.artefact.has(ARTEFACT_ROOT)).toBe(true);
  });
  it('cuts the art pool at AD 500', () => {
    expect(ANCIENT_CUTOFF_YEAR).toBe(500);
  });
});
