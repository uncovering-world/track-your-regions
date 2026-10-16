import { describe, expect, it } from 'vitest';
import { countryOfPlace, standingCountries } from './countryOfPlace.js';

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
      { country: 'Q2277', stands: false }, { country: 'Q43', stands: true }, { country: 'Q12560', stands: false },
    ])).toEqual(['Q43']);
  });

  it('keeps every country when none holds, rather than none', () => {
    // Mediolanum is stated in Ancient Rome (Q1747689) alone.
    expect(standingCountries([{ country: 'Q1747689', stands: false }])).toEqual(['Q1747689']);
    expect(standingCountries([])).toEqual([]);
  });
});
