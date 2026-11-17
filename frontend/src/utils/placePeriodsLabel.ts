/**
 * A place's periods in words (#2578): the periods in which it stood, "Built
 * 1391, stood until 1786" and "Rebuilt 1952, stands today", and its use, "In
 * use until c. 7,000 BC". One line a period, each date as `placeDateLabel`
 * writes it.
 *
 * Read from the list a run files on its change set, which reaches a screen as
 * data of no declared shape: a value that is not such a list reads as null,
 * and the caller shows it as it shows any other value.
 */

import {
  DATE_SPANS, PERIOD_SAYS, type PeriodSays, type PlaceDate, type PlacePeriod,
} from '@tyr/shared/lifetime';
import { placeDateLabel } from './placeDateLabel';

/** A period as a change set files it: its dates, and how a standing period ended or what a use was. */
export type FiledPeriod = PlacePeriod & { ending: string | null; what: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const wholeOrNull = (value: unknown): value is number | null | undefined => value == null || Number.isInteger(value);

/** One end of a filed period: a date, null for one not known, undefined for anything else. */
function filedDate(value: unknown): PlaceDate | null | undefined {
  if (value == null) return null;
  if (!isRecord(value) || !Number.isInteger(value.year) || !wholeOrNull(value.month) || !wholeOrNull(value.day)) return undefined;
  const span = DATE_SPANS.find(known => known === value.span) ?? null;
  return { year: value.year as number, month: value.month ?? null, day: value.day ?? null, span, circa: value.circa === true };
}

/** Whether a change set's field names a list of a place's periods. */
export function isPeriodsField(field: string): field is PeriodSays {
  return (PERIOD_SAYS as readonly string[]).includes(field);
}

/** The list a change set filed, an empty one for none, or null for a value that is no list of periods. */
export function filedPeriods(value: unknown): FiledPeriod[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const periods: FiledPeriod[] = [];
  for (const entry of value) {
    const [from, until] = isRecord(entry) ? [filedDate(entry.from), filedDate(entry.until)] : [undefined, undefined];
    if (!isRecord(entry) || from === undefined || until === undefined || typeof entry.ended !== 'boolean') return null;
    periods.push({
      from, until, ended: entry.ended,
      ending: typeof entry.ending === 'string' ? entry.ending : null,
      what: typeof entry.what === 'string' ? entry.what : null,
    });
  }
  return periods;
}

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** One standing period: how it began, and how it ended or that it has not. */
function stoodLine(period: FiledPeriod, index: number): string {
  const began = index === 0 ? 'built' : 'rebuilt';
  const parts: string[] = [];
  if (period.from) parts.push(`${began} ${placeDateLabel(period.from)}`);
  else if (index > 0) parts.push(`${began}, date unknown`);
  if (!period.ended) parts.push('stands today');
  else if (period.until) parts.push(`${period.ending ?? 'stood until'} ${placeDateLabel(period.until)}`);
  else parts.push(`${period.ending ?? 'no longer stands'}, date unknown`);
  return capitalised(parts.join(', '));
}

const OTHER_WORDS: Readonly<Record<Exclude<PeriodSays, 'stood'>, string>> = { used: 'In use', closed: 'Closed', held: 'Held' };

/** One use, closure or occurrence: under a curator's name for it where it has one, from when and until when. */
function otherLine(period: FiledPeriod, says: Exclude<PeriodSays, 'stood'>): string {
  const named = period.what ?? OTHER_WORDS[says];
  const from = period.from ? placeDateLabel(period.from) : null;
  if (!period.ended) return from ? `${named} since ${from}` : named;
  const until = period.until ? placeDateLabel(period.until) : null;
  if (from && until) return `${named} from ${from} until ${until}`;
  if (until) return `${named} until ${until}`;
  return from ? `${named} from ${from}, end date unknown` : `${named} once, dates unknown`;
}

/** The periods a list says, one line each. */
export function periodLines(says: PeriodSays, periods: readonly FiledPeriod[]): string[] {
  return periods.map((period, index) => (says === 'stood' ? stoodLine(period, index) : otherLine(period, says)));
}

/** The years between two dates, with no year zero between 1 BC and AD 1. */
export function yearsBetween(earlier: PlaceDate, later: PlaceDate): number {
  return later.year - earlier.year - (earlier.year < 0 && later.year > 0 ? 1 : 0);
}
