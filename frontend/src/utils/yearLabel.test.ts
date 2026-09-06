import { describe, it, expect } from 'vitest';
import { yearLabel } from './yearLabel';

describe('yearLabel', () => {
  it('says nothing for a work with no date', () => {
    expect(yearLabel(null)).toBeNull();
    expect(yearLabel(undefined)).toBeNull();
  });

  it('writes both sides of zero out, so neither reads as the other', () => {
    // The Borghese Gladiator, Louvre.
    expect(yearLabel(-100)).toBe('100 BC');
    // The Ares Borghese beside it, four hundred years the other way.
    expect(yearLabel(200)).toBe('AD 200');
  });

  it('drops the era once nothing else could be meant', () => {
    expect(yearLabel(1503)).toBe('1503');
    expect(yearLabel(1000)).toBe('1000');
    expect(yearLabel(999)).toBe('AD 999');
  });

  it('reaches as far back as the catalogue does, grouped so it can be read', () => {
    // The Lion man of the Hohlenstein Stadel, Museum Ulm. A Palaeolithic date is
    // a number before it is a year: "38000 BC" has to be counted.
    expect(yearLabel(-38000)).toBe('38,000 BC');
    expect(yearLabel(-400000)).toBe('400,000 BC');
    // A year itself is never grouped — "1,503" reads as a quantity.
    expect(yearLabel(1503)).toBe('1503');
    // And the grouping starts where the counting does.
    expect(yearLabel(-450)).toBe('450 BC');
  });
});
