/**
 * The writes to `experience_view_choices` — a curator's choice between two
 * sources' views of one field of a place (#1246) — under the place's lock
 * (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`VIEW_CHOICE_WRITE_RULES`): this module alone. A choice records the views of
 * the field as they stand, by the expression the open question compares with
 * (`viewsOfFieldSql`), so the answer holds exactly while every source keeps
 * sending what it sent. Which value the place then shows is the caller's
 * (`viewChoiceController.ts`).
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { viewsOfFieldSql, type ViewField } from '../../db/sourceViews.js';

/** One field answered: the membership whose view the place shows, or null to keep what it holds. */
export interface ViewChoice {
  field: ViewField;
  membershipId: number | null;
}

/** Record each choice, one row per field, replaced: the standing answer, not a pile. */
export async function recordViewChoices(
  client: PoolClient,
  lock: LockedExperience,
  userId: number,
  choices: readonly ViewChoice[],
): Promise<void> {
  for (const choice of choices) {
    await client.query(
      `INSERT INTO experience_view_choices (experience_id, field, chosen_membership_id, views, decided_by)
       VALUES ($1, $2::text, $3, ${viewsOfFieldSql('$1::int', '$2::text')}, $4)
       ON CONFLICT (experience_id, field)
       DO UPDATE SET chosen_membership_id = EXCLUDED.chosen_membership_id,
                     views = EXCLUDED.views,
                     decided_by = EXCLUDED.decided_by,
                     decided_at = NOW()`,
      [lock.id, choice.field, choice.membershipId, userId],
    );
  }
}

/**
 * Move a place's choices to another place on a merge, or the ones a merge moved
 * back on its undo (ADR-0086). Where the survivor already holds one for the
 * field, the survivor's stands.
 */
export async function moveViewChoices(
  client: PoolClient,
  from: LockedExperience,
  to: LockedExperience,
  only?: number[],
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE experience_view_choices f SET experience_id = $2
      WHERE f.experience_id = $1 AND ($3::int[] IS NULL OR f.id = ANY($3::int[]))
        AND NOT EXISTS (SELECT 1 FROM experience_view_choices s WHERE s.experience_id = $2 AND s.field = f.field)
      RETURNING f.id`,
    [from.id, to.id, only ?? null],
  );
  return result.rows.map(row => row.id);
}
