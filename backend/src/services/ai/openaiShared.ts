/**
 * Shared primitives for the OpenAI service.
 *
 * Hosts the module-level `openai` client, model selection state, generic chat
 * / web-search invocation helpers, and reusable prompt-building blocks used
 * across the group-suggestion, group-description, geocoding, and vision-match
 * paths.
 */

import OpenAI from 'openai';
import { calculateCost, loadPricing } from './pricingService.js';
import { chatCompletion } from './chatCompletion.js';

// =============================================================================
// Client state + init
// =============================================================================

// Initialize OpenAI client (will be null if no API key)
let openai: OpenAI | null = null;

/** Accessor used by sibling modules that need the raw SDK client. */
export function getOpenAIClient(): OpenAI | null {
  return openai;
}

export function initOpenAI(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey.length > 0) {
    openai = new OpenAI({ apiKey });
    console.log('✅ OpenAI API initialized');
    // Load pricing data
    loadPricing();
    return true;
  }
  console.log('⚠️  OpenAI API key not configured - AI features disabled');
  return false;
}

export function isOpenAIAvailable(): boolean {
  return openai !== null;
}

// =============================================================================
// Model selection
// =============================================================================

// Model type
export interface AIModel {
  id: string;
  name: string;
  description: string;
}

// Current selected model (default to gpt-4.1, will be updated when models are fetched)
let currentModel: string = 'gpt-4.1';
let webSearchModel: string = 'gpt-4.1';

// Cache for available models
let cachedModels: AIModel[] = [];

export function setModel(modelId: string): boolean {
  currentModel = modelId;
  console.log(`🤖 AI Model set to: ${modelId}`);
  return true;
}

export function setWebSearchModel(modelId: string): boolean {
  webSearchModel = modelId;
  console.log(`🌐 Web Search Model set to: ${modelId}`);
  return true;
}

export function getModel(): string {
  return currentModel;
}

export function getWebSearchModel(): string {
  return webSearchModel;
}

// Models that support web search via Responses API
// NOTE: OpenAI's API does NOT provide a programmatic way to query which models
// support which tools (like web_search_preview). This list is based on
// OpenAI documentation and testing. If a model fails, we gracefully fall back.
const WEB_SEARCH_CAPABLE_MODELS = [
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5.1',
  'gpt-5.2',
];

export function getWebSearchCapableModels(): AIModel[] {
  return cachedModels.filter(m =>
    WEB_SEARCH_CAPABLE_MODELS.some(wsm => m.id.startsWith(wsm))
  );
}

// Substrings that disqualify a model from being used as a chat model
const NON_CHAT_MODEL_TOKENS = [
  'instruct',
  'vision',
  'realtime',
  'audio',
  'transcribe',
  'tts',
  'whisper',
  'embedding',
  'search',
  'similarity',
  'edit',
  'insert',
  'moderation',
  'davinci',
  'curie',
  'babbage',
  'ada',
];

/**
 * Determines whether a given model id identifies a chat-capable model.
 * Chat models must contain "gpt" and must not include any non-chat tokens.
 */
function isChatCapableModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.includes('gpt')) return false;
  return !NON_CHAT_MODEL_TOKENS.some(token => id.includes(token));
}

/**
 * Fetch available models from OpenAI API
 * Returns only chat-capable models
 */
export async function fetchAvailableModelsFromAPI(): Promise<AIModel[]> {
  if (!openai) {
    return [];
  }

  try {
    console.log('🔍 Fetching available models from OpenAI API...');
    const response = await openai.models.list();
    const models = response.data;

    // Only include models that are suitable for chat completions
    const chatModels = models.filter(m => isChatCapableModel(m.id));

    // Sort by creation date (newest first)
    chatModels.sort((a, b) => b.created - a.created);

    console.log(`✅ Found ${chatModels.length} chat models:`);
    chatModels.forEach(m => console.log(`   - ${m.id}`));

    // Map to our format - just use ID and creation date
    const availableModels: AIModel[] = chatModels.map(m => ({
      id: m.id,
      name: m.id,
      description: new Date(m.created * 1000).toLocaleDateString(),
    }));

    // Cache the models
    cachedModels = availableModels;

    // If current model is not in list, switch to first available
    if (availableModels.length > 0 && !availableModels.some(m => m.id === currentModel)) {
      currentModel = availableModels[0].id;
      console.log(`⚠️  Switched to: ${currentModel}`);
    }

    return availableModels;
  } catch (error) {
    console.error('❌ Failed to fetch models:', error instanceof Error ? error.message : error);
    return cachedModels;
  }
}

