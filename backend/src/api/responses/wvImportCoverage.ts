/**
 * What the world-view import's coverage check answers (ADR-0066): the success
 * bodies of the endpoints `frontend/src/api/admin/wvImportCoverage.ts` calls,
 * declared once. That is the check itself and its stream, a gap's geographic
 * suggestion, a reviewer's verdicts on gaps, closing the review, and the
 * geometry the review draws: containers' coverage, a region's own and its
 * descendants' outlines, the gaps between them, and divisions previewed,
 * split deeper or read off a map by a model.
 *
 * The stream's events are one union, `CoverageEvent`, each written with
 * `writeEvent()`, which holds it to the schema as `respond()` holds a body.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';
import { AreaGeometry } from './regions.js';

// ---------------------------------------------------------------------------
// The coverage check
// ---------------------------------------------------------------------------

export const CoverageSuggestion = z.strictObject({
  action: z.enum(['add_member', 'create_region']).describe('Add the gap to the region, or create a region for it under this one.'),
  targetRegionId: z.number().int(),
  targetRegionName: z.string(),
}).describe('Where a coverage gap could go.');
export type CoverageSuggestion = z.infer<typeof CoverageSuggestion>;

export const GapSubtreeNode = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  get children(): z.ZodArray<typeof GapSubtreeNode> {
    return z.array(GapSubtreeNode);
  },
}).describe('A GADM division under a gap, with its own.');
export type GapSubtreeNode = z.infer<typeof GapSubtreeNode>;

export const CoverageGap = z.strictObject({
  id: z.number().int().describe('The uncovered GADM division.'),
  name: z.string(),
  parentName: z.string().nullable(),
  suggestion: CoverageSuggestion.nullable().describe('From a sibling division a region holds, else from the nearest covered cousin; null where neither exists.'),
  subtree: z.array(GapSubtreeNode).optional().describe('Sent for a gap with GADM divisions under it, by name.'),
}).describe('A GADM division no region covers, whose parent is covered or is a root.');
export type CoverageGap = z.infer<typeof CoverageGap>;

export const DismissedGap = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  parentName: z.string().nullable(),
}).describe('A gap the reviewer dismissed, which coverage no longer counts.');
export type DismissedGap = z.infer<typeof DismissedGap>;

export const CoverageResult = z.strictObject({
  gaps: z.array(CoverageGap),
  dismissedCount: z.number().int(),
  dismissedGaps: z.array(DismissedGap),
}).describe('The GADM divisions a world view does not cover yet.');
export type CoverageResult = z.infer<typeof CoverageResult>;

export const CoverageProgress = z.strictObject({
  type: z.literal('progress'),
  step: z.string(),
  elapsed: z.number().describe('Seconds since the check started.'),
}).describe('A step of the coverage check, begun.');
export type CoverageProgress = z.infer<typeof CoverageProgress>;

export const CoverageComplete = z.strictObject({
  type: z.literal('complete'),
  elapsed: z.number(),
  data: CoverageResult,
}).describe('The coverage check, finished; the stream ends after it.');
export type CoverageComplete = z.infer<typeof CoverageComplete>;

export const CoverageFailed = z.strictObject({
  type: z.literal('error'),
  message: z.string(),
  elapsed: z.number(),
}).describe('The coverage check, stopped; the stream ends after it.');
export type CoverageFailed = z.infer<typeof CoverageFailed>;

export const CoverageEvent = z.union([CoverageProgress, CoverageComplete, CoverageFailed])
  .describe('One event of the coverage stream (`/coverage-stream`), told apart by `type`.');
export type CoverageEvent = z.infer<typeof CoverageEvent>;

// ---------------------------------------------------------------------------
// A gap's geographic suggestion
// ---------------------------------------------------------------------------

export const RegionContextNode = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  isSuggested: z.boolean(),
  get children(): z.ZodArray<typeof RegionContextNode> {
    return z.array(RegionContextNode);
  },
}).describe('A region on the way from the root to the suggested one; the suggested one carries its children.');
export type RegionContextNode = z.infer<typeof RegionContextNode>;

export const GeoSuggestResult = z.strictObject({
  suggestion: CoverageSuggestion.extend({ action: z.literal('add_member') }).nullable()
    .describe('The region holding the assigned division nearest the gap; null where there is none, and then nothing else is sent.'),
  suggestionDivisionId: z.number().int().optional().describe('The assigned division nearest the gap.'),
  suggestionDivisionName: z.string().optional(),
  gapCenter: z.tuple([z.number(), z.number()]).optional().describe('Longitude and latitude.'),
  suggestionCenter: z.tuple([z.number(), z.number()]).optional().describe('The nearest division\'s anchor, longitude and latitude.'),
  distanceKm: z.number().int().optional().describe('From the gap\'s centre to the nearest division\'s boundary.'),
  contextTree: RegionContextNode.optional().describe('The suggested region\'s ancestry from the root, for picking another level.'),
}).describe('A gap\'s geographic suggestion: the region holding the assigned division nearest it.');
export type GeoSuggestResult = z.infer<typeof GeoSuggestResult>;

// ---------------------------------------------------------------------------
// A reviewer's verdicts on gaps, and closing the review
// ---------------------------------------------------------------------------

export const GapDismissed = z.strictObject({
  dismissed: z.literal(true),
}).describe('A gap dismissed: coverage stops counting it until a re-match.');
export type GapDismissed = z.infer<typeof GapDismissed>;

export const GapUndismissed = z.strictObject({
  undismissed: z.literal(true),
}).describe('A dismissed gap counted again.');
export type GapUndismissed = z.infer<typeof GapUndismissed>;

export const CoverageApproved = z.strictObject({
  approved: z.literal(true),
  regionId: z.number().int().describe('The region the gap was added to: the target, or the region created for it.'),
}).describe('A gap covered: added to a region, or to a new region created for it.');
export type CoverageApproved = z.infer<typeof CoverageApproved>;

export const ReviewFinalized = z.strictObject({
  finalized: z.literal(true),
  worldViewId: z.number().int(),
}).describe('A world view\'s match review closed; it leaves the active review list.');
export type ReviewFinalized = z.infer<typeof ReviewFinalized>;

// ---------------------------------------------------------------------------
// The geometry the review draws
// ---------------------------------------------------------------------------

export const ChildrenCoverage = z.strictObject({
  coverage: z.record(z.string(), z.number()).describe('By region id: the share, 0 to 1, of the region\'s own divisions its descendants\' divisions cover, or of its geoshape where it holds none.'),
  geoshapeCoverage: z.record(z.string(), z.number()).describe('By region id: the share of the region\'s geoshape its assigned divisions cover.'),
}).describe('How much of each container its children cover.');
export type ChildrenCoverage = z.infer<typeof ChildrenCoverage>;

export const CoverageGeometry = z.strictObject({
  parentGeometry: AreaGeometry.nullable().describe('The divisions the region holds itself, unified; null where it holds none.'),
  childrenGeometry: AreaGeometry.nullable().describe('Its descendants\' divisions, unified.'),
  geoshapeGeometry: AreaGeometry.nullable().describe('Its Wikidata geoshape, where one is cached.'),
}).describe('A region\'s own outline beside its descendants\' and its geoshape, to compare.');
export type CoverageGeometry = z.infer<typeof CoverageGeometry>;

export const SiblingRegionGeometry = z.strictObject({
  regionId: z.number().int(),
  name: z.string(),
  geometry: AreaGeometry,
}).describe('A child region\'s divisions, unified.');
export type SiblingRegionGeometry = z.infer<typeof SiblingRegionGeometry>;

export const ChildRegionGeometries = z.strictObject({
  childRegions: z.array(SiblingRegionGeometry),
}).describe('A region\'s children\'s outlines, for drilling into the gap map.');
export type ChildRegionGeometries = z.infer<typeof ChildRegionGeometries>;

export const CoverageGapDivision = z.strictObject({
  divisionId: z.number().int(),
  gadmParentId: z.number().int().nullable(),
  name: z.string(),
  path: z.string(),
  level: z.number().int().describe('Its depth in GADM.'),
  areaKm2: z.number().int(),
  overlapWithGap: z.number().describe('The share of the division inside the gap, rounded to two places.'),
  geometry: AreaGeometry.nullable(),
  suggestedTarget: z.strictObject({
    regionId: z.number().int(),
    regionName: z.string(),
  }).nullable().describe('The child region nearest the division.'),
}).describe('A GADM division inside the area a region holds but its children do not.');
export type CoverageGapDivision = z.infer<typeof CoverageGapDivision>;

export const CoverageGapAnalysis = z.strictObject({
  gapDivisions: z.array(CoverageGapDivision),
  siblingRegions: z.array(SiblingRegionGeometry).describe('The region\'s children\'s outlines, to draw the gaps among.'),
  message: z.string().optional().describe('Sent when there was nothing to compare: the region holds no divisions and none matched its name.'),
}).describe('The divisions between a region\'s outline and its children\'s, and where each could go.');
export type CoverageGapAnalysis = z.infer<typeof CoverageGapAnalysis>;

export const DivisionShapeFeature = z.strictObject({
  type: z.literal('Feature'),
  geometry: AreaGeometry,
  properties: z.strictObject({
    name: z.string(),
    divisionId: z.number().int(),
    hasPoints: z.boolean().describe('Whether one of the region\'s Wikivoyage markers lies in it.'),
    assignedTo: z.string().optional().describe('The region already holding it, by name.'),
  }),
}).describe('A GADM division drawn for preview.');
export type DivisionShapeFeature = z.infer<typeof DivisionShapeFeature>;

export const MarkerPointFeature = z.strictObject({
  type: z.literal('Feature'),
  geometry: z.strictObject({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]).describe('Longitude and latitude.'),
  }),
  properties: z.strictObject({
    name: z.string(),
    isMarker: z.literal(true),
  }),
}).describe('A marker from the region\'s Wikivoyage article.');
export type MarkerPointFeature = z.infer<typeof MarkerPointFeature>;

export const DivisionPreview = z.strictObject({
  type: z.literal('FeatureCollection'),
  features: z.array(z.union([DivisionShapeFeature, MarkerPointFeature])),
}).describe('Divisions drawn for preview, with the region\'s markers.');
export type DivisionPreview = z.infer<typeof DivisionPreview>;

export const UnionGeometryResult = z.strictObject({
  geometry: DivisionPreview,
}).describe('Divisions previewed together, each drawn on its own.');
export type UnionGeometryResult = z.infer<typeof UnionGeometryResult>;

export const SplitDeeperResult = z.strictObject({
  divisions: z.array(z.strictObject({
    divisionId: z.number().int(),
    name: z.string(),
    path: z.string(),
    parentId: z.number().int().nullable(),
    coverage: z.number().nullable().describe('The share of the region\'s geoshape that falls inside the division; null without a geoshape.'),
    hasPoints: z.boolean(),
    assignedTo: z.string().nullable(),
  })).describe('The GADM children that replace the divisions split.'),
  geometry: DivisionPreview.nullable(),
  points: z.array(z.strictObject({
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
  })).optional().describe('Sent where the region\'s article has markers.'),
}).describe('Divisions replaced by their GADM children that fall in the region.');
export type SplitDeeperResult = z.infer<typeof SplitDeeperResult>;

export const VisionMatchResult = z.strictObject({
  suggestedIds: z.array(z.number().int()).describe('Divisions the model read as inside the region on its map.'),
  rejectedIds: z.array(z.number().int()),
  unclearIds: z.array(z.number().int()).describe('Divisions the model read as on the border.'),
  reasoning: z.string(),
  cost: z.number().describe('In US dollars.'),
  debugImages: z.strictObject({
    regionMap: z.string().describe('The region\'s map, as sent to the model.'),
    divisionsMap: z.string().describe('The numbered divisions, as a PNG data URL.'),
  }),
}).describe('A model\'s reading of which candidate divisions a region\'s map covers.');
export type VisionMatchResult = z.infer<typeof VisionMatchResult>;
