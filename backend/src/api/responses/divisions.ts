/**
 * What the divisions client's calls answer (ADR-0066): the success bodies of
 * the endpoints `frontend/src/api/divisions.ts` calls, declared once. That is
 * GADM's tree (its roots, one division, its children, ancestors and siblings),
 * a search over it, and one division's boundary.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';
import { MultiPolygon } from './experiences.js';
import { AnchorPoint, FocusBbox } from './regions.js';

export const AdministrativeDivision = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  parentId: z.number().int().nullable(),
  hasChildren: z.boolean(),
  focusBbox: FocusBbox.nullable().describe('Null while the division has no geometry.'),
  anchorPoint: AnchorPoint.nullable(),
}).describe('An official boundary from GADM: a continent, a country, a province, down to a municipality.');
export type AdministrativeDivision = z.infer<typeof AdministrativeDivision>;

export const AdministrativeDivisions = z.array(AdministrativeDivision)
  .describe('Divisions: roots, children or siblings; or a division\'s ancestors, from the root to the division itself.');
export type AdministrativeDivisions = z.infer<typeof AdministrativeDivisions>;

export const DivisionSearchResult = AdministrativeDivision.extend({
  path: z.string().describe('The division\'s place in GADM, root first: `Europe > France > Brittany`.'),
  usageCount: z.number().int().describe('How many regions of the world view hold the division itself. 0 when no world view was named.'),
  usedAsSubdivisionCount: z.number().int()
    .describe('How many regions of the world view hold one of its ancestors, and so hold it as part of something larger.'),
  hasUsedSubdivisions: z.boolean().describe('Some division beneath it is held by a region of the world view.'),
}).describe('A division found by name, with how the world view already uses it.');
export type DivisionSearchResult = z.infer<typeof DivisionSearchResult>;

export const DivisionSearchResults = z.array(DivisionSearchResult).describe('The best matches, at most as many as asked for.');
export type DivisionSearchResults = z.infer<typeof DivisionSearchResults>;

export const DivisionGeometry = z.strictObject({
  type: z.literal('Feature'),
  properties: z.strictObject({ id: z.number().int() }),
  geometry: MultiPolygon.describe('At full resolution, whatever detail the call asked for (#1010).'),
}).describe('A division\'s boundary, as GADM draws it.');
export type DivisionGeometry = z.infer<typeof DivisionGeometry>;
