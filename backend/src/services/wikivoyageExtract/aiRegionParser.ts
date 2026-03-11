/**
 * AI-based region extraction from Wikivoyage wikitext.
 *
 * Replaces heuristic multi-link classification and plain-text parsing.
 * Only called for pages where parseRegionlist() encounters ambiguity.
 */

import type OpenAI from 'openai';
import type { RegionEntry } from './types.js';
import { getModelForFeature } from '../ai/aiSettingsService.js';
import { calculateCost } from '../ai/pricingService.js';
import { chatCompletion } from '../ai/chatCompletion.js';
import { logAIUsage } from '../ai/aiUsageLogger.js';
import { buildLearnedRulesPrompt } from '../ai/learnedRulesService.js';

export interface AIExtractionAccumulator {
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}

export function createExtractionAccumulator(): AIExtractionAccumulator {
  return { apiCalls: 0, promptTokens: 0, completionTokens: 0, totalCost: 0 };
}

const SYSTEM_PROMPT = `You extract subregions from a Wikivoyage page's "Regions" (or "Countries"/"States") section wikitext.
The page title will be provided in the user message so you know WHAT place this is about.

CORE PRINCIPLE: Represent regions exactly as they appear on the Wikivoyage page.
Each entry in the Regions section = one entry in your output. Do NOT split what the page treats as one entry.

Return a JSON object with two fields:
- "regions": array of region objects (see below)
- "questions": array of strings — any uncertainties you have about the extraction (empty if confident)

Each region object has:
- "name": the region name as it should appear in a hierarchy
- "wikiLink": the exact Wikivoyage page title if linked with [[...]], or null for grouping nodes
- "children": array of child wikiLink strings if this entry groups multiple linked pages, or empty array

Rules:

1. PRESERVE PAGE STRUCTURE:
   If the page shows "[[France]] and [[Monaco]]" as ONE regionlist entry or bullet,
   output ONE grouping node: {"name": "France and Monaco", "wikiLink": null, "children": ["France", "Monaco"]}.
   Each entry on the page = one entry in output, always.

2. WIKILINKS:
   - [[Link|Display text]] → wikiLink = "Link"
   - [[Russia]]'s [[North Caucasus]] → possessive pattern, target = "North Caucasus" (last link)
   - [[Falster]] ([[Gedser]], ...) → parenthetical pattern, target = "Falster" (first link)
   - [[Baker Island|Baker]] and [[Howland Island]]s → grouping: children = ["Baker Island", "Howland Island"]

3. SKIP UNLINKED DEAD-ENDS:
   If an entry is plain text with NO [[wikilink]] at all and NO linked items under it,
   skip it entirely — we only want regions with actual Wikivoyage content behind them.

4. GROUPING NODES:
   Plain-text labels (e.g., "Italian Peninsula") that group several linked regions ARE useful.
   Create a grouping node: {"name": "Italian Peninsula", "wikiLink": null, "children": ["Italy", "Malta", "San Marino"]}.

5. MIXED CONTENT — linked vs unlinked subregions:
   - If MOST subregions have wikilinks and only a few are plain text: keep the linked ones, skip the unlinked.
   - If MOST subregions are unlinked (no pages): this granularity is not useful — return empty regions array.
   - PAGE EXISTENCE matters more than wikilinks: a [[wikilink]] might point to a page that doesn't exist.
     Check the PAGE EXISTENCE section in the user message. If fewer than half of the subregions have
     actual pages, return EMPTY regions — splitting into mostly-pageless subregions adds no value.

6. CITIES ARE LEAVES:
   The page title tells you what place this is. If the page is about a CITY (e.g., Beijing, Paris, Tokyo,
   New York City, London, Bangkok, etc.), return EMPTY regions array. Cities are always leaf nodes.
   City district pages (Dongcheng, Manhattan, etc.) should never appear in the hierarchy.
   When in doubt whether something is a city, add a question.

7. CROSS-REFERENCES: Ignore entries that say "described separately", "see also", "elsewhere", etc.

8. SCOPE: Only extract from the Regionlist template and region bullets, not from {{mapshape}} or {{mapframe}} templates.
   NEVER use Wikidata Q-IDs (like Q1953, Q17915) as region names — those are metadata, not page titles.
   Use the actual region names from the Regionlist (region1name, region2name, etc.) or bullet points.

9. DESCRIPTIONS ARE NOT STRUCTURE:
   regionNdescription text is prose, NOT region structure. Links in descriptions (e.g., "can be visited
   from [[São Vicente]]") are cross-references, NOT child regions. NEVER make a region a child of another
   just because the description mentions it.

10. SINGLE-CHILD RULE:
    A region MUST NOT have exactly one subregion. Subdividing into a single child adds no granularity.
    If extraction would produce only one subregion, return EMPTY regions instead (treat as leaf).

11. QUESTIONS: If you're unsure about any decision (is this a city? should these be grouped? is this
    region meaningful?), add your question to the "questions" array. This helps the user teach you.

Return ONLY a JSON object {regions: [...], questions: [...]}, no markdown fencing.`;

