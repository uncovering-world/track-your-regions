/**
 * The writes to `experience_planned_kind_answers` — a curator's answer whether
 * an arriving place belongs to a kind the coverage register plans (#2342) —
 * under the place's lock (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`PLANNED_KIND_ANSWER_WRITE_RULES`): this module alone. One row per place
 * and planned kind, the latest answer: a curator who changes their mind
 * replaces it. The rows that say a place belongs are the kind's candidates
 * when it is built, found by the register's slug it keeps.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';

/** Record a curator's answer about the place and the planned kind, replacing an earlier one. */
export async function recordPlannedKindAnswer(
  client: PoolClient,
  lock: LockedExperience,
  answer: { plannedKind: string; belongs: boolean; curatorId: number },
): Promise<void> {
  await client.query(
    `INSERT INTO experience_planned_kind_answers (experience_id, planned_kind, belongs, curator_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (experience_id, planned_kind)
       DO UPDATE SET belongs = EXCLUDED.belongs, curator_id = EXCLUDED.curator_id, answered_at = NOW()`,
    [lock.id, answer.plannedKind, answer.belongs, answer.curatorId],
  );
}
