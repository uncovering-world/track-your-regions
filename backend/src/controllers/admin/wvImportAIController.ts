/**
 * WorldView Import AI Controller
 *
 * AI-assisted matching endpoints: batch AI match, db search, geocode, reset, single AI match,
 * AI suggest children.
 */

import { Response } from 'express';
import OpenAI from 'openai';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  startAIMatching,
  getAIMatchProgress,
  cancelAIMatch,
  aiMatchSingleRegion,
  dbSearchSingleRegion,
  geocodeMatchRegion,
} from '../../services/worldViewImport/aiMatcher.js';
import { isOpenAIAvailable } from '../../services/ai/openaiService.js';
import { getModelForFeature } from '../../services/ai/aiSettingsService.js';
import { calculateCost } from '../../services/ai/pricingService.js';
import { chatCompletion } from '../../services/ai/chatCompletion.js';
import { logAIUsage } from '../../services/ai/aiUsageLogger.js';
import { WikivoyageFetcher } from '../../services/wikivoyageExtract/fetcher.js';
import { findRegionsSection } from '../../services/wikivoyageExtract/parser.js';
import type { WikiSection } from '../../services/wikivoyageExtract/types.js';
import { geoshapeMatchRegion } from '../../services/worldViewImport/geoshapeCache.js';
import { pointMatchRegion } from '../../services/worldViewImport/pointMatcher.js';
import { computeGeoSimilarityIfNeeded } from './wvImportUtils.js';

// Lazy OpenAI singleton (same pattern as aiHierarchyReviewController.ts)
let openaiClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// =============================================================================
// AI-assisted matching endpoints
// =============================================================================

/**
 * Start AI-assisted re-matching for unresolved leaves.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-match
 */
export async function startAIMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-match`);

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI API is not configured' });
    return;
  }

  // Check no AI match is already running for this world view
  const existing = getAIMatchProgress(worldViewId);
  if (existing && existing.status === 'running') {
    res.status(409).json({ error: 'AI matching is already running for this world view' });
    return;
  }

  const progress = startAIMatching(worldViewId);
  res.json({ started: true, ...progress });
}

/**
 * Get AI matching progress.
 * GET /api/admin/wv-import/matches/:worldViewId/ai-match/status
 */
export function getAIMatchStatus(req: AuthenticatedRequest, res: Response): void {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const progress = getAIMatchProgress(worldViewId);
  if (progress) {
    res.json(progress);
  } else {
    res.json({ status: 'idle' });
  }
}

/**
 * Cancel AI matching.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-match/cancel
 */
export function cancelAIMatchEndpoint(req: AuthenticatedRequest, res: Response): void {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const cancelled = cancelAIMatch(worldViewId);
  res.json({ cancelled });
}

/**
 * DB search a single region using trigram similarity.
 * POST /api/admin/wv-import/matches/:worldViewId/db-search-one
 */
export async function dbSearchOneRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/db-search-one — regionId=${regionId}`);

  try {
    const result = await dbSearchSingleRegion(worldViewId, regionId);
    // Compute geo similarity if region now has multiple suggestions
    if (result.found > 0) {
      await computeGeoSimilarityIfNeeded(regionId);
    }
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] DB search one failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB search failed' });
  }
}

/**
 * Geocode-match a single region: name -> Nominatim coordinates -> ST_Contains on GADM.
 * POST /api/admin/wv-import/matches/:worldViewId/geocode-match
 */
export async function geocodeMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geocode-match — regionId=${regionId}`);

  try {
    const result = await geocodeMatchRegion(worldViewId, regionId);
    // Compute geo similarity if region now has multiple suggestions
    if (result.found > 0) {
      await computeGeoSimilarityIfNeeded(regionId);
    }
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Geocode match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Geocode match failed' });
  }
}

/**
 * Match a region by comparing its Wikidata geoshape geometry against GADM divisions.
 * Scopes search to the relevant GADM subtree for performance.
 * POST /api/admin/wv-import/matches/:worldViewId/geoshape-match
 */
export async function geoshapeMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geoshape-match — regionId=${regionId}`);

  try {
    const result = await geoshapeMatchRegion(worldViewId, regionId);
    // Compute geo similarity if region now has multiple suggestions
    if (result.found > 0) {
      await computeGeoSimilarityIfNeeded(regionId);
    }
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Geoshape match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Geoshape match failed' });
  }
}

