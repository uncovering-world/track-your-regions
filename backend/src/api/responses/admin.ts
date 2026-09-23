/**
 * What the admin panel's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/admin/index.ts` calls, declared once. That is
 * the sync screens: the sources and what each is holding, a run started,
 * followed and cancelled, its log and what it did object by object, what a
 * source keeps between runs, its curation gate and fame line, and a source's
 * backlog released. Then placing experiences into a world view's regions and
 * what it placed, and the curator directory: its curators and their
 * assignments, what a curator did, and the people an admin can make one.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { CURATION_LOG_ACTIONS } from '@tyr/shared/curationLog';
import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { placementTogether } from '../placementTogether.js';
import { CuratorScope, UserRole } from './auth.js';
import { PlacementFailure } from './curation.js';
import { ChangedField } from './reviewQueue.js';

/** A timestamp as the wire carries it: the handler converts the driver's `Date`. */
const timestamp = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// The sources and their runs
// ---------------------------------------------------------------------------

export const WaitingCounts = z.strictObject({
  arrivals: z.number().int().describe('Rows nobody has read yet.'),
  held: z.number().int().describe('Visible rows holding a change the gate kept out, answered per card rather than in a batch.'),
  contents: z.number().int().describe('Visible rows holding unread points or works.'),
}).describe('What one source is holding, in the three kinds the review queue asks about.');
export type WaitingCounts = z.infer<typeof WaitingCounts>;

const sitelinks = z.number().int().nullable();

export const ExperienceSource = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  requires_curation: z.boolean().describe('Whether a run holds its new and changed content for review (ADR-0025).'),
  last_sync_at: timestamp.nullable(),
  last_sync_status: z.string().nullable(),
  display_priority: z.number().int(),
  created_at: timestamp.nullable(),
  enter_sitelinks: sitelinks.describe('Wikipedia languages an item needs to enter this kind; null for a source with no line.'),
  stay_sitelinks: sitelinks.describe('Wikipedia languages an item already in this kind must keep, to stay.'),
  find_enter_sitelinks: sitelinks
    .describe('The finds line, for a source that admits famous finds beside its sites (ADR-0058 decision 5); null for a source with one door.'),
  find_stay_sitelinks: sitelinks,
  waiting: WaitingCounts.nullable()
    .describe('Three zeros for a source holding nothing, and null when the server could not count, so a panel never shows a count nothing checked.'),
  caches: z.boolean().describe('Whether this source keeps answers between runs, which decides whether "Sync without cache" is offered.'),
  repairsPictures: z.boolean().describe('Whether this source\'s pictures can be repaired from the panel (ADR-0043).'),
}).describe('One active source, with its gate, its line and what it is holding.');
export type ExperienceSource = z.infer<typeof ExperienceSource>;

export const ExperienceSources = z.array(ExperienceSource).describe('The active sources, in display order.');
export type ExperienceSources = z.infer<typeof ExperienceSources>;

export const SyncStarted = z.strictObject({
  started: z.literal(true),
  sourceId: z.number().int(),
  sourceName: z.string(),
  dryRun: z.boolean().describe('A preview: the changeset is recorded, experiences are not written.'),
  refreshCache: z.boolean().describe('Answers the source gave before are not used, so the collection runs at full length.'),
  message: z.string(),
}).describe('A run of one source, started in the background.');
export type SyncStarted = z.infer<typeof SyncStarted>;

export const PictureRepairStarted = z.strictObject({
  started: z.literal(true),
  message: z.string(),
}).describe('A repair of one source\'s pictures, started in the background and followed through the sync status.');
export type PictureRepairStarted = z.infer<typeof PictureRepairStarted>;

export const SyncStatus = z.strictObject({
  running: z.boolean(),
  cancellable: z.boolean().optional().describe('Whether a Cancel press would be acted on: the server\'s rule, not a copy.'),
  kind: z.enum(['sync', 'repair']).optional().describe('A sync, or a picture repair started from the same card.'),
  status: z.enum(['fetching', 'processing', 'assigning', 'complete', 'partial', 'failed', 'cancelled']).optional()
    .describe('`partial` is terminal like `complete`: the run finished and placing what it moved did not.'),
  statusMessage: z.string().optional(),
  progress: z.number().int().optional(),
  total: z.number().int().optional(),
  percent: z.number().int().optional(),
  created: z.number().int().optional(),
  updated: z.number().int().optional(),
  unchanged: z.number().int().optional(),
  missing: z.number().int().optional(),
  curatedConflicts: z.number().int().optional(),
  held: z.number().int().optional().describe('Rows the gate held whole so far, inside `unchanged`.'),
  filtered: z.number().int().optional(),
  errors: z.number().int().optional(),
  currentItem: z.string().optional(),
  logId: z.number().int().nullable().optional(),
  dryRun: z.boolean().optional(),
  lastSyncAt: timestamp.nullable().optional()
    .describe('Sent instead of the run\'s figures when no run is known since the server started: the source\'s last run as the database holds it.'),
  lastSyncStatus: z.string().nullable().optional(),
}).describe('A source\'s run as it stands: the figures of the run the server knows of, or the last run the database recorded.');
export type SyncStatus = z.infer<typeof SyncStatus>;

