/**
 * The point a place of several points is told to be at (ADR-0095): the one of
 * its points nearest their centroid — the medoid. A serial World Heritage
 * site's and an edition's alike (#880), so the rule is written once.
 *
 * Neither the centroid nor the first point will do. A centroid of scattered
 * parts (the Roças of São Tomé, the D-Day beaches, *Maman*'s casts on three
 * continents) can land in open water or the Arctic; the first point is wherever
 * the source happened to list it, which for Getbol sat 301 km from the site's
 * former point — far enough to land in a different region and take the
 * experience's assignment with it. The point nearest the centroid is both a
 * real place of the object and a central one.
 */

import { longitudeDelta } from './longitude.js';

interface LatLon {
  lat: number;
  lon: number;
}

/** The point of `points` nearest their centroid; `points` must hold at least one. */
export function medoidOf<T extends LatLon>(points: readonly T[]): T {
  const centroidLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const centroidLon = meanLongitude(points);
  // Comparing squared offsets is enough to rank candidates; longitude is scaled
  // by cos(lat) so the comparison stays sane away from the equator, and the
  // difference is taken the short way round so an object spanning the
  // antimeridian is not judged against a point on the far side of the planet.
  const lonScale = Math.cos((centroidLat * Math.PI) / 180);
  const offset = (p: LatLon) =>
    (p.lat - centroidLat) ** 2 + (longitudeDelta(p.lon, centroidLon) * lonScale) ** 2;
  return points.reduce((best, p) => (offset(p) < offset(best) ? p : best));
}

/**
 * Mean of longitudes, taken as directions rather than numbers.
 *
 * An arithmetic mean puts parts at 179.5 and -179.5 — half a degree apart
 * across the antimeridian — at longitude 0, on the opposite side of the world.
 * Averaging the unit vectors and reading the angle back gives 180, which is
 * where the site actually is. See CLAUDE.md § Antimeridian Handling.
 */
function meanLongitude(points: readonly LatLon[]): number {
  const toRad = Math.PI / 180;
  const x = points.reduce((sum, p) => sum + Math.cos(p.lon * toRad), 0);
  const y = points.reduce((sum, p) => sum + Math.sin(p.lon * toRad), 0);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
