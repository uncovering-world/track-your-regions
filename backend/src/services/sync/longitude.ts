/**
 * The difference between two longitudes, taken the short way round.
 *
 * A raw subtraction reads 179.9° and −179.9° as 359.8° apart when they are 0.2°
 * apart across the antimeridian. Two sync services each carried their own
 * normalisation of this — one signed, one absolute — and #674 keeps one. The
 * haversine in `changeSet.ts` needs neither: `sin(dLon / 2)` wraps by itself.
 */

/**
 * Signed, in [−180, 180): positive when `to` lies east of `from` the short way
 * round. Exactly half a turn comes out as −180 whichever way it is asked — the
 * two callers square or take the absolute value, so no direction is owed there.
 */
export function signedLongitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Absolute, in [0, 180]. */
export function longitudeDelta(a: number, b: number): number {
  return Math.abs(signedLongitudeDelta(a, b));
}
