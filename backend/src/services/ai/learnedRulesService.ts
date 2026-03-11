/**
 * Learned Rules Service
 *
 * Manages user-provided rules that get injected into AI prompts.
 * When the AI makes a mistake and the user corrects it with a note,
 * the note becomes a learned rule that improves future extractions.
 *
 * Also exposes predefined (built-in) rules from AI system prompts so
 * the admin sees the full rule set in one unified view.
 */

import { pool } from '../../db/index.js';

export interface LearnedRule {
  id: number;
  feature: string;
  ruleText: string;
  context: string | null;
  createdAt: string;
}

export interface PredefinedRule {
  /** Stable identifier like "extraction.5" (prompt rule number) */
  code: string;
  feature: string;
  ruleText: string;
}

/**
 * Built-in rules hardcoded in AI system prompts.
 * Only the decision-affecting rules — not parsing mechanics.
 */
export const PREDEFINED_RULES: PredefinedRule[] = [
  { code: 'extraction.3', feature: 'extraction', ruleText: 'Skip unlinked dead-ends — entries with no wikilink and no linked items are omitted.' },
  { code: 'extraction.5', feature: 'extraction', ruleText: 'If fewer than half of subregions have dedicated Wikivoyage pages, return empty regions (don\'t split).' },
  { code: 'extraction.6', feature: 'extraction', ruleText: 'Cities are always leaf nodes — never extract city districts as subregions.' },
  { code: 'extraction.7', feature: 'extraction', ruleText: 'Ignore cross-references ("described separately", "see also", etc.).' },
  { code: 'extraction.9', feature: 'extraction', ruleText: 'Description text is prose, not structure — links in descriptions are not child regions.' },
  { code: 'extraction.10', feature: 'extraction', ruleText: 'A region must not have exactly one subregion — treat as leaf instead.' },
  { code: 'interview.city', feature: 'extraction_interview', ruleText: 'Parent/District subpage format signals a city page — auto-resolve as leaf.' },
  { code: 'interview.coverage', feature: 'extraction_interview', ruleText: 'If <50% of subregions have pages, recommend not splitting.' },
];

/** Get all rules for a given feature (e.g., 'extraction'). */
export async function getRules(feature: string): Promise<LearnedRule[]> {
  const result = await pool.query(
    `SELECT id, feature, rule_text, context, created_at
     FROM ai_learned_rules
     WHERE feature = $1
     ORDER BY created_at ASC`,
    [feature],
  );
  return result.rows.map(r => ({
    id: r.id as number,
    feature: r.feature as string,
    ruleText: r.rule_text as string,
    context: r.context as string | null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Get all rules across all features. */
export async function getAllRules(): Promise<LearnedRule[]> {
  const result = await pool.query(
    `SELECT id, feature, rule_text, context, created_at
     FROM ai_learned_rules
     ORDER BY feature, created_at ASC`,
  );
  return result.rows.map(r => ({
    id: r.id as number,
    feature: r.feature as string,
    ruleText: r.rule_text as string,
    context: r.context as string | null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Add a new learned rule. Returns the new rule. */
export async function addRule(feature: string, ruleText: string, context?: string): Promise<LearnedRule> {
  const result = await pool.query(
    `INSERT INTO ai_learned_rules (feature, rule_text, context)
     VALUES ($1, $2, $3)
     RETURNING id, feature, rule_text, context, created_at`,
    [feature, ruleText, context ?? null],
  );
  const r = result.rows[0];
  return {
    id: r.id as number,
    feature: r.feature as string,
    ruleText: r.rule_text as string,
    context: r.context as string | null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/** Delete a learned rule by ID. */
export async function deleteRule(id: number): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM ai_learned_rules WHERE id = $1',
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Build the "learned rules" section to inject into a system prompt.
 * Returns empty string if no rules exist for the feature.
 *
 * Context is deliberately excluded — rules must be generic directives,
 * not page-specific anecdotes. Including "this was about Page X" makes
 * the AI treat the rule as specific to that page.
 */
export async function buildLearnedRulesPrompt(feature: string): Promise<string> {
  const rules = await getRules(feature);
  if (rules.length === 0) return '';

  const rulesText = rules
    .map((r, i) => `${i + 1}. ${r.ruleText}`)
    .join('\n');

  return `\n\nADDITIONAL LEARNED RULES (from admin feedback — these override any conflicting default behavior):
${rulesText}

When multiple rules apply, later rules (higher numbers) take precedence over earlier ones.`;
}

/** Bulk-replace a rule's text by ID. */
export async function updateRuleText(id: number, ruleText: string): Promise<boolean> {
  const result = await pool.query(
    'UPDATE ai_learned_rules SET rule_text = $2 WHERE id = $1',
    [id, ruleText],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Bulk-delete multiple rules by IDs. Returns number of rows deleted. */
export async function deleteRules(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await pool.query(
    'DELETE FROM ai_learned_rules WHERE id = ANY($1::int[])',
    [ids],
  );
  return result.rowCount ?? 0;
}
