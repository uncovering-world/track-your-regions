import { describe, expect, it } from 'vitest';
import { computeVisitedStatus, wholeProgress } from './visits.js';

describe("a place's state from what the traveller visited of it (#2120)", () => {
  it('keeps a serial site partial after two of its three components', () => {
    expect(computeVisitedStatus(2, 3, false)).toBe('partial');
  });

  it('keeps a site ticked as a whole partial while its parts are not visited', () => {
    expect(computeVisitedStatus(0, 3, true)).toBe('partial');
  });

  it('marks a place visited once every point a reader is shown of it is', () => {
    expect(computeVisitedStatus(3, 3, false)).toBe('visited');
    expect(computeVisitedStatus(4, 4, true)).toBe('visited');
  });

  it('marks a ticked place with no point a reader is shown visited', () => {
    expect(computeVisitedStatus(0, 0, true)).toBe('visited');
  });

  it('leaves a place with nothing visited and no tick not visited', () => {
    expect(computeVisitedStatus(0, 4, false)).toBe('not_visited');
    expect(computeVisitedStatus(0, 0, false)).toBe('not_visited');
  });
});

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
