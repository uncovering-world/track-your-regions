/**
 * A row's id, as a request may name one.
 *
 * Every id the API reads is a Postgres `integer` column, so a positive number
 * past its range names no row, and one sent to the database fails there
 * ("value out of range for type integer") where a request naming no row should
 * be refused. The bound refuses it at the boundary, and puts the range in the
 * OpenAPI document, where a client can read it.
 */

import { z } from 'zod/v4';

/** The largest value a Postgres `integer` column holds. */
export const PG_INTEGER_MAX = 2_147_483_647;

/** An id in a path or a query, where it arrives as text. */
export const rowIdSchema = z.coerce.number().int().positive().max(PG_INTEGER_MAX);

/**
 * An id in a JSON body, where it arrives as a number and a string is refused.
 * No route body coerces a number (`api/routeBodies.test.ts`).
 */
export const bodyRowIdSchema = z.number().int().positive().max(PG_INTEGER_MAX);
