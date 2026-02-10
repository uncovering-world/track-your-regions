/**
 * OpenAI Service for AI-assisted region grouping
 *
 * This service handles communication with OpenAI API to suggest
 * which group a region belongs to, or if it should be split.
 */

import OpenAI from 'openai';
import { calculateCost, loadPricing } from './pricingService.js';

// Initialize OpenAI client (will be null if no API key)
let openai: OpenAI | null = null;

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
    // These typically have "gpt" in the name and support chat format
    const chatModels = models.filter(m => {
      const id = m.id.toLowerCase();
      
      // Must contain 'gpt'
      if (!id.includes('gpt')) return false;
      
      // Exclude non-chat variants
      if (id.includes('instruct')) return false;
      if (id.includes('vision')) return false;
      if (id.includes('realtime')) return false;
      if (id.includes('audio')) return false;
      if (id.includes('transcribe')) return false;
      if (id.includes('tts')) return false;
      if (id.includes('whisper')) return false;
      if (id.includes('embedding')) return false;
      if (id.includes('search')) return false;
      if (id.includes('similarity')) return false;
      if (id.includes('edit')) return false;
      if (id.includes('insert')) return false;
      if (id.includes('moderation')) return false;
      if (id.includes('davinci')) return false;
      if (id.includes('curie')) return false;
      if (id.includes('babbage')) return false;
      if (id.includes('ada')) return false;
      
      return true;
    });

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

export function getAvailableModels(): AIModel[] {
  return cachedModels;
}

