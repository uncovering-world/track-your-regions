import { z } from 'zod';

/**
 * Types for Track Your Regions Backend
 *
 * Terminology:
 * - AdministrativeDivision: Official GADM boundary (Germany, Bavaria, Munich)
 * - WorldView: Custom hierarchy for organizing regions
 * - Region: User-defined grouping within a WorldView
 * - RegionMember: A member of a Region (can be division or subregion)
 */

// =============================================================================
// Administrative Divisions (GADM boundaries)
// =============================================================================

export interface AdministrativeDivision {
  id: number;
  name: string;
  parentId: number | null;
  hasChildren: boolean;
}

export interface AdministrativeDivisionWithPath extends AdministrativeDivision {
  path: string;
  relevance?: number;
  usageCount?: number;
  usedAsSubdivisionCount?: number;
  hasUsedSubdivisions?: boolean;
}

// =============================================================================
// World Views
// =============================================================================

export interface WorldView {
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  isDefault: boolean;
}

// =============================================================================
// Regions (user-defined groupings within a WorldView)
// =============================================================================

export interface Region {
  id: number;
  worldViewId: number;
  name: string;
  description: string | null;
  parentRegionId: number | null;
  color: string | null;
  hasSubregions?: boolean;
  isCustomBoundary?: boolean;
}

// =============================================================================
// Region Members
// =============================================================================

export interface RegionMember {
  id: number;
  name: string;
  parentId: number | null;
  hasChildren: boolean;
  memberType: 'division' | 'subregion';
  isSubregion: boolean;
  color?: string;
  path?: string;
  hasCustomGeometry?: boolean;
}

// =============================================================================
// GeoJSON types
// =============================================================================

export interface GeoJSONGeometry {
  type: 'MultiPolygon' | 'Polygon';
  coordinates: number[][][] | number[][][][];
}

export interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: GeoJSONGeometry;
}

// =============================================================================
// API query params
// =============================================================================

export const worldViewIdSchema = z.coerce.number().int().positive().default(1);
export const divisionIdSchema = z.coerce.number().int().positive();
export const regionIdSchema = z.coerce.number().int().positive();
export const detailLevelSchema = z.enum(['low', 'medium', 'high']).default('medium');
export const booleanStringSchema = z.enum(['true', 'false']).default('false');
export const limitSchema = z.coerce.number().int().min(1).max(1000).default(100);
export const offsetSchema = z.coerce.number().int().min(0).default(0);

// =============================================================================
// Request validation schemas
// =============================================================================

export const getSubdivisionsQuerySchema = z.object({
  worldViewId: worldViewIdSchema,
  getAll: booleanStringSchema,
  limit: limitSchema,
  offset: offsetSchema,
});

export const getGeometryQuerySchema = z.object({
  worldViewId: worldViewIdSchema,
  detail: detailLevelSchema,
  resolveEmpty: booleanStringSchema,
});

export const searchQuerySchema = z.object({
  query: z.string().max(255).optional().transform(v => v ?? ''),
  worldViewId: worldViewIdSchema,
  limit: limitSchema,
});

// =============================================================================
// Reusable param schemas (for path params)
// =============================================================================

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const regionIdParamSchema = z.object({
  regionId: z.coerce.number().int().positive(),
});

export const worldViewIdParamSchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
});

export const experienceIdParamSchema = z.object({
  experienceId: z.coerce.number().int().positive(),
});

export const locationIdParamSchema = z.object({
  locationId: z.coerce.number().int().positive(),
});

export const treasureIdParamSchema = z.object({
  treasureId: z.coerce.number().int().positive(),
});

export const markTreasureViewedBodySchema = z.object({
  experienceId: z.number().int().positive().optional(),
});

// =============================================================================
// Experience schemas
// =============================================================================

