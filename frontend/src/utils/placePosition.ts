/**
 * Where a place is, as its row says: its own coordinate, which a whole has
 * none of (#2122).
 */

import type { Experience } from '../api/experiences';

/**
 * A place's own coordinate as [lng, lat], or null for a whole, which has none:
 * a serial site is its places, and its row carries their frame instead
 * (`focus`, #2122). What every surface draws or flies to while a region's batch
 * holds none of the place's points.
 */
export function ownPoint(exp: Pick<Experience, 'longitude' | 'latitude'>): [number, number] | null {
  return exp.longitude === null || exp.latitude === null ? null : [exp.longitude, exp.latitude];
}
