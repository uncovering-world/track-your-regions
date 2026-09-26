import { z } from 'zod/v4';
import { COLUMN_WIDTHS } from '../db/schema.generated.js';
import { isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE } from './urlSafety.js';
import { optionalSafeUrlSchema, requiredSafeUrlSchema, safeUrlSchema } from './urlSchemas.js';

/**
 * The world-view import's request schemas (#933): the Wikivoyage extraction
 * that proposes a tree, the import that lands it and every action the import
 * review takes on it, and the coverage comparison. One surface, one file;
 * `index.ts` re-exports them, so every route and controller imports from the
 * barrel as before.
 */
// =============================================================================
// Wikivoyage extraction schemas
// =============================================================================

export const wvExtractStartSchema = z.object({
  name: z.string().min(1).max(COLUMN_WIDTHS.world_views.name).default('Wikivoyage Regions'),
  /** 'none' for clean fetch, or a wikivoyage-cache*.json basename. No path separators allowed. */
  cacheFile: z
    .string()
    .max(128)
    // eslint-disable-next-line security/detect-unsafe-regex -- anchored at both ends; inner [A-Za-z0-9_-]+ is non-overlapping with the literal `.json` suffix, so no catastrophic backtracking
    .regex(/^(none|wikivoyage-cache(-[A-Za-z0-9_-]+)?\.json)$/)
    .nullable()
    .optional(),
});

/** Path param schema for DELETE /wv-extract/caches/:name — guards against path traversal. */
export const wvCacheNameParamSchema = z.object({
  name: z
    .string()
    .max(128)
    // eslint-disable-next-line security/detect-unsafe-regex -- anchored; inner [A-Za-z0-9_-]+ is non-overlapping with the literal `.json` suffix, so no catastrophic backtracking
    .regex(/^wikivoyage-cache(-[A-Za-z0-9_-]+)?\.json$/),
});

export const wvExtractAnswerSchema = z.object({
  questionId: z.number().int().positive(),
  action: z.enum(['accept', 'skip', 'answer', 'delete_rule']),
  /** Selected option value or custom text (for 'answer' action) */
  answer: z.string().max(10000).optional(),
  /** Rule ID to delete (for 'delete_rule' action) */
  ruleId: z.number().int().positive().optional(),
}).refine(
  data => data.action !== 'answer' || data.answer !== undefined,
  { message: "answer is required when action is 'answer'", path: ['answer'] },
).refine(
  data => data.action !== 'delete_rule' || data.ruleId !== undefined,
  { message: "ruleId is required when action is 'delete_rule'", path: ['ruleId'] },
);

// =============================================================================
// WorldView import schemas
// =============================================================================

/** Recursive schema for ImportTreeNode */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod recursive schemas require z.ZodType<any> annotation; runtime shape is concrete (see z.object below)
const importTreeNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    // Every node becomes a region, so the bound is regions.name.
    name: z.string().min(1).max(COLUMN_WIDTHS.regions.name),
    // Both are pictures a dialog draws, so both are held to what a stored url
    // may be (#694) -- and to the link form of it: unlike an experience's
    // picture, no map is a path on our own origin.
    regionMapUrl: safeUrlSchema,
    mapImageCandidates: z.array(requiredSafeUrlSchema).max(20).optional(),
    wikidataId: z.string().regex(/^Q\d+$/).optional(),
    // The one url of the three that reaches an <a href>, where a scheme that
    // executes does so on click (#703). Same rule, in its link form.
    sourceUrl: optionalSafeUrlSchema,
    children: z.array(importTreeNodeSchema).default([]),
  }),
);

export const wvImportBodySchema = z.object({
  name: z.string().min(1).max(COLUMN_WIDTHS.world_views.name),
  tree: importTreeNodeSchema,
  matchingPolicy: z.enum(['country-based', 'hierarchical', 'none']).default('country-based'),
});

export const baseLayerImportBodySchema = z.object({
  name: z.string().min(1).max(COLUMN_WIDTHS.world_views.name),
  // Bounded by world_views.description, not world_views.source: both are the
  // same width, but startBaseLayerImport embeds the label in
  // `Mirror of the administrative base layer (<label>), depth <n>` — 51 fixed
  // characters — so a label sized against `source` alone would pass validation
  // here and then fail with 22001 inside the import run, minutes later and
  // after the endpoint has already answered { started: true }.
  providerLabel: z.string().min(1).max(COLUMN_WIDTHS.world_views.description - 51),
  // Depth 2 mirrors roots + countries + first-level subdivisions (~3800 regions).
  // 3 is allowed but adds tens of thousands; deeper is refused outright, since
  // the base layer has 392k divisions.
  maxDepth: z.number().int().min(1).max(3),
});

