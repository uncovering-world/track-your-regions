import { describe, it, expect } from 'vitest';
import {
  pointsToSmoothSvgPath, findOpenEndpoints, pointToSegmentDistance,
  findEraserIntersection,
} from './svgBorderUtils';
import type { BorderPath } from '../../api/adminWvImportCvMatch';

describe('pointsToSmoothSvgPath', () => {
  it('returns empty for 0-1 points', () => {
    expect(pointsToSmoothSvgPath([])).toBe('');
    expect(pointsToSmoothSvgPath([[5, 5]])).toBe('');
  });

  it('converts 2 points to a line', () => {
    const d = pointsToSmoothSvgPath([[0, 0], [10, 10]]);
    expect(d).toContain('M 0 0');
    expect(d).toContain('L 10 10');
  });

  it('converts 3+ points to smooth curves', () => {
    const d = pointsToSmoothSvgPath([[0, 0], [5, 3], [10, 0]]);
    expect(d).toContain('M 0 0');
    expect(d).toContain('C');
  });
});

describe('findOpenEndpoints', () => {
  it('returns all endpoints of separate open paths', () => {
    const paths: BorderPath[] = [
      { id: 'a', points: [[0, 0], [10, 0], [20, 0]], type: 'internal', clusters: [0, 1] },
      { id: 'b', points: [[30, 0], [40, 0]], type: 'internal', clusters: [0, 1] },
    ];
    const eps = findOpenEndpoints(paths);
    expect(eps.length).toBe(4);
  });

  it('excludes junction endpoints (close to another endpoint)', () => {
    const paths: BorderPath[] = [
      { id: 'a', points: [[0, 0], [10, 0]], type: 'internal', clusters: [0, 1] },
      { id: 'b', points: [[10, 1], [20, 0]], type: 'internal', clusters: [0, 2] },
    ];
    const eps = findOpenEndpoints(paths, 2);
    // a.end (10,0) and b.start (10,1) are within 2px — junction, not open
    expect(eps.length).toBe(2);
    expect(eps.some(e => e.pathId === 'a' && e.end === 'start')).toBe(true);
    expect(eps.some(e => e.pathId === 'b' && e.end === 'end')).toBe(true);
  });

  it('skips paths with fewer than 2 points', () => {
    const paths: BorderPath[] = [
      { id: 'a', points: [[5, 5]], type: 'internal', clusters: [0, 1] },
    ];
    expect(findOpenEndpoints(paths)).toEqual([]);
  });
});

describe('pointToSegmentDistance', () => {
  it('perpendicular distance to horizontal segment', () => {
    expect(pointToSegmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('distance to nearest endpoint when outside segment', () => {
    expect(pointToSegmentDistance(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('zero distance for point on segment', () => {
    expect(pointToSegmentDistance(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });
});

describe('findEraserIntersection', () => {
  it('returns segment index when eraser hits', () => {
    const points: Array<[number, number]> = [[0, 0], [10, 0], [20, 0]];
    expect(findEraserIntersection(5, 0, 2, points)).toBe(0);
    expect(findEraserIntersection(15, 0, 2, points)).toBe(1);
  });

  it('returns null when eraser misses', () => {
    const points: Array<[number, number]> = [[0, 0], [10, 0]];
    expect(findEraserIntersection(5, 20, 2, points)).toBeNull();
  });
});
