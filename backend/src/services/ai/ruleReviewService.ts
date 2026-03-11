/**
 * Rule Review Service
 *
 * Uses AI to analyze learned rules for duplicates, contradictions, and
 * suggests consolidation. Returns structured suggestions for admin review.
 */

import OpenAI from 'openai';
import { getAllRules, PREDEFINED_RULES } from './learnedRulesService.js';
import { getModelForFeature } from './aiSettingsService.js';
import { chatCompletion } from './chatCompletion.js';
import { calculateCost } from './pricingService.js';
import { logAIUsage } from './aiUsageLogger.js';

export interface ReviewSuggestion {
  /** What to do: merge duplicates, resolve contradiction, or remove obsolete */
  type: 'merge' | 'contradiction' | 'obsolete';
  /** Human-readable explanation */
  description: string;
  /** Rule IDs to delete */
  deleteIds: number[];
  /** Rule ID to keep (and optionally update) */
  keepId: number;
  /** New text for the kept rule (null = keep as-is) */
  replacementText: string | null;
}

export interface RuleReviewResult {
  suggestions: ReviewSuggestion[];
  summary: string;
  /** Number of unique rules after applying all suggestions */
  consolidatedCount: number;
}

const REVIEW_SYSTEM = `You review a set of learned rules used in AI prompts for a Wikivoyage region extraction system.

Analyze the rules for:
1. DUPLICATES — rules that say essentially the same thing (even with different wording)
2. CONTRADICTIONS — rules that give conflicting guidance
3. OBSOLETE — rules that are too specific or no longer useful

For each group of issues, suggest a consolidation action:
- For duplicates: keep the best-worded one, delete the rest. Optionally improve the kept rule's wording.
- For contradictions: keep the most recent (highest ID = latest), delete the conflicting older ones.
- For obsolete/overly-specific rules: mark for deletion.

Return JSON:
{
  "suggestions": [
    {
      "type": "merge",
      "description": "Rules 1, 2, 5 all say not to split when subregions lack pages",
      "deleteIds": [2, 5],
      "keepId": 1,
      "replacementText": "Don't split regions into subregions when fewer than half have dedicated Wikivoyage pages." or null
    }
  ],
  "summary": "Found 15 rules. 7 are duplicates. Suggests consolidating to 8 unique rules.",
  "consolidatedCount": 8
}

Rules:
- keepId MUST be one of the rule IDs from the input
- deleteIds MUST NOT include keepId
- Every rule ID should appear in at most ONE suggestion
- Be conservative: if two rules are similar but cover different nuances, don't merge them
- replacementText should be concise and generic (not page-specific)

Return ONLY JSON, no markdown fencing.`;

export async function reviewRules(): Promise<RuleReviewResult> {
  const allRules = await getAllRules();

  if (allRules.length < 2) {
    return {
      suggestions: [],
      summary: allRules.length === 0
        ? 'No rules to review.'
        : 'Only one rule exists — nothing to consolidate.',
      consolidatedCount: allRules.length,
    };
  }

  const model = await getModelForFeature('rule_review');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Sequential numbering: predefined 1..P, learned P+1..P+L (matches frontend table)
  const predefinedCount = PREDEFINED_RULES.length;
  const seqToDbId = new Map<number, number>();
  allRules.forEach((r, i) => {
    seqToDbId.set(predefinedCount + i + 1, r.id);
  });

  const predefinedText = PREDEFINED_RULES
    .map((r, i) => `[#${i + 1}] (BUILT-IN, feature: ${r.feature}) ${r.ruleText}`)
    .join('\n');

  const learnedText = allRules
    .map((r, i) => `[#${predefinedCount + i + 1}] (learned, feature: ${r.feature}) ${r.ruleText}${r.context ? ` (context: ${r.context})` : ''}`)
    .join('\n');

  const firstLearnedSeq = predefinedCount + 1;
  const lastLearnedSeq = predefinedCount + allRules.length;

  const userContent = `Review these learned rules for duplicates, contradictions, and obsolete entries.

BUILT-IN RULES (cannot be changed — for reference only):
${predefinedText}

LEARNED RULES (can be deleted/merged — review these, #${firstLearnedSeq}–#${lastLearnedSeq}):
${learnedText}

Important: Only suggest changes to LEARNED rules (#${firstLearnedSeq}+). If a learned rule duplicates a built-in rule, suggest deleting the learned rule as obsolete.`;

  const response = await chatCompletion(openai, {
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: REVIEW_SYSTEM },
      { role: 'user', content: userContent },
    ],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cost = calculateCost(promptTokens, completionTokens, model, false);

  logAIUsage({
    feature: 'rule_review',
    model,
    description: `Review ${allRules.length} learned rules`,
    apiCalls: 1,
    promptTokens,
    completionTokens,
    totalCost: cost.totalCost,
  }).catch(err => console.warn('[Rule Review] Failed to log usage:', err instanceof Error ? err.message : err));

  const text = response.choices[0]?.message?.content?.trim() ?? '{}';
  const jsonStr = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(jsonStr) as {
      suggestions?: Array<{
        type?: string;
        description?: string;
        deleteIds?: number[];
        keepId?: number;
        replacementText?: string | null;
      }>;
      summary?: string;
      consolidatedCount?: number;
    };

    // AI responds with sequential numbers — map back to DB IDs
    const validSeqs = new Set(seqToDbId.keys());
    const suggestions: ReviewSuggestion[] = (parsed.suggestions ?? [])
      .filter(s => s.keepId != null && validSeqs.has(s.keepId))
      .map(s => ({
        type: (s.type === 'merge' || s.type === 'contradiction' || s.type === 'obsolete')
          ? s.type : 'merge',
        description: s.description ?? '',
        deleteIds: (s.deleteIds ?? []).filter(id => validSeqs.has(id) && id !== s.keepId)
          .map(id => seqToDbId.get(id)!),
        keepId: seqToDbId.get(s.keepId!)!,
        replacementText: s.replacementText ?? null,
      }));

    return {
      suggestions,
      summary: parsed.summary ?? `Found ${suggestions.length} suggestion(s).`,
      consolidatedCount: parsed.consolidatedCount ?? (allRules.length - suggestions.reduce((n, s) => n + s.deleteIds.length, 0)),
    };
  } catch {
    console.warn('[Rule Review] Failed to parse AI response:', text.slice(0, 200));
    return {
      suggestions: [],
      summary: 'AI review failed to produce valid results. Try again.',
      consolidatedCount: allRules.length,
    };
  }
}
