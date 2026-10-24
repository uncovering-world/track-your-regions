import { describe, expect, it } from 'vitest';
import { computeVisitedStatus } from './visits.js';

describe('a visit to an edition rather than a serial site (ADR-0145)', () => {
  it('marks a work visited after one of its four casts was visited', () => {
    expect(computeVisitedStatus(1, 4, true)).toBe('visited');
  });

  it('keeps a serial site partial after one of its four components', () => {
    expect(computeVisitedStatus(1, 4, false)).toBe('partial');
  });

  it.each([false, true])('requires a visit and recognises every point visited (casts=%s)', (castPoints) => {
    expect(computeVisitedStatus(0, 4, castPoints)).toBe('not_visited');
    expect(computeVisitedStatus(0, 0, castPoints)).toBe('not_visited');
    expect(computeVisitedStatus(4, 4, castPoints)).toBe('visited');
  });
});
