/**
 * What the world-view import's map matching answers (ADR-0066): the success
 * bodies of the endpoints `frontend/src/api/admin/wvImportCvMatch.ts` calls,
 * declared once. That is a reviewer's answer handed to a waiting colour-match
 * run, the match of a region's divisions to the shapes its Wikivoyage page
 * draws, and a model's reading of which child region each colour cluster is.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';
import { AreaGeometry } from './regions.js';

// ---------------------------------------------------------------------------
// A reviewer's answer to a paused run
// ---------------------------------------------------------------------------

export const ReviewAnswered = z.strictObject({
  ok: z.literal(true),
}).describe('A reviewer\'s answer, handed to the colour-match run waiting on it.');
export type ReviewAnswered = z.infer<typeof ReviewAnswered>;

// ---------------------------------------------------------------------------
// The map preview both matches draw
// ---------------------------------------------------------------------------

export const ChildRegionRef = z.strictObject({
  id: z.number().int(),
  name: z.string(),
}).describe('A child region of the region being matched.');
export type ChildRegionRef = z.infer<typeof ChildRegionRef>;

export const ClusterGeoInfo = z.strictObject({
  clusterId: z.number().int(),
  color: z.string(),
  regionId: z.number().int().nullable().describe('The child region the cluster is matched to, or null while it is matched to none.'),
  regionName: z.string().nullable(),
}).describe('One colour group on the preview map and the child region it stands for.');
export type ClusterGeoInfo = z.infer<typeof ClusterGeoInfo>;

// ---------------------------------------------------------------------------
// The mapshape match
// ---------------------------------------------------------------------------

export const MapshapeDivision = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  coverage: z.number().describe('The share of the division the shape covers, from 0 to 1.'),
}).describe('A GADM division a shape covers.');
export type MapshapeDivision = z.infer<typeof MapshapeDivision>;

export const MapshapeGroup = z.strictObject({
  title: z.string().describe('The matched child region\'s name, or the titles of the shapes in the group joined.'),
  color: z.string(),
  wikidataIds: z.array(z.string()).describe('The Wikidata items whose shapes the group draws.'),
  matchedRegion: ChildRegionRef.nullable(),
  divisions: z.array(MapshapeDivision).describe('Largest coverage first.'),
}).describe('The shapes a Wikivoyage page draws in one colour, taken as one region.');
export type MapshapeGroup = z.infer<typeof MapshapeGroup>;

export const MapshapePreviewFeature = z.strictObject({
  type: z.literal('Feature'),
  geometry: AreaGeometry,
  properties: z.strictObject({
    divisionId: z.number().int(),
    name: z.string(),
    color: z.string(),
    mapshapeTitle: z.string(),
    regionId: z.number().int().nullable(),
    regionName: z.string().nullable(),
    coverage: z.number().describe('Rounded to three places.'),
    accepted: z.literal(false),
    isUnsplittable: z.boolean(),
    confidence: z.number(),
    clusterId: z.number().int().describe('The index of the division\'s group in `mapshapes`.'),
  }),
}).describe('A division drawn in the colour of the group that covers it best.');
export type MapshapePreviewFeature = z.infer<typeof MapshapePreviewFeature>;

export const WikivoyageShapeFeature = z.strictObject({
  type: z.literal('Feature'),
  geometry: AreaGeometry,
  properties: z.strictObject({
    mapshapeIndex: z.number().int().describe('The index of the shape\'s group in `mapshapes`.'),
    title: z.string(),
    color: z.string(),
  }),
}).describe('One shape the Wikivoyage page draws, as its Wikidata items outline it.');
export type WikivoyageShapeFeature = z.infer<typeof WikivoyageShapeFeature>;

export const MapshapesNotFound = z.strictObject({
  found: z.literal(false),
  message: z.string().describe('Why nothing was matched: no source page, no shapes on it, no divisions in scope.'),
}).describe('A mapshape match that found nothing to match.');
export type MapshapesNotFound = z.infer<typeof MapshapesNotFound>;

export const MapshapesFound = z.strictObject({
  found: z.literal(true),
  mapshapes: z.array(MapshapeGroup).describe('At least one.'),
  childRegions: z.array(ChildRegionRef).describe('By name.'),
  geoPreview: z.strictObject({
    featureCollection: z.strictObject({
      type: z.literal('FeatureCollection'),
      features: z.array(MapshapePreviewFeature),
    }),
    clusterInfos: z.array(ClusterGeoInfo).describe('One per group, in the order of `mapshapes`.'),
  }),
  wikivoyagePreview: z.strictObject({
    type: z.literal('FeatureCollection'),
    features: z.array(WikivoyageShapeFeature),
  }),
  stats: z.strictObject({
    totalMapshapes: z.number().int(),
    matchedMapshapes: z.number().int(),
    totalDivisions: z.number().int(),
  }),
}).describe('A mapshape match: the page\'s shapes grouped by colour, the divisions each covers, and both drawn.');
export type MapshapesFound = z.infer<typeof MapshapesFound>;

export const MapshapeMatchResult = z.union([MapshapesNotFound, MapshapesFound])
  .describe('The GADM divisions matched to the shapes a region\'s Wikivoyage page draws with `{{mapshape}}`.');
export type MapshapeMatchResult = z.infer<typeof MapshapeMatchResult>;

// ---------------------------------------------------------------------------
// A model's reading of the colour clusters
// ---------------------------------------------------------------------------

export const ClusterRegionMatch = z.strictObject({
  clusterId: z.number().int(),
  regionId: z.number().int().nullable().describe('Null where the model named no child region, one not among them, or one another cluster already took.'),
  regionName: z.string().nullable().describe('The child region\'s own name, as the region list spells it.'),
}).describe('The child region a model reads one colour cluster as.');
export type ClusterRegionMatch = z.infer<typeof ClusterRegionMatch>;

export const ClusterRegionSuggestions = z.strictObject({
  matches: z.array(ClusterRegionMatch).describe('At most one per cluster asked about, and no child region twice.'),
  stats: z.strictObject({
    model: z.string(),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    cost: z.number().describe('In US dollars.'),
    durationMs: z.number().int(),
  }),
}).describe('A model\'s reading of which child region each colour cluster stands for.');
export type ClusterRegionSuggestions = z.infer<typeof ClusterRegionSuggestions>;
