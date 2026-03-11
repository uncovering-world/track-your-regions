/**
 * AI Interview Service for extraction questions.
 *
 * Modern HITL (Human-in-the-Loop) pattern for AI-assisted decision making:
 * - AI recommends with confidence → human confirms or overrides
 * - One structured question at a time with clickable options
 * - Answers produce GENERIC rules that improve ALL future extractions
 * - Learned rules inform the AI's recommendation but never bypass the admin
 *
 * Uses a separate (potentially smarter) model configured as 'extraction_interview'.
 */

import type OpenAI from 'openai';
import type { RegionPreview } from './types.js';
import { getModelForFeature } from '../ai/aiSettingsService.js';
import { getRules } from '../ai/learnedRulesService.js';
import { calculateCost } from '../ai/pricingService.js';
import { chatCompletion } from '../ai/chatCompletion.js';
import { logAIUsage } from '../ai/aiUsageLogger.js';
import type { AIExtractionAccumulator } from './aiRegionParser.js';

export interface InterviewQuestion {
  text: string;
  options: Array<{ label: string; value: string }>;
  /** Index of the recommended option (AI's suggestion) */
  recommended: number | null;
  /** Existing rules relevant to this question (for admin to review/manage) */
  relatedRules?: Array<{ id: number; text: string }>;
}

/** Result of formulateQuestion: always a question for the admin */
export type FormulateResult = { question: InterviewQuestion };

export interface AnswerResult {
  /** Generic rule to save (if the answer produced one) */
  rule: string | null;
  /** Whether extraction can proceed without more questions */
  canProceed: boolean;
  /** Guidance for re-extraction (injected as adminFeedback) */
  reExtractGuidance: string | null;
}

const FORMULATE_SYSTEM = `You are a travel geography expert helping an admin organize a Wikivoyage region hierarchy.

The extraction AI processed a page and produced regions, but has uncertainties.
ALWAYS formulate a question for the admin. Use existing rules to INFORM your recommendation, not to bypass the admin.

QUESTION PRIORITY — always ask in this order:
1. FIRST: "Should this region be split into subregions at all?" — This is the most impactful decision.
   Look at page existence stats: if many subregions lack dedicated Wikivoyage pages, splitting is likely
   not useful. For subregions of a country where <50% of suggested subregions have pages, recommend NOT splitting.
2. ONLY IF splitting makes sense: ask about specific grouping or structure questions.

CITY DETECTION: If extracted regions use "Parent/District" subpage format (e.g., "Taichung/Central Taichung"),
this means the page describes a CITY with districts. Cities are always leaves — recommend treating as leaf.

RULES FOR QUESTIONS:
1. ONE question only — the most impactful one.
2. Provide 2-4 concise options. Always include "Other" as the last option.
3. Frame options as actionable decisions (what the system should DO), not descriptions.
4. Include your RECOMMENDATION — which option you think is correct and why. If an existing rule supports your recommendation, say so.
5. Keep the question short. The admin can see the Wikivoyage page for context.
6. Include page coverage stats in the question when relevant (e.g., "only 2 of 7 have pages").
7. If any existing rules are RELATED to this question, include their IDs in related_rules so the admin can review them.

Return JSON:
{
  "question": "Should this region be split?",
  "options": [
    {"label": "Don't split — treat as leaf", "value": "no_split"},
    {"label": "Split — keep subregions", "value": "split"},
    {"label": "Other", "value": "other"}
  ],
  "recommended": 0,
  "reasoning": "...",
  "related_rules": [8, 9]
}

Return ONLY JSON, no markdown fencing.`;

