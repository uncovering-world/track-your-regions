/**
 * AI-Assisted WorldView Import Matcher
 *
 * Uses OpenAI to improve matching for unresolved leaves (needs_review, no_candidates).
 * Runs as a post-processing step after the initial score-based matcher.
 *
 * Sends batches of unresolved leaves with their context (name, ancestor path,
 * country, current candidates) to OpenAI. The AI picks the best match or
 * identifies the correct GADM division name when string matching fails.
 *
 * DB search (trigram) lives in dbSearchMatcher.ts.
 * Geocode matching lives in geocodeMatcher.ts.
 * Both are re-exported here for backward compatibility.
 */

import OpenAI from 'openai';
import { pool } from '../../db/index.js';
import { isOpenAIAvailable } from '../ai/openaiService.js';
import { calculateCost } from '../ai/pricingService.js';
import type { MatchSuggestion, MatchStatus, AIMatchProgress, AIMatchResult } from './types.js';
import { tryTrigramMatch } from './dbSearchMatcher.js';
import { applyAIResults } from './aiMatcherApply.js';

// Re-export for backward compatibility — consumers import from aiMatcher.ts
export type { AIMatchProgress, AIMatchResult } from './types.js';
export { trigramSearch, dbSearchSingleRegion } from './dbSearchMatcher.js';
export { geocodeMatchRegion } from './geocodeMatcher.js';

export function createAIMatchProgress(): AIMatchProgress {
  return {
    status: 'running',
    statusMessage: 'Starting AI-assisted matching...',
    totalLeaves: 0,
    processedLeaves: 0,
    improved: 0,
    totalCost: 0,
    cancel: false,
  };
}

/** In-memory progress for AI matching */
const runningAIMatches = new Map<number, AIMatchProgress>();

export function getAIMatchProgress(worldViewId: number): AIMatchProgress | null {
  return runningAIMatches.get(worldViewId) ?? null;
}

export function cancelAIMatch(worldViewId: number): boolean {
  const progress = runningAIMatches.get(worldViewId);
  if (progress && progress.status === 'running') {
    progress.cancel = true;
    return true;
  }
  return false;
}

interface UnresolvedLeaf {
  id: number;
  name: string;
  ancestorPath: string;
  matchStatus: string;
  suggestions: MatchSuggestion[];
}

const BATCH_SIZE = 25;
const MODEL = 'gpt-4.1-mini';

/**
 * Start AI-assisted re-matching for unresolved leaves.
 * Returns immediately; runs in background.
 */
export function startAIMatching(worldViewId: number): AIMatchProgress {
  const progress = createAIMatchProgress();
  runningAIMatches.set(worldViewId, progress);

  runAIMatching(worldViewId, progress).catch((err) => {
    console.error(`[AI Matcher] Error for worldView ${worldViewId}:`, err);
    progress.status = 'failed';
    progress.statusMessage = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }).finally(() => {
    // Clean up after 5 minutes
    const thisProgress = progress;
    setTimeout(() => {
      if (runningAIMatches.get(worldViewId) === thisProgress) {
        runningAIMatches.delete(worldViewId);
      }
    }, 300_000);
  });

  return progress;
}

