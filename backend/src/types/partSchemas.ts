/**
 * What a curator's word on a place in a whole sends (#2118): the add, the
 * take-out and the search of the card's *Parts* and *Part of* sections. In a
 * module of its own because the barrel (`index.ts`) is at the size the
 * development guide allows.
 */

import { z } from 'zod/v4';
import { searchText } from './index.js';
import { bodyRowIdSchema } from './rowId.js';

/**
 * A curator's word that a place is a part of the whole `:id` (#2118), from
 * either place's card: the place, the curator's words, and whether the
 * curator was told that the whole's first part makes it a place made of
 * parts.
 */
export const partWordBodySchema = z.object({
  partId: bodyRowIdSchema,
  note: z.string().max(1000).optional(),
  makesWhole: z.boolean().optional()
    .describe('The curator was told that this first part makes the whole a place made of parts, never merged and found by no item.'),
});

/**
 * The search of the curator's part sections (#2118): `part` looks for places
 * to add to `:id` as its parts, `whole` for wholes to add `:id` to; with no
 * `q`, the places near it.
 */
export const partCandidatesQuerySchema = z.object({
  role: z.enum(['part', 'whole']),
  q: searchText(2, 100).transform(v => v.trim()).pipe(z.string().min(2)).optional(),
});

/** A place taken out of the whole `:id` (#2118): the place and why, kept in both places' histories. */
export const takeOutPartBodySchema = z.object({
  partId: bodyRowIdSchema,
  note: z.string().max(1000).optional(),
});
