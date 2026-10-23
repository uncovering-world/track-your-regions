/**
 * What a visitor is told about a point the source placed only roughly (#1912).
 *
 * The World Heritage list gives some components of a serial site only to the
 * whole minute of arc, and such a point is often more than a kilometre from the
 * place: measured against the components' own Wikidata items, a median 1.4 km
 * and 63 % over a kilometre, and the Longmen Grottoes' point stands 10 km from
 * the caves (`@tyr/shared/precision`). Or the list gives one point for several components, as
 * it does Echmiatsin's cathedral, church and cemetery (#1853). Until a curator
 * places such a point, the map and the maps link lead to the list's point, and
 * the visitor is told it is approximate, and why.
 */

import type { ExperienceLocation } from '../api/experiences';

export type ApproximateReason = NonNullable<ExperienceLocation['approximate']>;

/** The short word a row carries beside its maps link. */
export const APPROXIMATE_SHORT = 'approximate location';

/** Why the point is only approximate, in the visitor's words. */
export function approximateLocationWords(reason: ApproximateReason): string {
  return reason === 'shared'
    ? 'Approximate location: the World Heritage list gives one point for several parts of the site, so this one may stand elsewhere nearby.'
    : 'Approximate location: the World Heritage list gives it only to the nearest minute of arc, and such points are often a kilometre or more from the place itself.';
}
