/**
 * What the undo of a merge does for a separation that merge had undone
 * (ADR-0144 decision 5): the two are separate again, so the separation
 * stands again — its record reopened, the curator's `refers` word written on
 * the original once more, and the travellers' questions raised again. Its
 * own module, since `placeMerge.ts` reads it and `membershipSeparation.ts`
 * reads `placeMerge.ts`.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { writeIdentifierVerdict } from './placeIdentifierVerdictWriter.js';

export async function reopenSeparationsUndoneBy(
  client: PoolClient,
  mergeId: number,
  userId: number,
  separated: LockedExperience,
): Promise<void> {
  const reopened = await client.query<{ id: number; original_id: number; scheme: string | null; value: string | null; verdict_written: boolean }>(
    `UPDATE experience_separations SET undone_at = NULL, undone_by = NULL, merge_id = NULL
      WHERE merge_id = $1
      RETURNING id, original_id, scheme, value, verdict_written`,
    [mergeId],
  );
  for (const separation of reopened.rows) {
    if (separation.verdict_written && separation.scheme && separation.value) {
      await client.query('SELECT lock_place_identifiers($1, ARRAY[$2::text])', [separation.scheme, separation.value]);
      await writeIdentifierVerdict(client, {
        experienceId: separation.original_id, scheme: separation.scheme, value: separation.value, verdict: 'refers', userId,
        note: `Separated into a place of its own (#${separated.id})`,
      });
    }
    await client.query(
      `INSERT INTO separated_visit_questions (separation_id, visit_id, user_id)
       SELECT $1, v.id, v.user_id FROM user_visited_experiences v WHERE v.experience_id = $2
       ON CONFLICT (separation_id, visit_id) DO NOTHING`,
      [separation.id, separation.original_id],
    );
  }
}
