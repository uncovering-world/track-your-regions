/**
 * OpenAI group suggestions — single-region and batch classification.
 *
 * Ask OpenAI to classify administrative regions into one of a provided group
 * set. Supports escalation levels (fast / reasoning / reasoning + web search)
 * and batch processing in groups of 20.
 */

import { calculateCost } from './pricingService.js';
import { logAIUsage } from './aiUsageLogger.js';
import {
  getOpenAIClient,
  getModel,
  getWebSearchModel,
  invokeModel,
  buildTokenUsage,
  parseJsonResponse,
  buildGroupDescriptionsBlock,
  buildWorldViewSourceContext,
  buildStrictnessNote,
  type TokenUsage,
  type EscalationLevel,
  type RawModelResult,
} from './openaiShared.js';

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
 * Batch result with total usage
 */
export interface BatchSuggestionResult {
  suggestions: Map<string, GroupSuggestionResponse>;
  totalUsage: TokenUsage;
  apiRequestsCount: number;
}

// =============================================================================
// suggestGroupForRegion (single-region classification)
// =============================================================================

/**
 * Build the system + user prompts for a single-region classification.
 */
function buildSingleSuggestionPrompts(args: {
  regionPath: string;
  regionName: string;
  availableGroups: string[];
  parentRegion: string;
  groupDescriptions?: Record<string, string>;
  worldViewSource?: string;
  escalationLevel: EscalationLevel;
  shouldUseWebSearch: boolean;
}): { systemPrompt: string; userPrompt: string } {
  const contextInfo = buildWorldViewSourceContext(
    args.worldViewSource,
    args.shouldUseWebSearch,
    'region',
  );
  const strictnessNote = buildStrictnessNote(args.escalationLevel);

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

  const sourceInstruction = args.shouldUseWebSearch
    ? '\nInclude a "sources" array of URLs you used for verification.'
    : '';

  const groupList = args.availableGroups.map((g, i) => `${i + 1}. ${g}`).join('\n');
  const descriptionsBlock = buildGroupDescriptionsBlock(args.groupDescriptions);

  const userPrompt = `Task: Classify the administrative region "${args.regionName}" into exactly ONE of the provided groups for "${args.parentRegion}".
\nRegion path: ${args.regionPath}
\nIMPORTANT: You MUST use ONLY the groups listed below. These groups are authoritative.
\nAvailable groups (USE ONLY THESE):
${groupList}
${descriptionsBlock}
\nFind the BEST match from the provided groups. If the region spans multiple groups, set shouldSplit=true and list ALL of them in splitGroups.${sourceInstruction}
\nJSON response (no markdown):
{"suggestedGroup": "Exact Group Name" or null, "confidence": "high"|"medium"|"low", "shouldSplit": true|false, "splitGroups": [...], "reasoning": "Brief explanation", "needsEscalation": true|false, "sources": [...]}`;

  return { systemPrompt, userPrompt };
}

/**
 * Log the outgoing AI request context for a single-region suggestion.
 */
function logSingleSuggestionRequest(
  regionName: string,
  availableGroups: string[],
  shouldUseWebSearch: boolean,
  escalationLevel: EscalationLevel,
  systemPrompt: string,
  userPrompt: string,
): void {
  const modelName = shouldUseWebSearch ? getWebSearchModel() : getModel();
  console.log('\n🤖 AI Request:');
  console.log(`   Model: ${modelName}`);
  console.log(`   Region: ${regionName}`);
  console.log(`   Escalation: ${escalationLevel}`);
  console.log(`   Web search: ${shouldUseWebSearch ? 'YES 🌐' : 'no'}`);
  console.log(`   Groups: [${availableGroups.join(', ')}]`);
  console.log(`   📤 System Prompt:\n${systemPrompt}`);
  console.log(`   📤 User Prompt:\n${userPrompt}`);
}

/**
 * Log a successful single-region response summary.
 */
function logSingleSuggestionResponse(
  content: string,
  usage: TokenUsage,
  shouldUseWebSearch: boolean,
  webSearchWasUsed: boolean,
  escalationLevel: EscalationLevel,
): void {
  const searchBadge = shouldUseWebSearch ? ' 🌐' : '';
  const searchCostStr = webSearchWasUsed
    ? ` (incl. search: $${usage.cost.webSearchCost.toFixed(6)})`
    : '';
  console.log(`✅ AI Response [${escalationLevel}]${searchBadge}:`, content);
  console.log(
    `   💰 Tokens: ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${usage.totalTokens} total`,
  );
  console.log(
    `   💵 Cost: $${usage.cost.totalCost.toFixed(6)} (input: $${usage.cost.inputCost.toFixed(6)}, output: $${usage.cost.outputCost.toFixed(6)}${searchCostStr})`,
  );
  console.log(`   📊 Avg per region: $${usage.cost.totalCost.toFixed(6)} (1 region)`);
}

