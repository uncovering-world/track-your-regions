/**
 * Why a curator acted (#863), as the writes that ask it take it, the
 * curator's word on where a place belongs in a region, and a place taken out
 * of one of its kinds. In a module of its own
 * because the barrel (`index.ts`) is at the size the development guide allows;
 * the barrel re-exports it.
 *
 * Each reason is a code from the list the act's surface offers
 * (`@tyr/shared/curationLog`), kept in the act's log entry
 * (`db/curationLogWriter.ts`). Optional: an act sent without one is recorded
 * without one.
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
/** The reason a put-back, or a place added to a kind by hand, gives. */
export const additionReasonSchema = z.enum(ADDITION_REASON_CODES).optional().describe(REASON_CODE);
/** The reason an answer to a source's value gives. */
export const sourceAnswerReasonSchema = z.enum(SOURCE_ANSWER_REASON_CODES).optional().describe(REASON_CODE);
/** The reason an answer to a rule's refusal gives: a refusal's on a confirmation, an addition's on a put-back. */
export const admissionReasonSchema = z.enum([...REFUSAL_REASON_CODES, ...ADDITION_REASON_CODES]).optional()
  .describe(`${REASON_CODE} A confirmation takes a refusal's reason, a put-back an addition's.`);

/** Whether the reason fits the answer it was sent with: absent, or from that answer's list. */
export function admissionReasonFits(
  { decision, reasonCode }: { decision: 'confirm' | 'override'; reasonCode?: string },
): boolean {
  const offered: readonly string[] = decision === 'override' ? ADDITION_REASON_CODES : REFUSAL_REASON_CODES;
  return reasonCode === undefined || offered.includes(reasonCode);
}

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
