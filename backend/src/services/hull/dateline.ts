/**
 * Point splitting at the dateline.
 *
 * Whether a region crosses is not decided here: the caller reads focus_bbox,
 * or asks geometry_focus() (#674). A second rule beside the database's -- points
 * on both sides of ±150° -- reads a point cloud from 151°E to 151°W as crossing
 * whether or not it does.
 */

import type { Point } from './types.js';

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
