/**
 * The writes to `experience_point_hint_suggestions` — Jev's judgement of a
 * hint of where a component the World Heritage list placed only roughly stands
 * (#1913, ADR-0087) — under the site's lock (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`POINT_HINT_SUGGESTION_WRITE_RULES`): this module alone. A judgement is
 * recorded for the hint as the question was built from it (`hintAskedSql`: its
 * label, its distance and, for an OpenStreetMap object, its tags), so once the
 * pass finds the hint with other measures the question is asked again. Each
 * row keeps the hint's coordinate, which the agreement with the curator's
 * placement is measured against after the hint itself has gone with the
 * question. The input tokens of a call are shared out over its questions, so
 * the rows added up are what the calls cost.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import type { CheckValue } from '../../db/schema.generated.js';
import { shownBySql } from '../../db/placePoints.js';

/**
 * How near a hint a curator's placement of the point must fall to have taken
 * it: *Move here* writes the hint's own coordinate, and a hand placement this
 * close is the same answer. What the usage count compares a judgement with
 * once the question is closed (`jevUsageController.ts`).
 */
export const HINT_TAKEN_M = 25;

/** What Jev can say of a hint: it is where the component stands, or another place. */
export type HintJudgement = CheckValue<'experience_point_hint_suggestions', 'judgement'>;

/** Where a hint comes from, as the card and the table name it. */
export type HintSource = CheckValue<'experience_point_hint_suggestions', 'source'>;

/**
 * The hint as a question is built from it, off a hint row `h` (`HINTS`): what a
 * judgement is recorded for and what the card compares a stored one with.
 * Built in SQL on both sides, so the two never differ in how a number is spelled.
 */
export function hintAskedSql(h = 'h'): string {
  return `jsonb_build_object('label', ${h}.label, 'metres', ${h}.metres, 'tags', ${h}.tags)`;
}

/** What Jev answered for one hint. */
export interface PointHintSuggestion {
  locationId: number;
  source: HintSource;
  ref: string;
  /** Jev's judgement, or null for an answer the client refused. */
  judgement: HintJudgement | null;
  confidence: number;
  probabilities: Record<string, number>;
  /** This question's share of the call's input tokens. */
  inputTokens: number;
}

/**
 * Record the judgements of one call, a row per question, each for its hint as
 * the card reads it now (`hints`, the `HINTS` query over the site's points),
 * under the site's lock. A hint no longer there, or a point that is not this
 * site's, writes nothing. Answers how many rows were written.
 */
export async function recordPointHintSuggestions(
  client: PoolClient,
  lock: LockedExperience,
  model: string,
  hints: string,
  suggestions: readonly PointHintSuggestion[],
): Promise<number> {
  if (suggestions.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO experience_point_hint_suggestions
            (location_id, source, ref, asked, hint_location, judgement, confidence, probabilities, model, input_tokens)
     SELECT el.id, h.source, h.ref, ${hintAskedSql('h')}, h.at, s.judgement, s.confidence, s.probabilities::jsonb, $2, s.input_tokens
       FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::text[], $9::int[])
            AS s(location_id, source, ref, judgement, confidence, probabilities, input_tokens)
       JOIN experience_locations el ON el.id = s.location_id
      CROSS JOIN LATERAL (${hints}) h
      WHERE ${shownBySql('el', 'ARRAY[$1::int]')} AND h.source = s.source AND h.ref = s.ref`,
    [
      lock.id, model,
      suggestions.map(s => s.locationId), suggestions.map(s => s.source), suggestions.map(s => s.ref),
      suggestions.map(s => s.judgement), suggestions.map(s => s.confidence),
      suggestions.map(s => JSON.stringify(s.probabilities)), suggestions.map(s => s.inputTokens),
    ],
  );
  return result.rowCount ?? 0;
}