export const SyncCancelled = z.strictObject({
  cancelled: z.boolean().describe('False when no run was going that a stop could reach.'),
}).describe('A stop asked of a source\'s run.');
export type SyncCancelled = z.infer<typeof SyncCancelled>;

export const SourcesReordered = z.strictObject({
  success: z.literal(true),
  order: z.array(z.number().int()).describe('The source ids, first shown first.'),
}).describe('The sources\' display order, written.');
export type SourcesReordered = z.infer<typeof SourcesReordered>;

// ---------------------------------------------------------------------------
// What a source keeps between runs
// ---------------------------------------------------------------------------

export const WikidataCacheKind = z.strictObject({
  kind: z.string(),
  entries: z.number().int(),
  rows: z.number().int(),
  expired: z.number().int().describe('Answers past their expiry, which the next run fetches again.'),
  oldestFetchedAt: timestamp.nullable().describe('The oldest answer of this kind, which is what "how stale is this" means.'),
  nextExpiresAt: timestamp.nullable().describe('When the soonest answer stops being used.'),
  bytes: z.number().int(),
  labels: z.array(z.string()).describe('A few of the questions themselves, newest first, so a kind is not just a word.'),
  ttlMs: z.number().int().describe('How long an answer of this kind stays fresh, in force now.'),
  ttlSource: z.enum(['default', 'set by an admin']),
}).describe('One kind of question whose answers a source keeps.');
export type WikidataCacheKind = z.infer<typeof WikidataCacheKind>;

export const WikidataCache = z.strictObject({
  kinds: z.array(WikidataCacheKind).describe('Every kind the source asks, and any it kept before, by name.'),
}).describe('What a source keeps between runs.');
export type WikidataCache = z.infer<typeof WikidataCache>;

export const WikidataCacheCleared = z.strictObject({
  removed: z.number().int().describe('Answers dropped.'),
  kind: z.string().nullable().describe('The kind cleared, or null for all of them.'),
}).describe('Kept answers dropped, so the next run asks the source again.');
export type WikidataCacheCleared = z.infer<typeof WikidataCacheCleared>;

export const WikidataCacheTtlSet = z.strictObject({
  kind: z.string(),
  hours: z.number(),
  restamped: z.number().int().describe('Kept answers re-dated from their own fetch time, which says whether the next run re-fetches five things or five hundred.'),
}).describe('How long one kind stays fresh, changed.');
export type WikidataCacheTtlSet = z.infer<typeof WikidataCacheTtlSet>;

// ---------------------------------------------------------------------------
// A source's gate and line
// ---------------------------------------------------------------------------

export const CurationGateSet = z.strictObject({
  sourceId: z.number().int(),
  name: z.string(),
  requiresCuration: z.boolean().describe('The gate as it is now stored, which is what a switch that lost a race should show.'),
}).describe('A source\'s curation gate, switched.');
export type CurationGateSet = z.infer<typeof CurationGateSet>;

export const SourceLineSet = z.strictObject({
  sourceId: z.number().int(),
  name: z.string(),
  enterSitelinks: z.number().int(),
  staySitelinks: z.number().int(),
  findEnterSitelinks: z.number().int().optional().describe('Sent only when the request wrote the finds pair.'),
  findStaySitelinks: z.number().int().optional(),
}).describe('The fame line a source\'s next run reads, written: the keys the request wrote.');
export type SourceLineSet = z.infer<typeof SourceLineSet>;

export const PublishedWaitingObject = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  locationsPublished: z.number().int(),
  treasureLinksPublished: z.number().int()
    .describe('Works passed as being here. With `treasuresPublished`, because a work passed in one venue and unread in another moves the link and not the row.'),
  treasuresPublished: z.number().int(),
  withdrawalsReleased: z.number().int().describe('Points the source had replaced whose old pin this took off the map.'),
  placementFailed: z.literal(true).optional()
    .describe('The publication landed and re-placing the object into its regions did not.'),
  placementFailedWorldViews: z.array(PlacementFailure).min(1).optional()
    .describe('Where the regions are stale now. Present exactly when `placementFailed` is, and never empty.'),
}).superRefine(placementTogether).describe('One object a source\'s backlog released, and what came with it.');
export type PublishedWaitingObject = z.infer<typeof PublishedWaitingObject>;

