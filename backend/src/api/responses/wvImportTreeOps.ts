/**
 * What the world-view import review's tree operations answer (ADR-0066): the
 * success bodies of the endpoints `frontend/src/api/admin/wvImportTreeOps.ts`
 * calls, declared once. The module's other calls are #992's to declare.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const SelectionAccepted = z.strictObject({
  accepted: z.number().int().describe('Divisions of the selection that are the region\'s members now.'),
  rejected: z.number().int().describe('The region\'s other open suggestions, rejected.'),
}).describe('A selection of a region\'s suggestions accepted, and the rest rejected.');
export type SelectionAccepted = z.infer<typeof SelectionAccepted>;

export const SelectionRejected = z.strictObject({
  rejected: z.number().int().describe('Suggestions of the selection marked rejected.'),
}).describe('A selection of a region\'s suggestions rejected, and taken out of its members.');
export type SelectionRejected = z.infer<typeof SelectionRejected>;
