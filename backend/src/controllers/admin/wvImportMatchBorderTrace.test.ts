import { describe, it, expect } from 'vitest';
import { traceBorderPaths, douglasPeucker } from './wvImportMatchBorderTrace.js';

describe('traceBorderPaths', () => {
  it('traces a horizontal border between two clusters', () => {
    const TW = 4, TH = 3;
    const labels = new Uint8Array([
      0, 0, 0, 0,
      1, 1, 1, 1,
      1, 1, 1, 1,
    ]);
    const paths = traceBorderPaths(labels, TW, TH);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p.type).toBe('internal');
      expect(p.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('traces external border (cluster vs background)', () => {
    const TW = 4, TH = 4;
    const labels = new Uint8Array([
      255, 255, 255, 255,
      255,   0,   0, 255,
      255,   0,   0, 255,
      255, 255, 255, 255,
    ]);
    const paths = traceBorderPaths(labels, TW, TH);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some(p => p.type === 'external')).toBe(true);
  });

  it('returns empty for uniform labels', () => {
    expect(traceBorderPaths(new Uint8Array([0, 0, 0, 0]), 2, 2)).toEqual([]);
  });

  it('assigns unique IDs', () => {
    const TW = 4, TH = 3;
    const labels = new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 2, 2]);
    const paths = traceBorderPaths(labels, TW, TH);
    const ids = paths.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classifies cluster-to-cluster borders as internal', () => {
    const TW = 4, TH = 3;
    const labels = new Uint8Array([
      0, 0, 1, 1,
      0, 0, 1, 1,
      0, 0, 1, 1,
    ]);
    const paths = traceBorderPaths(labels, TW, TH);
    expect(paths.every(p => p.type === 'internal')).toBe(true);
  });

  it('provides clusters tuple with sorted labels', () => {
    const TW = 4, TH = 3;
    const labels = new Uint8Array([
      0, 0, 0, 0,
      1, 1, 1, 1,
      1, 1, 1, 1,
    ]);
    const paths = traceBorderPaths(labels, TW, TH);
    for (const p of paths) {
      expect(p.clusters[0]).toBeLessThanOrEqual(p.clusters[1]);
    }
  });

  it('IDs follow bp-N pattern', () => {
    const TW = 4, TH = 3;
    const labels = new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 2, 2]);
    const paths = traceBorderPaths(labels, TW, TH);
    for (const p of paths) {
      expect(p.id).toMatch(/^bp-\d+$/);
    }
  });
});

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
  });

  it('returns single point unchanged', () => {
    expect(douglasPeucker([[3, 4]], 1.0)).toEqual([[3, 4]]);
  });

  it('preserves a point clearly off the line', () => {
    // Right angle: start (0,0), turn (5,5), end (10,0)
    const pts: Array<[number, number]> = [[0, 0], [5, 5], [10, 0]];
    const simplified = douglasPeucker(pts, 1.0);
    expect(simplified).toEqual([[0, 0], [5, 5], [10, 0]]);
  });
});
