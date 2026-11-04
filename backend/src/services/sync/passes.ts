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
 * The Wikidata place kinds (#1820): one gather of their candidate places
 * (`places/gather.ts`), classified by Public art, Monuments & memorials,
 * Places of worship, Archaeology's sites, Towers, Bridges & engineering
 * marvels and Squares & streets, in that order.
 */
export const PLACE_KIND_SOURCES: readonly number[] = [...PUBLIC_ART_SOURCES, 4, 5, 7, 8, 9];

/** Art Museums: a works kind with no place of its own to gather, its museums the venues its works lie in. */
export const ART_MUSEUMS_SOURCE_ID = 2;

/**
 * The place pass: the place kinds, then Art Museums, which joins them for the
 * one gather of works it shares with Places of worship and Archaeology
 * (#1821, `museum/worksGather.ts`). Last, so it reads the works the earlier
 * kinds of the same pass refused as held at a museum (ADR-0102).
 */
export const PLACE_PASS: readonly number[] = [...PLACE_KIND_SOURCES, ART_MUSEUMS_SOURCE_ID];

const SYNC_PASSES: ReadonlyArray<readonly number[]> = [PLACE_PASS];

/** The sources a source runs with, itself included; itself alone when it shares no gather. */
export function passOf(sourceId: number): readonly number[] {
  return SYNC_PASSES.find((pass) => pass.includes(sourceId)) ?? [sourceId];
}