/**
 * Match a region using Wikivoyage marker coordinates → GADM point containment.
 * POST /api/admin/wv-import/matches/:worldViewId/point-match
 */
export async function pointMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/point-match — regionId=${regionId}`);

  try {
    const result = await pointMatchRegion(worldViewId, regionId);
    if (result.found > 0) {
      await computeGeoSimilarityIfNeeded(regionId);
    }
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Point match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Point match failed' });
  }
}

/**
 * Reset match state for a single region (clear suggestions, rejections, status).
 * POST /api/admin/wv-import/matches/:worldViewId/reset-match
 */
export async function resetMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/reset-match — regionId=${regionId}`);

  // Verify region belongs to this world view
  const region = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (region.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  // Also remove any region_members assignments for this region
  await pool.query(`DELETE FROM region_members WHERE region_id = $1`, [regionId]);

  // Delete all suggestions (both accepted and rejected)
  await pool.query(
    `DELETE FROM region_match_suggestions WHERE region_id = $1`,
    [regionId],
  );

  // Reset match status
  await pool.query(
    `UPDATE region_import_state SET match_status = 'no_candidates' WHERE region_id = $1`,
    [regionId],
  );

  res.json({ reset: true });
}

/**
 * AI-match a single region.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-match-one
 */
export async function aiMatchOneRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-match-one — regionId=${regionId}`);

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI API is not configured' });
    return;
  }

  try {
    const result = await aiMatchSingleRegion(worldViewId, regionId);
    // Compute geo similarity if region now has multiple suggestions
    await computeGeoSimilarityIfNeeded(regionId);
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] AI match one failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI matching failed' });
  }
}

/**
 * AI-suggest missing children for a region by fetching its Wikivoyage page,
 * extracting listed sub-regions, and using AI to identify gaps.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-suggest-children
 */
export async function aiSuggestChildren(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-suggest-children — regionId=${regionId}`);

  try {
    // 1. Look up source_url + name
    const regionResult = await pool.query(
      `SELECT r.id, r.name, ris.source_url
       FROM regions r
       LEFT JOIN region_import_state ris ON ris.region_id = r.id
       WHERE r.id = $1 AND r.world_view_id = $2`,
      [regionId, worldViewId],
    );
    if (regionResult.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }
    const { name: regionName, source_url: sourceUrl } = regionResult.rows[0];
    if (!sourceUrl) {
      res.status(400).json({ error: 'Region has no source URL' });
      return;
    }

    // 2. Get existing children
    const childrenResult = await pool.query(
      'SELECT name FROM regions WHERE parent_region_id = $1',
      [regionId],
    );
    const existingChildren = childrenResult.rows.map((r) => r.name as string);

    // 3. Extract page title from source URL
    const pathPart = new URL(sourceUrl).pathname.split('/wiki/')[1];
    if (!pathPart) {
      res.status(400).json({ error: 'Cannot extract page title from source URL' });
      return;
    }
    const pageTitle = decodeURIComponent(pathPart);

    // 4. Create fetcher with shared cache
    const progress = {
      cancel: false, status: 'extracting' as const, statusMessage: '',
      regionsFetched: 0, estimatedTotal: 0, currentPage: '', apiRequests: 0,
      cacheHits: 0, startedAt: Date.now(), createdRegions: 0, totalRegions: 0,
      countriesMatched: 0, totalCountries: 0, subdivisionsDrilled: 0,
      noCandidates: 0, worldViewId: null, aiApiCalls: 0, aiPromptTokens: 0,
      aiCompletionTokens: 0, aiTotalCost: 0, pendingQuestions: [],
      nextQuestionId: 1, decisions: [],
    };
    const fetcher = new WikivoyageFetcher('data/cache/wikivoyage-cache.json', progress);

    // 5. Fetch sections
    const sectionsData = await fetcher.apiGet({
      action: 'parse', page: pageTitle, prop: 'sections', format: 'json',
    });
    const sections = (sectionsData.parse as { sections: WikiSection[] })?.sections ?? [];

    // 6. Find Regions section
    const regionsSectionIdx = findRegionsSection(sections);
    if (!regionsSectionIdx) {
      fetcher.save();
      res.json({
        suggestions: [],
        analysis: 'No "Regions" section found on the Wikivoyage page.',
        stats: null,
      });
      return;
    }

    // 7. Fetch section wikitext
    const wikitextData = await fetcher.apiGet({
      action: 'parse', page: pageTitle, prop: 'wikitext',
      section: regionsSectionIdx, format: 'json',
    });
    const wikitext = ((wikitextData.parse as { wikitext: Record<string, string> })?.wikitext?.['*']) ?? '';

    fetcher.save();

    // 8. AI extracts sub-regions directly from the raw wikitext (handles all formats:
    // regionlist templates, bullet links, bold text, subsections, prose, etc.)
    if (!isOpenAIAvailable()) {
      res.status(503).json({ error: 'OpenAI API is not configured — AI is required for suggest children' });
      return;
    }

    if (wikitext.length === 0) {
      res.json({
        suggestions: [],
        analysis: 'The Regions section on the Wikivoyage page is empty.',
        stats: null,
      });
      return;
    }

    const startTime = Date.now();
    const model = await getModelForFeature('suggest_children');
    const client = getClient();

    const existingList = existingChildren.length > 0
      ? existingChildren.map(n => `  - ${n}`).join('\n')
      : '  (none — the region has no children yet)';

    const systemPrompt = `You are a travel geography expert. A user is building a region hierarchy for travel tracking.

=== REGION: "${regionName}" ===

=== EXISTING CHILDREN (${existingChildren.length} total, already in the hierarchy — do NOT suggest these): ===
${existingList}

=== RAW WIKITEXT from the "Regions" section of the Wikivoyage page: ===
${wikitext.slice(0, 4000)}
=== END WIKITEXT ===

YOUR TASK:
1. Read the wikitext carefully and extract ALL sub-regions mentioned as direct children of "${regionName}". The wikitext may use various formats: {{Regionlist}} templates, bullet-point wikilinks, bold text, subsections, or prose. Extract region names from ALL of these.
2. Compare with the EXISTING CHILDREN list above (${existingChildren.length} entries). Only suggest regions that are NOT already in that list (case-insensitive comparison).
3. Filter out cities, towns, and other non-region entries — only include actual regions/areas/provinces/states/oblasts.
4. Provide a brief analysis.

IMPORTANT: The existing children list and the wikitext are SEPARATE things. The existing children are what's already in the hierarchy. The wikitext is the source to extract NEW suggestions from. Do not confuse them.

Respond with JSON only (no markdown fences):
{
  "suggestions": [
    { "name": "Region Name", "reason": "brief reason" }
  ],
  "analysis": "1-2 sentence summary"
}

- Use the canonical region name (not alternate spellings or abbreviations).
- Only suggest regions that genuinely belong as direct children of "${regionName}".`;

    const response = await chatCompletion(client, {
      model,
      temperature: 0.3,
      max_completion_tokens: 4000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract sub-regions for "${regionName}" from the wikitext that are NOT in the ${existingChildren.length} existing children.` },
      ],
    });

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const cost = calculateCost(promptTokens, completionTokens, model);
    const durationMs = Date.now() - startTime;

    logAIUsage({
      feature: 'suggest_children',
      model,
      apiCalls: 1,
      promptTokens,
      completionTokens,
      totalCost: cost.totalCost,
      durationMs,
      description: `Suggest children for "${regionName}" (region ${regionId}) in world view ${worldViewId}`,
    }).catch((err) => console.warn('[AI Usage] Failed to log:', err));

    const content = response.choices[0]?.message?.content ?? '';
    try {
      let jsonStr = content;
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1];
      const parsed = JSON.parse(jsonStr.trim()) as {
        suggestions: Array<{ name: string; reason: string }>;
        analysis: string;
      };

      res.json({
        suggestions: parsed.suggestions ?? [],
        analysis: parsed.analysis ?? '',
        stats: {
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          cost: cost.totalCost,
        },
      });
    } catch {
      res.json({
        suggestions: [],
        analysis: content || 'AI response could not be parsed.',
        stats: {
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          cost: cost.totalCost,
        },
      });
    }
  } catch (err) {
    console.error(`[WV Import] AI suggest children failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI suggest children failed' });
  }
}
