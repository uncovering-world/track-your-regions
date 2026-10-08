/**
 * The writes to `experience_view_suggestions` — Jev's suggested answer to the
 * card that asks which of two sources' views a place shows (#1260) — under the
 * place's lock (ADR-0077 decision 4).
 *
 * The table's writers are a closed list the backend lint names
 * (`VIEW_SUGGESTION_WRITE_RULES`): this module alone. A suggestion records the
 * views it was asked about by the expression the open question and a choice
 * compare with (`viewsOfFieldSql`), so it is the views' suggestion and no
 * other: once a source sends something different it is stale, and the card
 * asks again.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { viewsOfFieldSql, type ViewField } from '../../db/sourceViews.js';

/** What Jev answered for one field. */
export interface ViewSuggestion {
  field: ViewField;
  /** The view Jev picked, or null for an answer the client refused. */
  membershipId: number | null;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  inputTokens: number;
  /** The field's views the question was built from (`viewsOfFieldSql`), as they stood when asked. */
  views: unknown;
}

/**
 * Record a call: a row per call, every one, since the rows are what the calls
 * cost. It is recorded for the views Jev was asked about, so an answer about
 * views a run changed during the call is kept and never the card's — the card
 * reads the newest row for the views as they stand. Answers whether this one
 * is about the views as they stand now, under the lock.
 */
export async function recordViewSuggestion(
  client: PoolClient,
  lock: LockedExperience,
  suggestion: ViewSuggestion,
): Promise<boolean> {
  const inserted = await client.query<{ current: boolean }>(
    `INSERT INTO experience_view_suggestions
       (experience_id, field, views, suggested_membership_id, confidence, probabilities, model, input_tokens)
     VALUES ($1, $2::text, $8::jsonb, $3, $4, $5, $6, $7)
     RETURNING views = ${viewsOfFieldSql('$1::int', '$2::text')} AS current`,
    [lock.id, suggestion.field, suggestion.membershipId, suggestion.confidence,
      JSON.stringify(suggestion.probabilities), suggestion.model, suggestion.inputTokens, JSON.stringify(suggestion.views)],
  );
  return inserted.rows[0]?.current === true;
}
