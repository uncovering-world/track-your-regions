/**
 * What Jev has cost, and how often curators chose what it suggested (#1260).
 * GET /api/admin/jev/usage
 *
 * The calls are the rows of `experience_view_suggestions`, one per call; the
 * agreement compares each curator's choice of a source with the newest
 * suggestion made for the same views. A choice that kept the place's own value
 * (no source) has nothing to compare and is left out.
 */

import type { JevUsage } from '../../api/responses/admin.js';
import { pool } from '../../db/index.js';
import { jevConfigured, JEV_USD_PER_MILLION_INPUT_TOKENS } from '../../services/jev/jevClient.js';

export async function getJevUsage(): Promise<JevUsage> {
  const result = await pool.query<{ calls: number; input_tokens: number; compared: number; agreed: number }>(`
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
  const row = result.rows[0];
  return {
    configured: jevConfigured(),
    calls: row.calls,
    inputTokens: row.input_tokens,
    usd: Math.round(row.input_tokens * JEV_USD_PER_MILLION_INPUT_TOKENS) / 1_000_000,
    compared: row.compared,
    agreed: row.agreed,
  };
}
