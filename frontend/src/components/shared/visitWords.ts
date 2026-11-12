import type { VisitedStatus } from '../../api/visited';

/**
 * What a place's own visit button reads, in Map mode's card and Discover's
 * panel alike (#2120). It is a place of no parts, so it is visited or not.
 */
export const VISIT_BUTTON_LABEL: Record<VisitedStatus, string> = {
  not_visited: 'Mark Visited',
  partial: 'Partly visited',
  visited: 'Visited',
};

/**
 * Whether a place's card offers "Visited, not sure which part" (#2120): a
 * whole whose detail read says it shows no point of its own. On a whole that
 * does, such as the City of Graz, a tick on that point is the whole's own
 * visit, so its checkbox in the list of places says it, and more precisely.
 * Not while the detail read is on its way.
 */
export function offersWholeTick(place: { has_parts: boolean }, details: { has_own_point: boolean } | undefined): boolean {
  return place.has_parts && details?.has_own_point === false;
}
