/**
 * What Jev has cost, and how often curators chose what it suggested (#1260,
 * #1272).
 * GET /api/admin/jev/usage
 *
 * Two questions are asked of it, counted apart and added up. The sources
 * card's: the rows of `experience_view_suggestions`, one per call, and the
 * agreement compares each curator's choice of a source with the newest
 * suggestion made for the same views — a choice that kept the place's own
 * value (no source) has nothing to compare and is left out. The component
 * items card's: the rows of `experience_component_item_suggestions`, one per
 * candidate judged, each carrying its share of its call's cost, and the
 * agreement compares each candidate a curator answered with the newest
 * judgement of it as it stood — confirmed against *same*, turned down against
 * *other*; a judgement the client refused compares with nothing.
 */

import type { JevUsage } from '../../api/responses/admin.js';
import { pool } from '../../db/index.js';
import { jevConfigured, JEV_USD_PER_MILLION_INPUT_TOKENS } from '../../services/jev/jevClient.js';
import { askedSql } from '../experience/componentItemSuggestions.js';

interface Counted {
  calls: number;
  input_tokens: number;
  compared: number;
  agreed: number;
}

const usd = (inputTokens: number) => Math.round(inputTokens * JEV_USD_PER_MILLION_INPUT_TOKENS) / 1_000_000;

function figures(question: JevUsage['byQuestion'][number]['question'], row: Counted) {
  return {
    question, calls: row.calls, inputTokens: row.input_tokens, usd: usd(row.input_tokens),
    compared: row.compared, agreed: row.agreed,
  };
}

export async function getJevUsage(): Promise<JevUsage> {
  const views = await pool.query<Counted>(`
    SELECT (SELECT count(*) FROM experience_view_suggestions)::int AS calls,
           -- float8: a sum of tokens outgrows int, and node-postgres hands int8 back as a string.
           (SELECT COALESCE(sum(input_tokens), 0) FROM experience_view_suggestions)::float8 AS input_tokens,
           count(g.suggested)::int AS compared,
           count(*) FILTER (WHERE g.suggested = c.chosen_membership_id)::int AS agreed
      FROM experience_view_choices c
      JOIN LATERAL (
        SELECT s.suggested_membership_id AS suggested
          FROM experience_view_suggestions s
         WHERE s.experience_id = c.experience_id AND s.field = c.field AND s.views = c.views
         ORDER BY s.asked_at DESC, s.id DESC LIMIT 1
      ) g ON true
     WHERE c.chosen_membership_id IS NOT NULL
  `);
  const items = await pool.query<Counted>(`
    SELECT (SELECT count(*) FROM experience_component_item_suggestions)::int AS calls,
           (SELECT COALESCE(sum(input_tokens), 0) FROM experience_component_item_suggestions)::float8 AS input_tokens,
           count(g.judgement)::int AS compared,
           count(*) FILTER (WHERE (p.answer = 'accepted' AND g.judgement = 'same')
                               OR (p.answer = 'refused' AND g.judgement = 'other'))::int AS agreed
      FROM experience_component_item_proposals p
      JOIN LATERAL (
        SELECT s.judgement
          FROM experience_component_item_suggestions s
         WHERE s.location_id = p.location_id AND s.wikidata_item = p.wikidata_item AND s.asked = ${askedSql('p')}
         ORDER BY s.asked_at DESC, s.id DESC LIMIT 1
      ) g ON true
     WHERE p.answer IS NOT NULL
  `);
  const byQuestion = [figures('views', views.rows[0]), figures('componentItems', items.rows[0])];
  const inputTokens = byQuestion.reduce((sum, q) => sum + q.inputTokens, 0);
  return {
    configured: jevConfigured(),
    calls: byQuestion.reduce((sum, q) => sum + q.calls, 0),
    inputTokens,
    usd: usd(inputTokens),
    compared: byQuestion.reduce((sum, q) => sum + q.compared, 0),
    agreed: byQuestion.reduce((sum, q) => sum + q.agreed, 0),
    byQuestion,
  };
}
