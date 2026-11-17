/**
 * Publishing a held list of a place's periods (#2578, ADR-0217 decision 3).
 *
 * A gated run files a list it may not write onto a place readers see, the
 * periods in which the place stood or the end of a use, as a held field named
 * by what the list says (`lifetimeWrites.ts`): the list the place holds as
 * `old`, the one its source reports as `new`. Publishing it writes that list
 * whole through `placePeriodsWriter.ts`, under the place's lock, as the list
 * of the source whose run proposed it: the next run of that source finds the
 * place holding what it reports, and asks nothing. A held removal takes the
 * list off the place.
 *
 * Refusing one needs nothing of its own. The answer is recorded by value, as
 * every held field's is (`heldDecisions.ts`), so a later run that reports the
 * same list files it and the queue does not ask again.
 */

import type { PoolClient } from 'pg';
import {
  DATE_SPANS, latestDayOnEarth, periodsFault, PLACE_ENDINGS, PLACE_STOOD, REPORTED_SAYS, type PeriodSays,
} from '@tyr/shared/lifetime';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { writePlacePeriods, type SourcedDate, type SourcedPeriod } from '../../db/placePeriodsWriter.js';

/** One list a publish writes onto the place; an empty one takes the place's off. */
export interface PublishedPeriods {
  says: PeriodSays;
  periods: SourcedPeriod[];
}

/** Whether a changeset field names a list of the place's periods a run reports. */
export function isPeriodsField(field: string): field is PeriodSays {
  return (REPORTED_SAYS as readonly string[]).includes(field);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const wholeOrNull = (value: unknown): value is number | null => value === null || Number.isInteger(value);
const textOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T | null =>
  value === null || list.includes(value as T);

/** One end of a filed period: a date, null for one not known, undefined for anything else. */
function filedDate(value: unknown): SourcedDate | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { year, month, day, span, circa, property, statement } = value;
  if (!Number.isInteger(year) || !wholeOrNull(month) || !wholeOrNull(day) || typeof circa !== 'boolean') return undefined;
  if (!oneOf(DATE_SPANS, span) || !textOrNull(property) || !textOrNull(statement)) return undefined;
  return { year: year as number, month, day, span, circa, property, statement };
}

function filedPeriod(says: PeriodSays, value: unknown): SourcedPeriod | undefined {
  if (!isRecord(value)) return undefined;
  const [from, until] = [filedDate(value.from), filedDate(value.until)];
  const { ended, ending, what } = value;
  if (from === undefined || until === undefined || typeof ended !== 'boolean') return undefined;
  // What the writer refuses beside the shared rule: an ending only on a standing period that ended, and no name on a run's period.
  if (!oneOf(PLACE_ENDINGS, ending) || (ending !== null && !(says === PLACE_STOOD && ended)) || what !== null) return undefined;
  return { from, ended, until, ending, what };
}

/**
 * The list a held row proposes, as its changeset filed it: empty where it
 * proposes none (the source stopped reporting it), and undefined where the
 * value is not a list the place can hold, which the caller refuses rather
 * than writes.
 */
export function proposedPeriods(says: PeriodSays, value: unknown): SourcedPeriod[] | undefined {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const periods: SourcedPeriod[] = [];
  for (const entry of value) {
    const period = filedPeriod(says, entry);
    if (!period) return undefined;
    periods.push(period);
  }
  return periodsFault(says, periods, latestDayOnEarth(new Date())) === null ? periods : undefined;
}

/** Write the lists a publish answers onto the place, as the lists of the source whose run proposed them. */
export async function publishPlacePeriods(
  client: PoolClient,
  lock: LockedExperience,
  lists: readonly PublishedPeriods[],
  sourceId: number,
): Promise<void> {
  for (const { says, periods } of lists) {
    await writePlacePeriods(client, lock, says, periods, { sourceId, decidedBy: null });
  }
}
