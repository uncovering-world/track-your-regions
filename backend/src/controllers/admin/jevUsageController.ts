/**
 * What Jev has cost, and how often curators chose what it suggested (#1260,
 * #1272, #1249, #1768, #1913).
 * GET /api/admin/jev/usage
 *
 * Five questions are asked of it, counted apart and added up. The sources
 * card's: the rows of `experience_view_suggestions`, one per call, and the
 * agreement compares each curator's choice of a source with the newest
 * suggestion made for the same views — a choice that kept the place's own
 * value (no source) has nothing to compare and is left out. The component
 * items card's: the rows of `experience_component_item_suggestions`, one per
 * candidate judged, each carrying its share of its call's cost, and the
 * agreement compares each candidate a curator answered with the newest
 * judgement of it as it stood — confirmed against *same*, turned down against
 * *other*; a judgement the client refused compares with nothing. The near
 * places card's: the rows of `experience_merge_suggestions`, one per pair
 * judged, and the agreement compares each pair a curator answered with the
 * newest judgement of it as it stood, in the same three words — *one*, *two*,
 * *part of*; a pair a merge's undo opened again has no answer and compares
 * with nothing until it is answered again. The arriving place's (#1768): the
 * rows of `experience_visit_suggestions`, one per call, and the agreement
 * compares a curator's first answer to an arrival after the place's newest
 * reading — a kept-out arrival (its log row) against *nothing*, *not a place*
 * or *an object*, a membership first published after it against *something to
 * see*; a reading of a part or of another kind says neither, and compares with
 * nothing. The same readings raise a run's questions about an offered place
 * with nothing to see (#1770), and each answered question is compared too: a
 * refusal agrees with the reading it was raised on, a place kept does not.
 * The hints of where a roughly placed component stands (#1913): the rows of
 * `experience_point_hint_suggestions`, one per hint judged, and the agreement
 * compares each point a curator has placed with the newest judgement of each
 * of its hints — a placement within `HINT_TAKEN_M` of the hint against *same*,
 * one elsewhere, the list's point kept included, against *other*.
 */

import type { JevUsage } from '../../api/responses/admin.js';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { jevConfigured, JEV_USD_PER_MILLION_INPUT_TOKENS } from '../../services/jev/jevClient.js';
import { askedSql } from '../experience/componentItemSuggestions.js';
import { HINT_TAKEN_M } from '../experience/pointHintSuggestions.js';

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
     -- A curator's answers only: the catalogue's own acceptance (ADR-0141) is no
     -- curator agreeing with anyone.
     WHERE p.answer IS NOT NULL AND NOT p.answered_by_catalogue
  `);
  const pairs = await pool.query<Counted>(`
    SELECT (SELECT count(*) FROM experience_merge_suggestions)::int AS calls,
           (SELECT COALESCE(sum(input_tokens), 0) FROM experience_merge_suggestions)::float8 AS input_tokens,
           count(g.judgement)::int AS compared,
           count(*) FILTER (WHERE p.answer = g.judgement)::int AS agreed
      FROM experience_merge_proposals p
      JOIN experiences a ON a.id = p.place_a
      JOIN experiences b ON b.id = p.place_b
      -- The judgement the curator saw: the newest asked before the answer. Not
      -- a match on the question's key (askedPairSql), which reads the places as
      -- they stand now: a *one place* answer folds the other place, whose claim
      -- on its item then reads false, and the key no longer matches (#2194).
      JOIN LATERAL (
        SELECT s.judgement
          FROM experience_merge_suggestions s
         WHERE s.place_a = p.place_a AND s.place_b = p.place_b AND s.asked_at <= p.answered_at
         ORDER BY s.asked_at DESC, s.id DESC LIMIT 1
      ) g ON true
     -- A curator's answers only: a part of read off Wikidata (ADR-0150) is no
     -- curator agreeing with Jev.
     WHERE p.answer IS NOT NULL AND NOT p.answered_by_catalogue
  `);
  const arrivals = await pool.query<Counted>(`
    SELECT (SELECT count(*) FROM experience_visit_suggestions)::int AS calls,
           (SELECT COALESCE(sum(input_tokens), 0) FROM experience_visit_suggestions)::float8 AS input_tokens,
           count(*)::int AS compared,
           count(*) FILTER (WHERE (a.action = 'arrival_refused') = (g.reading IN ('nothing', 'not-a-place', 'object')))::int AS agreed
      FROM (SELECT DISTINCT ON (s.experience_id) s.experience_id, s.reading, s.asked_at
              FROM experience_visit_suggestions s
             ORDER BY s.experience_id, s.asked_at DESC, s.id DESC) g
      JOIN LATERAL (
        SELECT answer.action
          FROM (SELECT l.action, l.created_at AS at
                  FROM experience_curation_log l
                 WHERE l.experience_id = g.experience_id AND l.action = 'arrival_refused' AND l.created_at >= g.asked_at
                UNION ALL
                -- An arrival is passed when its membership is first published:
                -- a publication of the place's other kind, or of its held fields,
                -- leaves a time set before the reading.
                SELECT 'published', m.published_at
                  FROM ${MEMBERSHIPS} m
                 WHERE m.experience_id = g.experience_id AND m.published_at >= g.asked_at) answer
         ORDER BY answer.at LIMIT 1
      ) a ON true
     WHERE g.reading IN ('visit', 'nothing', 'not-a-place', 'object')
  `);
  const questions = await pool.query<Pick<Counted, 'compared' | 'agreed'>>(`
    SELECT count(*)::int AS compared, count(*) FILTER (WHERE q.answer = 'refused')::int AS agreed
      FROM experience_visit_questions q
     WHERE q.answer IS NOT NULL
  `);
  const hints = await pool.query<Counted>(`
    SELECT (SELECT count(*) FROM experience_point_hint_suggestions)::int AS calls,
           (SELECT COALESCE(sum(input_tokens), 0) FROM experience_point_hint_suggestions)::float8 AS input_tokens,
           count(*)::int AS compared,
           count(*) FILTER (WHERE (g.judgement = 'same') = ST_DWithin(g.hint_location::geography, el.location::geography, ${HINT_TAKEN_M}))::int AS agreed
      FROM (SELECT DISTINCT ON (s.location_id, s.source, s.ref) s.location_id, s.judgement, s.hint_location
              FROM experience_point_hint_suggestions s
             ORDER BY s.location_id, s.source, s.ref, s.asked_at DESC, s.id DESC) g
      JOIN experience_locations el ON el.id = g.location_id
     -- A curator's placement only: until then the question is open.
     WHERE g.judgement IS NOT NULL AND el.curated_fields ? 'location'
  `);
  const visits = arrivals.rows[0];
  const asked = questions.rows[0];
  const byQuestion = [
    figures('views', views.rows[0]), figures('componentItems', items.rows[0]), figures('mergeProposals', pairs.rows[0]),
    figures('visits', { ...visits, compared: visits.compared + asked.compared, agreed: visits.agreed + asked.agreed }),
    figures('pointHints', hints.rows[0]),
  ];
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
