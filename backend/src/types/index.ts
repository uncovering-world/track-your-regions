/**
 * What the API accepts: the query and body schemas its routes validate with.
 * What it answers is declared in `api/responses/`, once (ADR-0066).
 */

import { z } from 'zod/v4';
import { parseBbox } from '../db/bboxEnvelopes.js';
import { CHECK_VALUES, COLUMN_WIDTHS } from '../db/schema.generated.js';
import { foldLabel, tidyLabel } from '@tyr/shared/labels';
import { WHOLE_REGION_LIMIT } from '@tyr/shared/catalogue';
import { safeImageUrlSchema, safeUrlSchema } from './urlSchemas.js';
import { POINTS_DETAILS } from '../controllers/experience/worldPointsVocabulary.js';

// The world-view import's request schemas live in their own module (#933) and
// are part of this barrel, so a route imports them from here as before.
export * from './worldViewImportSchemas.js';

// =============================================================================
// API query params
// =============================================================================

export const worldViewIdSchema = z.coerce.number().int().positive().default(1);
export const divisionIdSchema = z.coerce.number().int().positive();
export const regionIdSchema = z.coerce.number().int().positive();
// How much of a division's boundary to send: the stored simplifications for a
// preview, the full shape by default, since the cutting tools store what they
// cut from it (#1010).
export const detailLevelSchema = z.enum(['low', 'medium', 'high']).default('high');
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
  detail: detailLevelSchema,
});

export const searchQuerySchema = z.object({
  query: z.string().max(255).optional().transform(v => v ?? ''),
  worldViewId: worldViewIdSchema,
  limit: limitSchema,
});

// =============================================================================
// Reusable field schemas
// =============================================================================

/**
 * A name as the catalogue stores one: as a person would type it (#835).
 *
 * Tidied before it is judged — the edges trimmed, a run of whitespace inside
 * collapsed to one space (`tidyLabel`, the rule every importer's writer applies)
 * — so a title of nothing but spaces is refused as empty rather than stored,
 * and what `validate()` puts back on the request is what the row will hold. The
 * width is measured on the tidied form, which is never longer. Case, dashes and
 * accents are the curator's own and pass untouched.
 */
const storedName = (max: number) =>
  z.string().transform(tidyLabel).pipe(z.string().min(1).max(max));

