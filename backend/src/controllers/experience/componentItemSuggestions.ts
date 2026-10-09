/**
 * The writes to `experience_component_item_suggestions` — Jev's judgement of a
 * candidate Wikidata item for a World Heritage component (#1272, ADR-0087) —
 * under the site's lock (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`COMPONENT_ITEM_SUGGESTION_WRITE_RULES`): this module alone. A judgement is
 * recorded for the candidate as the question was built from it (`askedSql`:
 * the item's label, the distance, the name similarity and the rule that found
 * it), so it is that candidate's and no other: once the finder proposes the
 * item for the point with other measures, the question is asked again. One
 * row per question; the input tokens of the call the questions went in are
 * shared out over them, so the rows added up are what the calls cost.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import type { CheckValue } from '../../db/schema.generated.js';

/** What Jev can say of a candidate: the item is the component, or another place. */
export type Judgement = CheckValue<'experience_component_item_suggestions', 'judgement'>;

/**
 * The candidate as a question is built from it, off its proposal row `p`: what
 * a judgement is recorded for, and what the card and the usage count compare
 * a judgement with. Built in SQL on both sides, so the two never differ in how
 * a number is spelled.
 */
export function askedSql(p = 'p'): string {
  return `jsonb_build_object('label', ${p}.item_label, 'distanceM', ${p}.distance_m,
                             'similarity', ${p}.name_similarity, 'basis', ${p}.basis)`;
}

/** What Jev answered for one candidate, by its proposal. */
export interface ComponentItemSuggestion {
  proposalId: number;
  /** Jev's judgement, or null for an answer the client refused. */
  judgement: Judgement | null;
  confidence: number;
  probabilities: Record<string, number>;
  /** This question's share of the call's input tokens. */
  inputTokens: number;
}

/**
 * Record the judgements of one call, a row per question, each for its
 * candidate as the proposal states it now, under the site's lock. A proposal
 * that is not one of this site's points' — gone, or another site's — writes
 * nothing. Answers how many rows were written.
 */
export async function recordComponentItemSuggestions(
  client: PoolClient,
  lock: LockedExperience,
  model: string,
  suggestions: readonly ComponentItemSuggestion[],
): Promise<number> {
  if (suggestions.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO experience_component_item_suggestions
            (location_id, wikidata_item, asked, judgement, confidence, probabilities, model, input_tokens)
     SELECT p.location_id, p.wikidata_item, ${askedSql('p')}, s.judgement, s.confidence, s.probabilities::jsonb, $2, s.input_tokens
       FROM unnest($3::int[], $4::text[], $5::numeric[], $6::text[], $7::int[])
            AS s(proposal_id, judgement, confidence, probabilities, input_tokens)
       JOIN experience_component_item_proposals p ON p.id = s.proposal_id
       JOIN experience_locations el ON el.id = p.location_id
      WHERE el.experience_id = $1`,
    [
      lock.id, model,
      suggestions.map(s => s.proposalId), suggestions.map(s => s.judgement), suggestions.map(s => s.confidence),
      suggestions.map(s => JSON.stringify(s.probabilities)), suggestions.map(s => s.inputTokens),
    ],
  );
  return result.rowCount ?? 0;
}
