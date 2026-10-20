/**
 * The writes to `experience_visit_suggestions` — Jev's reading of what a
 * visitor finds at a place a curator is asked about (#1768, ADR-0087) — under
 * the place's lock (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`VISIT_SUGGESTION_WRITE_RULES`): this module alone. A reading is recorded
 * for the place as the question was built from it (`askedSql`: its name,
 * countries and kinds, the map's tag and its article), so it is that place's
 * reading and no other: once the place is renamed, moves into another kind or
 * gains an article, the card asks again. One row per call.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { KINDS, MEMBERSHIPS, membershipAdmittedSql } from '../../db/membership.js';
import { arrivalOpenSql } from './reviewQueuePredicates.js';
import type { VisitReading } from '../../services/sync/visit/visitReading.js';

/**
 * The place as a question is built from it, off its row `e`: what a reading is
 * recorded for, and what the card and the usage count compare a reading with.
 * Built in SQL on every side, so they never differ in how a name is spelled.
 * The kinds are those the place is admitted to, in their order of id.
 */
export function askedSql(e = 'e'): string {
  return `jsonb_build_object(
            'name', ${e}.name,
            'countries', to_jsonb(COALESCE(${e}.country_names, '{}'::text[])),
            'kinds', COALESCE((SELECT jsonb_agg(k.name ORDER BY k.id)
                                 FROM ${KINDS} k
                                WHERE EXISTS (SELECT 1 FROM ${MEMBERSHIPS} km
                                               WHERE km.experience_id = ${e}.id AND km.kind_id = k.id
                                                 AND ${membershipAdmittedSql('km')})), '[]'::jsonb),
            'map', ${e}.metadata->'osm'->>'tag',
            'article', ${e}.metadata->>'wikipediaUrl')`;
}

/** What Jev answered for one place. */
export interface VisitSuggestion {
  /** Jev's reading, or null for an answer the client refused. */
  reading: VisitReading | null;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  inputTokens: number;
  /** The place as the question was built from it (`askedSql`), as it stood when asked. */
  asked: unknown;
  /** The article lead Jev read, or null. */
  lead: string | null;
}

/**
 * Record a call, a row per call, since the rows are what the calls cost. It
 * is recorded for the place Jev was asked about, so an answer about a place a
 * run renamed during the call is kept and never the card's: the card reads the
 * newest row for the place as it stands. Answers whether this one is about the
 * place as it stands now and the place is still arriving, under the lock: a
 * place a run stopped finding, or a curator answered, during the call is no
 * card's question.
 */
export async function recordVisitSuggestion(
  client: PoolClient,
  lock: LockedExperience,
  suggestion: VisitSuggestion,
): Promise<boolean> {
  const inserted = await client.query<{ current: boolean }>(
    `INSERT INTO experience_visit_suggestions
       (experience_id, asked, article_lead, reading, confidence, probabilities, model, input_tokens)
     SELECT e.id, $2::jsonb, $3, $4, $5, $6::jsonb, $7, $8
       FROM experiences e WHERE e.id = $1
     RETURNING asked = (SELECT ${askedSql('e')} FROM experiences e WHERE e.id = $1)
               AND EXISTS (SELECT 1 FROM experiences e JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
                            WHERE e.id = $1 AND ${arrivalOpenSql('e', 'm')}) AS current`,
    [lock.id, JSON.stringify(suggestion.asked), suggestion.lead, suggestion.reading, suggestion.confidence,
      JSON.stringify(suggestion.probabilities), suggestion.model, suggestion.inputTokens],
  );
  return inserted.rows[0]?.current === true;
}
