/**
 * Publishing a held date of a place (#1719, ADR-0214 decision 4).
 *
 * A gated run files a change to a date readers see, and an end of a place
 * readers see, as a held field named by its slot (`lifetimeWrites.ts`), with
 * the date the place holds as `old` and the one its source reports as `new`.
 * Publishing it writes that date onto the place through `placeDatesWriter.ts`,
 * under the place's lock, as the date of the source whose run proposed it: the
 * next run of that source finds the place holding what it reports, and asks
 * nothing. A held removal takes the date off.
 *
 * Refusing one needs nothing of its own: the answer is recorded by value, as
 * every held field's is (`heldDecisions.ts`), so a later run that proposes the
 * same date files it and the queue does not ask again.
 */

import type { PoolClient } from 'pg';
import {
  DATE_SPANS, isValidPlaceDate, LIFETIME_SLOTS, PLACE_END, PLACE_ENDINGS, type LifetimeSlot,
} from '@tyr/shared/lifetime';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { clearPlaceDate, writePlaceDate, type SourcedDate } from '../../db/placeDatesWriter.js';

/** One date a publish writes onto the place, or takes off it (null). */
export interface PublishedDate {
  slot: LifetimeSlot;
  date: SourcedDate | null;
}

/** Whether a changeset field names a date of the place's lifetime. */
export function isLifetimeField(field: string): field is LifetimeSlot {
  return (LIFETIME_SLOTS as readonly string[]).includes(field);
}

const wholeOrNull = (value: unknown): value is number | null => value === null || Number.isInteger(value);
const textOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T | null =>
  value === null || list.includes(value as T);

/**
 * The date a held row proposes, as its changeset filed it: null where it
 * proposes none (the source stopped reporting it), and undefined where the
 * value is not a date the slot can hold, which the caller refuses rather than
 * writes.
 */
export function proposedDate(slot: LifetimeSlot, value: unknown): SourcedDate | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { year, month, day, span, circa, ending, property, statement } = value as Record<string, unknown>;
  if (!wholeOrNull(year) || !wholeOrNull(month) || !wholeOrNull(day) || typeof circa !== 'boolean') return undefined;
  if (!oneOf(DATE_SPANS, span) || !oneOf(PLACE_ENDINGS, ending) || !textOrNull(property) || !textOrNull(statement)) {
    return undefined;
  }
  const date: SourcedDate = { year, month, day, span, circa, ending, property, statement };
  if (ending !== null && slot !== PLACE_END) return undefined;
  return isValidPlaceDate(date, slot, new Date().getUTCFullYear()) ? date : undefined;
}

/** Write the dates a publish answers onto the place, as the dates of the source whose run proposed them. */
export async function publishPlaceDates(
  client: PoolClient,
  lock: LockedExperience,
  dates: readonly PublishedDate[] | undefined,
  sourceId: number,
): Promise<void> {
  for (const { slot, date } of dates ?? []) {
    if (date === null) await clearPlaceDate(client, lock, slot);
    else await writePlaceDate(client, lock, slot, { ...date, sourceId, decidedBy: null });
  }
}
