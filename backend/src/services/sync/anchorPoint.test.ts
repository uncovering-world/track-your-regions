import { describe, expect, it } from 'vitest';
import { medoidOf } from './anchorPoint.js';

/**
 * The point a place of several points is told to be at (ADR-0095): one of its
 * own points, the one nearest their centroid — for a serial site's components
 * and an edition's casts alike (#880).
 */
describe('medoidOf', () => {
  it('answers the most central point, never an average that lies in open water', () => {
    // Getbol's shape: parts strung along a coast, the first of them 300 km from the middle.
    const parts = [{ lat: 37.5, lon: 126.6 }, { lat: 35.0, lon: 126.2 }, { lat: 34.8, lon: 126.1 }];
    expect(medoidOf(parts)).toBe(parts[1]);
  });

  it("answers Maman's most central cast for the edition, not the first listed", () => {
    // The centroid of the four lies in the Atlantic off Iberia; Bilbao is nearest it.
    const casts = [
      { name: 'Ottawa', lat: 45.429333, lon: -75.697277 }, { name: 'Bilbao', lat: 43.269189, lon: -2.932958 },
      { name: 'London', lat: 51.507694, lon: -0.099333 }, { name: 'Minato', lat: 35.6610104, lon: 139.7296602 },
    ];
    expect(medoidOf(casts)).toBe(casts[1]);
  });

  it('takes longitudes the short way round across the antimeridian', () => {
    const points = [{ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 }, { lat: 0, lon: 179.8 }];
    expect(medoidOf(points)).toBe(points[2]);
  });

  it('answers the one point of one', () => {
    const only = [{ lat: 1, lon: 2 }];
    expect(medoidOf(only)).toBe(only[0]);
  });
});