export const experienceSearchQuerySchema = z.object({
  q: z.string().min(2).max(255),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const experienceListQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  category: z.string().max(255).optional(),
  country: z.string().max(255).optional(),
  regionId: z.coerce.number().int().positive().optional(),
  search: z.string().max(255).optional(),
  bbox: z.string().max(100).optional(),
  includeLost: booleanStringSchema,
  limit: z.coerce.number().int().min(1).max(5000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const experiencesByRegionQuerySchema = z.object({
  includeChildren: booleanStringSchema.default('true'),
  // Without this the parameter never reaches the controller: `validate()`
  // replaces req.query with the parsed object, and Zod strips what it does not
  // name — so the whole "show what no longer exists" path would be dead over
  // HTTP while passing every test that calls the controller directly.
  includeLost: booleanStringSchema,
  // 5000 to match `experienceListQuerySchema` above and the controller's own
  // clamp. Neither surface that reads a region paginates, so a ceiling below the
  // largest region truncated the list instead of paging it — and because the
  // rows are ordered by name, the loss was a tail of the alphabet.
  limit: z.coerce.number().int().min(1).max(5000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const experienceRegionCountsQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  parentRegionId: z.coerce.number().int().positive().optional(),
});

export const experienceLocationsQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
});

export const regionLocationsQuerySchema = z.object({
  includeChildren: booleanStringSchema.default('true'),
  // Follows the list: markers for the rows it is showing.
  includeLost: booleanStringSchema,
});

// Curation schemas
export const rejectExperienceBodySchema = z.object({
  regionId: z.number().int().positive(),
  reason: z.string().max(1000).optional(),
});

export const unrejectExperienceBodySchema = z.object({
  regionId: z.number().int().positive(),
});

export const assignExperienceBodySchema = z.object({
  regionId: z.number().int().positive(),
});

/**
 * A URL field that refuses script-bearing schemes, bounded by whatever holds
 * it. Most of these end up inside the `metadata` JSONB, which has no width, so
 * they keep the generic 2000; `imageUrl` is stored in `experiences.image_url`
 * and takes that column's 1000 instead.
 */
const safeUrl = (max: number) => z.string().max(max).optional().refine(
  (val) => !val || !/^(javascript|data|vbscript|blob):/i.test(val),
  { message: 'URL uses an unsafe scheme' },
);

const safeUrlSchema = safeUrl(2000);
const safeImageUrlSchema = safeUrl(1000);

export const editExperienceBodySchema = z.object({
  name: z.string().min(1).max(500).optional(),
  shortDescription: z.string().max(1000).optional(),
  description: z.string().max(10000).optional(),
  category: z.string().max(100).optional(),
  imageUrl: safeImageUrlSchema,
  tags: z.array(z.string().max(100)).max(50).optional(),
  websiteUrl: safeUrlSchema,
  wikipediaUrl: safeUrlSchema,
});

export const createManualExperienceBodySchema = z.object({
  name: z.string().min(1).max(500),
  shortDescription: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  imageUrl: safeImageUrlSchema,
  tags: z.array(z.string().max(100)).max(50).optional(),
  countryCode: z.string().max(10).optional(),
  countryName: z.string().max(255).optional(),
  regionId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  websiteUrl: safeUrlSchema,
  wikipediaUrl: safeUrlSchema,
});

export const idAndRegionIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  regionId: z.coerce.number().int().positive(),
});

// =============================================================================
// User visited schemas
// =============================================================================

export const markVisitedBodySchema = z.object({
  notes: z.string().max(2000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

export const updateVisitBodySchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

export const markLocationVisitedBodySchema = z.object({
  notes: z.string().max(2000).optional(),
});

export const visitedExperiencesQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const visitedIdsQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
});

export const visitedLocationIdsQuerySchema = z.object({
  experienceId: z.coerce.number().int().positive().optional(),
});

export const viewedTreasureIdsQuerySchema = z.object({
  experienceId: z.coerce.number().int().positive().optional(),
});

export const markAllLocationsQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
});

export const visitedRegionBodySchema = z.object({
  notes: z.string().max(2000).optional(),
});

// =============================================================================
// Admin schemas
// =============================================================================

export const categoryIdParamSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
});

export const logIdParamSchema = z.object({
  logId: z.coerce.number().int().positive(),
});

