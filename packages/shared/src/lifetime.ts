/**
 * A place's lifetime (#1719, ADR-0214): when it began, when what stands now
 * was rebuilt, when what it housed or was used for ended, and when the place
 * itself stopped standing.
 *
 * The four dates say different things, and only the last hides a place from
 * today's catalogue. Göbekli Tepe began about 10,000 BC and was abandoned about
 * 7000 BC, and the site stands and is visited: its abandonment is the end of a
 * use. Bath Abbey's monastery was dissolved in 1539, and the church stands. The
 * Arch of Reunification in Pyongyang was destroyed in January 2024: that is the
 * end of the place. The Cathedral of Christ the Saviour in Moscow was built by
 * 1883, blown up in 1931 and rebuilt by 2000.
 *
 * A date is a trip's approximate date (`@tyr/shared/approximateDates`, ADR-0202
 * decision 2: a month only within a year, a day only within a month the month
 * has), so `compareApproximate` reads one, with two fields a history needs and
 * a trip does not: a `span` where the source knows the year no closer than a
 * decade, a century or a millennium (Göbekli Tepe's start is known to the
 * millennium, Stonehenge's to the century), and `circa`.
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
 * The schema states the slots, the spans and the endings too, as CHECK lists
 * on `place_dates` and `record_dates`; the backend holds the two to each other
 * by a type (`curationLogActions.test.ts`).
 */

/** What each date of a place says, in the order a card reads them. */
export const LIFETIME_SLOTS = ['began', 'rebuilt', 'use_ended', 'ended'] as const;
export type LifetimeSlot = (typeof LIFETIME_SLOTS)[number];

/** The one slot that hides a place from today's catalogue: the place itself stopped standing. */
export const PLACE_END: LifetimeSlot = 'ended';

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

/** One date of a place's lifetime. */
export interface PlaceDate {
  /** Signed, 250 BC is -250, never 0. Null only on `ended`, for a place known gone with no date. */
  year: number | null;
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
 * Whether a date can stand in `slot`: a year from `EARLIEST_PLACE_YEAR` to
 * `latestYear` and never 0, a month only within a year, a day only within a
 * month the month has, a span only on a year with no month, circa only on a
 * year. Only `ended` may hold no year: a curator can know a place no longer
 * stands without knowing when.
 */
export function isValidPlaceDate(date: PlaceDate, slot: LifetimeSlot, latestYear: number): boolean {
  const { year, month, day, span, circa } = date;
  if (year === null) return slot === PLACE_END && month === null && day === null && span === null && !circa;
  if (year === 0 || !isWhole(year, EARLIEST_PLACE_YEAR, latestYear)) return false;
  if (!isWhole(month, 1, 12)) return false;
  if (day !== null && (month === null || !isWhole(day, 1, daysIn(year, month)))) return false;
  if (span !== null && (month !== null || !DATE_SPANS.includes(span))) return false;
  return true;
}

/** Whether two dates are the same date, every field compared. */
export function samePlaceDate(a: PlaceDate | null, b: PlaceDate | null): boolean {
  if (a === null || b === null) return a === b;
  return a.year === b.year && a.month === b.month && a.day === b.day && a.span === b.span && a.circa === b.circa;
}
