/**
 * What the trip routes accept (#2120, ADR-0202): a trip's date, a trip's id,
 * and the visits an untick removed, given back for its Undo.
 */

import { z } from 'zod/v4';
import { isValidTripDate } from '@tyr/shared/approximateDates';
import { bodyRowIdSchema, rowIdSchema } from './rowId.js';

/**
 * A trip's date as the traveller gives it (#2120): a year, a month within
 * it, a day within that, each optional, and all three empty for a trip they
 * do not remember the date of. Held to `isValidTripDate` (`@tyr/shared/approximateDates`).
 */
export const tripDateBodySchema = z.object({
  year: z.number().int().nullable(),
  month: z.number().int().nullable(),
  day: z.number().int().nullable(),
}).refine(date => isValidTripDate(date, new Date().getUTCFullYear() + 1), {
  message: 'A month needs a year, a day needs a month, and the date has to exist, from 1900 to next year',
});

export const tripIdParamSchema = z.object({
  tripId: rowIdSchema,
});

/**
 * The most trips adding a trip lets one visit hold (#2120): a trip a day for a
 * year is more than a traveller returns to one place. A merge or a restore
 * can leave a visit with more, which its removal and its Undo still take
 * whole (`RESTORE_LIMITS`).
 */
export const TRIPS_PER_VISIT = 365;

/** A trip added to a visit that already holds `TRIPS_PER_VISIT`, in words. */
export const TOO_MANY_TRIPS = 'A place holds at most 365 trips: remove one to add another';

/**
 * The most one removal takes and one Undo puts back (#2120), the same
 * numbers on both sides, so a removal never deletes what its Undo would
 * refuse. Unticking a whole with *Unmark all* removes it and every part, and
 * the largest whole holds 758 parts, so 1,000 visits leaves room. 10,000
 * trips is past any traveller (365 a visit is the most a visit takes by
 * adding) and bounds the rows one restore writes into the caller's own
 * visits; a single visit takes up to all of it.
 */
export const RESTORE_LIMITS = { visits: 1000, trips: 10000 } as const;

const RESTORE_TOO_MUCH = 'An Undo puts back at most 1,000 visits and 10,000 trips at once';

/** A removal larger than its Undo could put back, refused before anything is deleted, in words. */
export const TOO_MUCH_TO_UNDO = 'This would remove more than 1,000 visits or 10,000 trips at once, '
  + 'more than an Undo can put back: remove them one region at a time';

/** Visits an untick removed, given back whole for its Undo (#2120). */
export const restoreVisitsBodySchema = z.object({
  visits: z.array(z.object({
    experienceId: bodyRowIdSchema,
    markedAt: z.iso.datetime({ offset: true }).nullable(),
    notes: z.string().max(2000).nullable(),
    rating: z.number().int().min(1).max(5).nullable(),
    trips: z.array(tripDateBodySchema).max(RESTORE_LIMITS.trips, RESTORE_TOO_MUCH),
  })).min(1).max(RESTORE_LIMITS.visits, RESTORE_TOO_MUCH),
}).refine(body => body.visits.reduce((sum, visit) => sum + visit.trips.length, 0) <= RESTORE_LIMITS.trips, {
  message: RESTORE_TOO_MUCH,
});
