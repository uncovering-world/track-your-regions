/**
 * What the review queue client's calls answer (ADR-0066): the success bodies of
 * the endpoints `frontend/src/api/reviewQueue.ts` calls, declared once. That is
 * the queue itself, a run's batch set aside and brought back, and a page of rows
 * answered at once (#852).
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 *
 * A card's keys follow what the queries select. Keys every query selects but
 * the client has always treated as optional stay optional here, because the
 * cards are built and tested from partial rows. A looser type never promises
 * less than the server sends.
 */

import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import {
  QUEUE_ITEM_KINDS, QUEUE_KINDS, REVIEW_ANSWERS, WAITING_SUBS,
} from '../../controllers/experience/reviewQueueVocabulary.js';
import { ContentKind, PlacementFailure } from './curation.js';
import { ImageCredit } from './experiences.js';

/** A timestamp as the wire carries it: an ISO string, from a `Date` or from PostgreSQL's JSON. */
const timestamp = z.iso.datetime({ offset: true });

const SourceMembership = z.enum(CHECK_VALUES.experiences.source_membership);
const Existence = z.enum(CHECK_VALUES.experiences.existence);

export const QueueKind = z.enum(QUEUE_KINDS)
  .describe('The class of an open question, which a batch answer names a row by.');
export type QueueKind = z.infer<typeof QueueKind>;

export const WaitingSub = z.enum(WAITING_SUBS).describe('A gated sub-kind a `waiting` question groups (ADR-0025).');
export type WaitingSub = z.infer<typeof WaitingSub>;

export const ReviewAnswer = z.enum(REVIEW_ANSWERS)
  .describe('The two answers every review row has, and the third two kinds have (#852).');
export type ReviewAnswer = z.infer<typeof ReviewAnswer>;

// The changeset's record of one field, as the run stored it and the queue
// serves it. Older runs stored fewer keys: `held` arrived with the gate (#519),
// and `old` is absent where the stored value was undefined, which JSON drops.
const changedField = {
  field: z.string(),
  old: z.unknown().describe('The stored value the run found. Absent where there was none.'),
  new: z.unknown().describe('The value the source offered.'),
  significance: z.enum(CHECK_VALUES.experience_sync_changes.significance).optional(),
  curatedConflict: z.boolean().optional().describe('A curator had claimed the field, so the stored value won on purpose.'),
  held: z.boolean().optional()
    .describe("The source's gate kept the write out of a row readers see, so a verdict is waiting (ADR-0025)."),
};

export const ChangedField = z.strictObject(changedField).describe('One field a run proposed to change.');
export type ChangedField = z.infer<typeof ChangedField>;

export const FieldClaim = z.strictObject({
  by: z.string().describe('The curator, or "a curator" where they set no display name.'),
  at: timestamp,
}).describe('Who claimed a field, and when.');
export type FieldClaim = z.infer<typeof FieldClaim>;

export const EarlierAnswer = z.strictObject({
  by: z.string(),
  at: timestamp,
  action: z.enum(['accepted_source', 'declined_source']).optional()
    .describe('Which answer it was. Absent on rows written before refusing was possible.'),
  applied: z.unknown().describe('What that answer was about: the value taken, or the one refused.'),
}).describe('An earlier answer on the same field.');
export type EarlierAnswer = z.infer<typeof EarlierAnswer>;

export const ProposedField = z.strictObject({
  ...changedField,
  acceptable: z.boolean().optional().describe(
    'False where accepting releases the claim and the next run writes it. On a `conflict` field only: a `held` field'
    + ' carries `held` instead, and publishing is what applies it.',
  ),
  claim: FieldClaim.nullable().optional()
    .describe('Who claimed the field. Absent where the claim predates the log, or where the gate holds the field.'),
  decidedBefore: z.array(EarlierAnswer).optional()
    .describe('Every earlier answer on this field, newest first, refusals as well as acceptances.'),
}).describe("One of the object's own fields a run proposed, as its card asks about it.");
export type ProposedField = z.infer<typeof ProposedField>;

