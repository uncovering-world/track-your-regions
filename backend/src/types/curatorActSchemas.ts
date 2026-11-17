/**
 * Why a curator acted (#863), as the writes that ask it take it, the
 * curator's word on where a place belongs in a region, and a place taken out
 * of one of its kinds. In a module of its own
 * because the barrel (`index.ts`) is at the size the development guide allows;
 * the barrel re-exports it.
 *
 * Each reason is a code from the list the act's surface offers
 * (`@tyr/shared/curationLog`), kept in the act's log entry
 * (`db/curationLogWriter.ts`). Required where every surface of the act asks
 * it: an arrival turned away and a place put back against its kind's rule.
 * Optional elsewhere, where an act sent without one is recorded without one.
 */

import { z } from 'zod/v4';
import {
  ADDITION_REASON_CODES, CURATION_REASON_CODES, REFUSAL_REASON_CODES, SOURCE_ANSWER_REASON_CODES,
} from '@tyr/shared/curationLog';
import { bodyRowIdSchema } from './rowId.js';

const REASON_CODE = 'Why the curator acted, kept in the log entry the act writes.';

/** The reason a hand-made act on a place in a region gives: any reason fits. */
const regionReasonSchema = z.enum(CURATION_REASON_CODES).optional().describe(REASON_CODE);
/** The reason a refusal gives: an arrival turned away, a place kept out of a kind. */
export const refusalReasonSchema = z.enum(REFUSAL_REASON_CODES).optional().describe(REASON_CODE);
/** The reason a place added to a kind by hand gives. */
export const additionReasonSchema = z.enum(ADDITION_REASON_CODES).optional().describe(REASON_CODE);
/** The reason an answer to a source's value gives. */
export const sourceAnswerReasonSchema = z.enum(SOURCE_ANSWER_REASON_CODES).optional().describe(REASON_CODE);

/**
 * The membership a curator's answer is about (#1264, ADR-0084): a place in two
 * kinds can have an arrival in one and a refusal or a held proposal in the
 * other, and the card the curator answered names which. Optional: absent, the
 * endpoint answers the membership `membershipToAnswerSql` picks, which is the
 * place's only one until a merge (#1247). A membership of another place is no
 * question this place has, and is refused as one already answered.
 */
export const answeredMembershipSchema = bodyRowIdSchema.optional();
const NOTE = z.string().max(1000).optional();

/**
 * A curator's answer to a kind's rule refusing a place: `confirm` keeps the
 * refusal, `override` puts the place back.
 *
 * Only a put-back must say why, from an addition's reasons: it goes against
 * the rule, and every surface that offers it asks. A confirmation agrees with
 * the rule and asks nothing; a reason sent with it is a refusal's.
 *
 * No `expected` block, because only one of the two needs a stale-view check.
 * `confirm` hides, so it collides with the `curated_fields` pin a first
 * answer left. `override` reveals and is idempotent across curators, so it
 * stays open on a pinned row: that is the only way back from a refusal, and
 * a way back an earlier click can close is not one.
 */
export const experienceAdmissionBodySchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('confirm'),
    note: NOTE,
    membershipId: answeredMembershipSchema,
    reasonCode: refusalReasonSchema,
  }),
  z.object({
    decision: z.literal('override'),
    note: NOTE,
    membershipId: answeredMembershipSchema,
    /**
     * Whether later runs keep the row while the rule refuses it for the same
     * reason (the pin, #1367). Absent, they do; false admits it for now and the
     * next run applies the rule again (#1368).
     */
    remember: z.boolean().optional(),
    reasonCode: z.enum(ADDITION_REASON_CODES).describe(`${REASON_CODE} A put-back always says why.`),
  }),
]);

/**
 * A curator turning away an arrival (#852, ADR-0053): why, from a refusal's
 * reasons, which every surface that turns an arrival away asks, and the
 * curator's words.
 */
export const refuseArrivalBodySchema = z.object({
  note: NOTE,
  membershipId: answeredMembershipSchema,
  reasonCode: z.enum(REFUSAL_REASON_CODES).describe(`${REASON_CODE} Turning an arrival away always says why.`),
});

export const rejectExperienceBodySchema = z.object({
  regionId: bodyRowIdSchema,
  reason: z.string().max(1000).optional(),
  reasonCode: regionReasonSchema,
});

export const unrejectExperienceBodySchema = z.object({
  regionId: bodyRowIdSchema,
  reasonCode: regionReasonSchema,
});

export const assignExperienceBodySchema = z.object({
  regionId: bodyRowIdSchema,
  reasonCode: regionReasonSchema,
});

/**
 * A curator takes a published place out of one of its kinds from the place's
 * card (#2022), with no question asked: the membership named, and why.
 */
export const keepOutOfKindBodySchema = z.object({
  membershipId: bodyRowIdSchema,
  note: z.string().max(1000).optional(),
  reasonCode: refusalReasonSchema,
});

/** A place taken out of a region by hand: why, where the curator says. */
export const regionActQuerySchema = z.object({
  reasonCode: regionReasonSchema,
});
