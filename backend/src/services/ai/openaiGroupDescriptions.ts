/**
 * Generate short descriptions for each group to assist downstream classification.
 *
 * Called once per World View to populate per-group descriptions that the
 * group-suggestion prompts can use to give the model more context.
 */

import { logAIUsage } from './aiUsageLogger.js';
import {
  getOpenAIClient,
  getModel,
  getWebSearchModel,
  invokeModel,
  buildTokenUsage,
  parseJsonResponse,
  type TokenUsage,
} from './openaiShared.js';

/**
 * Result from generating group descriptions
 */
export interface GroupDescriptionsResult {
  descriptions: Record<string, string>;
  usage: TokenUsage;
}

/**
 * Build the system + user prompts for group description generation.
 */
function buildDescriptionsPrompts(
  groups: string[],
  worldViewDescription: string | undefined,
  worldViewSource: string | undefined,
  useWebSearch: boolean,
): { systemPrompt: string; userPrompt: string } {
  const contextParts: string[] = [];
  if (worldViewDescription) contextParts.push(`World View purpose: ${worldViewDescription}`);
  if (worldViewSource) {
    contextParts.push(`Groups were defined according to: ${worldViewSource}`);
    if (useWebSearch) {
      contextParts.push(
        `IMPORTANT: You have web search enabled. FIRST search for "${worldViewSource}" as your PRIMARY source of truth for understanding these groups.`,
      );
    }
  }
  const context = contextParts.length ? `\nContext:\n${contextParts.join('\n')}` : '';

  const systemPrompt = `You are a concise geography guide. For each group/region name, write a short description (1-2 sentences) to help determine which administrative divisions belong to it.

Include:
- Geographic location/boundaries
- Key cities or landmarks
- Historical context if relevant
- Any defining characteristics

Be factual and crisp. This will be used to classify administrative divisions into these groups.
Respond with valid JSON only, no markdown.`;

  const groupsList = groups.map(g => `- ${g}`).join('\n');
  const userPrompt = `Generate descriptions for these groups within a larger region:
${groupsList}
${context}

Return a JSON object where keys are the exact group names and values are the descriptions:
{"GroupName": "Description...", ...}`;

  return { systemPrompt, userPrompt };
}

/**
 * Log the outgoing request for group descriptions.
 */
function logDescriptionsRequest(
  groups: string[],
  useWebSearch: boolean,
  systemPrompt: string,
  userPrompt: string,
): void {
  console.log('\n📝 AI Group Descriptions Request:');
  console.log(`   Model: ${useWebSearch ? getWebSearchModel() : getModel()}`);
  console.log(`   Groups: [${groups.join(', ')}]`);
  if (useWebSearch) {
    console.log(`   🌐 Web search enabled`);
  }
  console.log(`   📤 System Prompt:\n${systemPrompt}`);
  console.log(`   📤 User Prompt:\n${userPrompt}`);
}

/**
 * Log the response/usage summary for a descriptions call.
 */
function logDescriptionsResponse(
  content: string,
  usage: TokenUsage,
  useWebSearch: boolean,
  webSearchWasUsed: boolean,
): void {
  const searchBadge = useWebSearch ? ' 🌐' : '';
  const preview = content.substring(0, 200) + '...';
  const searchCostStr = webSearchWasUsed
    ? ` (incl. search: $${usage.cost.webSearchCost.toFixed(6)})`
    : '';
  console.log(`✅ AI Descriptions Response${searchBadge}:`, preview);
  console.log(
    `   💰 Tokens: ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${usage.totalTokens} total`,
  );
  console.log(`   💵 Cost: $${usage.cost.totalCost.toFixed(6)}${searchCostStr}`);
}

/**
 * Build an empty descriptions result for the trivial no-groups case.
 */
function emptyDescriptionsResult(): GroupDescriptionsResult {
  return {
    descriptions: {},
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: { inputCost: 0, outputCost: 0, webSearchCost: 0, totalCost: 0 },
      model: getModel(),
    },
  };
}

/**
 * Generate short descriptions for each group to assist in classification
 */
export async function generateGroupDescriptions(
  groups: string[],
  worldViewDescription?: string,
  worldViewSource?: string,
  useWebSearch?: boolean
): Promise<GroupDescriptionsResult> {
  if (!getOpenAIClient()) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }
  if (groups.length === 0) {
    return emptyDescriptionsResult();
  }

  const useWebSearchFlag = Boolean(useWebSearch);
  const { systemPrompt, userPrompt } = buildDescriptionsPrompts(
    groups,
    worldViewDescription,
    worldViewSource,
    useWebSearchFlag,
  );

  logDescriptionsRequest(groups, useWebSearchFlag, systemPrompt, userPrompt);

  const modelToUse = useWebSearchFlag ? getWebSearchModel() : getModel();
  const raw = await invokeModel(systemPrompt, userPrompt, {
    useWebSearch: useWebSearchFlag,
    modelToUse,
    temperature: 0.1,
  });

  if (!raw.content) throw new Error('Empty response from OpenAI');

  const usage = buildTokenUsage(raw, modelToUse);

  logDescriptionsResponse(raw.content, usage, useWebSearchFlag, raw.webSearchWasUsed);

  logAIUsage({
    feature: 'subdivision_assist',
    model: modelToUse,
    description: `Group descriptions: ${groups.length} groups`,
    apiCalls: 1,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalCost: usage.cost.totalCost,
  }).catch(err =>
    console.warn(
      '[OpenAI] Failed to log description usage:',
      err instanceof Error ? err.message : err,
    ),
  );

  const descriptions = parseJsonResponse<Record<string, string>>(raw.content);
  return { descriptions, usage };
}
