import { describe, expect, it } from 'vitest';
import { computeChangeSet, type ExperienceSnapshot } from './changeSet.js';

/**
 * A subtitle arriving where the place holds none passes the gate (ADR-0133):
 * Ajanta Caves, made by the UNESCO run with its paragraph and no subtitle, and
 * admitted by Places of worship and Archaeology, which both bring Wikidata's line.
 */

const HELD = true;
const LINE = '2nd century BCE to 1st century CE Buddhist cave monuments located in Maharashtra, India';

function snapshot(overrides: Partial<ExperienceSnapshot> = {}): ExperienceSnapshot {
  return {
    name: 'Ajanta Caves',
    nameLocal: {},
    subtitle: null,
    description: 'The first Buddhist cave monuments at Ajanta date from the 2nd and 1st centuries B.C.',
    type: null,
    tags: [],
    lon: 75.7,
    lat: 20.55,
    countryCodes: ['IN'],
    countryNames: ['India'],
    imageUrl: null,
    metadata: {},
    ...overrides,
  };
}

describe('a subtitle where the place holds none (#1795)', () => {
  it('is written past the gate on a held row, and says why', () => {
    for (const empty of [null, '']) {
      const result = computeChangeSet(snapshot({ subtitle: empty }), snapshot({ subtitle: LINE }), [], HELD);
      expect(result.heldFields).toEqual([]);
      expect(result.changedFields.map(f => [f.field, f.held, f.passedTheGate]))
        .toEqual([['subtitle', false, 'first-subtitle']]);
    }
  });

  it('is written as any change on a row the gate does not hold', () => {
    const result = computeChangeSet(snapshot(), snapshot({ subtitle: LINE }), [], false);
    expect(result.changedFields.map(f => [f.field, f.passedTheGate])).toEqual([['subtitle', undefined]]);
  });

  it('holds a subtitle replaced or removed', () => {
    const replaced = computeChangeSet(snapshot({ subtitle: 'cave monuments' }), snapshot({ subtitle: LINE }), [], HELD);
    expect(replaced.heldFields.map(f => [f.field, f.passedTheGate])).toEqual([['subtitle', undefined]]);
    const removed = computeChangeSet(snapshot({ subtitle: LINE }), snapshot({ subtitle: null }), [], HELD);
    expect(removed.heldFields.map(f => f.field)).toEqual(['subtitle']);
  });

  it("keeps a curator's claim on an empty subtitle", () => {
    const result = computeChangeSet(snapshot(), snapshot({ subtitle: LINE }), ['subtitle'], HELD);
    expect(result.curatedConflicts.map(f => [f.field, f.passedTheGate])).toEqual([['subtitle', undefined]]);
    expect(result.changedFields).toEqual([]);
  });

  it('passes nothing but the subtitle: an empty description stays held', () => {
    const result = computeChangeSet(snapshot({ description: null }), snapshot({ description: 'A paragraph.' }), [], HELD);
    expect(result.heldFields.map(f => f.field)).toEqual(['description']);
  });
});
