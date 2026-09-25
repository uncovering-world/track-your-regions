import { distanceMeters, LOCATION_MAJOR_METERS } from '@tyr/shared/moves';

/**
 * How far a pin moved, and which way — the one rule for a sentence about a
 * moved coordinate.
 *
 * Written in `fieldMeaning.tsx` for the queue's coordinate rows and moved here
 * when the correction dialog needed the same sentence: that dialog opens from
 * the review page, the object screen and the map, and `components/shared/`
 * must not import a feature folder to say "1.6 km east". The distance and the
 * kilometre the warning turns on are the server's own (`@tyr/shared/moves`),
 * which is what decided a row was a move at all.
 */

export interface Coordinate {
  lon: number;
  lat: number;
}

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

function isCoordinate(value: unknown): value is Coordinate {
  return typeof value === 'object' && value !== null
    && typeof (value as Coordinate).lon === 'number'
    && typeof (value as Coordinate).lat === 'number';
}

/** Great-circle distance and the compass point it was in, or null where either side is not a coordinate. */
export function movedBy(before: unknown, after: unknown): { meters: number; heading: string } | null {
  if (!isCoordinate(before) || !isCoordinate(after)) return null;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const φ1 = toRad(before.lat); const φ2 = toRad(after.lat);
  const dλ = toRad(after.lon - before.lon);
  const meters = distanceMeters(before.lon, before.lat, after.lon, after.lat);
  // The compass point is the web's alone: the server decides a move, and the
  // sentence says which way it went.
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const degrees = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return { meters, heading: points[Math.round(degrees / 45) % 8] };
}

export function distanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${number.format(Math.round(meters / 100) / 10)} km`;
}

/** "1.6 km east" — the move as a phrase, for a sentence that supplies its own verb. */
export function moveLabel(before: unknown, after: unknown): string | null {
  const move = movedBy(before, after);
  return move ? `${distanceLabel(move.meters)} ${move.heading}` : null;
}

/**
 * The sentence under a moved coordinate: the move, and past a kilometre the
 * warning that it may have changed which region the place counts in.
 */
export function describeMove(before: unknown, after: unknown): string | null {
  const move = movedBy(before, after);
  if (!move) return null;
  const far = move.meters > LOCATION_MAJOR_METERS ? ' — may fall in a different region; check the pin' : '';
  return `Moved ${distanceLabel(move.meters)} ${move.heading}${far}.`;
}
