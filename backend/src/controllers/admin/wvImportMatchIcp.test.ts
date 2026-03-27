import { describe, it, expect } from 'vitest';
import { computeShoelaceArea, computeBboxFromDivisions, detectBboxInflation } from './wvImportMatchIcp.js';

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

describe('detectBboxInflation', () => {
  const TW = 800, TH = 600;

  it('returns true when both aspect ratio mismatch AND overflow exceed thresholds', () => {
    const gBbox = { minX: 0, maxX: 200, minY: 0, maxY: 100 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const overflow = 120; // 120/800 = 0.15 > 0.12
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(true);
  });

  it('returns false when aspect ratios are similar (compact country)', () => {
    const gBbox = { minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 340 };
    const overflow = 120;
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(false);
  });

  it('returns false when overflow is low (elongated but well-matched)', () => {
    const gBbox = { minX: 0, maxX: 200, minY: 0, maxY: 100 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const overflow = 50; // 50/800 = 0.0625 < 0.12
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(false);
  });

  it('returns false when both signals are below thresholds', () => {
    const gBbox = { minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 340 };
    const overflow = 50;
    expect(detectBboxInflation(gBbox, cBbox, overflow, TW, TH)).toBe(false);
  });
});
