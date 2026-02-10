import { describe, it, expect } from 'vitest';
import { crossesDateline, splitPointsAtDateline } from './dateline.js';
import type { Point } from './types.js';

describe('crossesDateline', () => {
  it('returns true when points span both sides of the dateline', () => {
    const points: Point[] = [
      { lng: 170, lat: 10 },
      { lng: -170, lat: 10 },
    ];
    expect(crossesDateline(points)).toBe(true);
  });

  it('returns false when all points are in the eastern hemisphere', () => {
    const points: Point[] = [
      { lng: 100, lat: 0 },
      { lng: 120, lat: 10 },
      { lng: 140, lat: 5 },
    ];
    expect(crossesDateline(points)).toBe(false);
  });

  it('returns false when all points are in the western hemisphere', () => {
    const points: Point[] = [
      { lng: -100, lat: 0 },
      { lng: -120, lat: 10 },
    ];
    expect(crossesDateline(points)).toBe(false);
  });

  it('returns false when points are on both sides but far from ±180', () => {
    // Points near the prime meridian (0°) — both sides but not near dateline
    const points: Point[] = [
      { lng: 10, lat: 0 },
      { lng: -10, lat: 0 },
    ];
    expect(crossesDateline(points)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(crossesDateline([])).toBe(false);
  });

  it('detects dateline crossing for Pacific island nations', () => {
    // Fiji spans the dateline: islands at ~177°E and ~-178°W
    const fijiPoints: Point[] = [
      { lng: 177, lat: -18 },
      { lng: 178, lat: -17 },
      { lng: -179, lat: -16 },
      { lng: -177, lat: -18 },
    ];
    expect(crossesDateline(fijiPoints)).toBe(true);
  });

  it('uses threshold of ±150 for detection', () => {
    // Points at exactly ±150 — should NOT trigger (threshold is > 150 and < -150)
    const borderline: Point[] = [
      { lng: 150, lat: 0 },
      { lng: -150, lat: 0 },
    ];
    expect(crossesDateline(borderline)).toBe(false);

    // Just past the threshold
    const pastThreshold: Point[] = [
      { lng: 151, lat: 0 },
      { lng: -151, lat: 0 },
    ];
    expect(crossesDateline(pastThreshold)).toBe(true);
  });
});

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