export const wvImportAcceptMatchSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  divisionId: z.coerce.number().int().positive(),
});

export const wvImportAcceptBatchSchema = z.object({
  assignments: z.array(z.object({
    regionId: z.coerce.number().int().positive(),
    divisionId: z.coerce.number().int().positive(),
  })).min(1).max(1000),
});

/**
 * What the CV match dialog asks a model to pair up: the colour clusters it
 * found on a region's map, each with the divisions under it, and the region's
 * children. `model` overrides the model set for the feature.
 */
export const wvImportAiSuggestClustersSchema = z.object({
  clusters: z.array(z.object({
    clusterId: z.coerce.number().int(),
    color: z.string().max(64),
    pixelShare: z.number().min(0).max(1),
    divisionNames: z.array(z.string().max(500)).max(5000),
  })).min(1).max(200),
  childRegions: z.array(z.object({
    id: z.coerce.number().int().positive(),
    name: z.string().max(500),
  })).max(1000),
  model: z.string().max(100).optional(),
});

/** A verdict on a selection of a region's suggestions (`wvImportMatchDecisions.ts`). */
export const wvImportDecideBatchSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  divisionIds: z.array(z.coerce.number().int().positive()).min(1).max(1000),
});

export const wvImportRegionIdSchema = z.object({
  regionId: z.coerce.number().int().positive(),
});

/**
 * Re-match body. `matchingPolicy` is optional: omitted, the re-match uses the
 * policy the world view's source type is shaped for, which is what reproduces
 * the original import. Passing one explicitly is how the same tree gets scored
 * under a second policy.
 */
export const wvImportRematchBodySchema = z.object({
  matchingPolicy: z.enum(['country-based', 'hierarchical', 'none']).optional(),
});

const reviewIdFieldSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export const reviewIdParamSchema = z.object({
  reviewId: reviewIdFieldSchema,
});

export const wvImportIcpAdjustmentBodySchema = z.object({
  action: z.enum(['adjust', 'continue']),
});

export const wvImportClusterHighlightParamSchema = z.object({
  reviewId: reviewIdFieldSchema,
  label: z.coerce.number().int().min(0).max(255),
});

const clusterReclusterPresetSchema = z.enum([
  'more_clusters', 'different_seed', 'boost_chroma',
  'remove_roads', 'fill_holes', 'clean_light', 'clean_heavy',
]);

// K-means label range is uint8 (0-255); 256 entries is the cap per field.
const MAX_PALETTE_ENTRIES = 256;

export const wvImportClusterReviewBodySchema = z.object({
  merges: z.record(
    z.string().regex(/^\d+$/),
    z.coerce.number().int().min(0).max(255),
  ).optional(),
  excludes: z.array(z.coerce.number().int().min(0).max(255)).max(MAX_PALETTE_ENTRIES).optional(),
  split: z.array(z.coerce.number().int().min(0).max(255)).max(MAX_PALETTE_ENTRIES).optional(),
  recluster: z.object({
    preset: clusterReclusterPresetSchema,
  }).optional(),
});

const clusterPaletteEntrySchema = z.object({
  label: z.coerce.number().int().min(0).max(255),
  color: z.tuple([
    z.coerce.number().int().min(0).max(255),
    z.coerce.number().int().min(0).max(255),
    z.coerce.number().int().min(0).max(255),
  ]),
});

// Painted-overlay decision body: replaces automated clustering with the admin's
// canvas-edited result before ICP alignment.
export const wvImportManualClusterReviewBodySchema = z.object({
  type: z.literal('manual_clusters'),
  overlayPng: z.string().min(1),
  palette: z.array(clusterPaletteEntrySchema).min(1).max(MAX_PALETTE_ENTRIES),
});

export const wvImportGeoshapeMatchSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  scopeAncestorId: z.coerce.number().int().positive().optional(),
});

export const wvImportAcceptTransferSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  divisionIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  donorRegionId: z.coerce.number().int().positive(),
  donorDivisionId: z.coerce.number().int().positive(),
  transferType: z.enum(['direct', 'split']),
});

export const wvImportTransferPreviewSchema = z.object({
  donorDivisionId: z.coerce.number().int().positive(),
  movingDivisionIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  wikidataId: z.string().regex(/^Q\d+$/),
});

export const wvImportMarkManualFixSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  needsManualFix: z.boolean(),
  fixNote: z.string().max(500).optional(),
});

