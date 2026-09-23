/**
 * What the AI client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/ai.ts` calls, and of the AI geocode
 * `frontend/src/api/geocode.ts` makes, declared once. That is whether the AI
 * features are on and which models they use, a model chosen, a group suggested
 * for one region or for a batch of them, the groups' descriptions, and a place
 * geocoded from a description.
 *
 * Every value here that came from a model's answer — a suggestion, a
 * description, a geocode — is read out of that answer key by key by the service
 * that asked (`services/ai/`), so a model that answers with a key or a word of
 * its own reaches the curator as the nearest thing these schemas allow, never as
 * a 500.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const AIModel = z.strictObject({
  id: z.string().describe('The provider\'s model id, which is what a model is chosen by.'),
  name: z.string().describe('The name to list it under, which is its id.'),
  description: z.string().describe('The date the provider published it, as the server\'s locale writes it.'),
}).describe('A chat model the configured API key can use.');
export type AIModel = z.infer<typeof AIModel>;

const modelChoice = {
  currentModel: z.string().describe('The model id the AI features use.'),
  webSearchModel: z.string().describe('The model id a request with web search uses.'),
  availableModels: z.array(AIModel),
  webSearchModels: z.array(AIModel).describe('The models that can search the web.'),
};

export const AIModels = z.strictObject(modelChoice)
  .describe('The models in use and the ones that can be chosen.');
export type AIModels = z.infer<typeof AIModels>;

export const AIStatus = z.strictObject({
  available: z.boolean().describe('Whether an API key is configured, so the AI features can answer.'),
  message: z.string().describe('The sentence to show beside the AI controls.'),
  ...modelChoice,
}).describe('Whether the AI features are on, and the models they use.');
export type AIStatus = z.infer<typeof AIStatus>;

export const ModelSet = z.strictObject({
  success: z.literal(true),
  currentModel: z.string().describe('The model id now in use.'),
}).describe('The model the AI features use, chosen.');
export type ModelSet = z.infer<typeof ModelSet>;

export const WebSearchModelSet = z.strictObject({
  success: z.literal(true),
  webSearchModel: z.string().describe('The model id a request with web search now uses.'),
}).describe('The model a request with web search uses, chosen.');
export type WebSearchModelSet = z.infer<typeof WebSearchModelSet>;

// ---------------------------------------------------------------------------
// What a request cost
// ---------------------------------------------------------------------------

export const TokenUsage = z.strictObject({
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  cost: z.strictObject({
    inputCost: z.number(),
    outputCost: z.number(),
    webSearchCost: z.number(),
    totalCost: z.number(),
  }).describe('In US dollars, from the model\'s price per token.'),
  model: z.string().describe('The model id the request was sent to.'),
}).describe('The tokens a request spent and what they cost.');
export type TokenUsage = z.infer<typeof TokenUsage>;

// ---------------------------------------------------------------------------
// Group suggestions
// ---------------------------------------------------------------------------

export const EscalationLevel = z.enum(['fast', 'reasoning', 'reasoning_search'])
  .describe('How hard a suggestion was asked for: a cheap model, a reasoning one, or reasoning with web search.');
export type EscalationLevel = z.infer<typeof EscalationLevel>;

export const Confidence = z.enum(['high', 'medium', 'low'])
  .describe('How sure the model is: `high` is assigned without asking, `low` is a guess.');
export type Confidence = z.infer<typeof Confidence>;

export const BatchGroupSuggestion = z.strictObject({
  suggestedGroup: z.string().nullable()
    .describe('One of the groups the request offered, or null when none fits or the region should be split.'),
  confidence: Confidence,
  shouldSplit: z.boolean().describe('The region spans more than one group.'),
  splitGroups: z.array(z.string()).optional()
    .describe('When the region should be split: the offered groups it spans. Names the request did not offer are dropped.'),
  reasoning: z.string(),
  context: z.string().optional().describe('Geographic or cultural context the model added.'),
  sources: z.array(z.string()).optional().describe('The pages a web search read.'),
}).describe('Which group one region of a batch belongs to, as the model suggests it.');
export type BatchGroupSuggestion = z.infer<typeof BatchGroupSuggestion>;

export const GroupSuggestion = BatchGroupSuggestion.extend({
  usage: TokenUsage,
  escalationLevel: EscalationLevel,
  needsEscalation: z.boolean()
    .describe('The model advises asking again one level up, since it was not sure at this one.'),
}).describe('Which group one region belongs to, as the model suggests it, and what asking cost.');
export type GroupSuggestion = z.infer<typeof GroupSuggestion>;

export const BatchSuggestions = z.strictObject({
  suggestions: z.record(z.string(), BatchGroupSuggestion)
    .describe('By region name. A region the model did not answer for has no entry.'),
  usage: TokenUsage,
  apiRequestsCount: z.number().int()
    .describe('The requests the model answered, twenty regions to a request. An answer that could not be read is counted and costed but suggests nothing; a request that failed before any answer is neither.'),
}).describe('Group suggestions for a batch of regions, and what they cost, summed over every request the batch made.');
export type BatchSuggestions = z.infer<typeof BatchSuggestions>;

export const GroupDescriptions = z.strictObject({
  descriptions: z.record(z.string(), z.string())
    .describe('A short description per group name, to offer the model beside the names.'),
  usage: TokenUsage,
}).describe('Short descriptions of the groups, and what writing them cost.');
export type GroupDescriptions = z.infer<typeof GroupDescriptions>;

// ---------------------------------------------------------------------------
// A place from a description
// ---------------------------------------------------------------------------

export const AIGeocodeResult = z.strictObject({
  lat: z.number(),
  lng: z.number(),
  name: z.string().describe('The place the model resolved the description to.'),
  confidence: Confidence,
}).describe('A place a curator described in words, located by the model.');
export type AIGeocodeResult = z.infer<typeof AIGeocodeResult>;