const PROCESS_ANSWER_SYSTEM = `You process admin answers to extraction questions and produce GENERIC rules for future use.

The admin answered a question about a specific Wikivoyage page. Determine:
1. A GENERIC rule (if the answer generalizes beyond this page)
2. Re-extraction guidance for this specific page
3. Whether more questions are needed

GENERIC RULE guidelines:
- Rules must be broadly applicable: "Cities should always be leaf nodes" NOT "Beijing is a leaf"
- Rules describe CATEGORIES: "island territories", "city districts", "autonomous regions"
- If the answer is too page-specific, set rule to null
- One concise sentence
- IMPORTANT: Check the EXISTING RULES below. Do NOT create a rule that duplicates or contradicts an existing one.
  If the answer aligns with an existing rule, set rule to null (already covered).
  If the answer CONTRADICTS an existing rule, the admin's new answer takes precedence — set rule to a corrected version that supersedes the old one.

RE-EXTRACT GUIDANCE:
- Specific instruction for the extraction AI about this page
- Reference the admin's decision directly

Return JSON:
{
  "rule": "When a Wikivoyage page describes a city (not a country/state/province), return empty regions — cities are always leaf nodes." or null,
  "canProceed": true,
  "reExtractGuidance": "This is a city. Return empty regions array.",
  "needsMoreQuestions": false
}

Return ONLY JSON, no markdown fencing.`;

function buildRegionSummary(regions: RegionPreview[]): string {
  return regions
    .map(r => {
      const parts = [r.isLink ? r.name : `${r.name} (grouping)`];
      if (r.pageExists === false) parts.push('[no page]');
      if (r.children.length > 0) {
        // Annotate children with page existence
        const childParts = r.children.map(c => {
          const exists = r.childPageExists?.[c];
          if (exists === false) return `${c} [no page]`;
          return c;
        });
        parts.push(`→ ${childParts.join(', ')}`);
      }
      return parts.join(' ');
    })
    .join('\n  ');
}

/**
 * Compute page-existence coverage stats for all subregions.
 * Every top-level region counts as a subregion (grouping or leaf — doesn't matter for split decisions).
 */
function buildCoverageStats(regions: RegionPreview[]): string {
  const total = regions.length;
  if (total === 0) return '';

  let withPage = 0;
  let withoutPage = 0;

  for (const r of regions) {
    if (r.isLink && r.pageExists === true) withPage++;
    else if (r.isLink && r.pageExists === false) withoutPage++;
    else if (!r.isLink) withoutPage++; // grouping nodes don't have dedicated pages
  }

  const pct = Math.round((withPage / total) * 100);
  let stats = `Page coverage: ${withPage}/${total} subregions have dedicated Wikivoyage pages (${pct}%)`;
  if (withoutPage > 0) stats += `, ${withoutPage} without pages`;
  const unknown = total - withPage - withoutPage;
  if (unknown > 0) stats += `, ${unknown} unknown`;
  return stats;
}

/**
 * Formulate an interview question with a recommendation informed by existing rules.
 */
export async function formulateQuestion(
  pageTitle: string,
  rawQuestions: string[],
  extractedRegions: RegionPreview[],
  openai: OpenAI,
  accumulator: AIExtractionAccumulator,
): Promise<FormulateResult> {
  const model = await getModelForFeature('extraction_interview');

  // Fetch existing rules for the AI to check
  const existingRules = await getRules('extraction');
  const rulesText = existingRules.length > 0
    ? `\n\nEXISTING RULES (check if any already answer this):\n${existingRules.map(r => `[Rule #${r.id}] ${r.ruleText}`).join('\n')}`
    : '';

  const regionSummary = buildRegionSummary(extractedRegions);
  const coverageStats = buildCoverageStats(extractedRegions);

  const userContent = `Page: "${pageTitle}"
${coverageStats ? `\n${coverageStats}\n` : ''}
AI's uncertainties:
${rawQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Currently extracted regions:
  ${regionSummary || '(none)'}
${rulesText}

Formulate a question for the admin. Use the rules above to inform your recommendation.`;

  const response = await chatCompletion(openai, {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: FORMULATE_SYSTEM },
      { role: 'user', content: userContent },
    ],
  });

  trackUsage(response, model, `Interview question for "${pageTitle}"`, accumulator);

  const text = response.choices[0]?.message?.content?.trim() ?? '{}';
  const jsonStr = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(jsonStr) as {
      question?: string;
      options?: Array<{ label: string; value: string }>;
      recommended?: number | null;
      related_rules?: number[];
    };

    // Build related rules with their text
    const relatedRuleIds = parsed.related_rules ?? [];
    const relatedRules = relatedRuleIds
      .map(id => existingRules.find(r => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .map(r => ({ id: r.id, text: r.ruleText }));

    return {
      question: {
        text: parsed.question ?? rawQuestions[0] ?? 'How should this page be handled?',
        options: parsed.options ?? [
          { label: 'Accept as-is', value: 'accept' },
          { label: 'Skip this region', value: 'skip' },
          { label: 'Other', value: 'other' },
        ],
        recommended: parsed.recommended ?? null,
        relatedRules: relatedRules.length > 0 ? relatedRules : undefined,
      },
    };
  } catch {
    return {
      question: {
        text: rawQuestions[0] ?? 'How should this page be handled?',
        options: [
          { label: 'Accept current extraction', value: 'accept' },
          { label: 'Skip this region', value: 'skip' },
          { label: 'Other', value: 'other' },
        ],
        recommended: 0,
      },
    };
  }
}

