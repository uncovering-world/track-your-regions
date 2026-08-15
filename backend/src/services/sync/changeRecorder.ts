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
import type { ContentsByKind } from './types.js';

export interface ChangeRecord {
  syncLogId: number;
  experienceId: number | null;
  externalId: string;
  nameSnapshot: string | null;
  /**
   * The two words for a row the source wanted to change and the run refused:
   * nothing changed, but the two now disagree, which is a fact a curator has to
   * see. `conflict` is a `curated_fields` claim — the stored value won on
   * purpose, nothing is waiting. `held` is the category's gate keeping a write
   * out of a row a reader can already see — nobody has looked yet, and a verdict
   * is waiting (#519). Reporting a held row as `updated` told a curator the
   * proposal was already live.
   *
   * `contents` is the third word for an untouched row, and it is about the object
   * rather than about a refusal: every field came through and what the object
   * *holds* moved (ADR-0026). It exists because the alternative was the value
   * `conflict`, which would have reported a disagreement with a curator that never
   * happened — and the admin report's `?type=conflict` filter would have handed it
   * back as one.
   */
  changeType: 'created' | 'updated' | 'conflict' | 'held' | 'contents' | 'missing' | 'returned' | 'failed' | 'filtered';
  changedFields: FieldChange[] | null;
  /**
   * What the run did to the object's contents, by kind, or `null` where it moved
   * none (ADR-0026). Independent of `changedFields`: a run can rewrite a
   * description and drop a point in the same pass.
   */
  contents: ContentsByKind | null;
  significance: FieldSignificance | null;
  error: string | null;
}

/** `experience_sync_changes.name_snapshot` is VARCHAR(500). */
const NAME_SNAPSHOT_LIMIT = 500;

/** Postgres caps a statement at 65535 parameters; 500 rows × 9 stays far below. */
export const CHANGE_INSERT_BATCH_SIZE = 500;

const COLUMNS_PER_ROW = 9;

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
      // `null` rather than `JSON.stringify(null)`, which is the string 'null' and
      // which `::jsonb` stores as a jsonb null — a value `IS NULL` does not find
      // and a reader cannot tell from a recorded delta.
      record.contents ? JSON.stringify(record.contents) : null,
      record.significance,
      record.error,
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}::jsonb, $${base + 8}, $${base + 9})`;
  });

  await pool.query(
    `INSERT INTO experience_sync_changes
       (sync_log_id, experience_id, external_id, name_snapshot, change_type, changed_fields, contents, significance, error)
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
