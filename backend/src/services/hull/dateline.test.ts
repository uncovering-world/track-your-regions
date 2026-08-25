import { describe, it, expect } from 'vitest';
import { splitPointsAtDateline } from './dateline.js';
import type { Point } from './types.js';

describe('splitPointsAtDateline', () => {
  it('separates positive and negative longitude points', () => {
    const points: Point[] = [
      { lng: 170, lat: 10 },
      { lng: -170, lat: 10 },
      { lng: 160, lat: 5 },
      { lng: -160, lat: 5 },
    ];
    const { eastPoints, westPoints } = splitPointsAtDateline(points);
    expect(eastPoints).toHaveLength(2);
    expect(westPoints).toHaveLength(2);
    expect(eastPoints.every(p => p.lng >= 0)).toBe(true);
    expect(westPoints.every(p => p.lng < 0)).toBe(true);
  });

  it('places zero-longitude points in the east group', () => {
    const points: Point[] = [
      { lng: 0, lat: 0 },
      { lng: -10, lat: 0 },
    ];
    const { eastPoints, westPoints } = splitPointsAtDateline(points);
    expect(eastPoints).toEqual([{ lng: 0, lat: 0 }]);
    expect(westPoints).toEqual([{ lng: -10, lat: 0 }]);
  });

  it('returns empty arrays for empty input', () => {
    const { eastPoints, westPoints } = splitPointsAtDateline([]);
    expect(eastPoints).toEqual([]);
    expect(westPoints).toEqual([]);
  });

  it('puts all points in east when all positive', () => {
    const points: Point[] = [
      { lng: 100, lat: 0 },
      { lng: 120, lat: 10 },
    ];
    const { eastPoints, westPoints } = splitPointsAtDateline(points);
    expect(eastPoints).toHaveLength(2);
    expect(westPoints).toHaveLength(0);
  });
});
