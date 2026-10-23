import { describe, expect, it } from 'vitest';
import { computeChangeSet, passingColumns, type ExperienceSnapshot } from './changeSet.js';

/**
 * A short move of a held place passes the gate (#1837, ADR-0140): the Choragic
 * Monument of Lysicrates, moved 28 m onto the monument by Archaeology's run.
 */

const HELD = true;
const STORED = { lon: 23.73, lat: 37.970833 };
const ONTO_THE_MONUMENT = { lon: 23.729949, lat: 37.971083 };

function snapshot(overrides: Partial<ExperienceSnapshot> = {}): ExperienceSnapshot {
  return {
    name: 'Choragic Monument of Lysicrates', nameLocal: {}, subtitle: null, description: null, type: null,
    tags: [], ...STORED, countryCodes: ['GR'], countryNames: ['Greece'], imageUrl: null, metadata: {},
    ...overrides,
  };
}

const filed = (result: ReturnType<typeof computeChangeSet>) => ({
  written: result.changedFields.map(f => [f.field, f.passedTheGate]),
  held: result.heldFields.map(f => f.field),
});

describe('a short move of a place readers see', () => {
  it('is written past the gate where the database found it a short move', () => {
    const result = computeChangeSet(snapshot(), snapshot({ ...ONTO_THE_MONUMENT, shortMovePasses: true }), [], HELD);
    expect(filed(result)).toEqual({ written: [['location', 'short-move']], held: [] });
    expect(passingColumns(snapshot(), snapshot({ ...ONTO_THE_MONUMENT, shortMovePasses: true }), [])).toEqual(['location']);
  });

  it('is held where it did not: another place nearer, another division', () => {
    const result = computeChangeSet(snapshot(), snapshot({ ...ONTO_THE_MONUMENT, shortMovePasses: false }), [], HELD);
    expect(filed(result)).toEqual({ written: [], held: ['location'] });
  });

  it('is held at 250 m or more whatever the flag says, and kept behind a claim', () => {
    const far = snapshot({ lon: STORED.lon, lat: STORED.lat + 0.0025, shortMovePasses: true });
    expect(filed(computeChangeSet(snapshot(), far, [], HELD))).toEqual({ written: [], held: ['location'] });
    const claimed = computeChangeSet(snapshot(), snapshot({ ...ONTO_THE_MONUMENT, shortMovePasses: true }), ['location'], HELD);
    expect(claimed.curatedConflicts.map(f => f.field)).toEqual(['location']);
    expect(passingColumns(snapshot(), snapshot({ ...ONTO_THE_MONUMENT, shortMovePasses: true }), ['location'])).toEqual([]);
  });
});
