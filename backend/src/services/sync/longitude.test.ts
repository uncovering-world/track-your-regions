import { describe, it, expect } from 'vitest';
import { longitudeDelta, signedLongitudeDelta } from './longitude.js';

describe('signedLongitudeDelta', () => {
  it('goes the short way round across the antimeridian', () => {
    // A metre either side of the line: 0.2°, not 359.8° — and signed by direction.
    expect(signedLongitudeDelta(179.9, -179.9)).toBeCloseTo(0.2, 9);
    expect(signedLongitudeDelta(-179.9, 179.9)).toBeCloseTo(-0.2, 9);
  });

  it('is a plain subtraction away from the line', () => {
    expect(signedLongitudeDelta(10, 15)).toBeCloseTo(5, 9);
    expect(signedLongitudeDelta(15, 10)).toBeCloseTo(-5, 9);
  });

  it('answers the far side of the planet as −180, whichever way it is asked', () => {
    // Half a turn has no short way round; the formula lands on the closed end.
    expect(signedLongitudeDelta(0, 180)).toBe(-180);
    expect(signedLongitudeDelta(0, -180)).toBe(-180);
    expect(signedLongitudeDelta(180, 0)).toBe(-180);
  });
});

describe('longitudeDelta', () => {
  it('is the absolute short-way-round separation', () => {
    expect(longitudeDelta(179.9, -179.9)).toBeCloseTo(0.2, 9);
    expect(longitudeDelta(-179.9, 179.9)).toBeCloseTo(0.2, 9);
    expect(longitudeDelta(-90, 90)).toBe(180);
  });
});
