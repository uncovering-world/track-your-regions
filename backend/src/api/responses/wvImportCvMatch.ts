/**
 * What the world-view import's map matching answers (ADR-0066): the success
 * bodies of the endpoints `frontend/src/api/admin/wvImportCvMatch.ts` calls,
 * declared once. That is the colour-match run's event stream, a reviewer's
 * answer handed to a run paused on it, the match of a region's divisions to
 * the shapes its Wikivoyage page draws, and a model's reading of which child
 * region each colour cluster is.
 *
 * The stream's events are one union, `ColorMatchEvent`, each written with
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

// ---------------------------------------------------------------------------
// The colour-match run's stream
// ---------------------------------------------------------------------------

export const NamedDivision = z.strictObject({
  id: z.number().int(),
  name: z.string(),
}).describe('A GADM division by id and name.');
export type NamedDivision = z.infer<typeof NamedDivision>;

export const DebugImage = z.strictObject({
  label: z.string(),
  dataUrl: z.string().describe('A PNG as a `data:` URL.'),
}).describe('One picture of a step of the run, for the reviewer to follow it.');
export type DebugImage = z.infer<typeof DebugImage>;

export const ColorMatchCluster = z.strictObject({
  clusterId: z.number().int(),
  color: z.string().describe('The cluster\'s colour on the source map, as `#rrggbb`.'),
  pixelShare: z.number().describe('The cluster\'s share of the country\'s pixels, rounded to two places.'),
  suggestedRegion: ChildRegionRef.nullable().describe('The child region most of its already-assigned divisions belong to, else the first whose centre falls on it.'),
  divisions: z.array(z.strictObject({
    id: z.number().int(),
    name: z.string(),
    confidence: z.number(),
    depth: z.number().int().describe('How many splits of a straddling parent it took to reach the division; 0 for one matched whole.'),
    parentDivisionId: z.number().int().optional().describe('Sent for a division reached by splitting its parent.'),
  })).describe('The unassigned divisions the cluster covers.'),
  unsplittable: z.array(z.strictObject({
    id: z.number().int(),
    name: z.string(),
    confidence: z.number(),
    splitClusters: z.array(z.strictObject({
      clusterId: z.number().int(),
      share: z.number(),
    })).describe('The clusters the division straddles and each one\'s share of it.'),
  })).describe('Divisions that straddle clusters and could not be split: no smaller GADM divisions, or four splits deep already.'),
}).describe('One colour cluster of the source map, and the divisions it covers.');
export type ColorMatchCluster = z.infer<typeof ColorMatchCluster>;

export const CvPreviewFeature = z.strictObject({
  type: z.literal('Feature'),
  geometry: AreaGeometry,
  properties: z.strictObject({
    divisionId: z.number().int(),
    name: z.string(),
    clusterId: z.number().int().describe('-1 for a division matched to no cluster or outside the map.'),
    confidence: z.number(),
    isUnsplittable: z.boolean(),
    isOutOfBounds: z.boolean().describe('Whether the division lies outside what the source map shows.'),
    preAssigned: z.boolean().describe('Whether the division, or its parent, already belongs to a child region.'),
    color: z.string(),
    regionId: z.number().int().nullable().describe('The child region the division already belongs to, else the one its cluster is matched to.'),
    regionName: z.string().nullable(),
  }),
}).describe('A division drawn in the colour of the cluster it was matched to.');
export type CvPreviewFeature = z.infer<typeof CvPreviewFeature>;

export const SpatialAnomalyDivision = z.strictObject({
  divisionId: z.number().int(),
  name: z.string(),
  memberRowId: z.number().int().nullable().describe('The region member row, where the division is already a member.'),
  sourceRegionId: z.number().int(),
  sourceRegionName: z.string(),
}).describe('A division in a fragment cut off from the rest of its region.');
export type SpatialAnomalyDivision = z.infer<typeof SpatialAnomalyDivision>;

export const SpatialAnomaly = z.strictObject({
  divisions: z.array(SpatialAnomalyDivision),
  suggestedTargetRegionId: z.number().int().describe('The neighbouring region the fragment borders most.'),
  suggestedTargetRegionName: z.string(),
  fragmentSize: z.number().int(),
  totalRegionSize: z.number().int(),
  score: z.number().describe('The fragment\'s share of its region; the lower, the more suspicious.'),
}).describe('A piece of a region that touches none of the rest of it.');
export type SpatialAnomaly = z.infer<typeof SpatialAnomaly>;

export const AdjacencyEdge = z.strictObject({
  divA: z.number().int(),
  divB: z.number().int(),
}).describe('Two divisions that share a border.');
export type AdjacencyEdge = z.infer<typeof AdjacencyEdge>;

export const ColorMatchResult = z.strictObject({
  clusters: z.array(ColorMatchCluster),
  childRegions: z.array(ChildRegionRef),
  outOfBounds: z.array(NamedDivision).optional().describe('Sent where some divisions lie outside what the source map shows.'),
  debugImages: z.array(DebugImage).describe('Every picture the run streamed, again.'),
  geoPreview: z.strictObject({
    featureCollection: z.strictObject({
      type: z.literal('FeatureCollection'),
      features: z.array(CvPreviewFeature),
    }),
    clusterInfos: z.array(ClusterGeoInfo),
  }),
  spatialAnomalies: z.array(SpatialAnomaly).optional().describe('Sent where the suggested assignment leaves a region in pieces.'),
  adjacencyEdges: z.array(AdjacencyEdge).optional().describe('The border graph over the run\'s divisions, sent whenever it has an edge: the screen finds anomalies again from it after a reviewer moves a division.'),
  stats: z.strictObject({
    totalDivisions: z.number().int(),
    assignedDivisions: z.number().int(),
    cvClusters: z.number().int(),
    cvAssignedDivisions: z.number().int(),
    cvUnsplittable: z.number().int(),
    cvOutOfBounds: z.number().int(),
    countryName: z.string(),
  }),
}).describe('What a colour-match run matched: each cluster\'s divisions and region, and the map of it.');
export type ColorMatchResult = z.infer<typeof ColorMatchResult>;

export const ColorMatchProgress = z.strictObject({
  type: z.literal('progress'),
  step: z.string(),
  elapsed: z.number().describe('Seconds since the run started.'),
}).describe('A step of the run, begun.');
export type ColorMatchProgress = z.infer<typeof ColorMatchProgress>;

export const ColorMatchDebugImage = z.strictObject({
  type: z.literal('debug_image'),
  debugImage: DebugImage,
}).describe('A picture of a step of the run.');
export type ColorMatchDebugImage = z.infer<typeof ColorMatchDebugImage>;

export const WaterComponent = z.strictObject({
  id: z.number().int(),
  pct: z.number().describe('The component\'s share of the map, in percent.'),
  cropDataUrl: z.string().describe('A crop of the map around it as a `data:` URL, or empty where the crop is fetched from `water-crop`.'),
  subClusters: z.array(z.strictObject({
    idx: z.number().int(),
    pct: z.number(),
    cropDataUrl: z.string(),
  })),
}).describe('One patch of the map the run reads as water.');
export type WaterComponent = z.infer<typeof WaterComponent>;

export const WaterReviewRequested = z.strictObject({
  type: z.literal('water_review'),
  reviewId: z.string(),
  waterPxPercent: z.number().describe('The share of the map read as water, in percent.'),
  waterMaskImage: z.string().optional().describe('The water mask as a `data:` URL, sent by the Python pipeline.'),
  waterComponents: z.array(WaterComponent),
}).describe('The run, paused until the reviewer says which patches are water.');
export type WaterReviewRequested = z.infer<typeof WaterReviewRequested>;

export const ClusterReviewCluster = z.strictObject({
  label: z.number().int(),
  color: z.string().describe('As `rgb(r,g,b)`.'),
  pct: z.number().describe('The cluster\'s share of the country, in percent.'),
  isSmall: z.boolean().describe('Under 3% of the country.'),
  componentCount: z.number().int().describe('How many separate pieces the cluster is in.'),
}).describe('One colour cluster, as the reviewer sees it before matching.');
export type ClusterReviewCluster = z.infer<typeof ClusterReviewCluster>;

export const BorderPath = z.strictObject({
  id: z.string(),
  points: z.array(z.tuple([z.number(), z.number()])).describe('Pixel positions at the run\'s working size.'),
  type: z.enum(['internal', 'external']),
  clusters: z.tuple([z.number().int(), z.number().int()]).describe('The two clusters on either side, lower label first.'),
}).describe('A border between two clusters, traced on the working image.');
export type BorderPath = z.infer<typeof BorderPath>;

export const ClusterReviewRequested = z.strictObject({
  type: z.literal('cluster_review'),
  reviewId: z.string(),
  data: z.strictObject({
    clusters: z.array(ClusterReviewCluster),
    borderPaths: z.array(BorderPath),
    pipelineSize: z.strictObject({
      w: z.number().int(),
      h: z.number().int(),
    }).describe('The working image\'s size, which the border paths are drawn at.'),
  }),
}).describe('The run, paused until the reviewer merges, drops, splits or repaints the clusters.');
export type ClusterReviewRequested = z.infer<typeof ClusterReviewRequested>;

export const IcpAdjustmentOffered = z.strictObject({
  type: z.literal('icp_adjustment_available'),
  reviewId: z.string(),
  message: z.string(),
  metrics: z.strictObject({
    overflow: z.number().int(),
    error: z.number().describe('Rounded to one place.'),
    icpOption: z.string().describe('The alignment option that fit best.'),
  }),
}).describe('The run, paused for up to five minutes on whether to retry a poorly fitting alignment.');
export type IcpAdjustmentOffered = z.infer<typeof IcpAdjustmentOffered>;

export const ColorMatchComplete = z.strictObject({
  type: z.literal('complete'),
  elapsed: z.number(),
  data: ColorMatchResult,
}).describe('The run, finished; the stream ends after it.');
export type ColorMatchComplete = z.infer<typeof ColorMatchComplete>;

export const ColorMatchFailed = z.strictObject({
  type: z.literal('error'),
  message: z.string(),
}).describe('The run, stopped; the stream ends after it.');
export type ColorMatchFailed = z.infer<typeof ColorMatchFailed>;

export const ColorMatchEvent = z.union([
  ColorMatchProgress, ColorMatchDebugImage, WaterReviewRequested, ClusterReviewRequested,
  IcpAdjustmentOffered, ColorMatchComplete, ColorMatchFailed,
]).describe('One event of the colour-match stream (`/color-match-stream`), told apart by `type`.');
export type ColorMatchEvent = z.infer<typeof ColorMatchEvent>;
