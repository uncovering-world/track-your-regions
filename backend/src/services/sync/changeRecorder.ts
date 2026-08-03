/**
 * Changeset persistence for sync runs.
 *
 * One row per object a run touched — created, changed, gone, returned, or
 * failed. Rows that passed through unchanged are counted on the log and not
 * written here: a UNESCO run would otherwise store 1247 rows of noise to
 * preserve the few dozen that carry information.
 */

import { pool } from '../../db/index.js';
import type { FieldChange, FieldSignificance } from './changeSet.js';

export interface ChangeRecord {
  syncLogId: number;
  experienceId: number | null;
  externalId: string;
  nameSnapshot: string | null;
  /**
   * `conflict` is a row the source wanted to change and `curated_fields`
   * refused — nothing changed, but the two now disagree, which is a fact a
   * curator has to see.
   */
  changeType: 'created' | 'updated' | 'conflict' | 'missing' | 'returned' | 'failed' | 'filtered';
  changedFields: FieldChange[] | null;
  significance: FieldSignificance | null;
  error: string | null;
}

/** `experience_sync_changes.name_snapshot` is VARCHAR(500). */
const NAME_SNAPSHOT_LIMIT = 500;

/** Postgres caps a statement at 65535 parameters; 500 rows × 8 stays far below. */
export const CHANGE_INSERT_BATCH_SIZE = 500;

const COLUMNS_PER_ROW = 8;

async function insertBatch(batch: ChangeRecord[]): Promise<void> {
  const values: unknown[] = [];
  const tuples = batch.map((record, index) => {
    const base = index * COLUMNS_PER_ROW;
    values.push(
      record.syncLogId,
      record.experienceId,
      record.externalId,
      record.nameSnapshot?.slice(0, NAME_SNAPSHOT_LIMIT) ?? null,
      record.changeType,
      record.changedFields ? JSON.stringify(record.changedFields) : null,
      record.significance,
      record.error,
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8})`;
  });

  await pool.query(
    `INSERT INTO experience_sync_changes
       (sync_log_id, experience_id, external_id, name_snapshot, change_type, changed_fields, significance, error)
     VALUES ${tuples.join(', ')}`,
    values
  );
}

/**
 * Persist the per-object records for a run, in batches.
 */
export async function recordSyncChanges(records: ChangeRecord[]): Promise<void> {
  for (let i = 0; i < records.length; i += CHANGE_INSERT_BATCH_SIZE) {
    await insertBatch(records.slice(i, i + CHANGE_INSERT_BATCH_SIZE));
  }
}
