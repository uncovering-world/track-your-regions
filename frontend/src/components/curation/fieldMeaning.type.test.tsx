/**
 * A type is explained in the words of the vocabulary its value is from.
 *
 * A type is explained in the words of the vocabulary its value is from — never
 * one sentence for every kind, opening with UNESCO's, on a monument's card
 * (#814). The proposed value picks the vocabulary; where a proposal
 * clears the field, the stored value does — a curator reading "monument → (none)"
 * still needs to know which vocabulary the row is about.
 */

import { describe, it, expect } from 'vitest';
import { meaningOf } from './fieldMeaning';

describe("a type's meaning", () => {
  it('speaks a monument\'s vocabulary for a memorial and World Heritage\'s for a natural site', () => {
    expect(meaningOf('type', 'memorial', 'monument').what).toMatch(/an arch, a column, an obelisk/);
    expect(meaningOf('type', 'fountain', 'sculpture').what).toMatch(/a fountain before a sculpture/);
    expect(meaningOf('type', 'natural', 'cultural').what).toMatch(/World Heritage/);
    expect(meaningOf('type', 'natural', 'cultural').what).not.toMatch(/monument/);
  });

  it('reads the stored value where the proposal clears the field', () => {
    expect(meaningOf('type', '', 'monument').what).toMatch(/an arch, a column, an obelisk/);
    expect(meaningOf('type', null, 'cultural').what).toMatch(/World Heritage/);
  });

  it('falls back to the one sentence for every kind when no value names a vocabulary', () => {
    const fallback = meaningOf('type', '', null);
    expect(fallback.label).toBe('type');
    expect(fallback.what).toMatch(/cultural, natural or mixed/);
    expect(fallback.what).toMatch(/sculpture, fountain, street art or clock/);
    expect(fallback.what).toMatch(/memorial, arch, column, obelisk or monument/);
  });

  it('is never called category', () => {
    // That word is the chip beside the object's name — the kind.
    expect(meaningOf('type', 'monument').label).toBe('type');
  });
});
