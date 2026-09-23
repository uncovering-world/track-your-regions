/**
 * One card of the review queue, from the row a query answered to the shape the
 * answer declares (`ReviewQueueItem`, `api/responses/reviewQueue.ts`, ADR-0066).
 *
 * Every query of the queue (`reviewQueueController.ts`, `reviewQueueContents.ts`,
 * `reviewQueueRefusedParts.ts`) passes its rows through here, so what a card
 * carries is decided in one place. A column a query selects reaches the curator
 * only once this names it, and a key a query does not select is written as
 * `undefined`, which JSON drops.
 */

import type {
  ChangedField, CountedWork, AnsweredPoint, HeldPart, PendingPoint, PendingWork, ProposedField,
  RefusedPoint, RefusedWork, ReviewQueueItem, WithdrawnPoint,
} from '../../api/responses/reviewQueue.js';
import type { ImageCredit } from '../../api/responses/experiences.js';
import type { CheckValue } from '../../db/schema.generated.js';
import type { QueueItemKind } from './reviewQueueVocabulary.js';

/**
 * A queue row as the driver hands it over, after `withDangerFields`: the
 * columns the queries select, each optional because each query selects its
 * own. Timestamps are `Date`s. The JSON a query builds arrives parsed, in the
 * shape its `jsonb_build_object` gives it, which the answer's parse holds.
 */
export interface QueueRow {
  id: number;
  external_id: string;
  name: string;
  kind_id: number;
  kind_name: string;
  missing_since: Date | null;
  source_membership: CheckValue<'experiences', 'source_membership'>;
  existence: CheckValue<'experiences', 'existence'>;
  kind: QueueItemKind;
  proposed: StoredProposal[] | null;
  image_url?: string | null;
  image_credit?: ImageCredit | null;
  latitude?: number | null;
  longitude?: number | null;
  website_url?: string | null;
  wikipedia_url?: string | null;
  region_names?: string[] | null;
  admission_note?: string | null;
  in_danger?: boolean;
  danger_since?: number | null;
  admission_reason?: string | null;
  state_decided_at?: Date | null;
  state_note?: string | null;
  run_completed_at?: Date | null;
  proposed_parts?: StoredPart[] | null;
  counted_works?: CountedWork[] | null;
  counted_works_total?: number | null;
  sync_log_id?: number | null;
  pending_locations?: number;
  pending_treasures?: number;
  pending_points?: PendingPoint[];
  pending_works?: PendingWork[];
  curation_state?: string;
  offered_locations?: number;
  withdrawn_points?: WithdrawnPoint[] | null;
  answered_points?: AnsweredPoint[] | null;
  answered_points_total?: number;
  refused_points?: RefusedPoint[] | null;
  refused_points_total?: number;
  refused_works?: RefusedWork[] | null;
  refused_works_total?: number;
  takeable?: boolean;
  object_admission?: string | null;
  object_curation_state?: string | null;
}

/**
 * One field of a stored changeset, with whatever else the record carries. Runs
 * before 2026-08-31 also stored the writer's own `protectedByClaim`, which
 * `changedFieldOf` leaves behind.
 */
export type StoredProposal = ProposedField & Record<string, unknown>;

/** A held part as its statement builds it, the part's record included whole. */
type StoredPart = Omit<HeldPart, 'fields'> & { fields: StoredProposal[] };

/** A stored field change, key by key, so a key the writer once leaked into the record stays there. */
export function changedFieldOf(f: StoredProposal): ChangedField {
  return {
    field: f.field,
    old: f.old,
    new: f.new,
    significance: f.significance,
    curatedConflict: f.curatedConflict,
    held: f.held,
  };
}

/** A proposed field of the object, with what the queue added to the stored record. */
function proposedFieldOf(f: StoredProposal): ProposedField {
  return {
    ...changedFieldOf(f),
    acceptable: f.acceptable,
    claim: f.claim,
    decidedBefore: f.decidedBefore,
  };
}

/** A held part, key by key: its `item` is the stored record's, and its fields the changeset's. */
function heldPartOf(part: StoredPart): HeldPart {
  return {
    kind: part.kind,
    item: { name: part.item.name, ref: part.item.ref },
    storedName: part.storedName,
    fields: part.fields.map(changedFieldOf),
    locationId: part.locationId,
    curatedFields: part.curatedFields,
    latitude: part.latitude,
    longitude: part.longitude,
    ordinal: part.ordinal,
    treasureId: part.treasureId,
    artists: part.artists,
    artistsCurated: part.artistsCurated,
    workCuratedFields: part.workCuratedFields,
    venueCount: part.venueCount,
    year: part.year,
    imageUrl: part.imageUrl,
    imageCredit: part.imageCredit,
    treasureType: part.treasureType,
  };
}

function iso(value: Date | null | undefined): string | null | undefined {
  return value == null ? value : value.toISOString();
}

export function queueItemOf(row: QueueRow): ReviewQueueItem {
  return {
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    kind_id: row.kind_id,
    kind_name: row.kind_name,
    missing_since: iso(row.missing_since) ?? null,
    source_membership: row.source_membership,
    existence: row.existence,
    kind: row.kind,
    image_url: row.image_url,
    image_credit: row.image_credit,
    latitude: row.latitude,
    longitude: row.longitude,
    website_url: row.website_url,
    wikipedia_url: row.wikipedia_url,
    region_names: row.region_names,
    admission_note: row.admission_note,
    in_danger: row.in_danger,
    danger_since: row.danger_since,
    admission_reason: row.admission_reason,
    state_decided_at: iso(row.state_decided_at),
    state_note: row.state_note,
    proposed: row.proposed?.map(proposedFieldOf) ?? null,
    run_completed_at: iso(row.run_completed_at),
    proposed_parts: row.proposed_parts?.map(heldPartOf),
    counted_works: row.counted_works,
    counted_works_total: row.counted_works_total,
    sync_log_id: row.sync_log_id,
    pending_locations: row.pending_locations,
    pending_treasures: row.pending_treasures,
    pending_points: row.pending_points,
    pending_works: row.pending_works,
    curation_state: row.curation_state,
    offered_locations: row.offered_locations,
    withdrawn_points: row.withdrawn_points,
    answered_points: row.answered_points,
    answered_points_total: row.answered_points_total,
    refused_points: row.refused_points,
    refused_points_total: row.refused_points_total,
    refused_works: row.refused_works,
    refused_works_total: row.refused_works_total,
    takeable: row.takeable,
    object_admission: row.object_admission,
    object_curation_state: row.object_curation_state,
  };
}
