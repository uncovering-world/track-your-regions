import { describe, it, expect } from 'vitest';
import { computeShoelaceArea, computeBboxFromDivisions } from './wvImportMatchIcp.js';

describe('computeShoelaceArea', () => {
  it('computes area of a unit square', () => {
    const points: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(computeShoelaceArea(points)).toBeCloseTo(1.0);
  });

  it('computes area of a right triangle', () => {
    const points: Array<[number, number]> = [[0, 0], [4, 0], [0, 3]];
    expect(computeShoelaceArea(points)).toBeCloseTo(6.0);
  });

  it('returns 0 for degenerate polygon (line)', () => {
    const points: Array<[number, number]> = [[0, 0], [1, 1], [2, 2]];
    expect(computeShoelaceArea(points)).toBeCloseTo(0);
  });

  it('handles clockwise and counter-clockwise winding identically', () => {
    const ccw: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const cw: Array<[number, number]> = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(computeShoelaceArea(ccw)).toBeCloseTo(computeShoelaceArea(cw));
  });
});

describe('computeBboxFromDivisions', () => {
  it('computes tight bbox around all divisions', () => {
    const divs = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 5, area: 50 },
      { id: 2, minX: 8, maxX: 20, minY: 3, maxY: 8, area: 60 },
    ];
    const bbox = computeBboxFromDivisions(divs);
    expect(bbox).toEqual({ minX: 0, maxX: 20, minY: 0, maxY: 8 });
  });

  it('handles single division', () => {
    const divs = [{ id: 1, minX: 5, maxX: 15, minY: 2, maxY: 7, area: 50 }];
    const bbox = computeBboxFromDivisions(divs);
    expect(bbox).toEqual({ minX: 5, maxX: 15, minY: 2, maxY: 7 });
  });
});
