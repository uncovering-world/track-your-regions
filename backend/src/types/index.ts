import { z } from 'zod';
import { foldLabel } from '../services/sync/labelFold.js';
import {
  isStorableHttpUrl,
  isStorableImageUrl,
  normalizeStorableUrl,
  STORABLE_HTTP_URL_MESSAGE,
  STORABLE_IMAGE_URL_MESSAGE,
} from './urlSafety.js';

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
  /** [west, south, east, north]; west > east = antimeridian crossing. Stored, from geometry_focus() (#674) */
  focusBbox?: [number, number, number, number] | null;
  /** [lng, lat] -- the centre of that frame; the camera goes here for a crossing box */
  anchorPoint?: [number, number] | null;
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

/**
 * A curator's correction to one point: what it is called, or where it is.
 *
 * The coordinate arrives as a pair or not at all. Half a move is not a place —
 * a latitude written against the old longitude names somewhere nobody chose,
 * and on a single-point object that is where the object itself would go.
 */
export const editLocationBodySchema = z.object({
  name: z.string().min(1).max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).refine(
  body => (body.latitude === undefined) === (body.longitude === undefined),
  { message: 'Pass latitude and longitude together, or neither' },
).refine(
  body => body.name !== undefined || body.latitude !== undefined,
  { message: 'Nothing to change: pass a name, a coordinate, or both' },
);

/** One work of one experience: the museum a curator is acting from, and the work in it. */
export const workEditParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  treasureId: z.coerce.number().int().positive(),
});

/**
 * A curator's correction to one work: what it is called, who made it, when.
 *
 * `artists` is a list because a work often has more than one maker (#720), and
 * an **empty** list is a value a curator can mean — "the source names someone
 * and nobody knows who made this" — which is why it is not folded into absence.
 * Twenty is a bound rather than a judgement: the most any stored work names is
 * the Moon Museum's six, and the Fountain of Cybele's seven among monuments.
 *
 * `year` accepts null for the same reason: a date withdrawn is an answer.
 * `image_url` is absent on purpose — see `workEditController`.
 */
export const editWorkBodySchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  artists: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  year: z.number().int().min(-4000).max(2200).nullable().optional(),
}).refine(
  body => body.name !== undefined || body.artists !== undefined || body.year !== undefined,
  { message: 'Nothing to change: pass a name, the makers, a year, or any of them' },
).refine(
  // The importer dedupes by entity and by folded label, so a stored list never
  // names the same person twice; without this an edit could store what no run
  // can produce, and `creators()` would render it — "Edward Savage and Edward
  // Savage". Folded, so the check is the same question the importer asks.
  body => body.artists === undefined || !hasRepeatedLabel(body.artists),
  { message: 'The same maker is named twice' },
);

/** Whether two entries of a list name the same person, ignoring their typesetting. */
function hasRepeatedLabel(values: readonly string[]): boolean {
  const seen = new Set(values.map(foldLabel));
  return seen.size !== values.length;
}

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
 * A URL field bounded by whatever holds it, kept to the shapes that field can
 * legitimately take. Most of these end up inside the `metadata` JSONB, which
 * has no width, so they keep the generic 2000; `imageUrl` is stored in
 * `experiences.image_url` and takes that column's 1000 instead.
 *
 * The value is judged, then rewritten to the form the parser read, and that is
 * what gets stored: `validate()` puts the parsed object back on the request, so
 * no consumer downstream sees a spelling this rule did not read. The width is
 * measured last, on that stored form, because percent-encoding can make it
 * longer than what arrived.
 */
const boundedUrl = (max: number, isStorable: (value: string) => boolean, message: string) =>
  z.string().trim().optional()
    .refine((val) => !val || isStorable(val), { message })
    .transform((val) => (val === undefined ? val : normalizeStorableUrl(val)))
    .refine((val) => !val || val.length <= max, {
      message: `URL must be at most ${max} characters once normalised`,
    });

const safeUrlSchema = boundedUrl(2000, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE);
const safeImageUrlSchema = boundedUrl(1000, isStorableImageUrl, STORABLE_IMAGE_URL_MESSAGE);

/**
 * The same rule for a url that has to be there: an element of a list, or a
 * value a route acts on at once. `boundedUrl` reads an absent or empty value
 * as "leave the field alone" or "clear it", which an element of a list cannot
 * mean -- a candidate that is nothing is not a candidate.
 */
const requiredUrl = (max: number, isStorable: (value: string) => boolean, message: string) =>
  z.string().trim()
    .refine(isStorable, { message })
    .transform(normalizeStorableUrl)
    .refine((val) => val.length <= max, {
      message: `URL must be at most ${max} characters once normalised`,
    });

