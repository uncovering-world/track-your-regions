import { describe, expect, it } from 'vitest';
import { distanceMeters, LOCATION_MAJOR_METERS, LOCATION_UNCHANGED_METERS } from './moves.js';

describe('distanceMeters', () => {
  it('measures a degree of latitude as about 111 km', () => {
    expect(distanceMeters(0, 0, 0, 1)).toBeCloseTo(111_195, -1);
  });

  it('measures across the antimeridian the short way', () => {
    // 179.5°E to 179.5°W is one degree at the equator, not 359.
    expect(distanceMeters(179.5, 0, -179.5, 0)).toBeCloseTo(111_195, -1);
  });

  it('is zero for the same point', () => {
    expect(distanceMeters(-2.935, 43.263, -2.935, 43.263)).toBe(0);
  });
});

describe('the move thresholds', () => {
  it('forgive a rewrite before they call anything a move, and call a kilometre major', () => {
    expect(LOCATION_UNCHANGED_METERS).toBeLessThan(LOCATION_MAJOR_METERS);
    expect(LOCATION_MAJOR_METERS).toBe(1000);
  });
});
