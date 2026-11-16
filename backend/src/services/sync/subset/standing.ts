/**
 * What the subset's compact entities say of whether a place still stands, as
 * `fetchStandingFacts` (`places/gone.ts`) answers it on the live service: the
 * best-ranked end of existence (`P576`), state of use (`P5817`), state of
 * conservation (`P5816`), inceptions (`P571`) and significant events
 * (`P793`), the start time of each coordinate (`P625`) that still holds, and
 * each heritage designation (`P1435`) that still holds, with its start time;
 * and every dated statement and dated event a place's lifetime is read from
 * (#1719, #2578, `places/lifetime.ts`).
 */

import type { CompactStatement, CompactValue } from '../../dumps/wikidata/compactEntity.js';
import { entitiesOf } from './entities.js';
import { bestStatements, isNoValue, itemOf, itemsOf, standingStatements, yearOf } from './values.js';

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
  /** The best-rank statements a place's lifetime is read from, each with its time (#1719). */
  dated: readonly DatedStatement[];
  /** The dated significant events that say the place was destroyed or stands again (#2578). */
  datedEvents: readonly DatedEvent[];
}

/** The properties a place's lifetime is read from: its starts, then its ends. */
export const LIFETIME_PROPERTIES = ['P571', 'P1619', 'P580', 'P576', 'P3999', 'P582'] as const;
export type LifetimeProperty = (typeof LIFETIME_PROPERTIES)[number];

/** Wikidata's item for the proleptic Julian calendar, the calendar model of most dates before 1582. */
export const JULIAN_CALENDAR = 'Q1985786';

/** Wikidata's item for *circa*, the value of the sourcing circumstances (`P1480`) of an approximate date. */
export const CIRCA = 'Q5727902';

/**
 * One best-rank statement of a lifetime property, with its time as the item
 * states it, in the item's own numbering of years.
 */
export interface DatedStatement {
  property: LifetimeProperty;
  time: StatedTime;
  /** The time is a day of the Julian calendar, which the place's date turns into the Gregorian one. */
  julian: boolean;
  /** The statement says the date is approximate (`P1480` circa). */
  circa: boolean;
  /** The statement's id (`Q214944$899b…`), as Wikidata's JSON gives it. */
  statement: string;
}

/**
 * The significant events (`P793`) that say a place was destroyed: what stood
 * is gone from that day. The Old Bridge in Mostar states a *destruction* on
 * 9 November 1993, the Kintai Bridge a *demolition* on 14 September 1950,
 * Ponte Pietra in Verona a *building implosion* on 24 April 1945. An event
 * that says what happened to a place and not what was left of it is not among
 * them: Berlin Cathedral's *bombardment* of 1944 left it standing, as
 * Kinkaku-ji's *conflagration* of 1950 did not, and the item's word cannot
 * tell the two apart.
 */
export const DESTROYED_EVENTS: Readonly<Record<string, string>> = {
  Q17781833: 'destruction',
  Q331483: 'demolition',
  Q1650581: 'building implosion',
};

/**
 * The significant events that say a place stands again. The Old Bridge
 * states an *architectural reconstruction* from 2001 to 23 July 2004, the
 * Kintai Bridge a *reconstruction* in 1953, the Vizcaya Bridge a *reopening*
 * on 19 June 1941 after its destruction in 1937. Each is also the word for
 * work on a building that never fell (Berlin Cathedral, the Neues Museum), so
 * one is read only after an end (`places/lifetime.ts`).
 */
export const REBUILT_EVENTS: Readonly<Record<string, string>> = {
  Q1370468: 'architectural reconstruction',
  Q2478058: 'reconstruction',
  Q52385658: 'rebuilding',
  Q11795864: 'rebuilding, a law term in Poland',
  Q16571590: 'reopening',
};

/** The qualifiers an event's date is read from: its point in time, then its end time. */
export const EVENT_DATE_QUALIFIERS = ['P585', 'P582'] as const;
export type EventDateQualifier = (typeof EVENT_DATE_QUALIFIERS)[number];

/** The qualifier that says an event happened to a part of the place (`P518` applies to part). */
export const APPLIES_TO_PART = 'P518';

/**
 * One date of a best-rank significant event (`P793`) among `DESTROYED_EVENTS`
 * and `REBUILT_EVENTS`, as the item states it. An event that names a part
 * (`P518`) is none: Hirano Shrine's *destruction* of 4 September 2018 is its
 * worship hall's, and the shrine was there to visit.
 */
export interface DatedEvent {
  event: string;
  qualifier: EventDateQualifier;
  time: StatedTime;
  julian: boolean;
  circa: boolean;
  /** The event's statement id. */
  statement: string;
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

/** The calendar model a compact time value names, Julian or not. */
function isJulian(value: CompactValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = (value as { calendarmodel?: unknown }).calendarmodel;
  return typeof model === 'string' && model.endsWith(`/${JULIAN_CALENDAR}`);
}

/** Every best-rank statement of the lifetime properties that gives a time. */
function datedStatementsOf(claims: Record<string, CompactStatement[]>): DatedStatement[] {
  return LIFETIME_PROPERTIES.flatMap((property) => bestStatements(claims[property]).flatMap((statement) => {
    const time = timeOf(statement.value);
    if (!time) return [];
    const circa = (statement.qualifiers?.P1480 ?? []).includes(CIRCA);
    return [{ property, time, julian: isJulian(statement.value), circa, statement: statement.id }];
  }));
}

/** Every date of the best-rank events that say the place was destroyed or stands again, whole-place events only. */
function datedEventsOf(claims: Record<string, CompactStatement[]>): DatedEvent[] {
  return bestStatements(claims.P793).flatMap((statement) => {
    const event = itemOf(statement.value);
    if (!event || !(DESTROYED_EVENTS[event] ?? REBUILT_EVENTS[event])) return [];
    if ((statement.qualifiers?.[APPLIES_TO_PART] ?? []).some((value) => !isNoValue(value))) return [];
    const circa = (statement.qualifiers?.P1480 ?? []).includes(CIRCA);
    return EVENT_DATE_QUALIFIERS.flatMap((qualifier) => (statement.qualifiers?.[qualifier] ?? []).flatMap((value) => {
      const time = timeOf(value);
      return time ? [{ event, qualifier, time, julian: isJulian(value), circa, statement: statement.id }] : [];
    }));
  });
}

/** What one item's statements say of whether it still stands. */
export function standingFactsOf(claims: Record<string, CompactStatement[]>): StandingFacts {
  const ends = bestStatements(claims.P576).filter((statement) => !isNoValue(statement.value));
  const designations = standingStatements(claims.P1435).filter((statement) => !isNoValue(statement.value));
  return {
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
    dated: datedStatementsOf(claims),
    datedEvents: datedEventsOf(claims),
  };
}

/** The standing facts of each kept item; an item the subset does not keep has none. */
export async function subsetStandingFacts(ids: string[]): Promise<Map<string, StandingFacts>> {
  const out = new Map<string, StandingFacts>();
  for (const [id, { entity }] of await entitiesOf(ids)) out.set(id, standingFactsOf(entity.claims));
  return out;
}
