/**
 * What the world views client's calls answer (ADR-0066): the success bodies of
 * the endpoints `frontend/src/api/worldViews.ts` calls, declared once. That is
 * the list of world views a caller may see, one created or edited, and what
 * deleting one would destroy.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const WorldView = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  source: z.string().nullable(),
  isDefault: z.boolean().describe('The GADM world view itself, which cannot be deleted.'),
  isPublic: z.boolean().describe('False for an admin-only world view, which the listing hides from everyone else.'),
  tileVersion: z.number().int()
    .describe('Bumped whenever the world view\'s tiles are rebuilt at unchanged URLs, so a tile URL carrying it misses the stale cache.'),
}).describe('A way of dividing the world into regions: GADM itself, or a hierarchy built over it.');
export type WorldView = z.infer<typeof WorldView>;

export const WorldViews = z.array(WorldView).describe('The world views the caller may see, the default first.');
export type WorldViews = z.infer<typeof WorldViews>;

export const DeleteImpact = z.strictObject({
  regionCount: z.number().int(),
  experienceAssignmentCount: z.number().int().describe('Object-to-region assignments that go with the regions.'),
  userVisitCount: z.number().int().describe('Readers\' visits to its regions that go with them.'),
  isDefault: z.boolean().describe('True means the delete will be refused.'),
}).describe('What deleting a world view would destroy, for the admin to read before confirming.');
export type DeleteImpact = z.infer<typeof DeleteImpact>;
