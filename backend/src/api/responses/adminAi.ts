/**
 * What the admin AI tools answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/admin/ai.ts` calls, declared once. That is the AI
 * settings and the models priced for them, what the AI features have cost, the
 * learned rules and a model's review of them, and a model's review of an
 * imported hierarchy.
 *
 * What a model wrote (a rule review's suggestions, a hierarchy review's
 * actions) is read out of its answer key by key by the code that asked, so a
 * model that answers with a word or a key of its own reaches the admin as the
 * nearest thing these schemas allow, never as a 500.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

/** A timestamp as the wire carries it. */
const timestamp = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// Settings, prices and cost
// ---------------------------------------------------------------------------

export const AIModelOption = z.strictObject({
  id: z.string(),
  inputPer1M: z.number().describe('US dollars per million input tokens.'),
  outputPer1M: z.number().describe('US dollars per million output tokens.'),
}).describe('A model with a known price, which a feature can be set to use.');
export type AIModelOption = z.infer<typeof AIModelOption>;

export const AISettings = z.strictObject({
  settings: z.record(z.string(), z.string()).describe('Each setting by its key, such as the model a feature uses.'),
  models: z.array(AIModelOption),
}).describe('The AI settings, and the models they can name.');
export type AISettings = z.infer<typeof AISettings>;

export const AISettingSaved = z.strictObject({
  ok: z.literal(true),
}).describe('One AI setting, written.');
export type AISettingSaved = z.infer<typeof AISettingSaved>;

export const AIUsageByModelFeature = z.strictObject({
  feature: z.string(),
  model: z.string(),
  totalCalls: z.number().int(),
  totalPromptTokens: z.number().int(),
  totalCompletionTokens: z.number().int(),
  totalCost: z.number().describe('US dollars.'),
  avgCostPerCall: z.number(),
  lastUsed: timestamp,
}).describe('What one feature has spent on one model.');
export type AIUsageByModelFeature = z.infer<typeof AIUsageByModelFeature>;

export const AIUsageSummary = z.strictObject({
  today: z.number().describe('US dollars spent since midnight, server time.'),
  thisMonth: z.number(),
  allTime: z.number(),
  byModelFeature: z.array(AIUsageByModelFeature).describe('Most recently used first.'),
}).describe('What the AI features have cost.');
export type AIUsageSummary = z.infer<typeof AIUsageSummary>;

export const PricingUpdated = z.strictObject({
  modelsUpdated: z.number().int().describe('Models whose price changed.'),
  modelsAdded: z.number().int().describe('Models priced for the first time.'),
  totalModels: z.number().int().describe('Models priced now.'),
}).describe('Model prices refreshed from the published price list.');
export type PricingUpdated = z.infer<typeof PricingUpdated>;

// ---------------------------------------------------------------------------
// Learned rules
// ---------------------------------------------------------------------------

export const LearnedRule = z.strictObject({
  id: z.number().int(),
  feature: z.string().describe('The AI feature whose prompts carry the rule, such as `extraction`.'),
  ruleText: z.string(),
  context: z.string().nullable().describe('What the rule was learned from.'),
  createdAt: timestamp,
}).describe('A rule an admin\'s answer taught the AI features.');
export type LearnedRule = z.infer<typeof LearnedRule>;

export const PredefinedRule = z.strictObject({
  code: z.string().describe('Stable, such as `extraction.5`, the rule\'s number in its prompt.'),
  feature: z.string(),
  ruleText: z.string(),
}).describe('A rule built into a prompt, shown beside the learned ones and never edited.');
export type PredefinedRule = z.infer<typeof PredefinedRule>;

export const LearnedRules = z.strictObject({
  learned: z.array(LearnedRule).describe('By feature, then oldest first.'),
  predefined: z.array(PredefinedRule),
}).describe('Every rule the AI prompts carry.');
export type LearnedRules = z.infer<typeof LearnedRules>;

export const LearnedRuleDeleted = z.strictObject({
  ok: z.literal(true),
}).describe('A learned rule, deleted.');
export type LearnedRuleDeleted = z.infer<typeof LearnedRuleDeleted>;

export const ReviewSuggestion = z.strictObject({
  type: z.enum(['merge', 'contradiction', 'obsolete']),
  description: z.string(),
  deleteIds: z.array(z.number().int()).describe('Learned rules to delete.'),
  keepId: z.number().int().describe('The learned rule to keep, and to rewrite when `replacementText` is set.'),
  replacementText: z.string().nullable(),
}).describe('One change a model proposes to the learned rules: merge duplicates, resolve a contradiction, or drop an obsolete rule.');
export type ReviewSuggestion = z.infer<typeof ReviewSuggestion>;

export const RuleReviewResult = z.strictObject({
  suggestions: z.array(ReviewSuggestion),
  summary: z.string(),
  consolidatedCount: z.number().int().describe('Learned rules left once every suggestion is applied.'),
}).describe('A model\'s review of the learned rules.');
export type RuleReviewResult = z.infer<typeof RuleReviewResult>;

export const ReviewSuggestionApplied = z.strictObject({
  ok: z.literal(true),
  deletedCount: z.number().int(),
}).describe('One suggestion of a rule review, applied.');
export type ReviewSuggestionApplied = z.infer<typeof ReviewSuggestionApplied>;

// ---------------------------------------------------------------------------
// A model's review of an imported hierarchy
// ---------------------------------------------------------------------------

export const HierarchyReviewAction = z.strictObject({
  id: z.string().describe('The model\'s own id for the action, or `action-N` by its place in the list.'),
  type: z.enum(['rename', 'reparent', 'remove', 'merge', 'dismiss_children', 'add_child', 'other'])
    .describe('`other` for a type the model named that is not one of these.'),
  regionId: z.number().int().nullable().describe('The region the action is about, or null where the model named none.'),
  regionName: z.string(),
  description: z.string(),
  params: z.record(z.string(), z.unknown()).optional().describe('What the action type takes, such as `newName` for a rename.'),
  choices: z.array(z.strictObject({ label: z.string(), value: z.string() })).optional()
    .describe('Where more than one answer is valid, such as two possible parents.'),
}).describe('One change a hierarchy review recommends.');
export type HierarchyReviewAction = z.infer<typeof HierarchyReviewAction>;

export const HierarchyReviewResult = z.strictObject({
  report: z.string().describe('Markdown, a heading per region the review looked at.'),
  actions: z.array(HierarchyReviewAction),
  stats: z.strictObject({
    passes: z.number().int().describe('A branch takes one pass; the whole tree two, a survey and then the flagged branches.'),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    cost: z.number().describe('US dollars.'),
  }),
}).describe('A model\'s review of a world view\'s hierarchy, or of one branch of it.');
export type HierarchyReviewResult = z.infer<typeof HierarchyReviewResult>;
