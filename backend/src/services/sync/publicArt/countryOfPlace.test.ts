import { describe, expect, it } from 'vitest';
import { countryOfPlace } from './countryOfPlace.js';

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