export const HeldPart = z.strictObject({
  kind: ContentKind,
  item: z.strictObject({ name: z.string().nullable(), ref: z.string().nullable() })
    .describe('The part as the record names it: the name as the run saw it, never rewritten (ADR-0026).'),
  storedName: z.string().nullable().optional()
    .describe("The stored row's name now, where the row was found, since a part corrected since has another."),
  fields: z.array(ChangedField).describe('The held fields of the part.'),
  locationId: z.number().int().nullable().optional(),
  curatedFields: z.array(z.string()).nullable().optional().describe('The fields a curator has claimed on the stored place.'),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  ordinal: z.number().int().nullable().optional(),
  treasureId: z.number().int().nullable().optional(),
  artists: z.array(z.string()).nullable().optional(),
  artistsCurated: z.boolean().nullable().optional(),
  workCuratedFields: z.array(z.string()).nullable().optional().describe('The fields a curator has claimed on the stored work.'),
  venueCount: z.number().int().nullable().optional().describe('How many museums hang the work.'),
  year: z.number().int().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  imageCredit: ImageCredit.nullable().optional(),
  treasureType: z.string().nullable().optional(),
}).describe(
  "One part of an object whose field a gated run held (ADR-0037), with what the stored row adds. The row's fields"
  + ' are null where no offered row answers to the record.',
);
export type HeldPart = z.infer<typeof HeldPart>;

export const CountedWork = z.strictObject({
  name: z.string(),
  type: z.string().nullable(),
  artists: z.array(z.string()),
  artistsCurated: z.boolean(),
  imageUrl: z.string().nullable(),
  imageCredit: ImageCredit.nullable().optional(),
  year: z.number().int().nullable(),
  externalId: z.string().describe("The source's own id for the work: a Wikidata QID for everything stored today."),
}).describe('A famous work the kind\'s rule weighed.');
export type CountedWork = z.infer<typeof CountedWork>;

export const PendingPoint = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  externalRef: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  curatedFields: z.array(z.string()).optional(),
}).describe('An unread point under a row readers already see.');
export type PendingPoint = z.infer<typeof PendingPoint>;

export const PendingWork = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  artists: z.array(z.string()),
  artistsCurated: z.boolean(),
  year: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  iconic: z.boolean(),
  externalId: z.string().optional().describe("The work's own Wikidata id, where the row opens the item from (#806)."),
  treasureType: z.string().nullable().optional(),
  imageCredit: ImageCredit.nullable().optional(),
  curatedFields: z.array(z.string()).nullable().optional(),
  venueCount: z.number().int().nullable().optional(),
}).describe('An unread work under a row readers already see.');
export type PendingWork = z.infer<typeof PendingWork>;

export const WithdrawnPoint = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  externalRef: z.string().nullable(),
  missingSince: timestamp,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  visited: z.boolean().describe('Whether anyone had been there. The visit survives either answer (ADR-0022).'),
  replacedMetres: z.number().nullable().describe(
    'How far away the source now offers this same part, in metres, rounded to two decimals. Null where it offers it'
    + ' nowhere.',
  ),
  curatedFields: z.array(z.string()).optional(),
}).describe('A point the object lost, waiting on its own verdict.');
export type WithdrawnPoint = z.infer<typeof WithdrawnPoint>;

export const AnsweredPoint = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  externalRef: z.string().nullable(),
  missingSince: timestamp.nullable().describe('Null where a later run found the point again and cleared the flag.'),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  sourceMembership: SourceMembership,
  existence: Existence,
  decidedAt: timestamp.nullable(),
  note: z.string().nullable(),
  decidedBy: z.string().nullable().describe(
    "Who last decided, read from the curation log under the log's own scope. Null where the act belongs to a region"
    + ' this reader does not cover, or predates the log.',
  ),
  visited: z.boolean(),
  curatedFields: z.array(z.string()).optional(),
}).describe('A lost point a curator has answered, which no reader sees as a result (#544).');
export type AnsweredPoint = z.infer<typeof AnsweredPoint>;

export const RefusedPoint = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  externalRef: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  curatedFields: z.array(z.string()).optional(),
  refusedAt: timestamp.nullable(),
  refusedBy: z.string().nullable(),
  note: z.string().nullable(),
  missingSince: timestamp.nullable().describe('Set where the source has stopped listing the point since it was turned down.'),
  visited: z.boolean(),
}).describe('A point a curator turned down (#859).');
export type RefusedPoint = z.infer<typeof RefusedPoint>;

export const RefusedWork = z.strictObject({
  id: z.number().int().describe('The treasure id, which the take-back takes.'),
  name: z.string().nullable(),
  artists: z.array(z.string()),
  artistsCurated: z.boolean(),
  year: z.number().int().nullable(),
  externalId: z.string().optional(),
  curatedFields: z.array(z.string()).nullable().optional(),
  refusedAt: timestamp.nullable(),
  refusedBy: z.string().nullable(),
  note: z.string().nullable(),
  missingSince: timestamp.nullable(),
}).describe('A work link a curator turned down (#859).');
export type RefusedWork = z.infer<typeof RefusedWork>;

