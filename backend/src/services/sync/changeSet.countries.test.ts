import { describe, expect, it } from 'vitest';
import { computeChangeSet, type ExperienceSnapshot } from './changeSet.js';

/**
 * A place's countries are shown to no reader (#1579), so a run writes their
 * change past the gate, and a curator's claim still keeps them.
 */

const HELD = true;

function snapshot(overrides: Partial<ExperienceSnapshot> = {}): ExperienceSnapshot {
  return {
    name: 'Salamis',
    nameLocal: {},
    description: null,
    shortDescription: null,
    type: null,
    tags: [],
    lon: 33.9,
    lat: 35.18,
    countryCodes: ['CY'],
    countryNames: ['Cyprus'],
    imageUrl: null,
    metadata: {},
    ...overrides,
  };
}
describe("a place's countries (#1579)", () => {
  it('are filed as written on a held row, since no reader sees them', () => {
    const result = computeChangeSet(
      snapshot({ countryNames: ['Cyprus'], countryCodes: ['CY'] }),
      snapshot({ countryNames: ['Northern Cyprus'], countryCodes: [] }),
      [], HELD,
    );
    expect(result.changedFields.map(f => f.field).sort()).toEqual(['countryCodes', 'countryNames']);
    expect(result.changedFields.every(f => f.held === false)).toBe(true);
    expect(result.heldFields).toEqual([]);
  });

  it('are kept behind a curator\'s claim', () => {
    const result = computeChangeSet(
      snapshot({ countryNames: ['Cyprus'] }), snapshot({ countryNames: ['Northern Cyprus'] }), ['country_names'], HELD,
    );
    expect(result.curatedConflicts.map(f => f.field)).toEqual(['countryNames']);
  });
});
