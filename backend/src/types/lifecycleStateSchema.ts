/**
 * The body of a lifecycle verdict (`POST /api/experiences/:id/state` and
 * `POST /api/experiences/locations/:locationId/state`), in a module of its own
 * and part of the `types/index.ts` barrel.
 */

import { z } from 'zod/v4';
import { EXISTENCES } from '@tyr/shared/lifecycle';
import { isValidPlaceDate } from '@tyr/shared/lifetime';
import { CHECK_VALUES } from '../db/schema.generated.js';
import { bodyRowIdSchema } from './rowId.js';

/**
 * A lifecycle verdict, for an object or for one point inside it.
 *
 * One schema for both endpoints because it is one question — delisted, gone, or
 * never gone — asked about two rows that carry the same two axes in the same words
 * (ADR-0026). What the two verdicts *do* differs, and that difference lives in the
 * controllers rather than in the body: on an experience every answer clears
 * `missing_since`, on a location only the false alarm does, because there the flag
 * is one of the two terms that keep a point off the map — `former` is held by the
 * flag, `lost` by its own axis whatever the flag says (ADR-0026 decision 7). So the
 * false alarm is the only answer that clears the flag, though not the only one that
 * can reveal a point: taking a `lost` verdict back on a row whose flag is already
 * clear reveals it too.
 */
export const lifecycleStateBodySchema = z.object({
  membership: z.enum(CHECK_VALUES.experiences.source_membership).optional(),
  existence: z.enum(EXISTENCES).optional(),
  /** With `lost`, on a place: the year it went (ADR-0214), 250 BC as -250; absent, the end holds no year. */
  endedYear: z.number().int().refine((year) => isValidPlaceDate(
    { year, month: null, day: null, span: null, circa: false }, 'ended', new Date().getUTCFullYear(),
  ), { message: 'Give a year other than 0, no later than this year' }).optional(),
  note: z.string().max(1000).optional(),
  /**
   * The row as the curator was looking at it: both axes and whether it was
   * flagged. Required, and compared under the write lock — it is the only
   * thing that distinguishes a card drawn before the question was answered
   * from a deliberate correction made with the current state in view.
   *
   * `flagged` is not redundant with the axes. A run that finds the object
   * again clears `missing_since` and touches neither axis, so a queue card
   * still matches on both while the question it was asking has been withdrawn
   * — and answering "former" then records as delisted an object the source
   * currently lists.
   */
  expected: z.object({
    membership: z.enum(CHECK_VALUES.experiences.source_membership),
    existence: z.enum(EXISTENCES),
    flagged: z.boolean(),
  }),
  /**
   * One kind whose source stopped listing the place while another still lists
   * it (#1264): the verdict is that membership's, and `expected` is its own
   * listing and flag beside the place's existence. Absent, the verdict is the
   * place's.
   */
  membershipId: bodyRowIdSchema.optional(),
}).refine(b => b.membership !== undefined || b.existence !== undefined, { message: 'Pass membership, existence, or both' })
  .refine(b => b.endedYear === undefined || (b.existence === 'lost' && b.membershipId === undefined),
    { message: 'A year it went goes only with an answer that the place is gone' });
