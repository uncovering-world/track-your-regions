/**
 * The writer of `place_identifier_verdicts` (ADR-0143 decision 5, ADR-0069): a
 * curator's word on one identifier of a place, written, replaced or taken
 * back. Called under the place's lock and the value's keys by the settle
 * endpoint (`placeIdentifierController.ts`), by a separation, which writes
 * `refers` on the original for the identifier its new place is (ADR-0144),
 * and by the undo of the merge that undid a separation, which writes it
 * again. The registry follows by trigger.
 */

import type { PoolClient } from 'pg';

/** The word a curator may write; `derived` takes a word back and is the take-back below. */
export type WrittenVerdict = 'identifies' | 'refers' | 'removed';

export async function writeIdentifierVerdict(
  client: PoolClient,
  { experienceId, scheme, value, verdict, userId, note }: {
    experienceId: number; scheme: string; value: string; verdict: WrittenVerdict; userId: number; note: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO place_identifier_verdicts (experience_id, scheme, value, verdict, curator_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (experience_id, scheme, value) DO UPDATE
       SET verdict = EXCLUDED.verdict, curator_id = EXCLUDED.curator_id, note = EXCLUDED.note, decided_at = NOW()`,
    [experienceId, scheme, value, verdict, userId, note],
  );
}

/** Take a curator's word on one identifier back, so the registry derives the claim from the columns again. */
export async function takeBackIdentifierVerdict(
  client: PoolClient,
  { experienceId, scheme, value }: { experienceId: number; scheme: string; value: string },
): Promise<void> {
  await client.query(
    'DELETE FROM place_identifier_verdicts WHERE experience_id = $1 AND scheme = $2 AND value = $3',
    [experienceId, scheme, value],
  );
}
