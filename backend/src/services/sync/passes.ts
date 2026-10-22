/**
 * Which sources fill their kinds from one gather (ADR-0132), in the order a
 * pass runs them. A source named in none runs alone.
 *
 * Said once, for the run that gathers and for the routes that start, refuse
 * and describe it: a start of one source of a pass starts the whole pass, and
 * is refused while any of its sources is running.
 */

/**
 * Public art and Monuments & memorials (#1807): two kinds one declaration
 * gathers for (`PUBLIC_ART_KIND`), each deciding by its own rule.
 */
export const PUBLIC_ART_SOURCES: readonly number[] = [3, 6];

/**
 * The place pass (#1820): one gather of the candidate places of every
 * Wikidata place kind (`places/gather.ts`), classified by Public art,
 * Monuments & memorials, Places of worship, Archaeology's sites and Towers,
 * in that order.
 */
export const PLACE_PASS: readonly number[] = [...PUBLIC_ART_SOURCES, 4, 5, 7];

const SYNC_PASSES: ReadonlyArray<readonly number[]> = [PLACE_PASS];

/** The sources a source runs with, itself included; itself alone when it shares no gather. */
export function passOf(sourceId: number): readonly number[] {
  return SYNC_PASSES.find((pass) => pass.includes(sourceId)) ?? [sourceId];
}