const requiredSafeUrlSchema = requiredUrl(2000, isStorableHttpUrl, STORABLE_HTTP_URL_MESSAGE);

/**
 * A link that may be left unsaid but not emptied: a region's source page
 * (#703). `safeUrlSchema` reads '' as "clear the field", which fits a curator's
 * form, where the controller turns it into NULL. Nothing does for
 * `source_url` -- the rename handler writes the value it is given, and every
 * reader of the column tests it for truthiness -- so a page is either named or
 * not sent, and '' stays refused, the way `z.string().url()` refused it.
 */
const optionalSafeUrlSchema = requiredSafeUrlSchema.optional();

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
  /**
   * Ignore what we kept from the source and ask it everything again.
   *
   * Per run rather than per source, because the reason is always about this
   * attempt: the source published something a moment ago, or a kept answer is
   * suspected of being wrong. It costs the full collection — a quarter of an
   * hour for museums — which is why it is a deliberate click and not a default.
   */
  refreshCache: z.boolean().optional(),
});

/**
 * Which kind of kept answer to forget, or all of them when absent.
 *
 * A free string rather than an enum of the kinds: the reader deletes by
 * equality, an unknown kind removes nothing, and pinning the list here would
 * mean a new kind of question needs a schema change before it can be cleared.
 */
export const clearCacheQuerySchema = z.object({
  kind: z.string().min(1).max(40).optional(),
});

/**
 * Whose lifetime is being changed, and of which kind.
 *
 * **Both**, because `validate(..., 'params')` replaces `req.params` with what
 * the schema parsed. Naming only `kind` left the handler reading
 * `req.params.categoryId` off an object that no longer had it — `parseInt` of
 * `undefined` is `NaN`, and the endpoint could not work at all.
 */
export const cacheKindParamSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  kind: z.string().min(1).max(40),
});

/**
 * A new lifetime, in hours.
 *
 * Hours rather than milliseconds because that is the unit of the decision — "a
 * pool is good for a day" — and bounded at both ends: under a minute is a cache
 * that never hits, and beyond a month it is not a cache but a copy of Wikidata
 * we forgot we made.
 */
export const cacheTtlBodySchema = z.object({
  hours: z.number().min(0.02).max(24 * 31),
});

/**
 * The queue's kinds page independently, which is why there is an offset per kind.
 *
 * One shared offset was the defect: the kinds are separate queries with separate
 * LIMITs, so "next" moved all of them at once and a kind whose page was full had
 * a page 2 no control could ask for. Nothing was unreachable while the largest kind held 19
 * against a limit of 25 — but the first gated round is measured at 139 cards, and at that
 * size the page silently hides work.
 *
 * Stated as a rule rather than as a tally: `answeredWithdrawals` is the ninth, and the
 * next list added is a line here rather than three sentences to renumber.
 *
 * `limit` stays shared: it is a page size, and one number is what a reader means by it.
 */
export const reviewQueueQuerySchema = z.object({
  // Bounded to int4: `experience_categories.id` is SERIAL, and a larger value
  // would reach Postgres and error there rather than answering 400 here.
  categoryId: z.coerce.number().int().positive().max(2147483647).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  missingOffset: z.coerce.number().int().min(0).default(0),
  refusedOffset: z.coerce.number().int().min(0).default(0),
  keptOutOffset: z.coerce.number().int().min(0).default(0),
  conflictsOffset: z.coerce.number().int().min(0).default(0),
  arrivalsOffset: z.coerce.number().int().min(0).default(0),
  heldOffset: z.coerce.number().int().min(0).default(0),
  contentsOffset: z.coerce.number().int().min(0).default(0),
  withdrawnOffset: z.coerce.number().int().min(0).default(0),
  answeredWithdrawalsOffset: z.coerce.number().int().min(0).default(0),
});

/**
 * A lifecycle verdict, for an object or for one point inside it.
 *
 * One schema for both endpoints because it is one question — delisted, gone, or
 * never gone — asked about two rows that carry the same two axes in the same words
 * (ADR-0026). What the two verdicts *do* differs, and that difference lives in the
 * controllers rather than in the body: on an experience every answer clears
 * `missing_since`, on a location only the false alarm does, because there the flag
 * is one of the two terms that keep a point off the map — `former` is held by the
 * flag, `lost` by its own axis whatever the flag says (ADR-0026 decision 7). So the
 * false alarm is the only answer that clears the flag, though not the only one that
 * can reveal a point: taking a `lost` verdict back on a row whose flag is already
 * clear reveals it too.
 */
