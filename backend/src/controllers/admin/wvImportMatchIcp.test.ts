import { describe, it, expect } from 'vitest';
import { computeShoelaceArea, computeBboxFromDivisions, detectBboxInflation, findBboxOutliers, findOverlapOutliers } from './wvImportMatchIcp.js';

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

  it('returns true when aspect ratio mismatch + moderate overflow', () => {
    const gBbox = { minX: 0, maxX: 200, minY: 0, maxY: 100 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    expect(detectBboxInflation(gBbox, cBbox, 120, 10, TW, TH)).toBe(true);
  });

  it('returns true when overflow alone is very high', () => {
    const gBbox = { minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 340 };
    expect(detectBboxInflation(gBbox, cBbox, 130, 5, TW, TH)).toBe(true);
  });

  it('returns true when scale asymmetry + high mean error (low overflow)', () => {
    // Simulates Western Java: scaleAsymmetry=1.34, low overflow, high error
    // GADM 3.7:2.6, CV 620:327 → scaleAsymmetry ≈ 1.33
    const gBbox = { minX: 0, maxX: 3.73, minY: 0, maxY: 2.64 };
    const cBbox = { minX: 81, maxX: 701, minY: 118, maxY: 445 };
    // overflow=27 (3.4%), error=22 (2.8%) — overflow low but error high
    expect(detectBboxInflation(gBbox, cBbox, 27, 22, TW, TH)).toBe(true);
  });

  it('returns true when mean error alone is very high', () => {
    const gBbox = { minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 340 };
    // Low overflow, matching shapes, but very high error (>3%)
    expect(detectBboxInflation(gBbox, cBbox, 20, 30, TW, TH)).toBe(true);
  });

  it('returns false when all metrics are good', () => {
    const gBbox = { minX: 0, maxX: 100, minY: 0, maxY: 80 };
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 340 };
    // Low overflow, low error, matching shapes
    expect(detectBboxInflation(gBbox, cBbox, 20, 8, TW, TH)).toBe(false);
  });
});

describe('findBboxOutliers', () => {
  it('excludes a small distant island that inflates the bbox', () => {
    const divBboxes = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 100 },
      { id: 2, minX: 10, maxX: 20, minY: 0, maxY: 10, area: 100 },
      { id: 3, minX: 0, maxX: 10, minY: 10, maxY: 20, area: 100 },
      { id: 4, minX: 95, maxX: 100, minY: 5, maxY: 10, area: 25 },
    ];
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    expect(excluded).toContain(4);
    expect(excluded).not.toContain(1);
    expect(excluded).not.toContain(2);
    expect(excluded).not.toContain(3);
  });

  it('does not exclude large divisions (area guard)', () => {
    const divBboxes = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 50 },
      { id: 2, minX: 50, maxX: 100, minY: 0, maxY: 10, area: 60 },
    ];
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    expect(excluded).not.toContain(2);
  });

  it('returns empty when all divisions contribute equally', () => {
    const divBboxes = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 100 },
      { id: 2, minX: 10, maxX: 20, minY: 0, maxY: 10, area: 100 },
      { id: 3, minX: 0, maxX: 10, minY: 10, maxY: 20, area: 100 },
      { id: 4, minX: 10, maxX: 20, minY: 10, maxY: 20, area: 100 },
    ];
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    expect(excluded).toEqual([]);
  });

  it('stops when aspect ratio is close enough to CV bbox', () => {
    const divBboxes = [
      { id: 1, minX: 0, maxX: 10, minY: 0, maxY: 10, area: 100 },
      { id: 2, minX: 10, maxX: 20, minY: 0, maxY: 10, area: 100 },
      { id: 3, minX: 80, maxX: 85, minY: 5, maxY: 8, area: 15 },
      { id: 4, minX: 90, maxX: 95, minY: 5, maxY: 8, area: 15 },
    ];
    const cBbox = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
    const excluded = findBboxOutliers(divBboxes, cBbox);
    expect(excluded.length).toBeGreaterThanOrEqual(1);
    expect(excluded.length).toBeLessThanOrEqual(2);
  });
});

describe('findOverlapOutliers', () => {
  const TW = 100, TH = 100;

  it('excludes divisions whose centroid projects outside the CV mask', () => {
    const gadmToPixel = (gx: number, gy: number): [number, number] => [gx, gy];
    const icpMask = new Uint8Array(TW * TH);
    for (let y = 25; y < 75; y++) {
      for (let x = 25; x < 75; x++) {
        icpMask[y * TW + x] = 1;
      }
    }
    const divPaths = [
      { id: 1, points: [[40, 40], [60, 40], [60, 60], [40, 60]] as Array<[number, number]> },
      { id: 2, points: [[85, 85], [95, 85], [95, 95], [85, 95]] as Array<[number, number]> },
    ];
    const excluded = findOverlapOutliers(divPaths, gadmToPixel, icpMask, TW, TH);
    expect(excluded).toContain(2);
    expect(excluded).not.toContain(1);
  });

  it('excludes divisions whose centroid projects outside the image', () => {
    const gadmToPixel = (gx: number, gy: number): [number, number] => [gx * 2 - 50, gy * 2 - 50];
    const icpMask = new Uint8Array(TW * TH);
    icpMask.fill(1);
    const divPaths = [
      { id: 1, points: [[50, 50], [60, 50], [60, 60], [50, 60]] as Array<[number, number]> },
      { id: 2, points: [[5, 5], [15, 5], [15, 15], [5, 15]] as Array<[number, number]> },
    ];
    const excluded = findOverlapOutliers(divPaths, gadmToPixel, icpMask, TW, TH);
    expect(excluded).toContain(2);
    expect(excluded).not.toContain(1);
  });

  it('returns empty when all divisions project onto the mask', () => {
    const gadmToPixel = (gx: number, gy: number): [number, number] => [gx, gy];
    const icpMask = new Uint8Array(TW * TH);
    icpMask.fill(1);
    const divPaths = [
      { id: 1, points: [[20, 20], [30, 20], [30, 30], [20, 30]] as Array<[number, number]> },
      { id: 2, points: [[60, 60], [70, 60], [70, 70], [60, 70]] as Array<[number, number]> },
    ];
    const excluded = findOverlapOutliers(divPaths, gadmToPixel, icpMask, TW, TH);
    expect(excluded).toEqual([]);
  });
});
