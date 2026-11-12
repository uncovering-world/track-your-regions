import { describe, expect, it } from 'vitest';
import { commemoratesOf, depictsOf, onBothLines, sameSubjects } from './commemorates.js';

// The Monument to Minin and Pozharsky (Q187531) depicts Dmitry Pozharsky (Q15756) and Kuzma Minin (Q469785).
const POZHARSKY = { item: 'Q15756', label: 'Dmitry Pozharsky', articleUrl: 'https://en.wikipedia.org/wiki/Dmitry_Pozharsky' };
const MININ = { item: 'Q469785', label: 'Kuzma Minin', articleUrl: null };

describe('whom a place commemorates, as stored (#2144)', () => {
  it('reads a stored value key by key, and nothing that is not one', () => {
    expect(commemoratesOf({ via: 'depicts', subjects: [{ ...POZHARSKY, extra: 1 }, MININ] }))
      .toEqual({ via: 'depicts', subjects: [POZHARSKY, MININ] });
    expect(commemoratesOf({ via: 'guess', subjects: [POZHARSKY] })).toBeNull();
    // The step that reads a dedication from the place's lead (#2472) is a step like any other.
    expect(commemoratesOf({ via: 'lead', subjects: [MININ] })).toEqual({ via: 'lead', subjects: [MININ] });
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

// Big Vishnu (Garuda Wisnu Kencana, Q12498977) shows Vishnu (Q11380) riding Garuda (Q188676).
const GARUDA = { item: 'Q188676', label: 'Garuda', articleUrl: 'https://en.wikipedia.org/wiki/Garuda' };
const VISHNU = { item: 'Q11380', label: 'Vishnu', articleUrl: 'https://en.wikipedia.org/wiki/Vishnu' };

describe('the figures a work depicts, as stored (#2404, #2421)', () => {
  it("reads a run's list and a curator's", () => {
    expect(depictsOf({ via: 'main-subject', subjects: [GARUDA] })).toEqual({ via: 'main-subject', subjects: [GARUDA] });
    expect(depictsOf({ via: 'curator', subjects: [VISHNU, GARUDA] })).toEqual({ via: 'curator', subjects: [VISHNU, GARUDA] });
  });

  it("keeps a curator's empty list as their word that the work shows no named figure, and a run's as none", () => {
    expect(depictsOf({ via: 'curator', subjects: [] })).toEqual({ via: 'curator', subjects: [] });
    expect(depictsOf({ via: 'main-subject', subjects: [] })).toBeNull();
  });

  it('reads no dedication step as a depiction', () => {
    expect(depictsOf({ via: 'commemorates', subjects: [GARUDA] })).toBeNull();
  });

  it("finds a curator's list that names the run's figures the same", () => {
    expect(sameSubjects({ via: 'curator', subjects: [GARUDA] }, { via: 'main-subject', subjects: [GARUDA] })).toBe(true);
    expect(sameSubjects({ via: 'curator', subjects: [VISHNU, GARUDA] }, { via: 'main-subject', subjects: [GARUDA] })).toBe(false);
  });
});

describe('a subject on both lines (#2421)', () => {
  // Big Vishnu: Garuda (Q188676) read as commemorated, Vishnu (Q11380) and Garuda listed as depicted.
  const VISHNU = { item: 'Q11380', label: 'Vishnu', articleUrl: null };
  const GARUDA = { item: 'Q188676', label: 'Garuda', articleUrl: null };

  it('names the items both lines list, a curator\'s list on either side included', () => {
    expect(onBothLines({ via: 'statues-category', subjects: [GARUDA] }, { via: 'curator', subjects: [VISHNU, GARUDA] })).toEqual(['Q188676']);
    expect(onBothLines({ via: 'curator', subjects: [GARUDA] }, { via: 'main-subject', subjects: [VISHNU] })).toEqual([]);
    expect(onBothLines(undefined, { via: 'curator', subjects: [] })).toEqual([]);
  });
});
