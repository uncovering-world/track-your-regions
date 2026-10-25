/**
 * The curator's writes to `experience_merge_proposals` — two near places with
 * similar names answered (#1249, ADR-0046 decisions 2 to 4) — under both
 * places' locks (ADR-0077 decision 4, ADR-0086 decision 6).
 *
 * The table's writers are a closed list the backend lint names
 * (`MERGE_PROPOSAL_WRITE_RULES`): the pass, which proposes and answers
 * *part of* from Wikidata (`services/sync/mergeProposalFinder.ts`), and this
 * module. An answer is kept, never deleted: *two places* is what keeps a pair
 * from being proposed again, *one place* records the merge the curator ran,
 * and *part of* records which place is the part, for #823, without merging. A
 * *part of* or *two places* is taken back from the history, which opens the
 * pair again (#1991). Every write names both places, so a token for one pair
 * cannot be spent on another.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import type { CheckValue } from '../../db/schema.generated.js';

/** The three answers a pair takes, in the table's own words. */
export type MergeProposalAnswer = CheckValue<'experience_merge_proposals', 'answer'>;

/** One pair answered: what the answer was about, for the log. */
export interface AnsweredPair {
  id: number;
  placeA: number;
  placeB: number;
}

/**
 * Record one answer on an open pair of the two locked places, and say which
 * pair it was: a pair already answered, or another pair's id, is left out
 * rather than rewritten. `partId` names the part for `part_of` and is null
 * otherwise; `mergeId` names the merge *one place* ran and is null otherwise —
 * the schema holds both to their answer.
 */
export async function answerMergeProposal(
  client: PoolClient,
  locks: { a: LockedExperience; b: LockedExperience },
  userId: number,
  proposalId: number,
  answer: MergeProposalAnswer,
  partId: number | null,
  mergeId: number | null,
): Promise<AnsweredPair | null> {
  const result = await client.query<{ id: number; place_a: number; place_b: number }>(
    `UPDATE experience_merge_proposals p
        SET answer = $4, part_id = $5, merge_id = $6, answered_by = $7, answered_at = NOW()
      WHERE p.id = $1 AND p.place_a = $2 AND p.place_b = $3 AND p.answer IS NULL
      RETURNING p.id, p.place_a, p.place_b`,
    [proposalId, locks.a.id, locks.b.id, answer, partId, mergeId, userId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, placeA: row.place_a, placeB: row.place_b } : null;
}

/**
 * Open the pair a merge's undo takes apart again: the places stand apart, so
 * a record saying *one place* would be wrong and would keep the pass from
 * ever asking about them. Under both places' locks, as the undo holds them.
 * Answers whether a pair named the merge.
 */
export async function reopenMergedPair(
  client: PoolClient,
  locks: { a: LockedExperience; b: LockedExperience },
  mergeId: number,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE experience_merge_proposals p
        SET answer = NULL, part_id = NULL, merge_id = NULL, answered_by = NULL, answered_at = NULL
      WHERE p.merge_id = $1::int AND p.place_a = LEAST($2::int, $3::int) AND p.place_b = GREATEST($2::int, $3::int)`,
    [mergeId, locks.a.id, locks.b.id],
  );
  return (result.rowCount ?? 0) > 0;
}

/** The answers a curator takes back from the history: *one place* is undone with its merge instead. */
export const TAKEABLE_ANSWERS = ['part_of', 'two'] as const satisfies readonly MergeProposalAnswer[];

/** An answer the history takes back. */
export type TakeableAnswer = typeof TAKEABLE_ANSWERS[number];

/** An answer taken back: what it was, for the log. */
export interface TakenBackPair extends AnsweredPair {
  answer: TakeableAnswer;
  partId: number | null;
  catalogue: boolean;
}

/**
 * Take a pair's *part of* or *two places* back (#1991), the pass's answer from
 * Wikidata or a curator's, under both places' locks: the pair is open again,
 * on the review queue, and marked, so the pass never answers it from Wikidata
 * again. A pair of other places, an open one, or one answered *one place* is
 * left as it is. Answers what was taken back, or null.
 */
export async function takeBackMergeProposal(
  client: PoolClient,
  locks: { a: LockedExperience; b: LockedExperience },
  proposalId: number,
): Promise<TakenBackPair | null> {
  const result = await client.query<{
    id: number; place_a: number; place_b: number; answer: TakeableAnswer; part_id: number | null; catalogue: boolean;
  }>(
    `WITH was AS (
       SELECT p.id, p.answer, p.part_id, p.answered_by_catalogue AS catalogue
         FROM experience_merge_proposals p
        WHERE p.id = $1 AND p.place_a = $2 AND p.place_b = $3 AND p.answer = ANY($4::text[])
        FOR UPDATE
     )
     UPDATE experience_merge_proposals p
        SET answer = NULL, part_id = NULL, answered_by = NULL, answered_at = NULL,
            answered_by_catalogue = false, answer_statement = NULL, taken_back_at = NOW()
       FROM was
      WHERE p.id = was.id
      RETURNING p.id, p.place_a, p.place_b, was.answer, was.part_id, was.catalogue`,
    [proposalId, locks.a.id, locks.b.id, TAKEABLE_ANSWERS],
  );
  const row = result.rows[0];
  return row ? {
    id: row.id, placeA: row.place_a, placeB: row.place_b, answer: row.answer, partId: row.part_id, catalogue: row.catalogue,
  } : null;
}
