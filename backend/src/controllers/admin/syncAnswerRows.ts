/**
 * The sync screens' rows, from what their statements select to the answers
 * `api/responses/admin.ts` declares (ADR-0066): key by key, timestamps as the
 * ISO strings the wire carries, and the JSON a run stored (its errors, a
 * changeset's fields and contents) read out one key at a time, so a key a
 * writer once added stays in the record and out of the answer.
 */

import type {
  ExperienceSource,
  SyncChange,
  SyncContentItem,
  SyncContentsDelta,
  SyncErrorDetail,
  SyncLog,
  SyncLogDetail,
  WaitingCounts,
} from '../../api/responses/admin.js';
import type {
  CheckValue,
  ExperienceSourcesRow,
  ExperienceSyncChangesRow,
  ExperienceSyncLogsRow,
  UsersRow,
} from '../../db/schema.generated.js';
import { changedFieldOf, type StoredProposal } from '../experience/reviewQueueItem.js';

function isoOf(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** A source as `getSources` selects it, its lines read out of `api_config`. */
export type SourceRow = Pick<ExperienceSourcesRow,
  'id' | 'name' | 'description' | 'is_active' | 'requires_curation' | 'last_sync_at'
  | 'last_sync_status' | 'display_priority' | 'created_at'> & {
  enter_sitelinks: number | null;
  stay_sitelinks: number | null;
  find_enter_sitelinks: number | null;
  find_stay_sitelinks: number | null;
};

export function experienceSourceOf(
  row: SourceRow,
  extra: { waiting: WaitingCounts | null; caches: boolean; repairsPictures: boolean },
): ExperienceSource {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    is_active: row.is_active === true,
    requires_curation: row.requires_curation,
    last_sync_at: isoOf(row.last_sync_at),
    last_sync_status: row.last_sync_status as CheckValue<'experience_sources', 'last_sync_status'> | null,
    display_priority: row.display_priority,
    created_at: isoOf(row.created_at),
    enter_sitelinks: row.enter_sitelinks,
    stay_sitelinks: row.stay_sitelinks,
    find_enter_sitelinks: row.find_enter_sitelinks,
    find_stay_sitelinks: row.find_stay_sitelinks,
    waiting: extra.waiting,
    caches: extra.caches,
    repairsPictures: extra.repairsPictures,
  };
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/** A run as the log reads select it (`SYNC_LOG_COLUMNS_SQL` in `syncController.ts`). */
export type SyncLogRow = Pick<ExperienceSyncLogsRow,
  'id' | 'source_id' | 'started_at' | 'completed_at' | 'status' | 'is_dry_run' | 'detection_skipped_reason'
  | 'withdrawal_skipped_reason' | 'triggered_by'> & {
  /** Read through `COALESCE(…, 0)`: nullable columns that no writer leaves null. */
  total_fetched: number;
  total_created: number;
  total_updated: number;
  total_unchanged: number;
  total_missing: number;
  total_curated_conflicts: number;
  total_held: number;
  total_filtered: number;
  total_errors: number;
  source_name: string;
  triggered_by_name: UsersRow['display_name'];
  has_changeset: boolean;
  changeset_lost: boolean;
};

export function syncLogOf(row: SyncLogRow): SyncLog {
  return {
    id: row.id,
    source_id: row.source_id,
    source_name: row.source_name,
    started_at: isoOf(row.started_at),
    completed_at: isoOf(row.completed_at),
    // The CHECK is what makes the stored text one of the declared statuses.
    status: row.status as CheckValue<'experience_sync_logs', 'status'>,
    total_fetched: row.total_fetched,
    total_created: row.total_created,
    total_updated: row.total_updated,
    total_unchanged: row.total_unchanged,
    total_missing: row.total_missing,
    total_curated_conflicts: row.total_curated_conflicts,
    total_held: row.total_held,
    total_filtered: row.total_filtered,
    total_errors: row.total_errors,
    is_dry_run: row.is_dry_run,
    detection_skipped_reason: row.detection_skipped_reason,
    withdrawal_skipped_reason: row.withdrawal_skipped_reason,
    triggered_by: row.triggered_by,
    triggered_by_name: row.triggered_by_name,
    has_changeset: row.has_changeset,
    changeset_lost: row.changeset_lost,
  };
}

/** An entry of `error_details`: its object's id and its message, and a marker's id with none. */
function errorDetailOf(entry: unknown): SyncErrorDetail {
  const record = isRecord(entry) ? entry : {};
  return {
    externalId: typeof record.externalId === 'string' ? record.externalId : '',
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

export function syncLogDetailOf(row: SyncLogRow & Pick<ExperienceSyncLogsRow, 'error_details'>): SyncLogDetail {
  return {
    ...syncLogOf(row),
    error_details: Array.isArray(row.error_details) ? row.error_details.map(errorDetailOf) : null,
  };
}

// ---------------------------------------------------------------------------
// What a run did, object by object
// ---------------------------------------------------------------------------

export type SyncChangeRow = Pick<ExperienceSyncChangesRow,
  'id' | 'experience_id' | 'external_id' | 'name_snapshot' | 'changed_fields' | 'contents' | 'error'> & {
  change_type: SyncChange['change_type'];
  significance: SyncChange['significance'];
};

function contentItemOf(item: unknown): SyncContentItem {
  const record = isRecord(item) ? item : {};
  return {
    name: typeof record.name === 'string' ? record.name : null,
    ref: typeof record.ref === 'string' ? record.ref : null,
  };
}

function itemsOf(value: unknown): SyncContentItem[] {
  return Array.isArray(value) ? value.map(contentItemOf) : [];
}

function fieldsOf(value: unknown): StoredProposal[] {
  return Array.isArray(value) ? (value as StoredProposal[]) : [];
}

function contentsDeltaOf(value: unknown): SyncContentsDelta | undefined {
  if (!isRecord(value)) return undefined;
  return {
    added: itemsOf(value.added),
    withdrawn: itemsOf(value.withdrawn),
    returned: itemsOf(value.returned),
    ...(Array.isArray(value.changed) ? {
      changed: value.changed.filter(isRecord).map(change => ({
        item: contentItemOf(change.item),
        fields: fieldsOf(change.fields).map(changedFieldOf),
      })),
    } : {}),
  };
}

function contentsOf(value: unknown): SyncChange['contents'] {
  if (!isRecord(value)) return null;
  const locations = contentsDeltaOf(value.locations);
  const treasures = contentsDeltaOf(value.treasures);
  return {
    ...(locations ? { locations } : {}),
    ...(treasures ? { treasures } : {}),
  };
}

export function syncChangeOf(row: SyncChangeRow): SyncChange {
  return {
    id: row.id,
    experience_id: row.experience_id,
    external_id: row.external_id,
    name_snapshot: row.name_snapshot,
    change_type: row.change_type,
    changed_fields: Array.isArray(row.changed_fields) ? fieldsOf(row.changed_fields).map(changedFieldOf) : null,
    contents: contentsOf(row.contents),
    significance: row.significance,
    error: row.error,
  };
}