export const assignmentIdParamSchema = z.object({
  assignmentId: z.coerce.number().int().positive(),
});

export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const startSyncBodySchema = z.object({
  dryRun: z.boolean().optional(),
});

export const reviewQueueQuerySchema = z.object({
  // Bounded to int4: `experience_categories.id` is SERIAL, and a larger value
  // would reach Postgres and error there rather than answering 400 here.
  categoryId: z.coerce.number().int().positive().max(2147483647).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const experienceStateBodySchema = z.object({
  membership: z.enum(['present', 'former']).optional(),
  existence: z.enum(['extant', 'lost']).optional(),
  note: z.string().max(1000).optional(),
  /**
   * The row as the curator was looking at it: both axes and whether it was
   * flagged. Required, and compared under the write lock — it is the only
   * thing that distinguishes a card drawn before the question was answered
   * from a deliberate correction made with the current state in view.
   *
   * `flagged` is not redundant with the axes. A run that finds the object
   * again clears `missing_since` and touches neither axis, so a queue card
   * still matches on both while the question it was asking has been withdrawn
   * — and answering "former" then records as delisted an object the source
   * currently lists.
   */
  expected: z.object({
    membership: z.enum(['present', 'former']),
    existence: z.enum(['extant', 'lost']),
    flagged: z.boolean(),
  }),
}).refine(b => b.membership !== undefined || b.existence !== undefined, {
  message: 'Pass membership, existence, or both',
});

export const experienceAdmissionBodySchema = z.object({
  /**
   * `confirm` keeps the refusal, `override` undoes it.
   *
   * No `expected` block, because only one of the two needs a stale-view check.
   * `confirm` hides, so it collides with the `curated_fields` pin a first
   * answer left. `override` reveals and is idempotent across curators, so it
   * stays open on a pinned row — that is the only way back from a refusal, and
   * a way back an earlier click can close is not one.
   */
  decision: z.enum(['confirm', 'override']),
  note: z.string().max(1000).optional(),
});

export const newBadgesSeenBodySchema = z.object({
  // Bounded because a page is bounded: the region read caps at 5000 rows, and
  // an unbounded array here would be an invitation to send something else.
  experienceIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(5000),
});

export const acceptSourceBodySchema = z.object({
  fields: z.array(z.string().min(1)).min(1).max(20),
  /**
   * The run whose proposal the caller was looking at. Required: the handler
   * re-resolves the newest proposal at click time, so without this a run
   * landing in between would substitute values the curator never saw.
   */
  expectedSyncLogId: z.number().int().positive().max(2147483647),
});

export const publishExperienceBodySchema = z.object({
  /**
   * Which unread points to publish. Naming any (with or without `treasureIds`
   * beside it) makes this a *named-contents* publish: only these points, and
   * the experience's own state left alone, because a visible museum that
   * gained three checked paintings has not thereby been read (ADR-0025 § 4.4).
   *
   * `.min(1)` so an empty array is a 400 rather than either reading: it would
   * otherwise mean "publish exactly nothing, and do not publish the object
   * either", which no caller can want and which would silently answer a card
   * without changing anything.
   *
   * Bounded above the largest object the catalogue actually holds — 758 points
   * on one UNESCO nomination — because a request answers a card, not an
   * arbitrary list, and the ids go into an `= ANY($n::int[])`.
   */
  locationIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(2000).optional(),
  /**
   * Treasure ids, not link ids: that is what the queue counts
   * (`COUNT(DISTINCT et.treasure_id)`) and what a card can therefore name, and
   * a work is passed once globally while its link is passed as being *here* —
   * two states this endpoint writes together from one id.
   */
  treasureIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(2000).optional(),
  /**
   * "Every pending content row, and nothing about the experience's own state"
   * — the shape for a card that names no ids at all, because it reports
   * counts rather than the ids behind them. Leaving everything absent means
   * the opposite thing: an arrival, answering for the object too. That
   * inference — "named nothing" reads as "publish the object" — is exactly
   * the defect this field exists to remove: a contents card whose only held
   * field a curator had already claimed used to send `{}` and silently
   * publish the object, asserting a person had read a museum whose paintings
   * were all a curator ever looked at.
   *
   * `true` only, never `false`: there is no meaningful "not contents-only" to
   * say with this field — that is what leaving it absent already means — so a
   * caller either sends it true or does not send it.
   *
   * Three shapes for what a body can mean, spelled out because "absent means
   * all of it" is exactly the inference that produced the defect above:
   * - absent, with no ids: an object publish — the experience and every
   *   pending content row it holds. The arrival case.
   * - `{ contentsOnly: true }`: every pending content row, object untouched.
   * - `{ locationIds }` / `{ treasureIds }` (or both): those ids only, object
   *   untouched.
   */
  contentsOnly: z.literal(true).optional(),
  /**
   * The run whose held proposal the caller was looking at.
   *
   * Compared under the write lock against `experiences.pending_change_sync_log_id`
   * — not against the newest changeset, as `accept-source` does. The card names
   * the run the pointer names, and a newer run overwrites the pointer, so
   * equality with the pointer is exactly the staleness question. Absent is a
   * claim too, and the same comparison judges it: "this row was holding
   * nothing", which is what an arrival looks like and what a row whose proposal
   * a later run withdrew no longer does.
   *
   * Meaningless for any contents publish — named or bare — which is why the
   * `.refine` below forbids sending it alongside either.
   */
  expectedSyncLogId: z.number().int().positive().max(2147483647).optional(),
}).refine(
  b => !(b.contentsOnly === true && (b.locationIds !== undefined || b.treasureIds !== undefined)),
  {
    // Two ways of saying "contents only" in the same body say nothing a
    // caller could not have said with one of them, and inventing a rule for
    // which one wins is worse than refusing the ambiguity.
    message: 'contentsOnly already means every pending content row; naming locationIds or treasureIds beside it is redundant',
  },
).refine(
  b => b.expectedSyncLogId === undefined
    || (b.locationIds === undefined && b.treasureIds === undefined && b.contentsOnly === undefined),
  {
    // A contents publish, named or bare, touches neither the held fields nor
    // the pointer, so accepting the run id beside it would let a caller
    // believe it had answered the held card when nothing about that card
    // changed.
    message: 'expectedSyncLogId answers the held proposal on the object; a contents publish (named or not) publishes only those',
  },
);

export const syncChangesQuerySchema = z.object({
  type: z.enum(['created', 'updated', 'conflict', 'held', 'missing', 'returned', 'failed', 'filtered']).optional(),
  significance: z.enum(['major', 'minor']).optional(),
  // Not z.coerce.boolean(): that is Boolean(input), so 'false' would enable it
  significantOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reorderCategoriesBodySchema = z.object({
  categoryIds: z.array(z.number().int().positive()).min(1),
});

export const startRegionAssignmentBodySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive().optional(),
});

export const regionAssignmentStatusQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
});

