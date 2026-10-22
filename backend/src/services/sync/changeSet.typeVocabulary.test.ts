import { describe, expect, it } from 'vitest';
import { computeChangeSet, type ExperienceSnapshot } from './changeSet.js';

/**
 * A type the kind's vocabulary does not hold, replaced by one it does, passes
 * the gate (#1807): the Arc de Triomphe, copied into Monuments & memorials by
 * the split with Public Art & Monuments' `monument`, and the Trevi Fountain,
 * left `monument` in Public art, whose words are sculpture, fountain and street art.
 */

const HELD = true;
const MONUMENTS = ['memorial', 'monument', 'arch', 'column', 'obelisk'];

function snapshot(overrides: Partial<ExperienceSnapshot> = {}): ExperienceSnapshot {
  return {
    name: 'Arc de Triomphe',
    nameLocal: {},
    subtitle: null,
    description: null,
    type: 'sculpture',
    tags: [],
    lon: 2.295,
    lat: 48.8738,
    countryCodes: ['FR'],
    countryNames: ['France'],
    imageUrl: null,
    metadata: {},
    ...overrides,
  };
}

describe('a type outside the kind\'s vocabulary (#1807)', () => {
  it('is written past the gate on a held row, and says why', () => {
    const result = computeChangeSet(snapshot(), snapshot({ type: 'arch', typeVocabulary: MONUMENTS }), [], HELD);
    expect(result.heldFields).toEqual([]);
    expect(result.changedFields.map(f => [f.field, f.held, f.passedTheGate]))
      .toEqual([['type', false, 'type-outside-vocabulary']]);
  });

  it('is written past the gate where the membership holds no type', () => {
    const result = computeChangeSet(snapshot({ type: null }), snapshot({ type: 'arch', typeVocabulary: MONUMENTS }), [], HELD);
    expect(result.changedFields.map(f => [f.field, f.passedTheGate])).toEqual([['type', 'type-outside-vocabulary']]);
  });

  it('holds a type moved inside the vocabulary', () => {
    const result = computeChangeSet(
      snapshot({ type: 'monument' }), snapshot({ type: 'arch', typeVocabulary: MONUMENTS }), [], HELD,
    );
    expect(result.heldFields.map(f => [f.field, f.passedTheGate])).toEqual([['type', undefined]]);
  });

  it('holds a type as before where the run declares no vocabulary, or proposes a word outside it', () => {
    expect(computeChangeSet(snapshot(), snapshot({ type: 'arch' }), [], HELD).heldFields.map(f => f.field))
      .toEqual(['type']);
    expect(computeChangeSet(snapshot(), snapshot({ type: 'fountain', typeVocabulary: MONUMENTS }), [], HELD)
      .heldFields.map(f => f.field)).toEqual(['type']);
  });

  it("keeps a curator's claim on a type outside the vocabulary", () => {
    const result = computeChangeSet(snapshot(), snapshot({ type: 'arch', typeVocabulary: MONUMENTS }), ['type'], HELD);
    expect(result.curatedConflicts.map(f => [f.field, f.passedTheGate])).toEqual([['type', undefined]]);
  });
});
