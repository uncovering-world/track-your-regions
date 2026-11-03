/**
 * What the subset's compact entities say of whether a place still stands, as
 * `fetchStandingFacts` (`places/gone.ts`) answers it on the live service: the
 * best-ranked end of existence (`P576`), state of use (`P5817`), state of
 * conservation (`P5816`), inceptions (`P571`) and significant events
 * (`P793`), the start time of each coordinate (`P625`) that still holds, and
 * each heritage designation (`P1435`) that still holds, with its start time.
 */

import type { CompactValue } from '../../dumps/wikidata/compactEntity.js';
import { entitiesOf } from './entities.js';
import { bestStatements, isNoValue, itemsOf, standingStatements, yearOf } from './values.js';

/**
 * A time a statement gives, as precisely as Wikidata states it: `precision` is
 * Wikidata's (9 a year, 10 a month, 11 a day), and a part finer than it is 0.
 */
export interface StatedTime {
  year: number;
  month: number;
  day: number;
  precision: number;
}

/** What an item's own statements say of whether it still stands, at their best rank (`places/gone.ts`). */
export interface StandingFacts {
  /** An end of existence (`P576`) with a value. */
  ended: boolean;
  /** Its year, where the statement gives one. */
  endedYear: number | null;
  /** Its time, where the statement gives one, for comparing with the times below. */
  endedAt: StatedTime | null;
  /** The state of use (`P5817`). */
  use: readonly string[];
  /** The state of conservation (`P5816`). */
  conservation: readonly string[];
  /** Whether a heritage designation (`P1435`) holds with no end time. */
  heritage: boolean;
  /** The start time (`P580`) of each designation that holds, or null where it states none. */
  designatedSince: readonly (StatedTime | null)[];
  /** The inceptions (`P571`) that give a time: a work set up again states a second one. */
  inceptions: readonly StatedTime[];
  /** The start time (`P580`) of each coordinate (`P625`) that holds: a work moved is placed since then. */
  placedSince: readonly StatedTime[];
  /** The significant events (`P793`). */
  events: readonly string[];
}

/**
 * A time from its value as the dump or the live service spells it
 * (`+1976-09-10T00:00:00Z`, `-1400-00-00T00:00:00Z`) and its precision, which
 * is a year's where none is given. Null for anything else.
 */
export function statedTime(time: string | undefined, precision: number | undefined): StatedTime | null {
  const match = typeof time === 'string' ? /^([+-]?)(\d+)-(\d\d)-(\d\d)/.exec(time) : null;
  if (!match) return null;
  const year = Number(match[2]);
  return {
    year: match[1] === '-' ? -year : year,
    month: Number(match[3]),
    day: Number(match[4]),
    precision: typeof precision === 'number' && Number.isFinite(precision) ? precision : 9,
  };
}

/** A compact time value's stated time, or null for a value that is none (an unknown value). */
function timeOf(value: CompactValue): StatedTime | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { time, precision } = value as { time?: string; precision?: number };
  return statedTime(time, precision);
}

const timesOf = (values: readonly CompactValue[]): StatedTime[] =>
  values.map(timeOf).filter((time): time is StatedTime => time !== null);

/** The standing facts of each kept item; an item the subset does not keep has none. */
export async function subsetStandingFacts(ids: string[]): Promise<Map<string, StandingFacts>> {
  const out = new Map<string, StandingFacts>();
  for (const [id, { entity }] of await entitiesOf(ids)) {
    const { claims } = entity;
    const ends = bestStatements(claims.P576).filter((statement) => !isNoValue(statement.value));
    const designations = standingStatements(claims.P1435).filter((statement) => !isNoValue(statement.value));
    out.set(id, {
      ended: ends.length > 0,
      endedYear: ends.map((statement) => yearOf(statement.value)).find((year) => year !== null) ?? null,
      endedAt: timesOf(ends.map((statement) => statement.value))[0] ?? null,
      use: itemsOf(bestStatements(claims.P5817)),
      conservation: itemsOf(bestStatements(claims.P5816)),
      heritage: designations.length > 0,
      // Every start a designation states, as the live reader binds each as its own row; one with none stands undated.
      designatedSince: designations.flatMap((statement) => {
        const times = timesOf(statement.qualifiers?.P580 ?? []);
        return times.length > 0 ? times : [null];
      }),
      inceptions: timesOf(bestStatements(claims.P571).map((statement) => statement.value)),
      placedSince: standingStatements(claims.P625).flatMap((statement) => timesOf(statement.qualifiers?.P580 ?? [])),
      events: itemsOf(bestStatements(claims.P793)),
    });
  }
  return out;
}