export function initOpenAI() {
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
 * - 'fast': Cheap model, low temperature, only answer if super confident
 * - 'reasoning': More expensive model with reasoning, still strict confidence
 * - 'reasoning_search': Reasoning + web search for maximum accuracy
 */
export type EscalationLevel = 'fast' | 'reasoning' | 'reasoning_search';

/**
 * Response from AI suggesting group assignment
 */
export interface GroupSuggestionResponse {
  suggestedGroup: string | null;
  confidence: 'high' | 'medium' | 'low';
  shouldSplit: boolean;
  splitGroups?: string[];
  reasoning: string;
  context?: string;
  sources?: string[];
  usage?: TokenUsage;
  /** The escalation level used for this response */
  escalationLevel?: EscalationLevel;
  /** If true, AI recommends escalating to next level for better accuracy */
  needsEscalation?: boolean;
}

/**
 * Ask AI to suggest which group a region belongs to
 *
 * @param escalationLevel - Controls the AI behavior:
 *   - 'fast': Cheap model, only answer if 100% certain, otherwise say "uncertain"
 *   - 'reasoning': Use reasoning model, think deeper, still be strict
 *   - 'reasoning_search': Use reasoning + web search for maximum accuracy
 */
export async function suggestGroupForRegion(
  regionPath: string,
  regionName: string,
  availableGroups: string[],
  parentRegion: string,
  groupDescriptions?: Record<string, string>,
  useWebSearch?: boolean,
  worldViewSource?: string,
  escalationLevel: EscalationLevel = 'fast'
): Promise<GroupSuggestionResponse> {
  if (!openai) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }

  if (availableGroups.length === 0) {
    throw new Error('No groups available. Please create at least one group first.');
  }

  // Determine if we should use web search based on escalation level
  const shouldUseWebSearch = escalationLevel === 'reasoning_search' || useWebSearch;

  // Build context for web search
  let contextInfo = '';
  if (worldViewSource) {
    contextInfo += `\nThe list of groups was created according to: ${worldViewSource}`;
    if (shouldUseWebSearch) {
      contextInfo += `\nIMPORTANT: You have web search enabled. FIRST search for "${worldViewSource}" as your PRIMARY source of truth for how regions should be grouped. Use this source to verify your classification.`;
    }
  }

  // Adjust system prompt based on escalation level
  const strictnessNote = escalationLevel === 'fast'
    ? `\nIMPORTANT: Only answer with "high" confidence if you are 100% CERTAIN. If you have ANY doubt, set confidence to "low" and set needsEscalation to true. It's better to escalate than to guess wrong.`
    : escalationLevel === 'reasoning'
    ? `\nThink step by step. Consider historical, geographical, and administrative boundaries carefully. If still uncertain after reasoning, set needsEscalation to true.`
    : `\nYou have web search available. Search for authoritative sources. Only mark needsEscalation if even with search you cannot determine the answer.`;

  const systemPrompt = `You are a geography expert classifying regions into PROVIDED groups ONLY.

CRITICAL RULES:
- You MUST assign the region to one of the PROVIDED groups - do NOT suggest groups outside the list
- The provided groups are the ONLY valid options - they come from an authoritative source
- "high" = absolutely certain, you would bet money on this
- "medium" = likely but some ambiguity possible  
- "low" = uncertain, but still pick the BEST match from the provided groups
- If a region spans multiple PROVIDED groups (2 or more), set shouldSplit=true and list them in splitGroups
- NEVER say a region "doesn't fit" or "is outside scope" - always find the best match from the list
- If shouldSplit is true, you MUST set suggestedGroup to null
${strictnessNote}

Respond with valid JSON only, no markdown.${contextInfo}`;

  const sourceInstruction = shouldUseWebSearch
    ? '\nInclude a "sources" array of URLs you used for verification.'
    : '';

  const userPrompt = `Task: Classify the administrative region "${regionName}" into exactly ONE of the provided groups for "${parentRegion}".
\nRegion path: ${regionPath}
\nIMPORTANT: You MUST use ONLY the groups listed below. These groups are authoritative.
\nAvailable groups (USE ONLY THESE):
${availableGroups.map((g, i) => `${i + 1}. ${g}`).join('\n')}
${groupDescriptions && Object.keys(groupDescriptions).length ? `\nGroup descriptions:\n${Object.entries(groupDescriptions).map(([g,d]) => `${g}: ${d}`).join('\n')}` : ''}
\nFind the BEST match from the provided groups. If the region spans multiple groups, set shouldSplit=true and list ALL of them in splitGroups.${sourceInstruction}
\nJSON response (no markdown):
{"suggestedGroup": "Exact Group Name" or null, "confidence": "high"|"medium"|"low", "shouldSplit": true|false, "splitGroups": [...], "reasoning": "Brief explanation", "needsEscalation": true|false, "sources": [...]}`;

  console.log('\n🤖 AI Request:');
  console.log(`   Model: ${shouldUseWebSearch ? webSearchModel : currentModel}`);
  console.log(`   Escalation: ${escalationLevel}`);
  console.log(`   Region: "${regionName}"`);
  console.log(`   Groups: [${availableGroups.join(', ')}]`);
  if (shouldUseWebSearch) {
    console.log(`   🌐 Web search enabled`);
  }
  console.log(`   📤 System Prompt:\n${systemPrompt}`);
  console.log(`   📤 User Prompt:\n${userPrompt}`);

  try {
    let content: string | null = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokensUsed = 0;

    // Use webSearchModel when web search is enabled
    const modelToUse = shouldUseWebSearch ? webSearchModel : currentModel;

    // Temperature based on escalation level
    // fast = very low (deterministic), reasoning = slightly higher for creativity
    const temperature = escalationLevel === 'fast' ? 0.1 : 0.3;
    const topP = escalationLevel === 'fast' ? 0.9 : 0.95;

    if (shouldUseWebSearch) {
      try {
        console.log(`   🌐 Using web search model: ${webSearchModel}`);
        // Use responses API with web search tool
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (openai as any).responses.create({
          model: webSearchModel,
          tools: [{ type: 'web_search_preview' }],
          input: `${systemPrompt}\n\n${userPrompt}`,
        });

        content = response.output_text || null;
        promptTokens = response.usage?.input_tokens ?? 0;
        completionTokens = response.usage?.output_tokens ?? 0;
        totalTokensUsed = promptTokens + completionTokens;

        console.log(`   🌐 Web search completed successfully`);
      } catch (webSearchError) {
        console.log(`   ⚠️ Web search failed, falling back to standard API:`, webSearchError instanceof Error ? webSearchError.message : webSearchError);
      }
    }

    // Standard chat completions (or fallback if web search failed)
    if (!content) {
      const response = await openai.chat.completions.create({
        model: modelToUse,
        temperature,
        top_p: topP,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      content = response.choices[0]?.message?.content || null;
      promptTokens = response.usage?.prompt_tokens ?? 0;
      completionTokens = response.usage?.completion_tokens ?? 0;
      totalTokensUsed = response.usage?.total_tokens ?? 0;
    }

    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Capture token usage and calculate cost (including web search cost if used)
    const webSearchWasUsed = shouldUseWebSearch && content !== null;
    const costResult = calculateCost(promptTokens, completionTokens, modelToUse, webSearchWasUsed);

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: totalTokensUsed,
      cost: {
        inputCost: costResult.inputCost,
        outputCost: costResult.outputCost,
        webSearchCost: costResult.webSearchCost,
        totalCost: costResult.totalCost,
      },
      model: modelToUse,
    };

    console.log(`✅ AI Response${shouldUseWebSearch ? ' 🌐' : ''} [${escalationLevel}]:`, content);
    console.log(`   💰 Tokens: ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${usage.totalTokens} total`);
    console.log(`   💵 Cost: $${usage.cost.totalCost.toFixed(6)} (input: $${usage.cost.inputCost.toFixed(6)}, output: $${usage.cost.outputCost.toFixed(6)}${webSearchWasUsed ? `, search: $${usage.cost.webSearchCost.toFixed(6)}` : ''})`);
    console.log(`   📊 Avg per region: $${usage.cost.totalCost.toFixed(6)} (1 region)`);

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim()) as GroupSuggestionResponse;

    // Validate suggested group exists
    if (parsed.suggestedGroup && !availableGroups.includes(parsed.suggestedGroup)) {
      const match = availableGroups.find(g => g.toLowerCase() === parsed.suggestedGroup?.toLowerCase());
      parsed.suggestedGroup = match || null;
      if (!match) parsed.confidence = 'low';
    }

    // Auto-set needsEscalation for low confidence in fast mode
    const needsEscalation = parsed.needsEscalation ?? (escalationLevel === 'fast' && parsed.confidence !== 'high');

    return {
      suggestedGroup: parsed.suggestedGroup ?? null,
      confidence: parsed.confidence ?? 'low',
      shouldSplit: parsed.shouldSplit ?? false,
      splitGroups: parsed.splitGroups,
      reasoning: parsed.reasoning ?? '',
      context: parsed.context,
      sources: parsed.sources,
      usage,
      escalationLevel,
      needsEscalation,
    };
  } catch (error) {
    console.log('❌ AI Error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Batch result with total usage
 */
export interface BatchSuggestionResult {
  suggestions: Map<string, GroupSuggestionResponse>;
  totalUsage: TokenUsage;
  apiRequestsCount: number;
}

/**
 * Batch process multiple regions for group suggestions
 * Processes in batches of 20 to avoid token limits
 */
export async function suggestGroupsForMultipleRegions(
  regions: Array<{ path: string; name: string }>,
  availableGroups: string[],
  parentRegion: string,
  worldViewDescription?: string,
  worldViewSource?: string,
  useWebSearch?: boolean,
  groupDescriptions?: Record<string, string>
): Promise<BatchSuggestionResult> {
  if (!openai) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }

  if (availableGroups.length === 0) {
    throw new Error('No groups available. Please create at least one group first.');
  }

  const BATCH_SIZE = 20;
  const allResults = new Map<string, GroupSuggestionResponse>();
  let apiRequestsCount = 0;
  // Use webSearchModel when web search is enabled for accurate cost tracking
  const modelForCosts = useWebSearch ? webSearchModel : currentModel;
  const totalUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: { inputCost: 0, outputCost: 0, webSearchCost: 0, totalCost: 0 },
    model: modelForCosts,
  };

  // Build context about what this classification is for
  let contextInfo = '';
  if (worldViewDescription) {
    contextInfo += `\nContext: This classification is for a World View used by: ${worldViewDescription}`;
  }
  if (worldViewSource) {
    contextInfo += `\nThe list of groups was created according to: ${worldViewSource}`;
    if (useWebSearch) {
      contextInfo += `\nIMPORTANT: You have web search enabled. FIRST search for "${worldViewSource}" as your PRIMARY source of truth for how regions should be grouped. Use this source to verify your classifications.`;
    }
  }

  // Process in batches
  for (let i = 0; i < regions.length; i += BATCH_SIZE) {
    const batch = regions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(regions.length / BATCH_SIZE);

    console.log(`\n🤖 AI Batch Request (${batchNum}/${totalBatches})${useWebSearch ? ' 🌐 WITH WEB SEARCH' : ''}:`);
    console.log(`   Model: ${currentModel}`);
    console.log(`   Parent: ${parentRegion}`);
    console.log(`   Groups: [${availableGroups.join(', ')}]`);
    if (worldViewDescription) {
      console.log(`   Description: ${worldViewDescription}`);
    }
    if (worldViewSource) {
      console.log(`   Source: ${worldViewSource}`);
    }
    console.log(`   Regions (${batch.length}): [${batch.map(r => r.name).join(', ')}]`);

    const systemPrompt = `You are a geography expert classifying regions into PROVIDED groups ONLY.

CRITICAL RULES:
- You MUST assign each division to one of the PROVIDED groups - do NOT suggest groups outside the list
- The provided groups are the ONLY valid options - they come from an authoritative source
- "high" = absolutely certain based on the source
- "medium" = likely but some ambiguity possible  
- "low" = uncertain, but still pick the BEST match from the provided groups
- If a region spans multiple PROVIDED groups (2 or more), set shouldSplit=true and list them in splitGroups
- NEVER say a region "doesn't fit" or "is outside scope" - always find the best match from the list
- Respond with valid JSON only, no markdown.${contextInfo}`;

    const sourceInstruction = useWebSearch
      ? '\nInclude a "sources" array of URLs you used for verification.'
      : '';

    const userPrompt = `Classify these administrative divisions of "${parentRegion}" into the provided groups.
\nIMPORTANT: You MUST use ONLY the groups listed below. These groups are authoritative - do not suggest any region is "outside scope".
\nDivisions to classify:
${batch.map((r, i) => `${i + 1}. ${r.name}`).join('\n')}
\nAvailable groups (USE ONLY THESE): ${availableGroups.join(', ')}
${groupDescriptions && Object.keys(groupDescriptions).length ? `\nGroup descriptions:\n${Object.entries(groupDescriptions).map(([g,d]) => `${g}: ${d}`).join('\n')}` : ''}
\nFor EACH division, find the BEST match from the provided groups. If a division spans MULTIPLE groups historically, set shouldSplit=true and list ALL groups in splitGroups.${sourceInstruction}
\nJSON response (no markdown, use exact division names as keys):
{"DivisionName": {"suggestedGroup": "Group" or null, "confidence": "high"|"medium"|"low", "shouldSplit": true|false, "splitGroups": ["G1","G2",...] (if shouldSplit=true), "reasoning": "brief fact", "sources": ["url1",...] (if web search)}, ...}`;

    console.log(`   📤 System Prompt:\n${systemPrompt}`);
    console.log(`   📤 User Prompt:\n${userPrompt}`);

    try {
      let content: string | null = null;
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      // Use webSearchModel when web search is enabled
      const modelToUse = useWebSearch ? webSearchModel : currentModel;

      if (useWebSearch) {
        try {
          console.log(`   🌐 Using web search model: ${webSearchModel}`);
          // Use responses API with web search tool
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response = await (openai as any).responses.create({
            model: webSearchModel,
            tools: [{ type: 'web_search_preview' }],
            input: `${systemPrompt}\n\n${userPrompt}`,
          });

          content = response.output_text || null;
          promptTokens = response.usage?.input_tokens ?? 0;
          completionTokens = response.usage?.output_tokens ?? 0;
          totalTokens = promptTokens + completionTokens;

          console.log(`   🌐 Web search completed successfully`);
        } catch (webSearchError) {
          console.log(`   ⚠️ Web search failed, falling back to standard API:`, webSearchError instanceof Error ? webSearchError.message : webSearchError);
        }
      }

      // Standard chat completions (or fallback if web search failed)
      if (!content) {
        const response = await openai.chat.completions.create({
          model: modelToUse,
          temperature: 0.2, // Low temperature for consistent results
          top_p: 0.9,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        content = response.choices[0]?.message?.content || null;
        promptTokens = response.usage?.prompt_tokens ?? 0;
        completionTokens = response.usage?.completion_tokens ?? 0;
        totalTokens = response.usage?.total_tokens ?? 0;
      }

      if (!content) {
        console.log(`❌ Empty response for batch ${batchNum}`);
        continue;
      }

      // Count this as a successful API request
      apiRequestsCount++;

      // Capture token usage for this batch and calculate cost
      const batchPromptTokens = promptTokens;
      const batchCompletionTokens = completionTokens;
      const webSearchWasUsed = useWebSearch && content !== null;
      const batchCost = calculateCost(batchPromptTokens, batchCompletionTokens, modelToUse, webSearchWasUsed);

      totalUsage.promptTokens += batchPromptTokens;
      totalUsage.completionTokens += batchCompletionTokens;
      totalUsage.totalTokens += totalTokens;
      totalUsage.cost.inputCost += batchCost.inputCost;
      totalUsage.cost.outputCost += batchCost.outputCost;
      totalUsage.cost.webSearchCost += batchCost.webSearchCost;
      totalUsage.cost.totalCost += batchCost.totalCost;

      console.log(`✅ AI Response (batch ${batchNum})${useWebSearch ? ' 🌐' : ''}:`, content.substring(0, 200) + '...');
      console.log(`   💰 Tokens: ${batchPromptTokens} prompt + ${batchCompletionTokens} completion = ${totalTokens} total`);
      console.log(`   💵 Cost: $${batchCost.totalCost.toFixed(6)}${webSearchWasUsed ? ` (incl. search: $${batchCost.webSearchCost.toFixed(6)})` : ''}`);
      console.log(`   📊 Avg per region: $${(batchCost.totalCost / batch.length).toFixed(6)} (${batch.length} regions)`);

      // Extract JSON from response
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim()) as Record<string, GroupSuggestionResponse>;

      for (const [name, suggestion] of Object.entries(parsed)) {
        if (suggestion && typeof suggestion === 'object') {
          allResults.set(name, {
            suggestedGroup: suggestion.suggestedGroup ?? null,
            confidence: suggestion.confidence ?? 'low',
            shouldSplit: suggestion.shouldSplit ?? false,
            splitGroups: suggestion.splitGroups,
            reasoning: suggestion.reasoning ?? '',
            context: suggestion.context,
            sources: suggestion.sources,
          });
        }
      }
    } catch (error) {
      console.log(`❌ AI Batch Error (batch ${batchNum}):`, error instanceof Error ? error.message : error);
      // Continue with next batch instead of failing entirely
    }
  }

  console.log(`\n✅ Processed ${allResults.size}/${regions.length} regions total in ${apiRequestsCount} API request(s)`);
  console.log(`   💰 Total tokens: ${totalUsage.promptTokens} prompt + ${totalUsage.completionTokens} completion = ${totalUsage.totalTokens} total`);
  console.log(`   💵 Total cost: $${totalUsage.cost.totalCost.toFixed(6)}`);
  console.log(`   📊 Avg per region: $${(totalUsage.cost.totalCost / regions.length).toFixed(6)} (${regions.length} regions)`);
  return { suggestions: allResults, totalUsage, apiRequestsCount };
}

/**
 * Result from generating group descriptions
 */
export interface GroupDescriptionsResult {
  descriptions: Record<string, string>;
  usage: TokenUsage;
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
  if (!openai) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }
  if (groups.length === 0) {
    return {
      descriptions: {},
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: { inputCost: 0, outputCost: 0, webSearchCost: 0, totalCost: 0 }, model: currentModel }
    };
  }

  const contextParts: string[] = [];
  if (worldViewDescription) contextParts.push(`World View purpose: ${worldViewDescription}`);
  if (worldViewSource) {
    contextParts.push(`Groups were defined according to: ${worldViewSource}`);
    if (useWebSearch) {
      contextParts.push(`IMPORTANT: You have web search enabled. FIRST search for "${worldViewSource}" as your PRIMARY source of truth for understanding these groups.`);
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

  const userPrompt = `Generate descriptions for these groups within a larger region:
${groups.map(g => `- ${g}`).join('\n')}
${context}

Return a JSON object where keys are the exact group names and values are the descriptions:
{"GroupName": "Description...", ...}`;

  console.log('\n📝 AI Group Descriptions Request:');
  console.log(`   Model: ${useWebSearch ? webSearchModel : currentModel}`);
  console.log(`   Groups: [${groups.join(', ')}]`);
  if (useWebSearch) {
    console.log(`   🌐 Web search enabled`);
  }
  console.log(`   📤 System Prompt:\n${systemPrompt}`);
  console.log(`   📤 User Prompt:\n${userPrompt}`);

  let content: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokensUsed = 0;
  const modelToUse = useWebSearch ? webSearchModel : currentModel;

  if (useWebSearch) {
    try {
      console.log(`   🌐 Using web search model: ${webSearchModel}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (openai as any).responses.create({
        model: webSearchModel,
        tools: [{ type: 'web_search_preview' }],
        input: `${systemPrompt}\n\n${userPrompt}`,
      });

      content = response.output_text || null;
      promptTokens = response.usage?.input_tokens ?? 0;
      completionTokens = response.usage?.output_tokens ?? 0;
      totalTokensUsed = promptTokens + completionTokens;

      console.log(`   🌐 Web search completed successfully`);
    } catch (webSearchError) {
      console.log(`   ⚠️ Web search failed, falling back to standard API:`, webSearchError instanceof Error ? webSearchError.message : webSearchError);
    }
  }

  // Standard chat completions (or fallback)
  if (!content) {
    const response = await openai.chat.completions.create({
      model: modelToUse,
      temperature: 0.1, // Lower temperature for more factual responses
      top_p: 0.9,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    content = response.choices[0]?.message?.content || null;
    promptTokens = response.usage?.prompt_tokens ?? 0;
    completionTokens = response.usage?.completion_tokens ?? 0;
    totalTokensUsed = response.usage?.total_tokens ?? 0;
  }

  if (!content) throw new Error('Empty response from OpenAI');

  // Calculate usage (including web search cost if used)
  const webSearchWasUsed = useWebSearch && content !== null;
  const costResult = calculateCost(promptTokens, completionTokens, modelToUse, webSearchWasUsed);

  const usage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: totalTokensUsed,
    cost: {
      inputCost: costResult.inputCost,
      outputCost: costResult.outputCost,
      webSearchCost: costResult.webSearchCost,
      totalCost: costResult.totalCost,
    },
    model: modelToUse,
  };

  console.log(`✅ AI Descriptions Response${useWebSearch ? ' 🌐' : ''}:`, content.substring(0, 200) + '...');
  console.log(`   💰 Tokens: ${promptTokens} prompt + ${completionTokens} completion = ${usage.totalTokens} total`);
  console.log(`   💵 Cost: $${usage.cost.totalCost.toFixed(6)}${webSearchWasUsed ? ` (incl. search: $${usage.cost.webSearchCost.toFixed(6)})` : ''}`);

  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  const descriptions = JSON.parse(jsonStr.trim()) as Record<string, string>;

  return { descriptions, usage };
}

/**
 * Use AI to geocode a natural-language place description.
 * Returns coordinates, a resolved name, and a confidence level.
 */
export interface AIGeocodeResult {
  lat: number;
  lng: number;
  name: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function geocodeDescription(description: string): Promise<AIGeocodeResult> {
  if (!openai) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }

  const systemPrompt = `You are a geocoding assistant. Given a description of a place, return its coordinates.
Respond with valid JSON only, no markdown. Format:
{"lat": number, "lng": number, "name": "Resolved place name", "confidence": "high"|"medium"|"low"}

- "high" = well-known, unambiguous place
- "medium" = likely correct but could be ambiguous
- "low" = best guess, uncertain`;

  const response = await openai.chat.completions.create({
    model: currentModel,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Geocode this place: ${description}` },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  return JSON.parse(jsonStr.trim()) as AIGeocodeResult;
}
