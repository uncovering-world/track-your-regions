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
