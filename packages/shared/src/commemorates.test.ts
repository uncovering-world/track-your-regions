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
});
