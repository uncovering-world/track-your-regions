/**
 * A date of a place's lifetime as a person reads it (#1719): "1883", "January
 * 2024", "5 Dec 1931", "1880s", "c. 10,000 BC".
 *
 * A date known only to the century or the millennium reads "c." and its year
 * rounded to that span: Göbekli Tepe's start, stored as 9999 BC to the
 * millennium, reads "c. 10,000 BC", and Stonehenge's 3000 BC to the century
 * "c. 3,000 BC". Wikidata's own "10th millennium BC" is not what a traveller
 * says, and is off by one on half the years entered as round ones. A decade
 * reads as one, "1880s", and a date the source calls circa reads "c." whatever
 * its precision. A month is named in words and a day carries its year always,
 * since a place's dates are history and never this year's (interface-writing
 * rule 5). The year is `yearLabel`'s, as a work's is.
 *
 * Rounding never reaches year 0: a span on a year closer to it than half a
 * span keeps its year.
 */

import type { DateSpan, PlaceDate } from '@tyr/shared/lifetime';
import { monthNames } from './dateFormat';
import { yearLabel } from './yearLabel';

const SPAN_YEARS: Readonly<Record<DateSpan, number>> = { decade: 10, century: 100, millennium: 1000 };

/** The year rounded to the nearest whole span, never to 0. */
function rounded(year: number, span: DateSpan): number {
  const width = SPAN_YEARS[span];
  const magnitude = Math.round(Math.abs(year) / width) * width;
  return magnitude === 0 ? year : Math.sign(year) * magnitude;
}

/** "1880s", "AD 880s", "250s BC": the decade a year falls in. */
function decadeLabel(year: number): string {
  const magnitude = Math.floor(Math.abs(year) / 10) * 10 || Math.abs(year);
  const label = yearLabel(Math.sign(year) * magnitude) ?? '';
  return year < 0 ? label.replace(/ BC$/, 's BC') : `${label}s`;
}

/** "5 Dec" in the reader's order of day and month, on a year that has both. */
function dayAndMonth(month: number, day: number): string {
  return new Date(2000, month - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The date in words, or null for a date with no year: a place known gone, with no date. */
export function placeDateLabel(date: PlaceDate): string | null {
  const { year, month, day, span, circa } = date;
  if (year === null) return null;
  if (span === 'decade') return `${circa ? 'c. ' : ''}${decadeLabel(year)}`;
  if (span !== null) return `c. ${yearLabel(rounded(year, span))}`;
  const about = circa ? 'c. ' : '';
  if (month === null) return `${about}${yearLabel(year)}`;
  if (day === null) return `${about}${monthNames()[month - 1]} ${yearLabel(year)}`;
  return `${about}${dayAndMonth(month, day)} ${yearLabel(year)}`;
}