export const wvImportSelectMapImageSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  // Judged by the same rule as the candidates it picks among, but not
  // rewritten: the controller keeps a pick only where it equals a stored
  // candidate, and a candidate stored before the rule may carry a non-ASCII
  // file name that normalising would percent-encode. A pick names a row, in
  // that row's own spelling.
  imageUrl: z.string().trim().max(2000)
    .refine(isStorableHttpUrl, { message: STORABLE_HTTP_URL_MESSAGE })
    .nullable(),
});

export const wvImportAddChildSchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
  // Inserted verbatim as the new child's regions.name.
  name: z.string().min(1).max(COLUMN_WIDTHS.regions.name),
  sourceUrl: optionalSafeUrlSchema,
  sourceExternalId: z.string().max(100).optional(),
});

export const wvImportRemoveRegionSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  reparentChildren: z.boolean(),
  reparentDivisions: z.boolean().optional(),
});

export const wvImportRenameRegionSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  // Written straight into regions.name.
  name: z.string().min(1).max(COLUMN_WIDTHS.regions.name),
  sourceUrl: optionalSafeUrlSchema,
  sourceExternalId: z.string().max(100).optional(),
});

export const wikidataIdParamSchema = z.object({
  wikidataId: z.string().regex(/^Q\d+$/),
});

export const divisionIdBodySchema = z.object({
  divisionId: z.coerce.number().int().positive(),
});

export const wvImportApproveCoverageSchema = z.object({
  divisionId: z.coerce.number().int().positive(),
  regionId: z.coerce.number().int().positive(),
  action: z.enum(['add_member', 'create_region']),
  // The region `create_region` makes is named by it.
  gapName: z.string().max(COLUMN_WIDTHS.regions.name).optional(),
});

export const wvImportSmartSimplifySchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
});

export const wvImportSmartSimplifyApplySchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
  ownerRegionId: z.coerce.number().int().positive(),
  memberRowIds: z.array(z.number().int().positive()).min(1),
});

export const worldViewRegionIdParamSchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  regionId: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// CV pipeline — water review + crop
// ---------------------------------------------------------------------------

export const wvImportWaterCropParamSchema = z.object({
  reviewId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  componentId: z.coerce.number().int(),
  subCluster: z.coerce.number().int(),
});

export const wvImportWaterReviewBodySchema = z.object({
  approvedIds: z.array(z.coerce.number().int()).max(1000).default([]),
  mixDecisions: z.array(z.object({
    componentId: z.coerce.number().int(),
    approvedSubClusters: z.array(z.coerce.number().int()).max(256).default([]),
  })).max(1000).default([]),
});

// ---------------------------------------------------------------------------
// CV pipeline — color match, union geometry, split deeper, vision match
// ---------------------------------------------------------------------------

export const wvImportColorMatchSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  token: z.string().optional(),
});

export const wvImportUnionGeometrySchema = z.object({
  divisionIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
  regionId: z.coerce.number().int().positive().optional(),
});

export const wvImportSplitDeeperSchema = z.object({
  divisionIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
  wikidataId: z.string().regex(/^Q\d+$/),
  regionId: z.coerce.number().int().positive(),
  source: z.enum(['geoshape', 'points', 'image']).optional(),
});

export const wvImportVisionMatchSchema = z.object({
  divisionIds: z.array(z.coerce.number().int().positive()).min(1).max(200),
  regionId: z.coerce.number().int().positive(),
  // The region's map, handed to a vision model to look at: the same rule as
  // the field it was read from.
  imageUrl: requiredSafeUrlSchema,
});

// ---------------------------------------------------------------------------
// Region tree ops — reparent, overlap
// ---------------------------------------------------------------------------

export const wvImportReparentRegionSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  newParentId: z.coerce.number().int().positive().nullable(),
});

export const wvImportOverlapChildrenSchema = z.object({
  divisionId: z.coerce.number().int().positive(),
  childRegionIds: z.array(z.number().int().positive()).min(1),
});

export const wvImportResolveOverlapSchema = z.object({
  action: z.enum(['keep', 'split']),
  divisionId: z.coerce.number().int().positive(),
  keepInRegionId: z.coerce.number().int().positive().optional(),
  removeFromRegionIds: z.array(z.number().int().positive()).optional(),
  splitRegionId: z.coerce.number().int().positive().optional(),
  assignments: z.array(z.object({
    gadmChildId: z.number().int().positive(),
    targetRegionId: z.number().int().positive(),
  })).optional(),
});

// ---------------------------------------------------------------------------
// Coverage comparison
// ---------------------------------------------------------------------------

export const childrenCoverageQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
  onlyId: z.coerce.number().int().positive().optional(),
});