async function runAIMatching(worldViewId: number, progress: AIMatchProgress): Promise<void> {
  if (!isOpenAIAvailable()) {
    throw new Error('OpenAI API is not configured');
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const startTime = Date.now();

  // Load unresolved leaves with ancestor paths
  progress.statusMessage = 'Loading unresolved leaves...';
  const result = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_region_id, id AS leaf_id
      FROM regions
      WHERE world_view_id = $1
        AND id IN (
          SELECT region_id FROM region_import_state
          WHERE match_status IN ('needs_review', 'no_candidates')
        )
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, a.leaf_id
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT
      r.id,
      r.name,
      ris.match_status,
      (SELECT COALESCE(json_agg(json_build_object(
        'divisionId', rms.division_id,
        'name', rms.name,
        'path', rms.path,
        'score', rms.score
      ) ORDER BY rms.score DESC), '[]'::json)
      FROM region_match_suggestions rms
      WHERE rms.region_id = r.id AND rms.rejected = false) AS suggestions,
      (SELECT string_agg(a.name, ' > ' ORDER BY a.id)
       FROM ancestors a WHERE a.leaf_id = r.id AND a.id != r.id) AS ancestor_path
    FROM regions r
    JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.world_view_id = $1
      AND (ris.match_status = 'needs_review' OR ris.match_status = 'no_candidates')
    ORDER BY r.id
  `, [worldViewId]);

  const leaves: UnresolvedLeaf[] = result.rows.map(row => ({
    id: row.id as number,
    name: row.name as string,
    ancestorPath: (row.ancestor_path as string) ?? '',
    matchStatus: row.match_status as string,
    suggestions: (row.suggestions as MatchSuggestion[]) ?? [],
  }));

  progress.totalLeaves = leaves.length;
  if (leaves.length === 0) {
    progress.status = 'complete';
    progress.statusMessage = 'No unresolved leaves to process.';
    return;
  }

  console.log(`[AI Matcher] Processing ${leaves.length} unresolved leaves for worldView ${worldViewId}`);

  // Process in batches
  for (let i = 0; i < leaves.length; i += BATCH_SIZE) {
    if (progress.cancel) {
      progress.status = 'cancelled';
      progress.statusMessage = 'AI matching cancelled.';
      return;
    }

    const batch = leaves.slice(i, i + BATCH_SIZE);
    progress.statusMessage = `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(leaves.length / BATCH_SIZE)}...`;
    console.log(`[AI Matcher] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} leaves`);

    const results = await processAIBatch(openai, batch, progress);

    // Apply results
    if (results.length > 0) {
      await applyAIResults(worldViewId, results, progress);
    }

    progress.processedLeaves = Math.min(i + BATCH_SIZE, leaves.length);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  progress.status = 'complete';
  progress.statusMessage = `AI matching complete: ${progress.improved} improved out of ${progress.totalLeaves} leaves ($${progress.totalCost.toFixed(4)}). Took ${duration}s.`;
  console.log(`[AI Matcher] Complete in ${duration}s: improved=${progress.improved}, cost=$${progress.totalCost.toFixed(4)}`);
}

async function processAIBatch(
  openai: OpenAI,
  batch: UnresolvedLeaf[],
  progress: AIMatchProgress,
  includeLowConfidence = false,
): Promise<AIMatchResult[]> {
  // Build the prompt with region context
  const regionsContext = batch.map((leaf, idx) => {
    const candidatesStr = leaf.suggestions.length > 0
      ? leaf.suggestions.map(s => `  - "${s.name}" (ID: ${s.divisionId}, path: ${s.path}, score: ${s.score})`).join('\n')
      : '  (no candidates found by text matching)';

    return `${idx + 1}. Region: "${leaf.name}"
   Hierarchy: ${leaf.ancestorPath || '(root)'}
   Current status: ${leaf.matchStatus}
   Candidates from text matching:
${candidatesStr}`;
  }).join('\n\n');

  const systemPrompt = `You are a geographic region matching expert. Your task is to match import source regions to GADM (Global Administrative Areas Database) administrative divisions.

GADM contains official administrative boundaries: countries, states/provinces, districts, etc. Import source regions are travel-oriented and may use different names, local names, or group areas differently.

For each region, you will see:
- The region name
- Its hierarchy (parent regions)
- Current candidate GADM divisions found by text matching (if any)

For each region, determine:
1. If one of the candidates is the correct match, pick it (return its divisionId)
2. If none of the candidates match but you know the correct GADM name, return divisionId: null and the correct GADM name in divisionName, plus alternative names in alternativeNames
3. If the region spans MULTIPLE GADM divisions (e.g., "Donbas" = Donetsk Oblast + Luhansk Oblast), return the primary division in divisionName and list the others in additionalDivisions. Each entry has a name and alternativeNames
4. Only return divisionName: null if you truly cannot identify any GADM division

