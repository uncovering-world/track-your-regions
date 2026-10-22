/**
 * Which sources fill their kinds from one gather (ADR-0132), in the order a
 * pass runs them. A source named in none runs alone.
 *
 * Said once, for the run that gathers and for the routes that start, refuse
 * and describe it: a start of one source of a pass starts the whole pass, and
 * is refused while any of its sources is running.
 */

/**
 * Public Art's gather: the class trees, the pool and the facts
 * (`publicArt/pipeline.ts`), for Public art and Monuments & memorials (#1807).
 */
export const PUBLIC_ART_PASS: readonly number[] = [3, 6];

const SYNC_PASSES: ReadonlyArray<readonly number[]> = [PUBLIC_ART_PASS];

/** The sources a source runs with, itself included; itself alone when it shares no gather. */
export function passOf(sourceId: number): readonly number[] {
  return SYNC_PASSES.find((pass) => pass.includes(sourceId)) ?? [sourceId];
}
