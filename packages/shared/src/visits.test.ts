import { describe, expect, it } from 'vitest';
import { computeVisitedStatus } from './visits.js';

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
