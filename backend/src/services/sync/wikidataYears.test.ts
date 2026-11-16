import { describe, expect, it } from 'vitest';
import { itemYearOf } from './wikidataYears.js';

describe('a year the query service gives, in the item\'s own numbering (#2564)', () => {
  it('turns a BC year given to the year or finer back by one: the Lion Capital of Ashoka is 250 BC', () => {
    expect(itemYearOf(-249, 9)).toBe(-250);
    expect(itemYearOf(-195, 11)).toBe(-196);
    expect(itemYearOf(0, 10)).toBe(-1);
  });

  it('leaves a BC year given to the decade or coarser as it came, and every AD year', () => {
    expect(itemYearOf(-1300, 7)).toBe(-1300);
    expect(itemYearOf(-9999, 6)).toBe(-9999);
    expect(itemYearOf(1966, 11)).toBe(1966);
    expect(itemYearOf(1, 9)).toBe(1);
  });

  it('reads a year the service bound no precision for as given to the year', () => {
    expect(itemYearOf(-249, null)).toBe(-250);
    expect(itemYearOf(-249, undefined)).toBe(-250);
  });
});
