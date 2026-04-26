import { describe, it, expect } from 'vitest';
import { douglasPeucker } from './wvImportMatchBorderTrace.js';

// Note: traceBorderPaths requires OpenCV (globalThis.__cv) which isn't available
// in the test environment. We test the Douglas-Peucker simplification standalone.
// The contour extraction is tested manually via the CV pipeline.

describe('douglasPeucker', () => {
  it('simplifies a straight line to endpoints', () => {
    const pts: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    expect(douglasPeucker(pts, 1.0)).toEqual([[0, 0], [4, 0]]);
  });

  it('preserves corners', () => {
    const pts: Array<[number, number]> = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
    const simplified = douglasPeucker(pts, 1.0);
    expect(simplified.length).toBe(3);
    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified[1]).toEqual([10, 0]);
    expect(simplified[2]).toEqual([10, 10]);
  });

  it('returns input if 2 or fewer points', () => {
    expect(douglasPeucker([[0, 0], [1, 1]], 1.0)).toEqual([[0, 0], [1, 1]]);
    expect(douglasPeucker([[0, 0]], 1.0)).toEqual([[0, 0]]);
  });

  it('preserves curved shapes', () => {
    // Quarter circle arc — should keep multiple points
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 20; i++) {
      const angle = (Math.PI / 2) * (i / 20);
      pts.push([Math.round(Math.cos(angle) * 100), Math.round(Math.sin(angle) * 100)]);
    }
    const simplified = douglasPeucker(pts, 2.0);
    expect(simplified.length).toBeGreaterThan(2);
    expect(simplified.length).toBeLessThan(pts.length);
  });
});