export const experienceCountsQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive().optional(),
});

export const syncLogsQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createCuratorAssignmentBodySchema = z.object({
  userId: z.number().int().positive(),
  scopeType: z.enum(['region', 'category', 'global']),
  regionId: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
});

export const curatorActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminUserSearchQuerySchema = z.object({
  q: z.string().min(2).max(255),
});

// =============================================================================
// Wikivoyage extraction schemas
// =============================================================================

export const wvExtractStartSchema = z.object({
  name: z.string().min(1).max(255).default('Wikivoyage Regions'),
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
    name: z.string().min(1).max(255),
    regionMapUrl: z.string().url().max(2000).optional(),
    mapImageCandidates: z.array(z.string().url().max(2000)).max(20).optional(),
    wikidataId: z.string().regex(/^Q\d+$/).optional(),
    sourceUrl: z.string().url().max(2000).optional(),
    children: z.array(importTreeNodeSchema).default([]),
  }),
);

export const wvImportBodySchema = z.object({
  name: z.string().min(1).max(255),
  tree: importTreeNodeSchema,
  matchingPolicy: z.enum(['country-based', 'hierarchical', 'none']).default('country-based'),
});

export const baseLayerImportBodySchema = z.object({
  name: z.string().min(1).max(255),
  // Bounded by world_views.description, not world_views.source: both are
  // VARCHAR(1000), but startBaseLayerImport embeds the label in
  // `Mirror of the administrative base layer (<label>), depth <n>` — 51 fixed
  // characters — so a label sized against `source` alone would pass validation
  // here and then fail with 22001 inside the import run, minutes later and
  // after the endpoint has already answered { started: true }.
  providerLabel: z.string().min(1).max(949),
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
  imageUrl: z.string().url().nullable(),
});

