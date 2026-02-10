/**
 * Dateline detection and point splitting utilities
 */

import type { Point } from './types.js';

/**
 * Check if points cross the dateline (have points on both sides near ±180)
 */
export function crossesDateline(points: Point[]): boolean {
  const nearPositive = points.some(p => p.lng > 150);
  const nearNegative = points.some(p => p.lng < -150);
  return nearPositive && nearNegative;
}

/**
 * Split points into east and west groups based on sign of longitude
 */
export function splitPointsAtDateline(points: Point[]): { eastPoints: Point[]; westPoints: Point[] } {
  const eastPoints: Point[] = [];
  const westPoints: Point[] = [];

  for (const p of points) {
    if (p.lng >= 0) {
      eastPoints.push(p);
    } else {
      westPoints.push(p);
    }
  }

  return { eastPoints, westPoints };
}