export const lifecycleStateBodySchema = z.object({
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

/**
 * The opposite answer to the same card, and it carries no value at all.
 *
 * What was refused is read from the locked proposal, never from the request: the queue
 * compares a stored refusal against the live proposal by equality, so a refusal naming
 * something nobody proposed would silence nothing while looking like an answer. Which
 * fields and which run is therefore the whole of what a client may say here.
 */
export const declineSourceBodySchema = z.object({
  fields: z.array(z.string().min(1)).min(1).max(20),
  expectedSyncLogId: z.number().int().positive().max(2147483647),
});


/**
 * One part of a held proposal, as a request names it (#722).
 *
 * The record names a part and never identifies it (ADR-0026 decision 4), so a
 * request does the same: the kind it was filed under, and the reference and name
 * the record carries. Both halves are nullable there — most UNESCO components
 * carry a reference and no name of their own, and one point carries neither — so
 * both are nullable here, and the server matches on the pair because neither is
 * an identity alone.
 *
 * Shared by the two endpoints that answer a held row, so a card cannot name a
 * part one way to publish it and another way to refuse it.
 */
const heldPartSelectionSchema = z.object({
  kind: z.enum(['locations', 'treasures']),
  ref: z.string().max(255).nullable().optional(),
  name: z.string().max(500).nullable().optional(),
  fields: z.array(z.string().min(1).max(100)).min(1).max(50),
});

/**
 * Which rows of a held proposal a curator is refusing.
 * POST /api/experiences/:id/decline-held
 *
 * The mirror of the held selection on `publishExperienceBodySchema`, and named
 * the same way for the same reason. At least one row: "refuse nothing" is not an
 * answer, and a call that reported success over it would leave a card looking
 * settled while it stands. The `.refine` is what says "at least one" across two
 * optional arrays, which neither array's own `.min(1)` can.
 *
 * `expectedSyncLogId` is required rather than optional, unlike on publishing: a
 * held card always names the run whose proposal it shows, so a caller that
 * cannot name one is not answering a card. The cost of getting it wrong is the
 * same as on `decline-source` — refusing the wrong run silences a proposal
 * nobody read — and it is re-resolved under the write lock and refused rather
 * than substituted.
 */
export const declineHeldBodySchema = z.object({
  fields: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  parts: z.array(heldPartSelectionSchema).min(1).max(50).optional(),
  expectedSyncLogId: z.number().int().positive().max(2147483647),
}).refine(
  b => b.fields !== undefined || b.parts !== undefined,
  { message: 'name at least one held field or part to refuse' },
);

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
   * Five shapes for what a body can mean, spelled out because "absent means
   * all of it" is exactly the inference that produced the defect above:
   * - absent, with no ids: an object publish — the experience and every
   *   pending content row it holds. The arrival case.
   * - `{ contentsOnly: true }`: every pending content row, object untouched.
   * - `{ locationIds }` / `{ treasureIds }` (or both): those ids only, object
   *   untouched.
   * - `{ fieldsOnly: true }`: the object's held fields and none of its unread
   *   contents — the field below, and the mirror of `contentsOnly`.
   * - `{ heldFields }` / `{ heldParts }` (or both) with `expectedSyncLogId`:
   *   that mirror narrowed to the held rows named, the rest left open (#722).
   *   The run id is required here and nowhere else in this schema, because a
   *   per-row answer is about the proposal one run made.
   */
  contentsOnly: z.literal(true).optional(),
  /**
   * The fourth shape, and the mirror of the one above: apply what the run
   * proposed for the object's own fields and leave every unread point and work
   * where it is.
   *
   * What #524 asked for, in the words of the case that raised it: a museum whose
   * label is held *and* which gained twelve paintings could be answered only as
   * one act, so declining the label held back the paintings — one doubtful field
   * freezing twelve works, which is the failure ADR-0025's queue section named
   * from the other direction.
   *
   * `true` only, for the reason `contentsOnly` is: absent already means "and the
   * contents with it". Exclusive with the three contents shapes, since a body
   * that named both would be asking for the object publish it could have asked
   * for by naming nothing.
   */
  fieldsOnly: z.literal(true).optional(),
  /**
   * The held fields of the object's own this call answers, rather than all of
   * them (#722).
   *
   * The fields publish narrowed the way `locationIds` narrows the contents one,
   * and for the same reason: the endpoint has always been able to answer part of
   * a proposal, and it was the screen that could not say "this one". What is not
   * named stays open and keeps the pointer, so the card comes back with the rows
   * still waiting rather than being cleared unanswered.
   *
   * `.min(1)` for the reason the id arrays carry it: an empty array would mean
   * "answer exactly nothing, and do not answer the card either", which no caller
   * can want and which would report success over a click that did nothing.
   * Bounded above the widest proposal a run can make — thirteen field names in
   * `CURATED_KEY_BY_FIELD` — with room for a vocabulary that grows.
   *
   * `fieldsOnly` beside it is allowed and does nothing, unlike the pairs the
   * `.refine`s below forbid: those say one thing twice with no rule for which
   * wins, while this one has a single reading — the fields half, these rows —
   * and refusing a body that merely restates its own half would be a rule
   * without a defect behind it.
   */
  heldFields: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  /**
   * The same, one level down: the held fields of the object's parts, each named
   * by the part as the record names it (ADR-0026 decision 4, ADR-0037).
   *
   * `ref` and `name` are the record's own two halves and both are nullable there,
   * so both are nullable here; neither is an identity alone, which is why the
   * server matches on the pair. Nothing is looked up by id, and the value each
   * row proposes is read off the locked proposal rather than from this body.
   *
   * Bounded at the page a card shows: a serial site can hold hundreds of points,
   * but the card lists `CONTENTS_ROWS_SHOWN` of them, so a request naming more
   * parts than that is not answering a card anyone was looking at.
   */
  heldParts: z.array(heldPartSelectionSchema).min(1).max(50).optional(),
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
  b => !((b.heldFields !== undefined || b.heldParts !== undefined)
    && (b.contentsOnly === true || b.locationIds !== undefined || b.treasureIds !== undefined)),
  {
    // Naming held rows already says "the fields half", so a contents shape
    // beside it asks for two different publishes in one body. Refused on the
    // same ground as the pair below: inventing a rule for which wins is worse
    // than refusing the ambiguity.
    message: 'heldFields and heldParts already publish the fields half; a contents publish beside either is two answers in one body',
  },
).refine(
  b => !(b.fieldsOnly === true
    && (b.contentsOnly === true || b.locationIds !== undefined || b.treasureIds !== undefined)),
  {
    // The two halves of one object, asked for together, are the object publish a
    // body says by naming neither. Refused rather than resolved, on the same
    // ground as the ambiguity below it.
    message: 'fieldsOnly and a contents publish are the two halves of an object publish; send neither to ask for both',
  },
).refine(
  b => !(b.contentsOnly === true && (b.locationIds !== undefined || b.treasureIds !== undefined)),
  {
    // Two ways of saying "contents only" in the same body say nothing a
    // caller could not have said with one of them, and inventing a rule for
    // which one wins is worse than refusing the ambiguity.
    message: 'contentsOnly already means every pending content row; naming locationIds or treasureIds beside it is redundant',
  },
).refine(
  b => (b.heldFields === undefined && b.heldParts === undefined)
    || b.expectedSyncLogId !== undefined,
  {
    // Naming rows is answering a card, and a held card always names the run
    // whose proposal it shows — `declineHeldBodySchema` requires the same for
    // the same reason. Without the pair, a selection sent at a row whose
    // pointer has since been cleared passes every gate the endpoint has and
    // reports success over a card that is not there: the staleness check is
    // skipped precisely because nothing would be written.
    message: 'heldFields and heldParts answer a card, which names its run: send expectedSyncLogId with them',
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
  type: z.enum(['created', 'updated', 'conflict', 'held', 'contents', 'missing', 'returned', 'failed', 'filtered']).optional(),
  significance: z.enum(['major', 'minor']).optional(),
  // Not z.coerce.boolean(): that is Boolean(input), so 'false' would enable it
  significantOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reorderCategoriesBodySchema = z.object({
  categoryIds: z.array(z.number().int().positive()).min(1),
});

/**
 * Whether a source holds its new and changed content for a curator (ADR-0025).
 *
 * `z.boolean()` rather than a coerced or enum'd form: this arrives as JSON from
 * one admin control, so there is no string to interpret, and the neighbours above
 * show what interpreting one costs — `z.coerce.boolean()` is `Boolean(input)`, so
 * the string `'false'` would switch a gate *on*. A request that cannot say which
 * way the switch went should be refused, not guessed.
 */
export const curationGateBodySchema = z.object({
  requiresCuration: z.boolean(),
});

/**
 * Which catalogue assertion an admin is accepting the debt of.
 *
 * The id and nothing else: the number is measured on the server when the
 * acceptance is recorded, never sent by the browser, because the whole lane
 * rests on the accepted figure being a measurement rather than a claim. A
 * schema carrying a count would be a schema inviting one.
 *
 * Bounded at the column's own width, so a request that could not be stored is
 * refused at the edge rather than by the database.
 */
export const dataAssertionAcceptBodySchema = z.object({
  assertionId: z.string().min(1).max(80),
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
  name: z.string().min(1).max(255),
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
  name: z.string().min(1).max(255),
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