// =============================================================================
// Shared types used across suggestion/description/vision paths
// =============================================================================

/**
 * Token usage information from API call
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: {
    inputCost: number;
    outputCost: number;
    webSearchCost: number;
    totalCost: number;
  };
  model: string;
}

/**
 * Escalation level for AI requests
 * - 'fast': Cheap model, only answer if super confident
 * - 'reasoning': More expensive model with reasoning, still strict confidence
 * - 'reasoning_search': Reasoning + web search for maximum accuracy
 */
export type EscalationLevel = 'fast' | 'reasoning' | 'reasoning_search';

/**
 * Result of a raw model invocation — captures content and token stats in a
 * shape normalised across Chat Completions and the Responses API.
 */
export interface RawModelResult {
  content: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  webSearchWasUsed: boolean;
}

// =============================================================================
// JSON response helpers
// =============================================================================

/**
 * Extract JSON content from a response that may wrap it in a markdown code
 * block (```json ... ``` or ``` ... ```).
 *
 * This uses bounded, non-backtracking splitting rather than a single regex to
 * avoid super-linear runtime on adversarial input.
 */
function extractJsonFromResponse(content: string): string {
  const fenceStart = content.indexOf('```');
  if (fenceStart === -1) return content.trim();

  // Skip opening fence and optional language tag (e.g. "json\n")
  let bodyStart = fenceStart + 3;
  const afterFence = content.slice(bodyStart);
  // Skip optional language tag up to the next newline
  const newlineIdx = afterFence.indexOf('\n');
  if (newlineIdx !== -1) {
    const lang = afterFence.slice(0, newlineIdx).trim();
    // Accept language tags that are simple identifiers (e.g. json, ts). If
    // the first line already contains content (no language tag or closing
    // fence on same line), we keep the body start at fenceStart + 3.
    if (/^[a-zA-Z0-9_-]{0,16}$/.test(lang)) {
      bodyStart += newlineIdx + 1;
    }
  }

  const body = content.slice(bodyStart);
  const fenceEnd = body.indexOf('```');
  if (fenceEnd === -1) return body.trim();
  return body.slice(0, fenceEnd).trim();
}

/**
 * Parse a JSON payload extracted from a potentially markdown-wrapped response.
 */
export function parseJsonResponse<T>(content: string): T {
  return JSON.parse(extractJsonFromResponse(content)) as T;
}

// =============================================================================
// Model invocation (web search or chat completion)
// =============================================================================

/**
 * Attempt a web-search-enabled call via the Responses API. Returns a partial
 * result whose `content` is null if the call fails (so callers can fall back).
 */