export const ReviewQueueItem = z.strictObject({
  id: z.number().int(),
  external_id: z.string(),
  name: z.string(),
  kind_id: z.number().int(),
  kind_name: z.string(),
  missing_since: timestamp.nullable(),
  source_membership: SourceMembership,
  existence: Existence,
  kind: z.enum(QUEUE_ITEM_KINDS),
  image_url: z.string().nullable().optional(),
  image_credit: ImageCredit.nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  website_url: z.string().nullable().optional(),
  wikipedia_url: z.string().nullable().optional(),
  region_names: z.array(z.string()).nullable().optional(),
  admission_note: z.string().nullable().optional()
    .describe("The run's own question about a row it could not settle by its rule (ADR-0058)."),
  in_danger: z.boolean().optional(),
  danger_since: z.number().int().nullable().optional().describe('The year the site was listed in danger.'),
  admission_reason: z.string().nullable().optional().describe("Why this kind turned the row down, in the rule's own words."),
  state_decided_at: timestamp.nullable().optional().describe('When a curator answered. Kept-out items only.'),
  state_note: z.string().nullable().optional(),
  proposed: z.array(ProposedField).nullable().describe(
    'The fields a run proposed. Null on every kind that carries no proposal, never absent.',
  ),
  run_completed_at: timestamp.nullable().optional().describe('When the run whose proposal this is finished. Conflicts only.'),
  proposed_parts: z.array(HeldPart).nullable().optional()
    .describe("The held fields of the object's parts. `held` items only, beside `proposed`, which is the object's own."),
  counted_works: z.array(CountedWork).nullable().optional()
    .describe("The famous works the kind's rule weighed, most widely known first, capped at twelve."),
  counted_works_total: z.number().int().nullable().optional().describe('How many works the object holds.'),
  sync_log_id: z.number().int().nullable().optional().describe(
    'The run this card is about. For an `arrival` it is the run that first saw the row and not a pointer to anything'
    + ' held, and null for a row with no first run recorded.',
  ),
  pending_locations: z.number().int().optional(),
  pending_treasures: z.number().int().optional(),
  pending_points: z.array(PendingPoint).optional(),
  pending_works: z.array(PendingWork).optional(),
  curation_state: z.string().optional().describe('Whether anyone has passed the row. `arrival` items only.'),
  offered_locations: z.number().int().optional().describe('How many points the object still offers.'),
  withdrawn_points: z.array(WithdrawnPoint).nullable().optional(),
  answered_points: z.array(AnsweredPoint).nullable().optional(),
  answered_points_total: z.number().int().optional(),
  refused_points: z.array(RefusedPoint).nullable().optional(),
  refused_points_total: z.number().int().optional(),
  refused_works: z.array(RefusedWork).nullable().optional(),
  refused_works_total: z.number().int().optional(),
  takeable: z.boolean().optional().describe('Whether the take-back would be accepted at all. `contents-refused` items only.'),
  object_admission: z.string().nullable().optional(),
  object_curation_state: z.string().nullable().optional(),
}).describe('An object waiting on a curator, or one a curator can take a verdict back from.');
export type ReviewQueueItem = z.infer<typeof ReviewQueueItem>;

export const QueueOrderEntry = z.strictObject({
  kind: QueueKind,
  id: z.number().int(),
  askedAt: timestamp.nullable().describe('When the run that raised this question completed. Null for one still in flight.'),
  runId: z.number().int().nullable(),
  subs: z.array(WaitingSub).describe('The gated sub-kinds a `waiting` row groups. An arrival is always alone.'),
}).describe('One open question, in the order the page draws them (ADR-0051).');
export type QueueOrderEntry = z.infer<typeof QueueOrderEntry>;

const paged = z.strictObject({ offset: z.number().int(), hasMore: z.boolean() });