export const RefusedWaitingObject = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  error: z.string().describe('Why it was not published, in a sentence for the curator.'),
}).describe('One object the release did not publish.');
export type RefusedWaitingObject = z.infer<typeof RefusedWaitingObject>;

export const PublishWaitingResult = z.strictObject({
  sourceId: z.number().int(),
  published: z.array(PublishedWaitingObject),
  refused: z.array(RefusedWaitingObject),
  outOfScope: z.number().int().describe('Objects waiting outside the caller\'s scope, left as they were.'),
  heldLeftForReview: z.number().int().nullable()
    .describe('Held changes the caller\'s scope still has, left on purpose for their own cards; null when they could not be counted.'),
}).describe('A source\'s backlog released, object by object, except the changes it is holding.');
export type PublishWaitingResult = z.infer<typeof PublishWaitingResult>;

// ---------------------------------------------------------------------------
// A run's log and what it did
// ---------------------------------------------------------------------------

const count = z.number().int();

export const SyncLog = z.strictObject({
  id: z.number().int(),
  source_id: z.number().int(),
  source_name: z.string(),
  started_at: timestamp.nullable(),
  completed_at: timestamp.nullable(),
  status: z.string().nullable(),
  total_fetched: count,
  total_created: count,
  total_updated: count.describe('Rows whose fields changed. Runs before change provenance counted every row the upsert touched.'),
  total_unchanged: count,
  total_missing: count,
  total_curated_conflicts: count,
  total_held: count.describe('Visible rows whose every proposed change the gate kept out, a subset of `total_unchanged` (#523).'),
  total_filtered: count,
  total_errors: count,
  is_dry_run: z.boolean(),
  detection_skipped_reason: z.string().nullable(),
  withdrawal_skipped_reason: z.string().nullable()
    .describe('Why the run marked none of the works its museums stopped holding: the works coverage floor refused it (ADR-0044).'),
  triggered_by: z.number().int().nullable(),
  triggered_by_name: z.string().nullable(),
  has_changeset: z.boolean().describe('False on runs that predate change provenance, whose counters mean something else.'),
  changeset_lost: z.boolean().describe('The changeset insert threw, so the per-object record is missing or short.'),
}).describe('One run of a source.');
export type SyncLog = z.infer<typeof SyncLog>;

export const SyncLogs = z.strictObject({
  logs: z.array(SyncLog).describe('Newest first.'),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
}).describe('A page of runs.');
export type SyncLogs = z.infer<typeof SyncLogs>;

export const SyncErrorDetail = z.strictObject({
  externalId: z.string().describe('The object the error is about, or a marker such as `changeset` for the run itself.'),
  error: z.string().optional(),
}).describe('One error a run recorded.');
export type SyncErrorDetail = z.infer<typeof SyncErrorDetail>;

export const SyncLogDetail = SyncLog.extend({
  error_details: z.array(SyncErrorDetail).nullable(),
}).describe('One run of a source, with the errors it recorded.');
export type SyncLogDetail = z.infer<typeof SyncLogDetail>;

export const SyncContentItem = z.strictObject({
  name: z.string().nullable(),
  ref: z.string().nullable(),
}).describe('One thing an object holds, as the record names it: never a database id (ADR-0026).');
export type SyncContentItem = z.infer<typeof SyncContentItem>;

export const SyncContentsDelta = z.strictObject({
  added: z.array(SyncContentItem),
  withdrawn: z.array(SyncContentItem),
  returned: z.array(SyncContentItem),
  changed: z.array(z.strictObject({
    item: SyncContentItem,
    fields: z.array(ChangedField),
  })).optional().describe('Items the run kept and rewrote, such as a point that moved. Absent on older records.'),
}).describe('What a run did to one kind of an object\'s contents.');
export type SyncContentsDelta = z.infer<typeof SyncContentsDelta>;

export const SyncChange = z.strictObject({
  id: z.string().describe('A bigint, sent as a string.'),
  experience_id: z.number().int().nullable(),
  external_id: z.string(),
  name_snapshot: z.string().nullable(),
  change_type: z.enum(CHECK_VALUES.experience_sync_changes.change_type),
  changed_fields: z.array(ChangedField).nullable(),
  contents: z.strictObject({
    locations: SyncContentsDelta.optional(),
    treasures: SyncContentsDelta.optional(),
  }).nullable().describe('What the run did to what the object holds (ADR-0026), or null where it moved none.'),
  significance: z.enum(CHECK_VALUES.experience_sync_changes.significance).nullable(),
  error: z.string().nullable(),
}).describe('What one run did to one object.');
export type SyncChange = z.infer<typeof SyncChange>;

export const SyncChanges = z.strictObject({
  changes: z.array(SyncChange).describe('The significant first.'),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
}).describe('A page of what a run did, object by object. Rows that came through unchanged are only a count on the log.');
export type SyncChanges = z.infer<typeof SyncChanges>;

