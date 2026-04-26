/**
 * AI Usage Logger
 *
 * Logs per-session AI usage to the ai_usage_log table.
 * Provides summary queries for the admin dashboard.
 */

import { pool } from '../../db/index.js';

export interface UsageByModelFeature {
  feature: string;
  model: string;
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  avgCostPerCall: number;
  lastUsed: string;
}

export interface UsageSummary {
  today: number;
  thisMonth: number;
  allTime: number;
  byModelFeature: UsageByModelFeature[];
}

/** Log a completed AI session. Returns the log entry ID. */
export async function logAIUsage(entry: {
  feature: string;
  model: string;
  description?: string;
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  durationMs?: number;
}): Promise<number> {
  const result = await pool.query(
    `INSERT INTO ai_usage_log (feature, model, description, api_calls, prompt_tokens, completion_tokens, total_cost, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [entry.feature, entry.model, entry.description ?? null, entry.apiCalls,
     entry.promptTokens, entry.completionTokens, entry.totalCost, entry.durationMs ?? null],
  );
  return result.rows[0].id as number;
}

/** Get usage summary for the admin dashboard. */
export async function getUsageSummary(): Promise<UsageSummary> {
  const [totals, grouped] = await Promise.all([
    pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN total_cost END), 0)::float AS today,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', CURRENT_DATE) THEN total_cost END), 0)::float AS this_month,
        COALESCE(SUM(total_cost), 0)::float AS all_time
      FROM ai_usage_log
    `),
    pool.query(`
      SELECT
        feature,
        model,
        SUM(api_calls)::int AS total_calls,
        SUM(prompt_tokens)::int AS total_prompt_tokens,
        SUM(completion_tokens)::int AS total_completion_tokens,
        SUM(total_cost)::float AS total_cost,
        (SUM(total_cost) / NULLIF(SUM(api_calls), 0))::float AS avg_cost_per_call,
        MAX(created_at) AS last_used
      FROM ai_usage_log
      GROUP BY feature, model
      ORDER BY MAX(created_at) DESC
    `),
  ]);

  return {
    today: totals.rows[0].today as number,
    thisMonth: totals.rows[0].this_month as number,
    allTime: totals.rows[0].all_time as number,
    byModelFeature: grouped.rows.map(r => ({
      feature: r.feature as string,
      model: r.model as string,
      totalCalls: r.total_calls as number,
      totalPromptTokens: r.total_prompt_tokens as number,
      totalCompletionTokens: r.total_completion_tokens as number,
      totalCost: r.total_cost as number,
      avgCostPerCall: (r.avg_cost_per_call as number) ?? 0,
      lastUsed: r.last_used instanceof Date ? r.last_used.toISOString() : String(r.last_used),
    })),
  };
}

