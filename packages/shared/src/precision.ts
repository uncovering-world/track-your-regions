/**
 * When a World Heritage point only says roughly where a component is (#1853).
 *
 * The World Heritage list gives some points to the whole minute, a cell of about
 * 1.8 × 1.5 km, and a point given that coarsely is often wrong by more than the
 * cell: the Longmen Grottoes' 34°28′0″ N 112°28′0″ E stands about 10 km from
 * the caves. Measured against the Wikidata items that carry the same World
 * Heritage reference on 2026-10-22, the 650 such points stood a median 1.4 km
 * from their item, and 63 % of them more than a kilometre, against 26 m and
 * 13 % for the 5 631 points given to the second. The list also gives several
 * components of one property the property's own point: the Mother Cathedral,
 * the Church of Saint Gayaneh and the Cemetery of Congregation of Echmiatsin
 * share 40.15931 N 44.29514 E, a street 340 m from Saint Gayane church.
 *
 * The run records the reason on each point it writes, and the curator's card
 * draws the minute cell around a rounded one, so both sides read this.
 */

/**
 * How close to a whole minute a coordinate must be, in degrees: 0.036″, about
 * a metre. The list writes some whole minutes in decimal degrees cut to five
 * places, up to about 6.7e-6° off the minute (Novgorod's 58.53333, Guachimontones'
 * 20.6833305556, #2158), while the nearest point given to the second stands
 * 0.17″ from one (Glovers Reef's 16.799952, measured on 2026-10-30).
 */
export const WHOLE_MINUTE_TOLERANCE_DEG = 1e-5;

/** Why a point is approximate: given to the whole minute, or shared with another component. */
export type ApproximateReason = 'whole-minute' | 'shared';

const onWholeMinuteAxis = (degrees: number): boolean =>
  Math.abs(degrees * 60 - Math.round(degrees * 60)) < WHOLE_MINUTE_TOLERANCE_DEG * 60;

/** Whether both a latitude and a longitude are whole minutes, a whole degree included. */
export function onWholeMinute(lon: number, lat: number): boolean {
  return onWholeMinuteAxis(lon) && onWholeMinuteAxis(lat);
}

/**
 * Why each of one property's points is approximate, in the order given, or null
 * where it is not: a point on a whole minute, or one whose coordinate another
 * component of the property, under another reference, shares. A shared point
 * is named so whatever its precision, since which of the components it stands
 * for is the question.
 */
export function approximateReasons(
  points: readonly { ref: string | null; lon: number; lat: number }[],
): (ApproximateReason | null)[] {
  const at = (lon: number, lat: number) => `${lon.toFixed(6)} ${lat.toFixed(6)}`;
  const refsAt = new Map<string, Set<string>>();
  for (const point of points) {
    if (point.ref === null) continue;
    const key = at(point.lon, point.lat);
    refsAt.set(key, (refsAt.get(key) ?? new Set()).add(point.ref));
  }
  return points.map(point => {
    if (point.ref !== null && (refsAt.get(at(point.lon, point.lat))?.size ?? 0) > 1) return 'shared';
    return onWholeMinute(point.lon, point.lat) ? 'whole-minute' : null;
  });
}
