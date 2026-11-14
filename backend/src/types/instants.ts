/**
 * An instant a caller hands in, as the database can read it (#2516).
 *
 * `z.iso.datetime({ offset: true })` accepts any well-formed offset and any
 * four-digit year, and Postgres reads neither every offset nor the year 0000:
 * `since=0050-04-14T14:36:45+17:19` was a 500 ("time zone displacement out of
 * range") on a value the route had validated. So an instant is held to an
 * offset of at most fourteen hours, the widest any place keeps (Kiribati's
 * Line Islands), and to the years 2 to 9998, and parsed to the UTC instant it
 * names, so the caller's own spelling never reaches a query. The years stop a
 * day inside Postgres's 1 to 9999: an offset moves an instant by less than a
 * day, so the UTC instant stays a year Postgres reads, where
 * `0001-01-01T00:00:00+05:00` would become the year 0. The rule is also a pattern the
 * OpenAPI document carries, so a client generated from it, and the API
 * contract lane, send only instants the route reads.
 */

import { z } from 'zod/v4';

/** A year from 0002 to 9998, whose UTC instant under any offset is one Postgres reads. */
const YEAR = String.raw`(?:000[2-9]|00[1-9]\d|0[1-9]\d{2}|[1-8]\d{3}|9[0-8]\d{2}|99[0-8]\d|999[0-8])`;
/** UTC, or an offset of at most fourteen hours (`+14:00`, never `+14:30`), written with or without its colon and minutes. */
const OFFSET = String.raw`(?:Z|[+-](?:(?:0\d|1[0-3])(?::?[0-5]\d)?|14(?::?00)?))`;

/** The fraction of a second an instant is written with: `Date` keeps three digits, Postgres six. */
const FRACTION = /\.(\d+)/;

export const INSTANT_PATTERN = new RegExp(`^${YEAR}-.*${OFFSET}$`);

export const INSTANT_MESSAGE = 'A date and time between the years 2 and 9998, its offset at most 14 hours';

/** Whether a string is an instant the database reads: what `instantSchema` accepts. */
export function isReadableInstant(value: string): boolean {
  return INSTANT_PATTERN.test(value) && z.iso.datetime({ offset: true }).safeParse(value).success;
}

/** An instant a request names, answered as the UTC instant it names (`2001-10-05T07:00:00.000Z`). */
export const instantSchema = z.iso.datetime({ offset: true })
  .regex(INSTANT_PATTERN, INSTANT_MESSAGE)
  // `overwrite` rather than `transform`: a string stays a string, so the schema documents as it validates.
  // It runs on a value the checks above refused too (an empty `since=`), whose issues already answer
  // 400, so such a value is left as it is rather than thrown on by `toISOString`. An offset moves whole
  // minutes, so the fraction the caller wrote is carried over as written: `Date` would cut
  // `07:00:00.123456Z` to `.123Z`, and a `before` bound would then leave out a row at `.123`.
  .overwrite(value => {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return value;
    const fraction = FRACTION.exec(value)?.[1];
    const utc = at.toISOString();
    return fraction === undefined || fraction.length <= 3 ? utc : `${utc.slice(0, -4)}${fraction}Z`;
  });
