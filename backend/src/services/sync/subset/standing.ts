/**
 * What the subset's compact entities say of whether a place still stands, as
 * `fetchStandingFacts` (`places/gone.ts`) answers it on the live service: the
 * best-ranked end of existence (`P576`), state of use (`P5817`) and state of
 * conservation (`P5816`), and whether a heritage designation (`P1435`) still
 * holds.
 */

import { entitiesOf } from './entities.js';
import { bestStatements, isNoValue, itemsOf, standingStatements, yearOf } from './values.js';

/** What an item's own statements say of whether it still stands, at their best rank (`places/gone.ts`). */
export interface StandingFacts {
  /** An end of existence (`P576`) with a value. */
  ended: boolean;
  /** Its year, where the statement gives one. */
  endedYear: number | null;
  /** The state of use (`P5817`). */
  use: readonly string[];
  /** The state of conservation (`P5816`). */
  conservation: readonly string[];
  /** Whether a heritage designation (`P1435`) holds with no end time. */
  heritage: boolean;
}

/** The standing facts of each kept item; an item the subset does not keep has none. */
export async function subsetStandingFacts(ids: string[]): Promise<Map<string, StandingFacts>> {
  const out = new Map<string, StandingFacts>();
  for (const [id, { entity }] of await entitiesOf(ids)) {
    const { claims } = entity;
    const ends = bestStatements(claims.P576).filter((statement) => !isNoValue(statement.value));
    out.set(id, {
      ended: ends.length > 0,
      endedYear: ends.map((statement) => yearOf(statement.value)).find((year) => year !== null) ?? null,
      use: itemsOf(bestStatements(claims.P5817)),
      conservation: itemsOf(bestStatements(claims.P5816)),
      heritage: standingStatements(claims.P1435).some((statement) => !isNoValue(statement.value)),
    });
  }
  return out;
}