export const wvImportAddChildSchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
  // Inserted verbatim as the new child's regions.name.
  name: z.string().min(1).max(255),
  sourceUrl: z.string().url().max(2000).optional(),
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
  name: z.string().min(1).max(255),
  sourceUrl: z.string().url().max(2000).optional(),
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
  gapName: z.string().max(255).optional(),
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
  imageUrl: z.string().url(),
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

// =============================================================================
// World View schemas
// =============================================================================
// String bounds here are the widths of the columns the values land in —
// world_views and regions in db/init/01-schema.sql. A bound wider than its
// column is not a laxer API, only a later failure: Zod passes the value on,
// Postgres raises 22001 on the write, and the caller gets a 500 where a 400
// was owed. columnBounds.test.ts holds the two in step.

export const createWorldViewBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  source: z.string().max(1000).optional(),
});

export const updateWorldViewBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  source: z.string().max(1000).optional(),
  isPublic: z.boolean().optional(),
});

export const createRegionBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  parentRegionId: z.number().int().positive().optional(),
  // `#rrggbb`, the one shape the editor's <input type="color"> produces and
  // the only one regions.color — VARCHAR(7) — has room for.
  color: z.string().max(7).optional(),
  customGeometry: z.any().optional(),
});

export const updateRegionBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  parentRegionId: z.number().int().positive().nullable().optional(),
  color: z.string().max(7).nullable().optional(),
  usesHull: z.boolean().optional(),
});

export const deleteRegionQuerySchema = z.object({
  moveChildrenToParent: booleanStringSchema.default('false'),
});

export const regionSearchQuerySchema = z.object({
  query: z.string().min(2).max(255),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const addDivisionsToRegionBodySchema = z.object({
  divisionIds: z.array(z.number().int().positive()).optional(),
  createAsSubregions: z.boolean().optional(),
  includeChildren: z.boolean().optional(),
  inheritColor: z.boolean().default(true),
  childIds: z.array(z.number().int().positive()).optional(),
  // Names the subregion this call creates (regions.name) and the
  // region_members.custom_name recorded beside it — both VARCHAR(255).
  customName: z.string().max(255).optional(),
  customGeometry: z.any().optional(),
});

export const removeDivisionsFromRegionBodySchema = z.object({
  divisionIds: z.array(z.number().int().positive()).optional(),
  memberRowIds: z.array(z.number().int().positive()).optional(),
});

export const moveMemberBodySchema = z.object({
  memberRowId: z.number().int().positive(),
  toRegionId: z.number().int().positive(),
});

export const addChildDivisionsBodySchema = z.object({
  childIds: z.array(z.number().int().positive()).optional(),
  removeOriginal: z.boolean().default(true),
  inheritColor: z.boolean().default(true),
  createAsSubregions: z.boolean().default(true),
  /** Explicit GADM child → existing region assignments (skips name-match, skips create) */
  assignments: z.array(z.object({
    gadmChildId: z.number().int().positive(),
    existingRegionId: z.number().int().positive(),
  })).optional(),
});

export const expandToSubregionsBodySchema = z.object({
  inheritColor: z.boolean().default(true),
});

export const divisionUsageBodySchema = z.object({
  divisionIds: z.array(z.number().int().positive()).optional(),
});

export const hullPreviewBodySchema = z.object({
  bufferKm: z.number().min(0).max(1000).optional(),
  concavity: z.number().min(0).max(100).optional(),
  simplifyTolerance: z.number().min(0).max(10).optional(),
  customGeometry: z.any().optional(),
});

export const hullSaveBodySchema = z.object({
  bufferKm: z.number().min(0).max(1000).optional(),
  concavity: z.number().min(0).max(100).optional(),
  simplifyTolerance: z.number().min(0).max(10).optional(),
});

export const updateGeometryBodySchema = z.object({
  geometry: z.any(),
  isCustomBoundary: z.boolean().default(true),
  hullGeometry: z.any().optional(),
});

export const subregionGeometriesQuerySchema = z.object({
  useDisplay: booleanStringSchema.default('false'),
});

export const computeGeometryQuerySchema = z.object({
  force: booleanStringSchema.default('false'),
});

export const computeSSEQuerySchema = z.object({
  force: booleanStringSchema.default('false'),
  skipSnapping: booleanStringSchema.default('false'),
  token: z.string().optional(), // JWT passed as query param (EventSource can't send headers)
});

export const coverageSSEQuerySchema = z.object({
  token: z.string().optional(), // JWT passed as query param (EventSource can't send headers)
});

export const regenerateDisplayQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
});

