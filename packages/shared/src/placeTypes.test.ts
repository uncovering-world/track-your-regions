import { describe, it, expect } from 'vitest';
import { TYPE_VOCABULARIES, typeValues } from './placeTypes.js';

describe("the kinds' type vocabularies", () => {
  it('give no two kinds the same value, so a value names its kind', () => {
    const owners = new Map<string, string>();
    for (const [kind, entries] of Object.entries(TYPE_VOCABULARIES)) {
      for (const { value } of entries) {
        expect(owners.get(value), `${value} is both ${owners.get(value)}'s and ${kind}'s`).toBeUndefined();
        owners.set(value, kind);
      }
    }
  });

  it('give every type a word of its own within its kind, never its raw value', () => {
    for (const entries of Object.values(TYPE_VOCABULARIES)) {
      const labels = entries.map((entry) => entry.label);
      expect(new Set(labels).size).toBe(labels.length);
      for (const { value, label } of entries) {
        expect(label.trim()).not.toBe('');
        expect(label).not.toBe(value);
      }
    }
  });

  it("list a kind's values in its order", () => {
    expect(typeValues('bridges-and-engineering')).toEqual([
      'aqueduct', 'bridge', 'inclined-plane', 'boat-lift', 'lock-flight', 'lock', 'dam', 'tunnel',
    ]);
  });
});