Important:
- ALWAYS try to find a match. Even if the match is approximate (e.g., a disputed territory that covers part of a GADM division), return the closest enclosing GADM division rather than null. The user can accept or reject later
- GADM often uses older or formal country names. Return the name GADM would use, not the modern name. Examples: Eswatini → "Swaziland", Myanmar → "Burma", Czechia → "Czech Republic", Côte d'Ivoire → "Ivory Coast", Timor-Leste → "East Timor", North Macedonia → "Macedonia"
- Regions like "British Virgin Islands" ARE in GADM, often under their parent country
- Islands, territories, and dependencies exist in GADM under their sovereign nation
- Islands split between sovereigns appear as SEPARATE country-level entries in GADM under each sovereign. For example, Saint Martin → "Saint-Martin" (under France) + "Sint Maarten" (under Netherlands). Use additionalDivisions for these
- Some source names use local/alternative names (e.g., "Bayern" vs "Bavaria")
- Disputed territories and de facto states: return the GADM division they fall within. For example, South Ossetia → "Shida Kartli" (Georgian administrative region), Transnistria → "Stînga Nistrului", Nagorno-Karabakh → the relevant Azerbaijani rayon, etc.
- When suggesting a divisionName, ALWAYS include alternativeNames: an array of other plausible names the region might be listed under in GADM. Include local-language names, official administrative names, colonial-era names, sovereign-state names, and transliteration variants. Do NOT add qualifiers like "(partial)" to names — return clean names only
- Consider the hierarchy context to disambiguate (e.g., "Springfield" under "Illinois" vs "Missouri")
- Be conservative: only say "high" confidence when you're very sure`;

  const userPrompt = `Match these regions to GADM divisions. Return a JSON array with one object per region:

${regionsContext}

Respond with ONLY a JSON array, no markdown code blocks:
[
  {
    "regionIndex": 1,
    "divisionId": <id from candidates or null>,
    "divisionName": <correct GADM name if known, or null>,
    "alternativeNames": ["<other names for the SAME division>"],
    "additionalDivisions": [{"name": "<GADM name>", "alternativeNames": ["<alt names>"]}],
    "confidence": "high" | "medium" | "low",
    "reasoning": "<brief explanation>"
  },
  ...
]

Use additionalDivisions when a region maps to 2+ GADM divisions (e.g., Donbas → Donetsk + Luhansk oblasts). Leave it as [] for single-division matches.`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.warn('[AI Matcher] Empty response from OpenAI');
      return [];
    }

    // Track cost
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const cost = calculateCost(promptTokens, completionTokens, MODEL, false);
    progress.totalCost += cost.totalCost;

    // Parse JSON response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const parsed = JSON.parse(jsonStr.trim()) as Array<{
      regionIndex: number;
      divisionId: number | null;
      divisionName: string | null;
      alternativeNames?: string[];
      additionalDivisions?: Array<{ name: string; alternativeNames?: string[] }>;
      confidence: 'high' | 'medium' | 'low';
      reasoning: string;
    }>;

    return parsed
      .filter(r => includeLowConfidence || r.confidence === 'high' || r.confidence === 'medium')
      .map(r => ({
        regionId: batch[r.regionIndex - 1]?.id,
        divisionId: r.divisionId,
        divisionName: r.divisionName,
        alternativeNames: r.alternativeNames ?? [],
        additionalDivisions: (r.additionalDivisions ?? []).map(d => ({
          name: d.name,
          alternativeNames: d.alternativeNames ?? [],
        })),
        confidence: r.confidence,
        reasoning: r.reasoning,
      }))
      .filter(r => r.regionId !== undefined);
  } catch (err) {
    console.error('[AI Matcher] API call failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Match a single region — tries trigram similarity first, then AI.
 * Used for per-region "AI Match" buttons in the tree UI.
 */
export async function aiMatchSingleRegion(
  worldViewId: number,
  regionId: number,
): Promise<{ improved: boolean; suggestion?: MatchSuggestion; reasoning?: string; cost: number }> {
  // Load the region with its ancestor path, import state, and suggestions
  const result = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_region_id, id AS leaf_id
      FROM regions WHERE id = $1 AND world_view_id = $2
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, a.leaf_id
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT
      r.id, r.name, r.is_leaf,
      ris.match_status,
      (SELECT COALESCE(json_agg(json_build_object(
        'divisionId', rms.division_id,
        'name', rms.name,
        'path', rms.path,
        'score', rms.score
      ) ORDER BY rms.score DESC), '[]'::json)
      FROM region_match_suggestions rms
      WHERE rms.region_id = r.id AND rms.rejected = false) AS suggestions,
      (SELECT COALESCE(json_agg(rms.division_id), '[]'::json)
      FROM region_match_suggestions rms
      WHERE rms.region_id = r.id AND rms.rejected = true) AS rejected_ids,
      (SELECT string_agg(a.name, ' > ' ORDER BY a.id)
       FROM ancestors a WHERE a.leaf_id = r.id AND a.id != r.id) AS ancestor_path
    FROM regions r
    LEFT JOIN region_import_state ris ON ris.region_id = r.id
    WHERE r.id = $1 AND r.world_view_id = $2
  `, [regionId, worldViewId]);

  if (result.rows.length === 0) {
    throw new Error('Region not found in this world view');
  }

  const row = result.rows[0];
  const regionName = row.name as string;
  const isLeaf = row.is_leaf as boolean;
  const rejectedIds = new Set<number>((row.rejected_ids as number[]) ?? []);

  // Load already-assigned member division IDs to avoid re-suggesting them
  const membersResult = await pool.query(
    `SELECT division_id FROM region_members WHERE region_id = $1`,
    [regionId],
  );
  const assignedIds = new Set<number>(membersResult.rows.map(r => r.division_id as number));

  // Phase 1: Try trigram similarity match (free, fast) — adds candidates
  const trigramMatch = await tryTrigramMatch(regionName);
  // Skip trigram result if it was previously rejected or already assigned
  const validTrigramMatch = trigramMatch && !rejectedIds.has(trigramMatch.divisionId) && !assignedIds.has(trigramMatch.divisionId) ? trigramMatch : null;
  const existingSuggestions = (row.suggestions as MatchSuggestion[]) ?? [];

  // Merge trigram result into suggestions for AI context
  const mergedSuggestions = [...existingSuggestions];
  if (validTrigramMatch && !existingSuggestions.some(s => s.divisionId === validTrigramMatch.divisionId)) {
    mergedSuggestions.unshift({
      divisionId: validTrigramMatch.divisionId,
      name: validTrigramMatch.name,
      path: validTrigramMatch.path,
      score: Math.round(validTrigramMatch.similarity * 1000),
    });
  }

  // Phase 2: Try AI matching (if available)
  if (!isOpenAIAvailable()) {
    // No AI — use trigram result directly if available
    if (validTrigramMatch && validTrigramMatch.similarity >= 0.5) {
      const suggestion: MatchSuggestion = {
        divisionId: validTrigramMatch.divisionId,
        name: validTrigramMatch.name,
        path: validTrigramMatch.path,
        score: Math.round(validTrigramMatch.similarity * 1000),
      };
      const newStatus: MatchStatus = !isLeaf ? 'suggested' : 'needs_review';
      await pool.query(
        `UPDATE region_import_state SET match_status = $1 WHERE region_id = $2`,
        [newStatus, regionId],
      );
      // Insert suggestion if not already present
      const existingCheck = await pool.query(
        `SELECT 1 FROM region_match_suggestions WHERE region_id = $1 AND division_id = $2`,
        [regionId, suggestion.divisionId],
      );
      if (existingCheck.rows.length === 0) {
        await pool.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [regionId, suggestion.divisionId, suggestion.name, suggestion.path, suggestion.score],
        );
      }
      return { improved: false, suggestion, reasoning: `Trigram match (${Math.round(validTrigramMatch.similarity * 100)}% similarity)`, cost: 0 };
    }
    throw new Error('OpenAI API is not configured and no trigram match found');
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const leaf: UnresolvedLeaf = {
    id: row.id as number,
    name: regionName,
    ancestorPath: (row.ancestor_path as string) ?? '',
    matchStatus: row.match_status as string,
    suggestions: mergedSuggestions,
  };

  // Process as a single-item batch (reuses existing prompt logic)
  // Include low confidence results — user will review and accept/reject
  const trackingProgress = createAIMatchProgress();
  const aiResults = await processAIBatch(openai, [leaf], trackingProgress, true);

  if (aiResults.length === 0) {
    return { improved: false, cost: trackingProgress.totalCost };
  }

  // Apply the single result
  await applyAIResults(worldViewId, aiResults, trackingProgress, false);

  const aiResult = aiResults[0];
  let suggestion: MatchSuggestion | undefined;
  if (aiResult.divisionId) {
    const divResult = await pool.query(`
      SELECT ad.name,
        (
          WITH RECURSIVE div_ancestors AS (
            SELECT ad.id, ad.name, ad.parent_id
            UNION ALL
            SELECT d.id, d.name, d.parent_id
            FROM administrative_divisions d JOIN div_ancestors da ON d.id = da.parent_id
          )
          SELECT string_agg(name, ' > ' ORDER BY id) FROM div_ancestors
        ) AS path
      FROM administrative_divisions ad WHERE ad.id = $1
    `, [aiResult.divisionId]);
    if (divResult.rows.length > 0) {
      suggestion = {
        divisionId: aiResult.divisionId,
        name: divResult.rows[0].name as string,
        path: divResult.rows[0].path as string,
        score: aiResult.confidence === 'high' ? 900 : 600,
      };
    }
  }

  return {
    improved: trackingProgress.improved > 0,
    suggestion,
    reasoning: aiResult.reasoning,
    cost: trackingProgress.totalCost,
  };
}