/**
 * Normalise a parsed response, validating the suggested group against the
 * authoritative list and deriving `needsEscalation` when not explicit.
 */
function normalizeParsedSuggestion(
  parsed: GroupSuggestionResponse,
  availableGroups: string[],
  escalationLevel: EscalationLevel,
  usage: TokenUsage,
): GroupSuggestionResponse {
  // Validate suggested group exists in the authoritative list.
  if (parsed.suggestedGroup && !availableGroups.includes(parsed.suggestedGroup)) {
    const match = availableGroups.find(
      g => g.toLowerCase() === parsed.suggestedGroup?.toLowerCase(),
    );
    parsed.suggestedGroup = match || null;
    if (!match) parsed.confidence = 'low';
  }

  // Same authoritative check for splitGroups — drop hallucinated entries
  // (case-insensitive resolution back to the canonical name when possible).
  if (parsed.splitGroups && Array.isArray(parsed.splitGroups)) {
    parsed.splitGroups = parsed.splitGroups
      .map(name => {
        if (availableGroups.includes(name)) return name;
        const match = availableGroups.find(g => g.toLowerCase() === name?.toLowerCase());
        return match ?? null;
      })
      .filter((name): name is string => name !== null);
  }

  const needsEscalation =
    parsed.needsEscalation ?? (escalationLevel === 'fast' && parsed.confidence !== 'high');

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
  if (!getOpenAIClient()) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }

  if (availableGroups.length === 0) {
    throw new Error('No groups available. Please create at least one group first.');
  }

  const shouldUseWebSearch = escalationLevel === 'reasoning_search' || Boolean(useWebSearch);

  const { systemPrompt, userPrompt } = buildSingleSuggestionPrompts({
    regionPath,
    regionName,
    availableGroups,
    parentRegion,
    groupDescriptions,
    worldViewSource,
    escalationLevel,
    shouldUseWebSearch,
  });

  logSingleSuggestionRequest(
    regionName,
    availableGroups,
    shouldUseWebSearch,
    escalationLevel,
    systemPrompt,
    userPrompt,
  );

  try {
    const modelToUse = shouldUseWebSearch ? getWebSearchModel() : getModel();
    const temperature = escalationLevel === 'fast' ? 0.1 : 0.3;
    const topP = escalationLevel === 'fast' ? 0.9 : 0.95;

    const raw = await invokeModel(systemPrompt, userPrompt, {
      useWebSearch: shouldUseWebSearch,
      modelToUse,
      temperature,
      topP,
    });

    if (!raw.content) {
      throw new Error('Empty response from OpenAI');
    }

    const usage = buildTokenUsage(raw, modelToUse);

    logSingleSuggestionResponse(
      raw.content,
      usage,
      shouldUseWebSearch,
      raw.webSearchWasUsed,
      escalationLevel,
    );

    logAIUsage({
      feature: 'subdivision_assist',
      model: modelToUse,
      description: `Group suggestion: "${regionName}" → "${parentRegion}"`,
      apiCalls: 1,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalCost: usage.cost.totalCost,
    }).catch(err =>
      console.warn('[OpenAI] Failed to log usage:', err instanceof Error ? err.message : err),
    );

    const parsed = parseJsonResponse<GroupSuggestionResponse>(raw.content);
    return normalizeParsedSuggestion(parsed, availableGroups, escalationLevel, usage);
  } catch (error) {
    console.log('❌ AI Error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

// =============================================================================
// suggestGroupsForMultipleRegions (batch classification)
// =============================================================================

interface BatchContextArgs {
  parentRegion: string;
  availableGroups: string[];
  worldViewDescription?: string;
  worldViewSource?: string;
  useWebSearch: boolean;
  groupDescriptions?: Record<string, string>;
}

/**
 * Build the shared context block used by every batch prompt.
 */
function buildBatchContextInfo(
  worldViewDescription: string | undefined,
  worldViewSource: string | undefined,
  useWebSearch: boolean,
): string {
  let contextInfo = '';
  if (worldViewDescription) {
    contextInfo += `\nContext: This classification is for a World View used by: ${worldViewDescription}`;
  }
  contextInfo += buildWorldViewSourceContext(worldViewSource, useWebSearch, 'regions');
  return contextInfo;
}

/**
 * Build the system + user prompts for a single batch of regions.
 */
function buildBatchPrompts(
  batch: Array<{ path: string; name: string }>,
  args: BatchContextArgs,
  contextInfo: string,
): { systemPrompt: string; userPrompt: string } {
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

  const sourceInstruction = args.useWebSearch
    ? '\nInclude a "sources" array of URLs you used for verification.'
    : '';

  const divisionsList = batch.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
  const descriptionsBlock = buildGroupDescriptionsBlock(args.groupDescriptions);

  const userPrompt = `Classify these administrative divisions of "${args.parentRegion}" into the provided groups.
\nIMPORTANT: You MUST use ONLY the groups listed below. These groups are authoritative - do not suggest any region is "outside scope".
\nDivisions to classify:
${divisionsList}
\nAvailable groups (USE ONLY THESE): ${args.availableGroups.join(', ')}
${descriptionsBlock}
\nFor EACH division, find the BEST match from the provided groups. If a division spans MULTIPLE groups historically, set shouldSplit=true and list ALL groups in splitGroups.${sourceInstruction}
\nJSON response (no markdown, use exact division names as keys):
{"DivisionName": {"suggestedGroup": "Group" or null, "confidence": "high"|"medium"|"low", "shouldSplit": true|false, "splitGroups": ["G1","G2",...] (if shouldSplit=true), "reasoning": "brief fact", "sources": ["url1",...] (if web search)}, ...}`;

  return { systemPrompt, userPrompt };
}

/**
 * Log the metadata for a batch request.
 */
function logBatchRequest(
  batchNum: number,
  totalBatches: number,
  batch: Array<{ path: string; name: string }>,
  args: BatchContextArgs,
  systemPrompt: string,
  userPrompt: string,
): void {
  const webBadge = args.useWebSearch ? ' 🌐 WITH WEB SEARCH' : '';
  console.log(`\n🤖 AI Batch Request (${batchNum}/${totalBatches})${webBadge}:`);
  console.log(`   Model: ${getModel()}`);
  console.log(`   Parent: ${args.parentRegion}`);
  console.log(`   Groups: [${args.availableGroups.join(', ')}]`);
  if (args.worldViewDescription) {
    console.log(`   Description: ${args.worldViewDescription}`);
  }
  if (args.worldViewSource) {
    console.log(`   Source: ${args.worldViewSource}`);
  }
  console.log(`   Regions (${batch.length}): [${batch.map(r => r.name).join(', ')}]`);
  console.log(`   📤 System Prompt:\n${systemPrompt}`);
  console.log(`   📤 User Prompt:\n${userPrompt}`);
}

/**
 * Log the summary of a successful batch response.
 */
function logBatchResponse(
  batchNum: number,
  batch: Array<{ path: string; name: string }>,
  content: string,
  raw: RawModelResult,
  batchCost: ReturnType<typeof calculateCost>,
  useWebSearch: boolean,
): void {
  const searchBadge = useWebSearch ? ' 🌐' : '';
  const searchCostStr = raw.webSearchWasUsed
    ? ` (incl. search: $${batchCost.webSearchCost.toFixed(6)})`
    : '';
  const preview = content.substring(0, 200) + '...';
  console.log(`✅ AI Response (batch ${batchNum})${searchBadge}:`, preview);
  console.log(
    `   💰 Tokens: ${raw.promptTokens} prompt + ${raw.completionTokens} completion = ${raw.totalTokens} total`,
  );
  console.log(`   💵 Cost: $${batchCost.totalCost.toFixed(6)}${searchCostStr}`);
  const avg = (batchCost.totalCost / batch.length).toFixed(6);
  console.log(`   📊 Avg per region: $${avg} (${batch.length} regions)`);
}

/**
 * Validate a group name against the authoritative list. Returns the canonical
 * name (case-insensitive resolution) or null if no match.
 */
function resolveGroupName(name: string | null | undefined, availableGroups: string[]): string | null {
  if (!name) return null;
  if (availableGroups.includes(name)) return name;
  return availableGroups.find(g => g.toLowerCase() === name.toLowerCase()) ?? null;
}

/**
 * Merge a parsed batch response into the accumulated results map. Validates
 * `suggestedGroup` and every entry in `splitGroups` against the authoritative
 * list — drops hallucinated names so downstream code can't silently emit them.
 */
function mergeBatchSuggestions(
  parsed: Record<string, GroupSuggestionResponse>,
  target: Map<string, GroupSuggestionResponse>,
  availableGroups: string[],
): void {
  for (const [name, suggestion] of Object.entries(parsed)) {
    if (suggestion && typeof suggestion === 'object') {
      const validatedSuggested = resolveGroupName(suggestion.suggestedGroup, availableGroups);
      const validatedSplits = Array.isArray(suggestion.splitGroups)
        ? suggestion.splitGroups
            .map(g => resolveGroupName(g, availableGroups))
            .filter((g): g is string => g !== null)
        : suggestion.splitGroups;
      target.set(name, {
        suggestedGroup: validatedSuggested,
        confidence: suggestion.confidence ?? 'low',
        shouldSplit: suggestion.shouldSplit ?? false,
        splitGroups: validatedSplits,
        reasoning: suggestion.reasoning ?? '',
        context: suggestion.context,
        sources: suggestion.sources,
      });
    }
  }
}

/**
 * Process a single batch: build prompts, invoke, parse, log. Returns the
 * partial usage that should be summed into `totalUsage`.
 */
async function processBatch(
  batch: Array<{ path: string; name: string }>,
  batchNum: number,
  totalBatches: number,
  args: BatchContextArgs,
  contextInfo: string,
  allResults: Map<string, GroupSuggestionResponse>,
): Promise<
  | { success: true; raw: RawModelResult; batchCost: ReturnType<typeof calculateCost>; modelToUse: string }
  | { success: false }
> {
  const { systemPrompt, userPrompt } = buildBatchPrompts(batch, args, contextInfo);
  logBatchRequest(batchNum, totalBatches, batch, args, systemPrompt, userPrompt);

  const modelToUse = args.useWebSearch ? getWebSearchModel() : getModel();

  try {
    const raw = await invokeModel(systemPrompt, userPrompt, {
      useWebSearch: args.useWebSearch,
      modelToUse,
      temperature: 0.1,
    });

    if (!raw.content) {
      console.log(`❌ Empty response for batch ${batchNum}`);
      return { success: false };
    }

    const batchCost = calculateCost(
      raw.promptTokens,
      raw.completionTokens,
      modelToUse,
      raw.webSearchWasUsed,
    );

    logBatchResponse(batchNum, batch, raw.content, raw, batchCost, args.useWebSearch);

    const parsed = parseJsonResponse<Record<string, GroupSuggestionResponse>>(raw.content);
    mergeBatchSuggestions(parsed, allResults, args.availableGroups);

    return { success: true, raw, batchCost, modelToUse };
  } catch (error) {
    const message = error instanceof Error ? error.message : error;
    console.log(`❌ AI Batch Error (batch ${batchNum}):`, message);
    return { success: false };
  }
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
  if (!getOpenAIClient()) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }

  if (availableGroups.length === 0) {
    throw new Error('No groups available. Please create at least one group first.');
  }

  const BATCH_SIZE = 20;
  const allResults = new Map<string, GroupSuggestionResponse>();
  let apiRequestsCount = 0;

  const useWebSearchFlag = Boolean(useWebSearch);
  const modelForCosts = useWebSearchFlag ? getWebSearchModel() : getModel();
  const totalUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: { inputCost: 0, outputCost: 0, webSearchCost: 0, totalCost: 0 },
    model: modelForCosts,
  };

  const contextInfo = buildBatchContextInfo(
    worldViewDescription,
    worldViewSource,
    useWebSearchFlag,
  );

  const args: BatchContextArgs = {
    parentRegion,
    availableGroups,
    worldViewDescription,
    worldViewSource,
    useWebSearch: useWebSearchFlag,
    groupDescriptions,
  };

  const totalBatches = Math.ceil(regions.length / BATCH_SIZE);

  for (let i = 0; i < regions.length; i += BATCH_SIZE) {
    const batch = regions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const result = await processBatch(
      batch,
      batchNum,
      totalBatches,
      args,
      contextInfo,
      allResults,
    );

    if (result.success) {
      apiRequestsCount++;
      totalUsage.promptTokens += result.raw.promptTokens;
      totalUsage.completionTokens += result.raw.completionTokens;
      totalUsage.totalTokens += result.raw.totalTokens;
      totalUsage.cost.inputCost += result.batchCost.inputCost;
      totalUsage.cost.outputCost += result.batchCost.outputCost;
      totalUsage.cost.webSearchCost += result.batchCost.webSearchCost;
      totalUsage.cost.totalCost += result.batchCost.totalCost;
    }
  }

  console.log(
    `\n✅ Processed ${allResults.size}/${regions.length} regions total in ${apiRequestsCount} API request(s)`,
  );
  console.log(
    `   💰 Total tokens: ${totalUsage.promptTokens} prompt + ${totalUsage.completionTokens} completion = ${totalUsage.totalTokens} total`,
  );
  console.log(`   💵 Total cost: $${totalUsage.cost.totalCost.toFixed(6)}`);
  const avgPerRegion = (totalUsage.cost.totalCost / regions.length).toFixed(6);
  console.log(`   📊 Avg per region: $${avgPerRegion} (${regions.length} regions)`);

  logAIUsage({
    feature: 'subdivision_assist',
    model: modelForCosts,
    description: `Batch group suggestion: ${regions.length} regions for "${parentRegion}" (${apiRequestsCount} API calls)`,
    apiCalls: apiRequestsCount,
    promptTokens: totalUsage.promptTokens,
    completionTokens: totalUsage.completionTokens,
    totalCost: totalUsage.cost.totalCost,
  }).catch(err =>
    console.warn(
      '[OpenAI] Failed to log batch usage:',
      err instanceof Error ? err.message : err,
    ),
  );

  return { suggestions: allResults, totalUsage, apiRequestsCount };
}