export const QueueFacets = z.strictObject({
  kind: z.array(z.strictObject({ kind: z.enum([...QUEUE_KINDS, ...WAITING_SUBS]), count: z.number().int() })),
  source: z.array(z.strictObject({ id: z.number().int(), name: z.string(), count: z.number().int() })),
  region: z.array(z.strictObject({
    id: z.number().int().nullable().describe('Null is the unplaced bucket: keys with no region row at all.'),
    name: z.string(),
    worldView: z.string().nullable().describe(
      'The world view this root is a root of, null on the unplaced row. A name does not identify a root on its own:'
      + ' two of them are called Europe.',
    ),
    count: z.number().int(),
  })),
  run: z.array(z.strictObject({
    id: z.number().int(),
    sourceId: z.number().int(),
    completedAt: timestamp.nullable().describe('Null for a run still in flight.'),
    count: z.number().int(),
    setAside: z.boolean().describe('Whether this curator has already hidden the batch.'),
  })).describe(
    'The runs with open questions, counted before the set-aside exclusion, because a hidden batch is exactly the'
    + ' one the chip has to name, or there is no way back to it. The search still narrows this list.',
  ),
  setAside: z.strictObject({ batches: z.number().int() })
    .describe('How many runs this curator has set aside, which is the unit the chip names.'),
}).describe('What each chip would leave, counted over the union under every other filter the curator set.');
export type QueueFacets = z.infer<typeof QueueFacets>;

export const ReviewQueue = z.strictObject({
  missing: z.array(ReviewQueueItem),
  refused: z.array(ReviewQueueItem).describe('Rows a rule turned down and nobody has answered yet.'),
  keptOut: z.array(ReviewQueueItem).describe('Refusals a curator confirmed, carried because no other surface shows them.'),
  conflicts: z.array(ReviewQueueItem),
  arrivals: z.array(ReviewQueueItem),
  held: z.array(ReviewQueueItem),
  contents: z.array(ReviewQueueItem),
  withdrawn: z.array(ReviewQueueItem),
  answeredWithdrawals: z.array(ReviewQueueItem),
  refusedParts: z.array(ReviewQueueItem),
  limit: z.number().int(),
  order: z.array(QueueOrderEntry).describe('The page, in the one order across all seven kinds. The arrays above are a lookup by id.'),
  total: z.number().int(),
  facets: QueueFacets,
  paging: z.strictObject({
    cursor: z.string().nullable(),
    nextCursor: z.string().nullable(),
    keptOut: paged,
    answeredWithdrawals: paged,
    refusedParts: paged,
  }).describe('The one cursor the seven open kinds share, beside the three offsets the answered lists page by.'),
}).describe("A page of the curator's review queue (ADR-0051).");
export type ReviewQueue = z.infer<typeof ReviewQueue>;

export const RunSetAside = z.strictObject({
  syncLogId: z.number().int(),
  setAside: z.boolean().describe('The state the caller asked for, whether or not a row changed.'),
}).describe("A run's batch set aside for this curator, or brought back (ADR-0051 decision 4).");
export type RunSetAside = z.infer<typeof RunSetAside>;

export const ReviewAnswerDid = z.strictObject({
  published: z.number().int().optional().describe('1 where this answer made the object visible to readers.'),
  locations: z.number().int().optional(),
  treasureLinks: z.number().int().optional(),
  treasures: z.number().int().optional(),
  withdrawalsReleased: z.number().int().optional(),
  fields: z.number().int().optional().describe(
    "Held or claimed fields this answer applied, released or refused, the parts' rows counted with the object's.",
  ),
  points: z.number().int().optional().describe('Points answered, for a withdrawn row.'),
  pointsRefused: z.number().int().optional().describe('Points on the same row that refused the answer, for a withdrawn row.'),
}).describe('What one answer did, counted. The notice sums these per kind and answer.');
export type ReviewAnswerDid = z.infer<typeof ReviewAnswerDid>;

export const ReviewAnswerResult = z.strictObject({
  answer: ReviewAnswer,
  answered: z.array(z.strictObject({
    kind: QueueKind, id: z.number().int(), name: z.string(), answer: ReviewAnswer, did: ReviewAnswerDid,
  })),
  refused: z.array(z.strictObject({
    kind: QueueKind, id: z.number().int(), name: z.string(), error: z.string(),
  })).describe('The rows the server would not answer, each with its reason. The batch goes on without them.'),
  outOfScope: z.number().int().describe("Rows outside the curator's scope, counted rather than named."),
  placementFailed: z.array(z.strictObject({
    id: z.number().int(), name: z.string(), worldViews: z.array(PlacementFailure).min(1),
  })).describe('The objects whose answer landed and whose re-placement did not.'),
}).describe('The report of one batch answer (#852).');
export type ReviewAnswerResult = z.infer<typeof ReviewAnswerResult>;
