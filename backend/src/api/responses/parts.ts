/**
 * What a curator's word on a place in a whole answers (#2118), from the
 * card's *Parts* and *Part of* sections.
 */

import { z } from 'zod/v4';

export const PartWordAnswered = z.strictObject({
  wholeId: z.number().int(),
  partId: z.number().int(),
  act: z.enum(['added', 'put_back', 'taken_out']).describe(
    'What the word did: a part added, a kept-out place put back, or a part taken out.',
  ),
  standing: z.boolean().describe('Whether the place is a part of the whole now.'),
  keptOut: z.boolean().describe(
    'Taken out while a source still names it: the curator\'s refusal keeps it out, and no run puts it back.',
  ),
  recordId: z.number().int().nullable().describe(
    'The curator\'s record of the pair the word left standing; null where it withdrew the curator\'s record and the sources decide the pair again.',
  ),
  becameWhole: z.boolean().describe('The place was the whole\'s first part: the whole is now a place made of parts.'),
}).describe("A curator's word that a place is a part of a whole, or is taken out of it, from either place's card (#2118).");
export type PartWordAnswered = z.infer<typeof PartWordAnswered>;