async function callResponsesAPIWithWebSearch(
  systemPrompt: string,
  userPrompt: string,
): Promise<RawModelResult> {
  try {
    console.log(`   🌐 Using web search model: ${webSearchModel}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAI SDK at this version doesn't expose typed `responses.create` (web_search_preview tool path)
    const response = await (openai as any).responses.create({
      model: webSearchModel,
      tools: [{ type: 'web_search_preview' }],
      input: `${systemPrompt}\n\n${userPrompt}`,
    });

    const promptTokens = response.usage?.input_tokens ?? 0;
    const completionTokens = response.usage?.output_tokens ?? 0;

    console.log(`   🌐 Web search completed successfully`);
    return {
      content: response.output_text || null,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      webSearchWasUsed: true,
    };
  } catch (webSearchError) {
    const message = webSearchError instanceof Error ? webSearchError.message : webSearchError;
    console.log(`   ⚠️ Web search failed, falling back to standard API:`, message);
    return {
      content: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      webSearchWasUsed: false,
    };
  }
}

/**
 * Call the standard Chat Completions API with system + user messages.
 */
async function callChatCompletion(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  topP?: number,
): Promise<RawModelResult> {
  const options: Parameters<typeof chatCompletion>[1] = {
    model,
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (topP !== undefined) {
    options.top_p = topP;
  }

  const response = await chatCompletion(openai!, options);
  return {
    content: response.choices[0]?.message?.content || null,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    webSearchWasUsed: false,
  };
}

/**
 * Invoke the model, preferring web search when requested but falling back to
 * standard chat completions if the responses API fails or web search is off.
 */
export async function invokeModel(
  systemPrompt: string,
  userPrompt: string,
  options: {
    useWebSearch: boolean;
    modelToUse: string;
    temperature: number;
    topP?: number;
  },
): Promise<RawModelResult> {
  let result: RawModelResult = {
    content: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    webSearchWasUsed: false,
  };

  if (options.useWebSearch) {
    result = await callResponsesAPIWithWebSearch(systemPrompt, userPrompt);
  }

  if (!result.content) {
    result = await callChatCompletion(
      options.modelToUse,
      systemPrompt,
      userPrompt,
      options.temperature,
      options.topP,
    );
  }

  return result;
}

/**
 * Build a TokenUsage record from raw token counts + derived costs.
 */
export function buildTokenUsage(
  raw: RawModelResult,
  model: string,
): TokenUsage {
  const costResult = calculateCost(
    raw.promptTokens,
    raw.completionTokens,
    model,
    raw.webSearchWasUsed,
  );
  return {
    promptTokens: raw.promptTokens,
    completionTokens: raw.completionTokens,
    totalTokens: raw.totalTokens,
    cost: {
      inputCost: costResult.inputCost,
      outputCost: costResult.outputCost,
      webSearchCost: costResult.webSearchCost,
      totalCost: costResult.totalCost,
    },
    model,
  };
}

// =============================================================================
// Prompt-building primitives
// =============================================================================

/**
 * Build the optional group-descriptions block used by both single and batch
 * prompts. Returns an empty string when no descriptions are provided.
 */
export function buildGroupDescriptionsBlock(groupDescriptions?: Record<string, string>): string {
  if (!groupDescriptions || Object.keys(groupDescriptions).length === 0) {
    return '';
  }
  const lines = Object.entries(groupDescriptions)
    .map(([g, d]) => `${g}: ${d}`)
    .join('\n');
  return `\nGroup descriptions:\n${lines}`;
}

/**
 * Build the context line describing the source of truth for web search.
 */
export function buildWorldViewSourceContext(
  worldViewSource: string | undefined,
  useWebSearch: boolean,
  entity: 'region' | 'regions',
): string {
  if (!worldViewSource) return '';
  let ctx = `\nThe list of groups was created according to: ${worldViewSource}`;
  if (useWebSearch) {
    ctx += `\nIMPORTANT: You have web search enabled. FIRST search for "${worldViewSource}" as your PRIMARY source of truth for how regions should be grouped. Use this source to verify your ${entity === 'region' ? 'classification' : 'classifications'}.`;
  }
  return ctx;
}

/**
 * Pick the strictness note for a single-region suggestion based on escalation.
 */
export function buildStrictnessNote(level: EscalationLevel): string {
  switch (level) {
    case 'fast':
      return `\nIMPORTANT: Only answer with "high" confidence if you are 100% CERTAIN. If you have ANY doubt, set confidence to "low" and set needsEscalation to true. It's better to escalate than to guess wrong.`;
    case 'reasoning':
      return `\nThink step by step. Consider historical, geographical, and administrative boundaries carefully. If still uncertain after reasoning, set needsEscalation to true.`;
    case 'reasoning_search':
      return `\nYou have web search available. Search for authoritative sources. Only mark needsEscalation if even with search you cannot determine the answer.`;
  }
}
