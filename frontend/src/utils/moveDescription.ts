import { distanceMeters, LOCATION_UNCHANGED_METERS } from '@tyr/shared/moves';

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

/**
 * Great-circle distance, the bearing it was on and that bearing's compass point, or null
 * where either side is not a coordinate. The bearing is degrees clockwise from north, at
 * the point the move starts from — what an arrow drawn on a map is turned by.
 */
export function movedBy(before: unknown, after: unknown): { meters: number; heading: string; degrees: number } | null {
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
  return { meters, heading: points[Math.round(degrees / 45) % 8], degrees };
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

/** Where the two points of a move fall, as the review queue reads them (#2203). */
export interface MoveDivisions {
  from: { name: string; country: string } | null;
  to: { name: string; country: string } | null;
  /** The two points share a GADM leaf division: a point on a shared border stands in both. */
  same: boolean;
}

/**
 * What a move crosses, said only where it crosses something: a warning on
 * every long move was read past on the moves it was for (#2203). On
 * 2026-11-01 the Summer Palace's 14.5 km move stayed in Beijing, while Kinabalu
 * Park's point moved 19.4 km south-east, from Kota Belud into Ranau. Whether
 * the two points share a leaf is the server's (`same`), which holds the leaves.
 */
function crossing(divisions: MoveDivisions | undefined): string {
  if (!divisions || divisions.same) return '';
  const { from, to } = divisions;
  if (!from && !to) return ' — both points fall outside any land division';
  if (!from) return ` — from outside any land division into ${to!.name}, ${to!.country}; check the pin`;
  if (!to) return ` — out of ${from.name}, ${from.country}, to outside any land division; check the pin`;
  if (from.country !== to.country) {
    return ` — out of ${from.name}, ${from.country}, into ${to.name}, ${to.country}: another country; check the pin`;
  }
  return ` — from ${from.name} into ${to.name}; check the pin`;
}

/**
 * The sentence under a moved coordinate: the move, and, where the review
 * queue says the two points fall in different divisions, which ones.
 */
export function describeMove(before: unknown, after: unknown, divisions?: MoveDivisions): string | null {
  const move = movedBy(before, after);
  if (!move) return null;
  return `Moved ${distanceLabel(move.meters)} ${move.heading}${crossing(divisions)}.`;
}

/**
 * The sentence under a coordinate a source proposes: the move, or, within
 * `LOCATION_UNCHANGED_METERS`, the same place written again, which the server
 * pairs as one point (ADR-0027) and the queue never words as a move. The
 * Genbaku Dome's held "Moved 0 m south" was a point 5 cm from the one it named
 * (#1846). A curator's own correction keeps `describeMove`: a pin they drag
 * five metres did move.
 */
export function describeProposedMove(before: unknown, after: unknown, divisions?: MoveDivisions): string | null {
  const move = movedBy(before, after);
  if (move && move.meters <= LOCATION_UNCHANGED_METERS) {
    return `Not a move: the source writes the same place again, within ${LOCATION_UNCHANGED_METERS} m.`;
  }
  return describeMove(before, after, divisions);
}

/**
 * How many degrees of longitude a move covers, the short way round: -1 from
 * 179.5 to -179.5, never 359.
 *
 * A move is two points, and the way between them is the one its distance and
 * its bearing are already measured along (`movedBy`) — so the line drawn for it
 * and the camera centred on it take that way too. This is not the rule that
 * tells a region crossing the antimeridian from a global one (`focusFromGeoJson`,
 * `utils/mapUtils.ts`): that rule measures a shape's extent, and two points have
 * a path, not an extent.
 */
export function shortWayLongitudeDelta(before: Coordinate, after: Coordinate): number {
  return ((after.lon - before.lon + 540) % 360) - 180;
}

/** MapLibre's ground resolution at zoom 0 on the equator, in metres per CSS pixel (512 px tiles). */
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.517;
/** How much of the map a move should span: wide enough to read, with its surroundings around it. */
const MOVE_SPAN_PIXELS = 260;

/**
 * The camera that shows a move: centred between the two points, at the zoom where the
 * move spans a readable part of the map.
 *
 * Derived from the great-circle distance rather than by fitting a box, because the
 * question is scale and not extent: a region-sized frame stops at the zoom a region
 * needs, where a 158 m correction — Ephesus, run 146 — is five pixels and two markers
 * drawn on top of each other. The floor keeps a move across a continent on one screen,
 * and the ceiling is the basemap's last useful level. The midpoint takes the short way
 * round, so a move across the antimeridian is centred on it and not on Greenwich.
 */
export function moveView(before: Coordinate, after: Coordinate): { longitude: number; latitude: number; zoom: number } {
  const longitude = ((before.lon + shortWayLongitudeDelta(before, after) / 2 + 540) % 360) - 180;
  const latitude = (before.lat + after.lat) / 2;
  const meters = Math.max(distanceMeters(before.lon, before.lat, after.lon, after.lat), 1);
  const zoom = Math.log2((METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180) * MOVE_SPAN_PIXELS) / meters);
  return { longitude, latitude, zoom: Math.min(17, Math.max(1, zoom)) };
}