export const regionGeometryDetailQuerySchema = z.object({
  detail: z.enum(['high', 'display', 'hull', 'anchor']).optional(),
});

// =============================================================================
// Geocode schemas
// =============================================================================

export const geocodeSearchQuerySchema = z.object({
  q: z.string().min(2).max(255),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const suggestImageQuerySchema = z.object({
  name: z.string().max(500).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  wikidataId: z.string().max(50).optional(),
});

export const aiGeocodeBodySchema = z.object({
  description: z.string().min(2).max(1000),
});

// =============================================================================
// AI schemas
// =============================================================================

export const setModelBodySchema = z.object({
  modelId: z.string().min(1).max(255),
});

/** `PUT /api/admin/ai/settings/:key` — the key is the row's primary key. */
export const aiSettingKeyParamSchema = z.object({
  key: z.string().trim().min(1).max(255),
});

export const aiSettingValueBodySchema = z.object({
  value: z.string().trim().min(1).max(2000),
});

export const addLearnedRuleBodySchema = z.object({
  feature: z.string().trim().min(1).max(100),
  // rule_text and context are TEXT columns, so 2000 is not a width — it is the
  // same refuse-the-absurd bound every other free-text request field carries.
  ruleText: z.string().trim().min(1).max(2000),
  context: z.string().max(2000).optional(),
});

export const suggestGroupBodySchema = z.object({
  regionPath: z.string().max(1000),
  regionName: z.string().max(500),
  availableGroups: z.array(z.string().max(500)),
  parentRegion: z.string().max(500),
  groupDescriptions: z.record(z.string()).optional(),
  useWebSearch: z.boolean().optional(),
  worldViewSource: z.string().max(1000).optional(),
  escalationLevel: z.enum(['fast', 'reasoning', 'reasoning_search']).optional(),
});

export const suggestGroupsBatchBodySchema = z.object({
  regions: z.array(z.object({
    path: z.string().max(1000),
    name: z.string().max(500),
  })).min(1).max(100),
  availableGroups: z.array(z.string().max(500)),
  parentRegion: z.string().max(500),
  worldViewDescription: z.string().max(2000).optional(),
  worldViewSource: z.string().max(1000).optional(),
  useWebSearch: z.boolean().optional(),
  groupDescriptions: z.record(z.string()).optional(),
});

export const generateDescriptionsBodySchema = z.object({
  groups: z.array(z.string().max(500)).min(1).max(100),
  parentRegion: z.string().max(500),
  worldViewDescription: z.string().max(2000).optional(),
  worldViewSource: z.string().max(1000).optional(),
  useWebSearch: z.boolean().optional(),
});

// =============================================================================
// Type exports for validated requests
// =============================================================================

export type GetSubdivisionsQuery = z.infer<typeof getSubdivisionsQuerySchema>;
export type GetGeometryQuery = z.infer<typeof getGeometryQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
