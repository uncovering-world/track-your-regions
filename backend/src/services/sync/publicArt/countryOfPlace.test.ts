import { describe, expect, it } from 'vitest';
import { countryOfPlace, openCountries, standingCountries } from './countryOfPlace.js';

describe('countryOfPlace (#1533)', () => {
  it('keeps the first country where the point names no part, and one no part needs', () => {
    expect(countryOfPlace(['Q38'], null)).toBe('Q38');
    expect(countryOfPlace(['Q36', 'Q7318'], null)).toBe('Q36');
    expect(countryOfPlace(['Q945', 'Q945'], new Set(['Q962']))).toBe('Q945');
    expect(countryOfPlace([], new Set(['Q962']))).toBeNull();
  });

  it('names the country the point\'s part stands in, and none when no part agrees', () => {
    expect(countryOfPlace(['Q29', 'Q16', 'Q145', 'Q17'], new Set(['Q17']))).toBe('Q17');
    expect(countryOfPlace(['Q29', 'Q16'], new Set(['Q17']))).toBeNull();
    expect(countryOfPlace(['Q29', 'Q16'], new Set())).toBeNull();
  });
});

describe('standingCountries (#757)', () => {
  it('keeps the countries that still hold, in their order', () => {
    // Ephesus: the Roman Empire (Q2277) and the Ottoman Empire (Q12560) are gone, Turkey (Q43) stands.
    expect(standingCountries([
      { country: 'Q2277', stands: false, sovereign: false }, { country: 'Q43', stands: true, sovereign: true }, { country: 'Q12560', stands: false, sovereign: false },
    ])).toEqual(['Q43']);
  });

  it('prefers a sovereign state to a country no statement ended that is none (#1575)', () => {
    // A church stated in the Kingdom of Denmark (Q756617) and Denmark (Q35), its
    // constituent country; Shechem in the United Kingdom of Israel (Q3185305) alone,
    // an ancient state the subset holds no dissolution for.
    expect(standingCountries([
      { country: 'Q35', stands: true, sovereign: false }, { country: 'Q756617', stands: true, sovereign: true },
    ])).toEqual(['Q756617']);
    expect(standingCountries([{ country: 'Q3185305', stands: true, sovereign: false }])).toEqual(['Q3185305']);
  });

  it('keeps every country when none holds, rather than none', () => {
    // Mediolanum is stated in Ancient Rome (Q1747689) alone.
    expect(standingCountries([{ country: 'Q1747689', stands: false, sovereign: false }])).toEqual(['Q1747689']);
    expect(standingCountries([])).toEqual([]);
  });
});

describe('openCountries (#1564)', () => {
  it('opens two standing countries no part chose between', () => {
    // Sant'Ambrogio: Russia (Q159) and Italy (Q38), both standing.
    expect(openCountries([{ country: 'Q159', stands: true, sovereign: true }, { country: 'Q38', stands: true, sovereign: true }], null))
      .toEqual({ keys: ['Q159', 'Q38'], noneStands: false, sovereign: new Set(['Q159', 'Q38']) });
  });

  it('opens a place where no country stands, and settles one standing country or a part', () => {
    expect(openCountries([{ country: 'Q1747689', stands: false, sovereign: false }], null)).toEqual({ keys: ['Q1747689'], noneStands: true, sovereign: new Set() });
    expect(openCountries([{ country: 'Q38', stands: true, sovereign: true }, { country: 'Q2277', stands: false, sovereign: false }], null)).toBeNull();
    expect(openCountries([{ country: 'Q29', stands: true, sovereign: true }, { country: 'Q145', stands: true, sovereign: true }], new Set(['Q145']))).toBeNull();
    expect(openCountries([], null)).toBeNull();
  });

  it('opens a country no statement ended that is no sovereign state, for the point to judge (#1575)', () => {
    // Shechem: the United Kingdom of Israel (Q3185305), ancient, with no P576 the reader sees.
    expect(openCountries([{ country: 'Q3185305', stands: true, sovereign: false }], null))
      .toEqual({ keys: ['Q3185305'], noneStands: false, sovereign: new Set() });
    // Nagaoka-kyō: an item (Q132869361) the reader holds nothing of.
    expect(openCountries([{ country: 'Q132869361', stands: true, sovereign: false }], null))
      .toEqual({ keys: ['Q132869361'], noneStands: false, sovereign: new Set() });
    // A place on the border, stated in Denmark (Q35) and Germany (Q183), stays open too,
    // so the point can say which of them holds it.
    expect(openCountries([
      { country: 'Q35', stands: true, sovereign: false }, { country: 'Q183', stands: true, sovereign: true },
    ], null)).toEqual({ keys: ['Q35', 'Q183'], noneStands: false, sovereign: new Set(['Q183']) });
  });
});