/**
 * Process an admin's answer and determine next steps.
 * Returns a rule (if generalizable), re-extraction guidance, and whether more questions are needed.
 */
export async function processAnswer(
  pageTitle: string,
  question: InterviewQuestion,
  answer: string,
  rawQuestions: string[],
  extractedRegions: RegionPreview[],
  openai: OpenAI,
  accumulator: AIExtractionAccumulator,
): Promise<AnswerResult> {
  const model = await getModelForFeature('extraction_interview');

  const regionSummary = buildRegionSummary(extractedRegions);

  // Fetch existing rules so the AI can avoid duplicates/contradictions
  const existingRules = await getRules('extraction');
  const existingRulesText = existingRules.length > 0
    ? `\n\nEXISTING RULES (do not duplicate these):\n${existingRules.map(r => `${r.id}. ${r.ruleText}`).join('\n')}`
    : '';

  const userContent = `Page: "${pageTitle}"

Original AI uncertainties:
${rawQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Extracted regions:
  ${regionSummary || '(none)'}

Question asked: "${question.text}"
Admin's answer: "${answer}"
${existingRulesText}

Based on this answer:
1. Is there a GENERIC rule for all similar cases? (not page-specific, and not already covered by existing rules)
2. What guidance for re-processing this page?
3. More questions needed, or proceed?`;

  const response = await chatCompletion(openai, {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: PROCESS_ANSWER_SYSTEM },
      { role: 'user', content: userContent },
    ],
  });

  trackUsage(response, model, `Process answer for "${pageTitle}"`, accumulator);

  const text = response.choices[0]?.message?.content?.trim() ?? '{}';
  const jsonStr = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(jsonStr) as {
      rule?: string | null;
      canProceed?: boolean;
      reExtractGuidance?: string | null;
      needsMoreQuestions?: boolean;
    };
    return {
      rule: parsed.rule ?? null,
      canProceed: parsed.canProceed ?? !parsed.needsMoreQuestions,
      reExtractGuidance: parsed.reExtractGuidance ?? null,
    };
  } catch {
    return {
      rule: null,
      canProceed: true,
      reExtractGuidance: answer,
    };
  }
}

function trackUsage(
  response: OpenAI.Chat.Completions.ChatCompletion,
  model: string,
  description: string,
  accumulator: AIExtractionAccumulator,
): void {
  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cost = calculateCost(promptTokens, completionTokens, model, false);

  accumulator.apiCalls++;
  accumulator.promptTokens += promptTokens;
  accumulator.completionTokens += completionTokens;
  accumulator.totalCost += cost.totalCost;

  logAIUsage({
    feature: 'extraction_interview',
    model,
    description,
    apiCalls: 1,
    promptTokens,
    completionTokens,
    totalCost: cost.totalCost,
  }).catch(err => console.warn('[AI Interview] Failed to log usage:', err instanceof Error ? err.message : err));
}
