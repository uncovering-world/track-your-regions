/**
 * The cell a point given to the whole minute of arc may stand anywhere in
 * (#1853): drawn by the approximate-points card's map and named in words by
 * it and by the sources card (#2158). Whether a point is on a whole minute is
 * `onWholeMinute` (`@tyr/shared/precision`).
 *
 * Its own module so the sources card names the cell without loading the map
 * the approximate-points card draws it on.
 */

import type { MinuteCell } from './ComponentItemsMap';

/** Half a minute of arc, in degrees: the cell around a point given to the whole minute. */
const HALF_MINUTE = 0.5 / 60;
/** A minute of latitude, in kilometres. */
const MINUTE_KM = 1.852;

/** The whole minute a point was given to, as the box the component may stand anywhere in. */
export function minuteCell(point: { latitude: number; longitude: number }): MinuteCell {
  return {
    west: point.longitude - HALF_MINUTE, east: point.longitude + HALF_MINUTE,
    south: point.latitude - HALF_MINUTE, north: point.latitude + HALF_MINUTE,
  };
}

/** The cell's size at a latitude, west to east by south to north: "1.7 × 1.9 km". */
export function minuteCellSize(latitude: number): string {
  const wide = MINUTE_KM * Math.cos((latitude * Math.PI) / 180);
  return `${wide.toFixed(1)} × ${MINUTE_KM.toFixed(1)} km`;
}
