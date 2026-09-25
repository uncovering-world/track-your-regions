/**
 * When a coordinate that changed is a move, and when a move matters (#1034).
 *
 * The server decides it: a sync run's diff of an object and of its parts
 * (`changeSet.ts`, `contentsChangeSet.ts`), and the writer that pairs a
 * rewritten point with the one it replaces. The web says it: the sentence
 * under a moved coordinate on the review card and in the correction dialog
 * (`moveDescription.ts`), and the withdrawn-points card telling a rewrite from
 * a move. A threshold moved on one side alone would have the web warn about
 * moves the server calls minor, or call a move what the writer forgave as the
 * same place, so both read these.
 */

/**
 * Below this, a coordinate difference is the source writing the same place
 * more precisely, not a move: Bilbao's replacement point sat 1.2 cm from the
 * one it replaced. The writers pair within it through `ST_DWithin`, which
 * counts the boundary as within.
 */
export const LOCATION_UNCHANGED_METERS = 10;

/** Above this, a place has moved far enough to matter to a traveller: it may now fall in another region. */
export const LOCATION_MAJOR_METERS = 1000;

/** Great-circle distance in metres, on a sphere of radius 6 371 km. */
export function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}
