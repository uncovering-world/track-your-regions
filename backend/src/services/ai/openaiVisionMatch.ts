/**
 * Vision-based division matching.
 *
 * Given a region map image + an SVG of numbered candidate GADM divisions,
 * asks a vision-capable model which numbered divisions fall inside the
 * region's colored area.
 *
 * NOTE: Full implementation (chatCompletion + logAIUsage) is added in a
 * later chain. This version uses the OpenAI SDK directly.
 */

import OpenAI from 'openai';
import { calculateCost } from './pricingService.js';
import { getModelForFeature } from './aiSettingsService.js';
import type { TokenUsage } from './openaiService.js';

export interface VisionMatchDivision {
  id: number;
  name: string;
}

export interface VisionMatchResult {
  suggestedIds: number[];
  rejectedIds: number[];
  unclearIds: number[];
  reasoning: string;
  usage: TokenUsage;
}

let openaiClient: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// Code-fence regex. No `\s*` inside to avoid super-linear backtracking.
const FENCE_REGEX = /```(?:json)?([\s\S]*?)```/;

function parseJsonResponse<T>(content: string): T {
  const fenceMatch = FENCE_REGEX.exec(content);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : content.trim();
  return JSON.parse(jsonStr) as T;
}

/**
 * Use GPT-4o vision to identify which GADM divisions fall within a region,
 * given the region's map image and a numbered PNG map of candidate divisions.
 *
 * Two images are sent:
 *   1. Wikivoyage/Wikipedia region map (color-coded, labeled regions)
 *   2. Server-generated PNG with numbered division boundaries
 */
export async function matchDivisionsByVision(
  regionName: string,
  imageUrl: string,
  divisionsSvgBase64: string,
  divisions: VisionMatchDivision[],
): Promise<VisionMatchResult> {
  const openai = getClient();
  if (!openai) {
    throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in .env');
  }

  // Vision requires models with strong image analysis — override non-vision models
  const VISION_CAPABLE = ['gpt-4o', 'gpt-4.1', 'gpt-5'];
  const configuredModel = await getModelForFeature('vision_match');
  const visionModel = VISION_CAPABLE.some(v => configuredModel.startsWith(v))
    ? configuredModel
    : 'gpt-4o';

  const divCount = divisions.length;

  const systemPrompt = [
    'You are a geography expert comparing two maps to identify which administrative divisions belong to a specific region.',
    '',
    'YOU WILL RECEIVE TWO IMAGES:',
    '1. IMAGE 1 (first): A color-coded region map (from Wikivoyage/Wikipedia) where each region has a DISTINCT COLOR and a TEXT LABEL',
    '2. IMAGE 2 (second): A numbered map showing GADM administrative division boundaries — each division has a NUMBER label inside it',
    '',
    'YOUR TASK:',
    `1. On Image 1, find the region labeled "${regionName}" (or similar) — note its COLOR and BOUNDARIES`,
    '2. On Image 2, identify which NUMBERED divisions fall within that same geographic area',
    '3. The two maps show the same geographic area from different perspectives — match by position and shape',
    '',
    'RULES:',
    `- Classify EVERY division number (1 to ${divCount}) into exactly one of three categories: inside, outside, or unclear`,
    `- "inside": clearly falls within "${regionName}" colored area on Image 1`,
    `- "outside": clearly falls outside "${regionName}" area`,
    '- "unclear": on the border or hard to tell from the images',
    '- Be conservative: if unsure, put it in "unclear" rather than "inside"',
    `- "${regionName}" is ONE of several regions — typically 10-40% of the ${divCount} divisions belong to it`,
    '- Respond with valid JSON only, no markdown',
  ].join('\n');

  const userPrompt = [
    `Region to find: "${regionName}"`,
    '',
    `Image 1: Region map — find "${regionName}", note its color and area.`,
    `Image 2: Numbered divisions (1 to ${divCount}) — classify each number.`,
    '',
    'Respond with JSON:',
    `{"inside": [numbers inside "${regionName}"], "outside": [numbers outside], "unclear": [numbers on the border], "reasoning": "brief explanation"}`,
  ].join('\n');

  const response = await openai.chat.completions.create({
    model: visionModel,
    temperature: 0.1,
    max_completion_tokens: 2000,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          { type: 'image_url', image_url: { url: divisionsSvgBase64, detail: 'high' } },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from vision model');

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const totalTokensUsed = response.usage?.total_tokens ?? 0;
  const costResult = calculateCost(promptTokens, completionTokens, visionModel, false);

  const usage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: totalTokensUsed,
    cost: {
      inputCost: costResult.inputCost,
      outputCost: costResult.outputCost,
      webSearchCost: 0,
      totalCost: costResult.totalCost,
    },
    model: visionModel,
  };

  const parsed = parseJsonResponse<{
    inside: number[];
    outside: number[];
    unclear: number[];
    reasoning: string;
  }>(content);

  const toIds = (nums: number[]) =>
    (nums || []).filter(n => n >= 1 && n <= divCount).map(n => divisions[n - 1].id);

  return {
    suggestedIds: toIds(parsed.inside),
    rejectedIds: toIds(parsed.outside),
    unclearIds: toIds(parsed.unclear),
    reasoning: parsed.reasoning,
    usage,
  };
}
