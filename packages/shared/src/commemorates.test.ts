import { describe, expect, it } from 'vitest';
import { commemoratesOf, sameSubjects } from './commemorates.js';

// The Monument to Minin and Pozharsky (Q187531) depicts Dmitry Pozharsky (Q15756) and Kuzma Minin (Q469785).
const POZHARSKY = { item: 'Q15756', label: 'Dmitry Pozharsky', articleUrl: 'https://en.wikipedia.org/wiki/Dmitry_Pozharsky' };
const MININ = { item: 'Q469785', label: 'Kuzma Minin', articleUrl: null };

describe('whom a place commemorates, as stored (#2144)', () => {
  it('reads a stored value key by key, and nothing that is not one', () => {
    expect(commemoratesOf({ via: 'depicts', subjects: [{ ...POZHARSKY, extra: 1 }, MININ] }))
      .toEqual({ via: 'depicts', subjects: [POZHARSKY, MININ] });
    expect(commemoratesOf({ via: 'guess', subjects: [POZHARSKY] })).toBeNull();
    expect(commemoratesOf({ via: 'depicts', subjects: [{ item: 'Q15756', label: '' }] })).toBeNull();
    expect(commemoratesOf(null)).toBeNull();
  });

  it('calls two values the same when they name the same items, whatever their order, words or step', () => {
    expect(sameSubjects({ via: 'depicts', subjects: [POZHARSKY, MININ] },
      { via: 'main-subject', subjects: [{ ...MININ, label: 'Minin' }, { ...POZHARSKY, articleUrl: null }] })).toBe(true);
    expect(sameSubjects({ via: 'depicts', subjects: [POZHARSKY, MININ] }, { via: 'depicts', subjects: [POZHARSKY] })).toBe(false);
  });

  it("keeps a curator's list, even one naming nobody, and a reading's only where it names someone", () => {
    expect(commemoratesOf({ via: 'curator', subjects: [MININ] })).toEqual({ via: 'curator', subjects: [MININ] });
    // The curator's word that the place commemorates nobody, which a run must not undo.
    expect(commemoratesOf({ via: 'curator', subjects: [] })).toEqual({ via: 'curator', subjects: [] });
    expect(commemoratesOf({ via: 'depicts', subjects: [] })).toBeNull();
  });

  it("reads a curator's empty list as naming nobody, as no value does", () => {
    const nobody = { via: 'curator', subjects: [] };
    expect(sameSubjects(nobody, undefined)).toBe(true);
    expect(sameSubjects(nobody, null)).toBe(true);
    expect(sameSubjects(nobody, { via: 'depicts', subjects: [POZHARSKY] })).toBe(false);
    expect(sameSubjects({ via: 'curator', subjects: [POZHARSKY, MININ] }, { via: 'depicts', subjects: [MININ, POZHARSKY] })).toBe(true);
  });
});
