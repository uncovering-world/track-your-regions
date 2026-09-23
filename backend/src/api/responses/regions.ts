/**
 * What the regions client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/regions.ts` calls, declared once. That is the
 * regions of a world view — its tree, one branch, a region's ancestors, a
 * search — and a region created or edited.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const FocusBbox = z.tuple([z.number(), z.number(), z.number(), z.number()])
  .describe(
    'The frame a camera fits, [west, south, east, north], stored from `geometry_focus()`.'
    + ' West greater than east means the frame crosses the antimeridian.',
  );
export type FocusBbox = z.infer<typeof FocusBbox>;

export const AnchorPoint = z.tuple([z.number(), z.number()])
  .describe('The centre of the focus frame, [lng, lat]: where the camera goes for a frame that crosses the antimeridian.');
export type AnchorPoint = z.infer<typeof AnchorPoint>;

export const Region = z.strictObject({
  id: z.number().int(),
  worldViewId: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  parentRegionId: z.number().int().nullable(),
  color: z.string().nullable(),
  isCustomBoundary: z.boolean().describe('Its outline was drawn by hand rather than made of its members.'),
  usesHull: z.boolean().describe('Drawn as the hull around its members, as for an archipelago.'),
  focusBbox: FocusBbox.nullable().describe('Null while the region has no geometry.'),
  anchorPoint: AnchorPoint.nullable(),
  hasSubregions: z.boolean(),
  hasHullChildren: z.boolean().describe('At least one of its subregions is drawn as a hull.'),
  sourceUrl: z.string().nullable().describe('The page the region was imported from, where it was imported.'),
  regionMapUrl: z.string().nullable().describe('The map image that import read, where it read one.'),
}).describe('A region of a world view: a named grouping of divisions, or of other regions.');
export type Region = z.infer<typeof Region>;

export const Regions = z.array(Region).describe('Regions, by name; or a region\'s ancestors, from the root to the region itself.');
export type Regions = z.infer<typeof Regions>;

export const RegionUpdated = Region.extend({
  tileVersion: z.number().int().optional()
    .describe('The world view\'s new tile version, sent when the edit changed what its tiles draw (a hull flip).'),
}).describe('A region as an edit left it.');
export type RegionUpdated = z.infer<typeof RegionUpdated>;

export const RegionSearchResult = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  parentRegionId: z.number().int().nullable(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  usesHull: z.boolean(),
  focusBbox: FocusBbox.nullable(),
  anchorPoint: AnchorPoint.nullable(),
  hasSubregions: z.boolean(),
  path: z.string().describe('The region\'s place in the tree, root first: `Europe > Western Europe > France`.'),
  relevance_score: z.number().int().describe('How well it matched; the results come sorted by it, best first.'),
}).describe('A region found by name.');
export type RegionSearchResult = z.infer<typeof RegionSearchResult>;

export const RegionSearchResults = z.array(RegionSearchResult).describe('The best matches, at most as many as asked for.');
export type RegionSearchResults = z.infer<typeof RegionSearchResults>;

export const RegionMemberType = z.enum(['division', 'subregion'])
  .describe('What a member of a region is: a GADM division, or one of its own subregions.');
export type RegionMemberType = z.infer<typeof RegionMemberType>;

export const RegionMember = z.strictObject({
  id: z.number().int().describe('The division\'s id, or the subregion\'s.'),
  memberRowId: z.number().int().optional()
    .describe('A division member\'s own row. A division can be a member twice, as parts cut from it, so the division\'s id alone does not name one.'),
  name: z.string().describe('A division member\'s custom name where it has one, as for a part cut from it.'),
  hasChildren: z.boolean().describe('The division has divisions beneath it. Always false for a subregion.'),
  memberType: RegionMemberType,
  isSubregion: z.boolean(),
  color: z.string().nullable().optional().describe('A subregion\'s colour.'),
  path: z.string().describe('A division\'s place in GADM, root first (`Europe > Germany > Bavaria`); a subregion\'s name.'),
  hasCustomGeometry: z.boolean().optional().describe('The division member is a part cut from the division rather than all of it.'),
}).superRefine((member, ctx) => {
  const subregion = member.memberType === 'subregion';
  if (member.isSubregion !== subregion) {
    ctx.addIssue({ code: 'custom', path: ['isSubregion'], message: 'isSubregion says what memberType says' });
  }
  for (const key of ['memberRowId', 'hasCustomGeometry'] as const) {
    if (subregion === (member[key] !== undefined)) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} comes with a division member and only with one` });
    }
  }
  if (subregion === (member.color === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['color'], message: 'color comes with a subregion and only with one' });
  }
}).describe('One member of a region: a division, or a part cut from one, or a subregion.');
export type RegionMember = z.infer<typeof RegionMember>;

export const RegionMembers = z.array(RegionMember)
  .describe('A region\'s subregions by name, then its division members. A division a subregion of the same name stands for is left out.');
export type RegionMembers = z.infer<typeof RegionMembers>;

export const CreatedSubregion = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  divisionId: z.number().int().describe('The division the subregion was made for.'),
}).describe('A subregion an edit created for a division.');
export type CreatedSubregion = z.infer<typeof CreatedSubregion>;

export const DivisionsAdded = z.strictObject({
  added: z.number().int().describe('How many divisions the call named.'),
  createdRegions: z.array(CreatedSubregion).optional()
    .describe('Sent when the divisions were added as subregions: the ones that did not exist yet.'),
}).describe('Divisions added to a region, directly or as subregions of it.');
export type DivisionsAdded = z.infer<typeof DivisionsAdded>;

export const DivisionsRemoved = z.strictObject({
  removed: z.number().int().describe('How many member rows went.'),
}).describe('Division members removed from a region.');
export type DivisionsRemoved = z.infer<typeof DivisionsRemoved>;

export const MemberMoved = z.strictObject({
  moved: z.literal(true),
  memberRowId: z.number().int(),
  fromRegionId: z.number().int(),
  toRegionId: z.number().int(),
}).describe('A division member moved to another region. The row keeps its custom name and cut geometry; the answer names it and the two regions.');
export type MemberMoved = z.infer<typeof MemberMoved>;

export const ChildDivisionsAdded = z.strictObject({
  added: z.number().int().describe(
    'How many of the division\'s children now sit in the region: the ones the call named, or all of them where it named'
    + ' none, less any whose assignment to an existing subregion failed.',
  ),
  removedOriginal: z.boolean()
    .describe('The division itself was taken out of the region, so it is not counted twice beside its children.'),
  createdRegions: z.array(CreatedSubregion).describe('The subregions made for them; empty when they went in as division members.'),
}).describe('A division member\'s children added to the region, as subregions or as members.');
export type ChildDivisionsAdded = z.infer<typeof ChildDivisionsAdded>;

export const SubregionFlattened = z.strictObject({
  movedDivisions: z.number().int().describe('Divisions the parent gained; one it already held is not counted.'),
  deletedRegion: z.literal(true),
}).describe('A subregion folded into its parent: its divisions, and its descendants\', moved up, and the subregion deleted.');
export type SubregionFlattened = z.infer<typeof SubregionFlattened>;

export const SubregionsExpanded = z.strictObject({
  createdRegions: z.array(CreatedSubregion),
  expandedCount: z.number().int(),
}).describe('Each division member of a region turned into a subregion holding it.');
export type SubregionsExpanded = z.infer<typeof SubregionsExpanded>;

export const DivisionUsageCounts = z.record(z.string(), z.number().int())
  .describe('For each division asked about that some region of the world view holds, how many regions hold it, by division id.');
export type DivisionUsageCounts = z.infer<typeof DivisionUsageCounts>;
