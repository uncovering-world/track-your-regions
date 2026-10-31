/**
 * The writes to `experience_merge_suggestions` — Jev's judgement of two near
 * places with similar names (#1249, ADR-0087) — under the lock of the place
 * the card is about, the lower id of each pair (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`MERGE_SUGGESTION_WRITE_RULES`): this module alone. A judgement is
 * recorded for the pair as the question was built from it (`askedPairSql`:
 * both names, the distance, the similarity, whether the pair is exact, the
 * words it matched on and whether each place claims its item), so it is that
 * pair's and no other: once the pass refreshes the measures or the words, a
 * place is renamed or an item's claim moves, the question is asked again. One
 * row per question; the
 * input tokens of the call the questions went in are shared out over them,
 * so the rows added up are what the calls cost.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import type { CheckValue } from '../../db/schema.generated.js';
import { itemClaimedSql } from './reviewQueueMergeProposals.js';

/** What Jev can say of a pair: one place, two places, or one part of the other. */
export type PairJudgement = CheckValue<'experience_merge_suggestions', 'judgement'>;

/**
 * The pair as a question is built from it, off its proposal row `p` and its
 * places `a` and `b`: what a judgement is recorded for, and what the card
 * compares a judgement with. Built in SQL on both sides, so the two never
 * differ in how a number is spelled. Every fact the question's sentences read
 * is in the key (#2194): the words the pair matched on and whether each place
 * claims its item, so a pass that fills the words or a claim that moves asks
 * the question again rather than serving the judgement of a question that
 * said something else. The usage count (`jevUsageController.ts`) does not
 * match on it: an answered pair's places have moved on — a *one place* answer
 * folds one of them — so it takes the newest judgement asked before the
 * answer, which is the one the curator saw.
 */
export function askedPairSql(p = 'p', a = 'a', b = 'b'): string {
  return `jsonb_build_object('aName', ${a}.name, 'bName', ${b}.name, 'distanceM', ${p}.distance_m,
                             'similarity', ${p}.name_similarity, 'exact', ${p}.exact,
                             'matchedWords', ${p}.matched_words,
                             'aItemClaimed', ${itemClaimedSql(a)}, 'bItemClaimed', ${itemClaimedSql(b)})`;
}

/** What Jev answered for one pair, by its proposal. */
export interface MergeSuggestion {
  proposalId: number;
  /** The other place of the pair (`place_b`); the anchor under the lock is `place_a`. */
  placeB: number;
  /**
   * The pair as the question was built from it (`askedPairSql`, read with the
   * pair before the call), as JSON text: what the row records, so a pair the
   * pass measured anew while the call was in flight gets its old answer
   * stamped with the old pair, which the next read sees as stale.
   */
  asked: string;
  /** Jev's judgement, or null for an answer the client refused. */
  judgement: PairJudgement | null;
  confidence: number;
  probabilities: Record<string, number>;
  /** This question's share of the call's input tokens. */
  inputTokens: number;
}

/**
 * Record the judgements of one call, a row per question, each on its pair's
 * two places with the proposal it was asked for and the pair as it was asked
 * (`asked`), under the anchor's lock. Keyed on the places, not the proposal: a
 * pass deletes an open pair it no longer finds and clears the pointer, and the
 * judgement Jev was paid for stays, counted, and found again by a pair proposed
 * anew with the same measures. The places come with the suggestion, read with
 * the pair before the call, so a pair the pass dropped while Jev was answering
 * is still recorded, with no proposal; a proposal that is another anchor's
 * writes nothing. Answers how many rows were written.
 */
export async function recordMergeSuggestions(
  client: PoolClient,
  lock: LockedExperience,
  model: string,
  suggestions: readonly MergeSuggestion[],
): Promise<number> {
  if (suggestions.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO experience_merge_suggestions
            (place_a, place_b, proposal_id, asked, judgement, confidence, probabilities, model, input_tokens)
     SELECT $1::int, s.place_b, p.id, s.asked::jsonb, s.judgement, s.confidence, s.probabilities::jsonb, $2, s.input_tokens
       FROM unnest($3::int[], $4::int[], $5::text[], $6::text[], $7::numeric[], $8::text[], $9::int[])
            AS s(proposal_id, place_b, asked, judgement, confidence, probabilities, input_tokens)
       LEFT JOIN experience_merge_proposals p ON p.id = s.proposal_id
      WHERE p.id IS NULL OR p.place_a = $1::int`,
    [
      lock.id, model,
      suggestions.map(s => s.proposalId), suggestions.map(s => s.placeB), suggestions.map(s => s.asked),
      suggestions.map(s => s.judgement), suggestions.map(s => s.confidence),
      suggestions.map(s => JSON.stringify(s.probabilities)), suggestions.map(s => s.inputTokens),
    ],
  );
  return result.rowCount ?? 0;
}
