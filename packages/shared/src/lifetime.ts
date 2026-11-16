/**
 * A place's time (#2578, ADR-0217; #1719, ADR-0214 decision 2): the periods in
 * which it stood, was used, was closed or was held, each from one date until
 * another.
 *
 * What a period says matters, and only one thing takes a place off today's
 * catalogue: that it stood, in periods none of which is open. Göbekli Tepe
 * began about 10,000 BC and was abandoned about 7000 BC, and the site stands
 * and is visited: its abandonment ends a use. Bath Abbey's monastery was
 * dissolved in 1539, and the church stands. The Arch of Reunification in
 * Pyongyang was destroyed in January 2024: the place stood until then. The
 * Cathedral of Christ the Saviour in Moscow stood from 1883 until it was blown
 * up on 5 December 1931, and stands again since 2000: two periods and a gap.
 *
 * A date is a trip's approximate date (`@tyr/shared/approximateDates`, ADR-0202
 * decision 2: a month only within a year, a day only within a month the month
 * has), with two fields a history needs and a trip does not: a `span` where the source knows the year no closer than a
 * decade, a century or a millennium (Göbekli Tepe's start is known to the
 * millennium, Stonehenge's to the century), and `circa`. Two dates are ordered
 * by the days they may be (`comparePlaceDates`): one follows another only
 * where those days do not overlap. That is the one order of dates: a place's
 * own, and a trip's against a place's (#2008).
 *
 * The year is numbered as the subset gives it, from Wikidata's JSON: 250 BC is
 * -250, and there is no year zero. The query service numbers a BC year at a
 * year's precision or finer one higher (astronomically), and a reader of it
 * shifts it back before it is written here.
 *
 * A day is a day of the proleptic Gregorian calendar, the calendar
 * `isValidPlaceDate` counts in. Wikidata's JSON keeps a date to the day in the
 * calendar its source used, Julian for most dates before 1582 (and Russia's
 * before 1918); a reader turns such a date into the Gregorian one
 * (`julianToGregorian`) before it is written here, as the query service does,
 * so a stored date means one calendar and compares with a trip's (#2008). A
 * day the Julian calendar does not have comes back null, and the reader
 * writes nothing of that statement. A date known only to the month or coarser
 * is kept as it is given.
 *
 * The schema states what a period says, the spans and the endings too, as
 * CHECK lists on `place_periods` and `record_periods`; the backend holds the
 * two to each other by a type (`curationLogActions.test.ts`).
 */

/** How coarsely a year is known, where coarser than a year. */
export const DATE_SPANS = ['decade', 'century', 'millennium'] as const;
export type DateSpan = (typeof DATE_SPANS)[number];

/** How a place stopped standing, where its source says. */
export const PLACE_ENDINGS = ['destroyed', 'demolished', 'removed', 'collapsed'] as const;
export type PlaceEnding = (typeof PLACE_ENDINGS)[number];

/**
 * The earliest year a place may begin. The Cave of Altamira's paintings are
 * dated to about 35,000 BC; a work in a museum may be older, and its year is
 * `treasures.year`, not this.
 */
export const EARLIEST_PLACE_YEAR = -100_000;

/** One date of a place's time: an end of a period. A date that is not known is no date, `null` where one is asked. */
export interface PlaceDate {
  /** Signed, 250 BC is -250, never 0. */
  year: number;
  month: number | null;
  day: number | null;
  /** Null where the date is as precise as the year, month and day set. */
  span: DateSpan | null;
  circa: boolean;
}

const isWhole = (value: number | null, low: number, high: number): boolean =>
  value === null || (Number.isInteger(value) && value >= low && value <= high);

/** A year with no year zero as the astronomers number it: 1 BC is 0, 2 BC is -1. */
const astronomicalOf = (year: number): number => (year < 0 ? year + 1 : year);

/**
 * The days of a month of the proleptic Gregorian calendar, in a year numbered
 * with no year zero. A BC year is a leap year one later than an AD one would
 * be: 1 BC is year 0 to the astronomers, and so a leap year, as 5 BC is.
 */
function daysIn(year: number, month: number): number {
  if (month !== 2) return [4, 6, 9, 11].includes(month) ? 30 : 31;
  const astronomical = astronomicalOf(year);
  const leap = (astronomical % 4 === 0 && astronomical % 100 !== 0) || astronomical % 400 === 0;
  return leap ? 29 : 28;
}

/** The days of a month of the Julian calendar, which leaps every fourth year, 1 BC and 5 BC among them. */
function julianDaysIn(year: number, month: number): number {
  if (month !== 2) return [4, 6, 9, 11].includes(month) ? 30 : 31;
  return astronomicalOf(year) % 4 === 0 ? 29 : 28;
}

