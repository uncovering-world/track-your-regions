/**
 * The writes to `experience_conflict_decisions` — a curator's standing refusal
 * of the value a run proposed for a field the curator had claimed — under the
 * object's lock (ADR-0077 decision 4, #1148).
 *
 * The table's writers are a closed list the backend lint names
 * (`CONFLICT_DECISION_WRITE_RULES`): this module alone. Both answers to a
 * conflict meet here, since they are the two ends of one record: refusing
 * writes the answer (`declineSourceController.ts`), accepting deletes it with
 * the claim it was given about (`acceptSourceController.ts`). Each write takes
 * the `LockedExperience` the answering handler holds, so a refusal is always
 * recorded against a claim read under the same lock.
 *
 * Whether to write — the proposal re-read, the claim still held, the run the
 * curator saw — stays with the handler that decided it; the readers of the
 * table (`reviewQueueConflicts.ts`, `reviewQueueKeys.ts`) are not writers and
 * stay where they are.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { tidyNameValue } from './heldDecisions.js';

/** One refused field and the value the run proposed for it. */
export interface ConflictRefusal {
  field: string;
  proposed: unknown;
}

/**
 * Record the curator's refusal of each field, one row per field, replaced: this
 * is the standing answer, so a curator who refuses twice leaves one record and
 * not a pile. The history of who answered when is the curation log's, which the
 * caller writes in the same transaction. A name-carrying value is recorded as
 * the catalogue stores a name (`tidyNameValue`, #835): the queue matches the
 * refusal to the record by value, and every run records the tidied form.
 */
export async function recordConflictRefusals(
  client: PoolClient,
  lock: LockedExperience,
  userId: number,
  refusals: readonly ConflictRefusal[],
): Promise<void> {
  for (const p of refusals) {
    await client.query(`
        INSERT INTO experience_conflict_decisions (experience_id, field, declined, decided_by)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (experience_id, field)
        DO UPDATE SET declined = EXCLUDED.declined,
                      decided_by = EXCLUDED.decided_by,
                      decided_at = NOW()
      `, [lock.id, p.field, JSON.stringify(tidyNameValue(p.field, p.proposed ?? null)), userId]);
  }
}

/**
 * Drop any standing refusal of these fields with the claim it belonged to. A
 * refusal answers "the source may not have this field *while I hold it*", and
 * accepting hands the field back — so leaving the row behind would silence the
 * field the day someone claims it again, with an answer given about a claim
 * that no longer exists.
 */
export async function releaseConflictRefusals(
  client: PoolClient,
  lock: LockedExperience,
  fields: readonly string[],
): Promise<void> {
  await client.query(
    `DELETE FROM experience_conflict_decisions
        WHERE experience_id = $1 AND field = ANY($2::text[])`,
    [lock.id, fields],
  );
}

/**
 * Move a place's refusals of a source's value to another place on a merge, or
 * the ones a merge moved back on its undo (ADR-0086 decision 4). Where the
 * survivor already holds one for the field, the survivor's stands.
 */
export async function moveConflictDecisions(
  client: PoolClient,
  from: LockedExperience,
  to: LockedExperience,
  only?: number[],
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE experience_conflict_decisions f SET experience_id = $2
      WHERE f.experience_id = $1 AND ($3::int[] IS NULL OR f.id = ANY($3::int[]))
        AND NOT EXISTS (SELECT 1 FROM experience_conflict_decisions s WHERE s.experience_id = $2 AND s.field = f.field)
      RETURNING f.id`,
    [from.id, to.id, only ?? null],
  );
  return result.rows.map(row => row.id);
}