/** Cached learned-rules suffix (refreshed once per extraction run, not per call) */
let cachedLearnedRules: string | null = null;

/** Call once at the start of an extraction run to preload learned rules. */
export async function preloadLearnedRules(): Promise<void> {
  cachedLearnedRules = await buildLearnedRulesPrompt('extraction');
  if (cachedLearnedRules) {
    console.log(`[AI Extract] Loaded learned rules for prompt injection`);
  }
}

export interface AIExtractionResult {
  regions: RegionEntry[];
  questions: string[];
}

export async function extractRegionsWithAI(
  pageTitle: string,
  wikitext: string,
  openai: OpenAI,
  accumulator: AIExtractionAccumulator,
  options?: { adminFeedback?: string; pageExistence?: Map<string, boolean> },
): Promise<AIExtractionResult> {
  const model = await getModelForFeature('extraction');

  // Build system prompt with any learned rules appended
  const systemPrompt = SYSTEM_PROMPT + (cachedLearnedRules ?? '');

  let userContent = `Page: "${pageTitle}"\n\n${wikitext}`;
  // Include page existence info so AI can make informed decisions
  if (options?.pageExistence && options.pageExistence.size > 0) {
    const exists = [...options.pageExistence.entries()].filter(([, v]) => v).map(([k]) => k);
    const missing = [...options.pageExistence.entries()].filter(([, v]) => !v).map(([k]) => k);
    userContent += '\n\nPAGE EXISTENCE CHECK (verified against Wikivoyage):';
    if (exists.length > 0) userContent += `\nHave pages: ${exists.join(', ')}`;
    if (missing.length > 0) userContent += `\nNo pages: ${missing.join(', ')}`;
  }
  if (options?.adminFeedback) {
    userContent += `\n\nADMIN FEEDBACK (re-extraction requested — follow this guidance):\n${options.adminFeedback}`;
  }

  const response = await chatCompletion(openai, {
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cost = calculateCost(promptTokens, completionTokens, model, false);

  accumulator.apiCalls++;
  accumulator.promptTokens += promptTokens;
  accumulator.completionTokens += completionTokens;
  accumulator.totalCost += cost.totalCost;

  // Log immediately so AI Settings page shows live data
  logAIUsage({
    feature: 'extraction',
    model,
    description: `Extract regions from "${pageTitle}"`,
    apiCalls: 1,
    promptTokens,
    completionTokens,
    totalCost: cost.totalCost,
  }).catch(err => console.warn('[AI Extract] Failed to log usage:', err instanceof Error ? err.message : err));

  const text = response.choices[0]?.message?.content?.trim() ?? '{}';
  // Strip markdown fences if present
  const jsonStr = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    // Try new format: {regions: [...], questions: [...]}
    const parsed = JSON.parse(jsonStr) as {
      regions?: Array<{ name: string; wikiLink: string | null; children: string[] }>;
      questions?: string[];
    } | Array<{ name: string; wikiLink: string | null; children: string[] }>;

    // Support both old array format and new object format
    const regionArray = Array.isArray(parsed) ? parsed : (parsed.regions ?? []);
    const questions = Array.isArray(parsed) ? [] : (parsed.questions ?? []);

    if (questions.length > 0) {
      console.log(`[AI Extract] Questions for "${pageTitle}": ${questions.join(' | ')}`);
    }

    // Filter out Wikidata Q-IDs that the AI may extract from {{mapshape}} templates
    const isQId = (s: string) => /^Q\d+$/.test(s);

    const regions = regionArray
      .filter(r => !isQId(r.wikiLink ?? r.name))
      .map(r => ({
        name: r.wikiLink ?? r.name,
        // Children can be strings or objects — normalize to string page titles
        items: (r.children ?? []).map((c: unknown) =>
          typeof c === 'string' ? c : (c as { wikiLink?: string; name?: string })?.wikiLink ?? (c as { name?: string })?.name ?? String(c),
        ).filter(c => !isQId(c)),
        hasLink: !!r.wikiLink,
      }));

    return { regions, questions };
  } catch (err) {
    console.warn('[AI Extract] Failed to parse AI response:', err instanceof Error ? err.message : err);
    return { regions: [], questions: [] };
  }
}
