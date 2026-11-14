/**
 * An instant a caller hands in, as the database can read it (#2516).
 *
 * `z.iso.datetime({ offset: true })` accepts any well-formed offset and any
 * four-digit year, and Postgres reads neither every offset nor the year 0000:
 * `since=0050-04-14T14:36:45+17:19` was a 500 ("time zone displacement out of
 * range") on a value the route had validated. So an instant is held to years 1
 * to 9999 and an offset of at most fourteen hours, the widest any place keeps
 * (Kiribati's Line Islands), and parsed to the UTC instant it names, so the
 * caller's own spelling never reaches a query. The rule is also a pattern the
 * OpenAPI document carries, so a client generated from it, and the API
 * contract lane, send only instants the route reads.
 */

import { z } from 'zod/v4';

/** A year Postgres reads, 0001 to 9999. */
const YEAR = String.raw`(?:000[1-9]|00[1-9]\d|0[1-9]\d{2}|[1-9]\d{3})`;
/** UTC, or an offset of at most fourteen hours, written with or without its colon and minutes. */
const OFFSET = String.raw`(?:Z|[+-](?:0\d|1[0-4])(?::?[0-5]\d)?)`;

export const INSTANT_PATTERN = new RegExp(`^${YEAR}-.*${OFFSET}$`);

export const INSTANT_MESSAGE = 'A date and time from year 1 to 9999, its offset at most 14 hours';

/** Whether a string is an instant the database reads: what `instantSchema` accepts. */
export function isReadableInstant(value: string): boolean {
  return INSTANT_PATTERN.test(value) && z.iso.datetime({ offset: true }).safeParse(value).success;
}

/** An instant a request names, answered as the UTC instant it names (`2001-10-05T07:00:00.000Z`). */
export const instantSchema = z.iso.datetime({ offset: true })
  .regex(INSTANT_PATTERN, INSTANT_MESSAGE)
  // `overwrite` rather than `transform`: a string stays a string, so the schema documents as it validates.
  .overwrite(value => new Date(value).toISOString());
