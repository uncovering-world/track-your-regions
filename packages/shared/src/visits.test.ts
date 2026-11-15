import { describe, expect, it } from 'vitest';
import { wholeProgress } from './visits.js';

describe("a whole's count over its offered leaves (ADR-0206)", () => {
  it('reads the Struve Geodetic Arc after one station as 1 of 34', () => {
    expect(wholeProgress(1, 34, true)).toEqual({ visited: 1, total: 34 });
  });

  it('reads a whole visited with no offered leaf named as ? of N', () => {
    expect(wholeProgress(0, 34, true)).toEqual({ visited: null, total: 34 });
  });

  it('reads a whole the traveller has not been to as 0 of N', () => {
    expect(wholeProgress(0, 34, false)).toEqual({ visited: 0, total: 34 });
  });

  it('gives a whole with no offered leaf no count, visited or not', () => {
    expect(wholeProgress(0, 0, true)).toBeNull();
    expect(wholeProgress(0, 0, false)).toBeNull();
  });
});
