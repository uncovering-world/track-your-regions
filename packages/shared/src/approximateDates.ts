/**
 * A date known to a day, a month or a year, or not known at all (#773,
 * #2120): a trip to a place, "May 2015", "2015", or "I don't remember". The
 * precision is which of the three are set, so there is no precision beside
 * them to disagree. A place's lifetime (#1719) reads dates the same way and
 * is compared with a trip through `compareApproximate` (#2008).
 */
export interface ApproximateDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

/** The earliest year a trip may carry: a traveller's own memory, not a history book. */
export const EARLIEST_TRIP_YEAR = 1900;

/** The days of a month, February counted in the year's own length. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function precisionOf(date: ApproximateDate): DatePrecision {
  if (date.day !== null) return 'day';
  if (date.month !== null) return 'month';
  if (date.year !== null) return 'year';
  return 'unknown';
}

/**
 * Whether a trip's date can stand: a month only within a year, a day only
 * within a month, a day the month has, a year from `EARLIEST_TRIP_YEAR` to
 * `latestYear` (this year and one more, for a traveller a time zone ahead).
 */
export function isValidTripDate(date: ApproximateDate, latestYear: number): boolean {
  const { year, month, day } = date;
  if (month !== null && year === null) return false;
  if (day !== null && month === null) return false;
  if (year !== null && (!Number.isInteger(year) || year < EARLIEST_TRIP_YEAR || year > latestYear)) return false;
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return false;
  if (day !== null && year !== null && month !== null
    && (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month))) return false;
  return true;
}

/**
 * Which of two dates is earlier, read at the coarser of their precisions:
 * May 2015 and 2015 are the same at a year (0), and an unknown date is
 * comparable with nothing (0). Negative where `a` is earlier.
 */
export function compareApproximate(a: ApproximateDate, b: ApproximateDate): number {
  const parts = ['year', 'month', 'day'] as const;
  for (const part of parts) {
    const left = a[part];
    const right = b[part];
    if (left === null || right === null) return 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}