/**
 * The Gregorian day a day of the Julian calendar is, through its Julian day
 * number: the Gregorian calendar's day for 29 February 1500 Julian is
 * 10 March 1500, and for 1 January AD 1 Julian 30 December 1 BC. Years are
 * numbered with no year zero, both ways.
 *
 * Null for a day the Julian calendar does not have (30 February, 31 April, a
 * thirteenth month, year zero), so a malformed date is refused here as
 * `isValidPlaceDate` refuses one of the Gregorian calendar, never written ten
 * days later as a day that exists. Null rather than an error: a reader skips
 * the statement and keeps reading the rest of the item.
 */
export function julianToGregorian(year: number, month: number, day: number): { year: number; month: number; day: number } | null {
  if (year === 0 || !Number.isInteger(year) || !isWhole(month, 1, 12) || !isWhole(day, 1, julianDaysIn(year, month))) return null;
  const shift = Math.floor((14 - month) / 12);
  const y = astronomicalOf(year) + 4800 - shift;
  const m = month + 12 * shift - 3;
  const julianDay = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  const a = julianDay + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const n = Math.floor((5 * e + 2) / 153);
  const astronomical = 100 * b + d - 4800 + Math.floor(n / 10);
  return {
    year: astronomical <= 0 ? astronomical - 1 : astronomical,
    month: n + 3 - 12 * Math.floor(n / 10),
    day: e - Math.floor((153 * n + 2) / 5) + 1,
  };
}

/**
 * Whether a date is one the tables can hold: a year from `EARLIEST_PLACE_YEAR`
 * to `latestYear` and never 0, a month only within a year, a day only within a
 * month the month has, a span only on a year with no month.
 */
export function isValidPlaceDate(date: PlaceDate, latestYear: number): boolean {
  const { year, month, day, span } = date;
  if (year === 0 || !isWhole(year, EARLIEST_PLACE_YEAR, latestYear)) return false;
  if (!isWhole(month, 1, 12)) return false;
  if (day !== null && (month === null || !isWhole(day, 1, daysIn(year, month)))) return false;
  if (span !== null && (month !== null || !DATE_SPANS.includes(span))) return false;
  return true;
}

/** Days in order, a month counted as 31 of them: only the order matters. */
const dayIndex = (year: number, month: number, day: number): number => (year * 12 + (month - 1)) * 31 + (day - 1);

/** The years one span is wide. */
const SPAN_YEARS: Readonly<Record<DateSpan, number>> = { decade: 10, century: 100, millennium: 1000 };

/**
 * The first and the last day a date may be, as a count that orders days: a
 * day is itself, a month or a year all its days, and a span every year within
 * one span either side of its year, since a century is stated both by its
 * first year and by its last.
 */
export function periodOf(date: PlaceDate): { first: number; last: number } {
  const { year, month, day, span } = date;
  if (span !== null) {
    const width = SPAN_YEARS[span];
    return { first: dayIndex(year - width + 1, 1, 1), last: dayIndex(year + width - 1, 12, 31) };
  }
  if (month === null) return { first: dayIndex(year, 1, 1), last: dayIndex(year, 12, 31) };
  if (day === null) return { first: dayIndex(year, month, 1), last: dayIndex(year, month, 31) };
  const index = dayIndex(year, month, day);
  return { first: index, last: index };
}

/**
 * The one order of two dates (#1719, #2008): -1 where `a` is wholly before
 * `b`, 1 where wholly after, and 0 where the days they may be overlap and
 * either may be the other (1859 and 6 September 1859, the 1950s and 1955). A
 * place's dates are ordered by it, and a trip is compared with them by it.
 */
export function comparePlaceDates(a: PlaceDate, b: PlaceDate): -1 | 0 | 1 {
  const left = periodOf(a);
  const right = periodOf(b);
  if (left.last < right.first) return -1;
  if (left.first > right.last) return 1;
  return 0;
}

/**
 * What a period of a place says was so (ADR-0217 decision 2), in the order a
 * card reads them: the place itself stood, it was used for something, it was
 * closed, or an event was held there.
 */
export const PERIOD_SAYS = ['stood', 'used', 'closed', 'held'] as const;
export type PeriodSays = (typeof PERIOD_SAYS)[number];

/** The one thing a place is gone by: it has periods that say it stood, and none is open. */
export const PLACE_STOOD: PeriodSays = 'stood';

/**
 * What a run reports of a place: the periods in which it stood, and the end of
 * a use. A closure and an occurrence are a curator's entries, since no source
 * the runs read states them for the places the catalogue offers.
 */
export const REPORTED_SAYS: readonly PeriodSays[] = ['stood', 'used'];