// ---------------------------------------------------------------------------
// Placing experiences into regions
// ---------------------------------------------------------------------------

export const AssignmentStarted = z.strictObject({
  started: z.literal(true),
  worldViewId: z.number().int(),
  worldViewName: z.string(),
  sourceId: z.number().int().nullable().describe('The one source placed, or null for every source.'),
  message: z.string(),
}).describe('A placement of experiences into a world view\'s regions, started in the background.');
export type AssignmentStarted = z.infer<typeof AssignmentStarted>;

export const AssignmentStatus = z.strictObject({
  running: z.boolean(),
  status: z.enum(['assigning', 'propagating', 'denormalizing', 'complete', 'failed', 'cancelled']).optional()
    .describe('The step: each point placed in its leaf regions, then carried up to their ancestors, then an experience\'s regions written from its points.'),
  statusMessage: z.string().optional(),
  directAssignments: z.number().int().optional().describe('Points placed in the regions that contain them.'),
  ancestorAssignments: z.number().int().optional().describe('Placements carried up to those regions\' ancestors.'),
  totalAssignments: z.number().int().optional(),
  errors: z.number().int().optional(),
}).describe('A world view\'s placement as it stands. Only `running` is sent while no run is known since the server started.');
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

export const AssignmentCancelled = z.strictObject({
  cancelled: z.boolean().describe('False when no placement was running to stop.'),
}).describe('A stop asked of a world view\'s placement.');
export type AssignmentCancelled = z.infer<typeof AssignmentCancelled>;

export const PlacementCount = z.strictObject({
  regionId: z.number().int(),
  regionName: z.string(),
  count: z.number().int(),
}).describe('How many experiences are placed in one region.');
export type PlacementCount = z.infer<typeof PlacementCount>;

export const PlacementCounts = z.array(PlacementCount)
  .describe('Every region of the world view holding at least one experience, most first.');
export type PlacementCounts = z.infer<typeof PlacementCounts>;

// ---------------------------------------------------------------------------
// The curator directory
// ---------------------------------------------------------------------------

export const CuratorInfo = z.strictObject({
  user_id: z.number().int(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: UserRole,
  avatar_url: z.string().nullable(),
  scopes: z.array(CuratorScope).describe('Newest first. An admin with none curates everything by role.'),
}).describe('One person who curates: every admin, and every curator with an assignment.');
export type CuratorInfo = z.infer<typeof CuratorInfo>;

export const Curators = z.array(CuratorInfo).describe('Everyone who curates, by display name.');
export type Curators = z.infer<typeof Curators>;

export const CuratorAssignmentCreated = z.strictObject({
  id: z.number().int(),
  userId: z.number().int(),
  scopeType: z.enum(CHECK_VALUES.curator_assignments.scope_type),
  regionId: z.number().int().nullable(),
  sourceId: z.number().int().nullable(),
  assignedAt: timestamp.nullable(),
  rolePromoted: z.boolean().describe('The person was a `user`, and is a `curator` now.'),
}).describe('A curator assignment granted.');
export type CuratorAssignmentCreated = z.infer<typeof CuratorAssignmentCreated>;

export const CuratorAssignmentRevoked = z.strictObject({
  success: z.literal(true),
  assignmentId: z.number().int(),
  userId: z.number().int(),
  remainingAssignments: z.number().int(),
  roleReverted: z.boolean().describe('The last assignment went, and the curator is a `user` again.'),
}).describe('A curator assignment taken back.');
export type CuratorAssignmentRevoked = z.infer<typeof CuratorAssignmentRevoked>;

export const CuratorActivityEntry = z.strictObject({
  id: z.number().int(),
  action: z.enum(CURATION_LOG_ACTIONS),
  created_at: timestamp.nullable(),
  details: z.record(z.string(), z.unknown()).nullable()
    .describe('What the act changed, in the shape its action writes.'),
  experience_id: z.number().int(),
  experience_name: z.string(),
  region_id: z.number().int().nullable(),
  region_name: z.string().nullable(),
}).describe('One act of a curator\'s, on one experience.');
export type CuratorActivityEntry = z.infer<typeof CuratorActivityEntry>;

export const CuratorActivity = z.strictObject({
  activity: z.array(CuratorActivityEntry).describe('Newest first.'),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
}).describe('A page of what one curator did.');
export type CuratorActivity = z.infer<typeof CuratorActivity>;

export const UserSearchResult = z.strictObject({
  id: z.number().int(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: UserRole,
}).describe('One account whose name or email matched.');
export type UserSearchResult = z.infer<typeof UserSearchResult>;

export const UserSearchResults = z.array(UserSearchResult)
  .describe('Up to twenty accounts, by display name.');
export type UserSearchResults = z.infer<typeof UserSearchResults>;