// =============================================================================
// Reusable param schemas (for path params)
// =============================================================================

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** `/api/divisions/:divisionId…` — a GADM division's id. */
export const divisionIdParamSchema = z.object({
  divisionId: divisionIdSchema,
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

// Bounded to int4 like `reviewQueueQuerySchema`'s own `run`: `experience_sync_logs.id`
// is SERIAL, and a larger value would reach Postgres and error there rather than
// answering 400.
export const syncLogIdParamSchema = z.object({
  syncLogId: z.coerce.number().int().positive().max(2147483647),
});

/**
 * A curator's correction to one point: what it is called, or where it is.
 *
 * The coordinate arrives as a pair or not at all. Half a move is not a place —
 * a latitude written against the old longitude names somewhere nobody chose,
 * and on a single-point object that is where the object itself would go.
 */
export const editLocationBodySchema = z.object({
  name: storedName(COLUMN_WIDTHS.experience_locations.name).optional(),
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
 * A curator's correction to one work: what it is called, who made it, when,
 * and which photograph it is shown by.
 *
 * `artists` is a list because a work often has more than one maker (#720), and
 * an **empty** list is a value a curator can mean — "the source names someone
 * and nobody knows who made this" — which is why it is not folded into absence.
 * Twenty is a bound rather than a judgement: the most any stored work names is
 * the Moon Museum's six, and the Fountain of Cybele's seven among monuments.
 *
 * `year` accepts null for the same reason: a date withdrawn is an answer. Its
 * floor is not a guess about art history but a bound the stored rows had to
 * clear: −4000 refused nine works the museum run had already written, the
 * oldest being the Lion man of the Hohlenstein Stadel at 38000 BC in Museum
 * Ulm, with five palaeolithic Venuses, the Swimming Reindeer, the Shigir Idol
 * and the Ain Sakhri lovers behind it. A curator cannot be refused a value the
 * catalogue is showing them, so the floor sits far enough below the oldest
 * worked object a museum displays to stay a typo guard and nothing else.
 *
 * `imageUrl` is `safeImageUrlSchema`, the same field `editExperienceBodySchema`
 * takes: a Commons file or an `/images/` path we host, normalised to the
 * spelling the drawing side reads. `''` clears the picture. The credit is not
 * in the body and never could be — it belongs to the file and is fetched from
 * Commons for it (`workEditController`).
 */
export const editWorkBodySchema = z.object({
  name: storedName(COLUMN_WIDTHS.treasures.name).optional(),
  artists: z.array(storedName(COLUMN_WIDTHS.treasures.artists)).max(20).optional(),
  year: z.number().int().min(-200000).max(2200).nullable().optional(),
  imageUrl: safeImageUrlSchema,
}).refine(
  body => body.name !== undefined || body.artists !== undefined
    || body.year !== undefined || body.imageUrl !== undefined,
  { message: 'Nothing to change: pass a name, the makers, a year, a picture, or any of them' },
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

/**
 * The map's world layer (#910): which kind, which box, how much of each point.
 *
 * `bbox` is a string here and parsed in one place (`db/bboxEnvelopes.ts`),
 * because the interesting half of a box is the antimeridian rule rather than
 * its syntax, and that rule already has an owner.
 *
 * `detail` and `folded` are named rather than inferred: `validate()` replaces
 * req.query with what Zod parsed and strips whatever it does not name, so a
 * parameter missing here is a parameter the handler never sees — which is the
 * note `experiencesByRegionQuerySchema` below carries for `includeLost`, and
 * the same mistake would silently pin this endpoint to its overview tier.
 */
export const worldPointsQuerySchema = z.object({
  // Bounded to int4 like `reviewQueueQuerySchema`'s ids above, and measured
  // rather than assumed: `experience_kinds.id` is an integer column, so
  // `?kindId=99999999999` is a perfectly good positive integer to Zod and an
  // out-of-range error from Postgres, which this endpoint then answered as a
  // 500 carrying the database's own message. A kind id that cannot exist is a
  // bad request, and the 400 is also what stops the message getting out. The
  // same shape a tile function had to catch as `numeric_value_out_of_range`
  // (#918); here the schema is the guard.
  kindId: z.coerce.number().int().positive().max(2147483647).optional(),
  // west,south,east,north. Refused rather than dropped when it is not that:
  // the map's read is a viewport, and a box nobody can parse must not quietly
  // widen it to the whole catalogue — the argument the tile source made for a
  // malformed kind id, applied to the parameter that decides how much of the
  // world is answered.
  bbox: z.string().max(100)
    .refine(value => parseBbox(value) !== null,
      { message: 'bbox must be four numbers: west,south,east,north' })
    .optional(),
  detail: z.enum(POINTS_DETAILS).default('overview'),
  folded: booleanStringSchema,
});

export const experiencesByRegionQuerySchema = z.object({
  includeChildren: booleanStringSchema.default('true'),
  // Without this the parameter never reaches the handler, which receives the
  // parsed object, and Zod strips what it does not name — so the whole "show
  // what no longer exists" path would be dead over HTTP while passing every
  // test that calls the handler directly.
  includeLost: booleanStringSchema,
  // The whole region, at most: neither surface that reads a region paginates,
  // so a ceiling below the largest region truncated the list instead of paging
  // it — and because the rows are ordered by name, the loss was a tail of the
  // alphabet.
  limit: z.coerce.number().int().min(1).max(WHOLE_REGION_LIMIT).default(100),
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

export const editExperienceBodySchema = z.object({
  name: storedName(COLUMN_WIDTHS.experiences.name).optional(),
  shortDescription: z.string().max(1000).optional(),
  description: z.string().max(10000).optional(),
  type: z.string().max(COLUMN_WIDTHS.experiences.type).optional(),
  imageUrl: safeImageUrlSchema,
  tags: z.array(z.string().max(100)).max(50).optional(),
  websiteUrl: safeUrlSchema,
  wikipediaUrl: safeUrlSchema,
});

export const createManualExperienceBodySchema = z.object({
  // Written as the place's name and again as its first location's, so the
  // bound is whichever column is narrower.
  name: storedName(Math.min(COLUMN_WIDTHS.experiences.name, COLUMN_WIDTHS.experience_locations.name)),
  shortDescription: z.string().max(1000).optional(),
  type: z.string().max(COLUMN_WIDTHS.experiences.type).optional(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  imageUrl: safeImageUrlSchema,
  tags: z.array(z.string().max(100)).max(50).optional(),
  // One element each of the two VARCHAR arrays; the width is the element's.
  countryCode: z.string().max(COLUMN_WIDTHS.experiences.country_codes).optional(),
  countryName: z.string().max(COLUMN_WIDTHS.experiences.country_names).optional(),
  regionId: z.number().int().positive(),
  /** The kind the curator files the place under; its source is the kind's own (#819). */
  kindId: z.number().int().positive(),
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

export const markLocationVisitedBodySchema = z.object({
  notes: z.string().max(2000).optional(),
});

export const visitedIdsQuerySchema = z.object({
  kindId: z.coerce.number().int().positive().optional(),
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

export const sourceIdParamSchema = z.object({
  sourceId: z.coerce.number().int().positive(),
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
 * `req.params.sourceId` off an object that no longer had it — `parseInt` of
 * `undefined` is `NaN`, and the endpoint could not work at all.
 */
export const cacheKindParamSchema = z.object({
  sourceId: z.coerce.number().int().positive(),
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
 * The queue is one list, so it takes one cursor and the controls that narrow it
 * (ADR-0051).
 *
 * The seven `<kind>Offset` parameters are gone with the seven statements that
 * had a `LIMIT` each: the open questions are ordered and paged across the kinds
 * at once, and `cursor` is where the reader is in that one order. Keyset rather
 * than an offset because the list shrinks while it is read — answering a
 * question removes it, and every later row shifts by one under an offset.
 *
 * `keptOutOffset`, `answeredWithdrawalsOffset` and `refusedPartsOffset` stay.
 * Those three lists are not open questions, carry no date to order the union by,
 * and keep their own statement and their own paging.
 *
 * The filters are the page's address (ADR-0051 decision 5), which is why each is
 * the string a query parameter actually is: `source=1,3` and `kind=arrival,refused`
 * are validated in shape here and split by the controller, which drops a word it
 * does not know rather than answering 400 — an unreadable filter opens the
 * unfiltered list (`docs/tech/addresses.md`).
 */
export const reviewQueueQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  // Length-bounded like `cursor` and `q`: the shape alone admits a digit string
  // of any length, and the catalogue offers a handful of sources. Each id is bounded to
  // int4 by the controller, which is where the list is split — the same place a
  // `kind` word it does not know is dropped.
  source: z.string().max(200).regex(/^\d+(,\d+)*$/).optional(),
  kind: z.string().regex(/^[a-z]+(,[a-z]+)*$/).optional(),
  // Bounded to int4 like every other id here: `regions.id` is SERIAL, and a
  // larger value would reach Postgres and error there rather than answering 400.
  region: z.union([z.literal('none'), z.coerce.number().int().positive().max(2147483647)]).optional(),
  run: z.coerce.number().int().positive().max(2147483647).optional(),
  aside: z.enum(['show']).optional(),
  sort: z.enum(['date', 'question']).default('date'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  keptOutOffset: z.coerce.number().int().min(0).default(0),
  answeredWithdrawalsOffset: z.coerce.number().int().min(0).default(0),
  refusedPartsOffset: z.coerce.number().int().min(0).default(0),
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
  membership: z.enum(CHECK_VALUES.experiences.source_membership).optional(),
  existence: z.enum(CHECK_VALUES.experiences.existence).optional(),
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
    membership: z.enum(CHECK_VALUES.experiences.source_membership),
    existence: z.enum(CHECK_VALUES.experiences.existence),
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

/**
 * A selection of review rows and one answer for all of them (#852).
 *
 * A row is what a click sends: which row — the queue's own kind word and the
 * object — and the run the curator saw it asked by, which the held and
 * conflict writers compare with the pointer under the lock. Bounded by the
 * queue's page maximum: a selection past one page is walked by the client a
 * page at a time, so progress is reported and the route never takes a filter.
 */
export const reviewAnswerBodySchema = z.object({
  rows: z.array(z.object({
    kind: z.enum(['conflict', 'waiting', 'withdrawn', 'refused', 'missing']),
    id: z.number().int().positive().max(2147483647),
    runId: z.number().int().positive().max(2147483647).nullable().optional(),
  })).min(1).max(100),
  answer: z.enum(['accept', 'reject', 'lost']),
});

/** A curator keeping out an arrival (#852, ADR-0053): the note is all there is to send. */
export const refuseArrivalBodySchema = z.object({
  note: z.string().max(1000).optional(),
});

/**
 * A curator turning down unread contents (#852, ADR-0053): the named points
 * and works, or all of them when neither list is sent — the same two lists,
 * the same bounds and the same reading `publishExperienceBodySchema` gives
 * them, since this answers the same card the other way.
 */
export const refuseContentsBodySchema = z.object({
  locationIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(2000).optional(),
  treasureIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(2000).optional(),
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
  kind: z.enum(CHECK_VALUES.experience_held_decisions.part_kind),
  ref: z.string().max(COLUMN_WIDTHS.experience_held_decisions.part_ref).nullable().optional(),
  name: z.string().max(COLUMN_WIDTHS.experience_held_decisions.part_name).nullable().optional(),
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
   * the defect this field exists to remove: without it, a contents card whose
   * only held field a curator had already claimed sends `{}` and silently
   * publishes the object, asserting a person had read a museum whose paintings
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
   *
   * Bounded above the widest card a curator can be looking at, which is no
   * longer a count of column names: a run records a fact per metadata key
   * (ADR-0039) and a fact per language of the local-names map (#728), so the
   * ceiling is the object's own columns plus whatever keys and languages the
   * source publishes. UNESCO's six languages and its handful of metadata keys
   * put the widest real proposal around two dozen rows, so fifty is headroom
   * rather than a limit anyone meets.
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
   * Compared under the place's write lock against the membership's
   * `pending_change_sync_log_id` (`experience_kind_memberships`, #822)
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
  // The column's own CHECK lists, so `?type=` accepts exactly what a changeset
  // row can hold — a value missing here answered 400 for a row that existed.
  type: z.enum(CHECK_VALUES.experience_sync_changes.change_type).optional(),
  significance: z.enum(CHECK_VALUES.experience_sync_changes.significance).optional(),
  // Not z.coerce.boolean(): that is Boolean(input), so 'false' would enable it
  significantOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reorderSourcesBodySchema = z.object({
  sourceIds: z.array(z.number().int().positive()).min(1),
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
 * A source's fame line: how many sitelinks a row needs to enter the world
 * tier, and how few it may fall to before the tier lets it go (ADR-0023's
 * hysteresis, read by `parseSourceLine` in `services/sync/sourceLine.ts`).
 *
 * The same bound the run's own reader enforces — integers from 1 to 1000,
 * `staySitelinks` no higher than `enterSitelinks` — kept identical on purpose:
 * a body this schema passed but the run's reader refused would let an admin
 * save a line no sync could ever use.
 *
 * A source whose finds are thinner than its places states a second pair under
 * the `find…` keys (ADR-0058 decision 5): optional, because most sources have
 * one door, but taken whole or not at all, since the reader refuses half a pair
 * rather than completing it from the places' line. An archaeological find
 * carries fewer articles than the museum that holds it, so the two doors need
 * two lines.
 */
export const sourceLineBodySchema = z.object({
  enterSitelinks: z.number().int().min(1).max(1000),
  staySitelinks: z.number().int().min(1).max(1000),
  findEnterSitelinks: z.number().int().min(1).max(1000).optional(),
  findStaySitelinks: z.number().int().min(1).max(1000).optional(),
}).refine(b => b.staySitelinks <= b.enterSitelinks, {
  message: 'staySitelinks must not exceed enterSitelinks',
}).refine(b => (b.findEnterSitelinks === undefined) === (b.findStaySitelinks === undefined), {
  message: 'findEnterSitelinks and findStaySitelinks must be sent together',
}).refine(
  b => b.findEnterSitelinks === undefined
    || b.findStaySitelinks === undefined
    || b.findStaySitelinks <= b.findEnterSitelinks,
  { message: 'findStaySitelinks must not exceed findEnterSitelinks' },
);

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
  assertionId: z.string().min(1).max(COLUMN_WIDTHS.data_assertion_acceptances.assertion_id),
});

export const startRegionAssignmentBodySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  sourceId: z.coerce.number().int().positive().optional(),
});

export const regionAssignmentStatusQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
});

export const experienceCountsQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  sourceId: z.coerce.number().int().positive().optional(),
});

export const syncLogsQuerySchema = z.object({
  sourceId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createCuratorAssignmentBodySchema = z.object({
  userId: z.number().int().positive(),
  scopeType: z.enum(CHECK_VALUES.curator_assignments.scope_type),
  regionId: z.number().int().positive().optional(),
  sourceId: z.number().int().positive().optional(),
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
// World View schemas
// =============================================================================
// String bounds here are the widths of the columns the values land in —
// world_views and regions in db/init/01-schema.sql. A bound wider than its
// column is not a laxer API, only a later failure: Zod passes the value on,
// Postgres raises 22001 on the write, and the caller gets a 500 where a 400
// was owed. Each bound reads its width from `COLUMN_WIDTHS`, so the two
// cannot drift apart.

export const createWorldViewBodySchema = z.object({
  name: z.string().min(1).max(COLUMN_WIDTHS.world_views.name),
  description: z.string().max(COLUMN_WIDTHS.world_views.description).optional(),
  source: z.string().max(COLUMN_WIDTHS.world_views.source).optional(),
});

export const updateWorldViewBodySchema = z.object({
  name: z.string().min(1).max(COLUMN_WIDTHS.world_views.name).optional(),
  description: z.string().max(COLUMN_WIDTHS.world_views.description).optional(),
  source: z.string().max(COLUMN_WIDTHS.world_views.source).optional(),
  isPublic: z.boolean().optional(),
});

export const createRegionBodySchema = z.object({
  name: z.string().min(1).max(COLUMN_WIDTHS.regions.name),
  description: z.string().max(COLUMN_WIDTHS.regions.description).optional(),
  parentRegionId: z.number().int().positive().optional(),
  // `#rrggbb`, the one shape the editor's <input type="color"> produces and
  // the only one regions.color has room for.
  color: z.string().max(COLUMN_WIDTHS.regions.color).optional(),
  customGeometry: z.any().optional(),
});

export const updateRegionBodySchema = z.object({
  name: z.string().min(1).max(COLUMN_WIDTHS.regions.name).optional(),
  description: z.string().max(COLUMN_WIDTHS.regions.description).optional(),
  parentRegionId: z.number().int().positive().nullable().optional(),
  color: z.string().max(COLUMN_WIDTHS.regions.color).nullable().optional(),
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
  // region_members.custom_name recorded beside it, so the bound is whichever
  // column is narrower.
  customName: z.string().max(Math.min(COLUMN_WIDTHS.regions.name, COLUMN_WIDTHS.region_members.custom_name)).optional(),
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

/**
 * What every writer of a region's geometry accepts, mounted on both of them:
 * the bulk endpoint, and the progress stream through the extension below.
 *
 * One object rather than one per endpoint, because that is the whole point of
 * it — separate declarations disagreed about `skipSnapping`, one taking no such
 * parameter at all and one reading it off a query nothing validated, so the
 * same region came out differently depending on which was asked (#736).
 * Identical schemas would restore that by the ordinary route: a change made to
 * one and forgotten on the other, with nothing to fail.
 *
 * `skipSnapping` absent means *snap*, which is what each of them already did.
 */
export const computeGeometryQuerySchema = z.object({
  force: booleanStringSchema.default('false'),
  skipSnapping: booleanStringSchema.default('false'),
});

/** The same, plus the JWT `EventSource` cannot put in a header. */
export const computeSSEQuerySchema = computeGeometryQuerySchema.extend({
  token: z.string().optional(),
});

export const coverageSSEQuerySchema = z.object({
  token: z.string().optional(), // JWT passed as query param (EventSource can't send headers)
});

export const regenerateDisplayQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
});

export const regionGeometryDetailQuerySchema = z.object({
  detail: z.enum(['high', 'hull']).optional(),
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
  key: z.string().trim().min(1).max(COLUMN_WIDTHS.ai_settings.key),
});

export const aiSettingValueBodySchema = z.object({
  value: z.string().trim().min(1).max(2000),
});

export const addLearnedRuleBodySchema = z.object({
  feature: z.string().trim().min(1).max(COLUMN_WIDTHS.ai_learned_rules.feature),
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
  groupDescriptions: z.record(z.string(), z.string()).optional(),
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
  groupDescriptions: z.record(z.string(), z.string()).optional(),
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