/** What may lie ahead of today: a closure announced until 2027, next year's Holy Week. A place never stood in the future. */
const MAY_LIE_AHEAD: readonly PeriodSays[] = ['closed', 'held'];

/** How far ahead of this year such a period may be dated; a year mistyped with a digit too many is refused. */
export const FURTHEST_YEARS_AHEAD = 50;

/**
 * A period: something was so from one date until another (ADR-0217
 * decision 1). The Cathedral of Christ the Saviour in Moscow stood from 1883
 * until 5 December 1931, and stands again from 2000, in a period still open.
 */
export interface PlacePeriod {
  /** When it began; null where that is not known. */
  from: PlaceDate | null;
  /** Whether it has ended. An open period still holds. */
  ended: boolean;
  /** When it ended; null on an open period, and on one that ended at a date not known. */
  until: PlaceDate | null;
}

/** A day of the Gregorian calendar, as the day a period is checked on. */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/**
 * The latest calendar day it is anywhere on Earth at `now` (UTC+14, Kiritimati):
 * a place blown up this morning in Auckland ended on a day London has not
 * reached, and its end is not in the future.
 */
export function latestDayOnEarth(now: Date): CalendarDay {
  const ahead = new Date(now.getTime() + 14 * 60 * 60 * 1000);
  return { year: ahead.getUTCFullYear(), month: ahead.getUTCMonth() + 1, day: ahead.getUTCDate() };
}

/**
 * The outer days a period may cover, in the count `periodOf` orders days by:
 * the first day its start may be and the last day its end may be, each null
 * where that end has no date. They are what is stored beside a period and
 * compared by a read as of a date (ADR-0217 decisions 1 and 6): a trip of 1980
 * falls after `untilLast` of the cathedral's first period and before
 * `fromFirst` of its second.
 */
export function outerDaysOf(period: PlacePeriod): { fromFirst: number | null; untilLast: number | null } {
  return {
    fromFirst: period.from ? periodOf(period.from).first : null,
    untilLast: period.until ? periodOf(period.until).last : null,
  };
}

/** Whether a place with these standing periods stands: it holds none, or one that is open. */
export function standsBy(stood: readonly PlacePeriod[]): boolean {
  return stood.length === 0 || stood.some((period) => !period.ended);
}

/** What is wrong with one period saying `says`, or null. */
function periodFault(period: PlacePeriod, says: PeriodSays, today: CalendarDay): string | null {
  const ahead = MAY_LIE_AHEAD.includes(says);
  const latestYear = ahead ? today.year + FURTHEST_YEARS_AHEAD : today.year;
  const { from, until } = period;
  if (from && !isValidPlaceDate(from, latestYear)) return 'its start is not a date';
  if (until && !period.ended) return 'it has an end date and has not ended';
  if (until && !isValidPlaceDate(until, latestYear)) return 'its end is not a date';
  if (from && until && comparePlaceDates(from, until) > 0) return 'it ends before it starts';
  if (ahead) return null;
  const now = dayIndex(today.year, today.month, today.day);
  if ((from && periodOf(from).first > now) || (until && periodOf(until).first > now)) return 'it lies in the future';
  return null;
}

/**
 * What is wrong with the periods of one place that say `says`, in the order
 * given, or null where they are a list the tables can hold. Every writer and
 * every reader of a source checks a list by this before it is written.
 *
 * - Each end is a date of the calendar (`isValidPlaceDate`), an end date is
 *   only on a period that has ended, and no period ends before it starts.
 * - The list is in time order: no period starts wholly after the one that
 *   follows it.
 * - Standing periods do not overlap: each but the last has ended, and the next
 *   does not start wholly before that end. Uses and closures may overlap.
 * - A standing period or a use lies wholly in the past or holds today; a
 *   closure and an occurrence may lie ahead (ADR-0217 decision 2).
 */
export function periodsFault(says: PeriodSays, periods: readonly PlacePeriod[], today: CalendarDay): string | null {
  for (const [index, period] of periods.entries()) {
    const fault = periodFault(period, says, today);
    if (fault) return fault;
    const next = periods[index + 1];
    if (!next) continue;
    if (period.from && next.from && comparePlaceDates(period.from, next.from) > 0) return 'the periods are not in time order';
    if (says !== PLACE_STOOD) continue;
    if (!period.ended) return 'a period that has not ended is followed by another';
    if (period.until && next.from && comparePlaceDates(period.until, next.from) > 0) return 'two periods overlap';
  }
  return null;
}

/** Whether two dates are the same date, every field compared. */
export function samePlaceDate(a: PlaceDate | null, b: PlaceDate | null): boolean {
  if (a === null || b === null) return a === b;
  return a.year === b.year && a.month === b.month && a.day === b.day && a.span === b.span && a.circa === b.circa;
}
