import { describe, it, expect } from 'vitest';
import { findCommonPrefix } from './index';

describe('findCommonPrefix', () => {
  it('returns empty string for empty array', () => {
    expect(findCommonPrefix([])).toBe('');
  });

  it('returns the string itself for single-element array', () => {
    expect(findCommonPrefix(['hello'])).toBe('hello');
  });

  it('finds common prefix of similar strings', () => {
    expect(findCommonPrefix(['South America', 'South Africa', 'South Asia']))
      .toBe('South A');
  });

  it('returns empty string when no common prefix exists', () => {
    expect(findCommonPrefix(['North', 'South', 'East'])).toBe('');
  });

  it('trims trailing spaces and special characters from prefix', () => {
    // Common prefix is "Region - " but trailing " - " should be trimmed
    expect(findCommonPrefix(['Region - North', 'Region - South']))
      .toBe('Region');
  });

  it('trims trailing commas and colons', () => {
    expect(findCommonPrefix(['Category: A', 'Category: B']))
      .toBe('Category');
  });

  it('handles identical strings', () => {
    expect(findCommonPrefix(['same', 'same', 'same'])).toBe('same');
  });

  it('is limited by the shortest string', () => {
    expect(findCommonPrefix(['ab', 'abcd', 'abcdef'])).toBe('ab');
  });

  it('handles strings with trailing separators correctly', () => {
    // Common prefix is "Europe, " — trailing ", " should be trimmed
    expect(findCommonPrefix(['Europe, Western', 'Europe, Eastern']))
      .toBe('Europe');
  });

  it('handles single-character common prefix', () => {
    expect(findCommonPrefix(['Apple', 'Avocado', 'Artichoke'])).toBe('A');
  });

  it('trims trailing dots and semicolons', () => {
    expect(findCommonPrefix(['Item. A', 'Item. B'])).toBe('Item');
    expect(findCommonPrefix(['Code; X', 'Code; Y'])).toBe('Code');
  });
});
