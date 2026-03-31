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
  const { regionId, scopeAncestorId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geoshape-match — regionId=${regionId}${scopeAncestorId ? ` scopeAncestorId=${scopeAncestorId}` : ''}`);

  try {
    const result = await geoshapeMatchRegion(worldViewId, regionId, scopeAncestorId);
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
  const { regionId, scopeAncestorId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/point-match — regionId=${regionId}${scopeAncestorId ? ` scopeAncestorId=${scopeAncestorId}` : ''}`);

  try {
    const result = await pointMatchRegion(worldViewId, regionId, scopeAncestorId);
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
 * AI-review children for a region: full audit + enrichment + verification flow.
 * Fetches the Wikivoyage "Regions" section, asks AI to audit existing children
 * (add/remove/rename), enriches with Wikivoyage page titles and Wikidata QIDs,
 * then programmatically verifies pages exist via the Wikivoyage API.
 * POST /api/admin/wv-import/matches/:worldViewId/ai-suggest-children
 */
export async function aiSuggestChildren(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-review-children — regionId=${regionId}`);

  try {
    // 1. Fetch region metadata
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

    // 2. Fetch existing children with metadata
    const childrenResult = await pool.query(
      `SELECT r.name, ris.source_url, ris.source_external_id
       FROM regions r
       LEFT JOIN region_import_state ris ON ris.region_id = r.id
       WHERE r.parent_region_id = $1`,
      [regionId],
    );
    const existingChildren = childrenResult.rows.map((r) => ({
      name: r.name as string,
      sourceUrl: (r.source_url as string | null) ?? null,
      sourceExternalId: (r.source_external_id as string | null) ?? null,
    }));

    // 3. Fetch Wikivoyage "Regions" section wikitext
    const pathPart = new URL(sourceUrl).pathname.split('/wiki/')[1];
    if (!pathPart) {
      res.status(400).json({ error: 'Cannot extract page title from source URL' });
      return;
    }
    const pageTitle = decodeURIComponent(pathPart);

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

    const sectionsData = await fetcher.apiGet({
      action: 'parse', page: pageTitle, prop: 'sections', format: 'json',
    });
    const sections = (sectionsData.parse as { sections: WikiSection[] })?.sections ?? [];

    const regionsSectionIdx = findRegionsSection(sections);
    if (!regionsSectionIdx) {
      fetcher.save();
      res.json({ actions: [], analysis: 'No "Regions" section found on the Wikivoyage page.', stats: null });
      return;
    }

    const wikitextData = await fetcher.apiGet({
      action: 'parse', page: pageTitle, prop: 'wikitext',
      section: regionsSectionIdx, format: 'json',
    });
    const wikitext = ((wikitextData.parse as { wikitext: Record<string, string> })?.wikitext?.['*']) ?? '';
    fetcher.save();

    if (wikitext.length === 0) {
      res.json({ actions: [], analysis: 'The Regions section on the Wikivoyage page is empty.', stats: null });
      return;
    }

    if (!isOpenAIAvailable()) {
      res.status(503).json({ error: 'OpenAI API is not configured' });
      return;
    }

    // 4. AI Call 1 — Audit
    const model = await getModelForFeature('review_children');
    const client = getClient();
    const startTime = Date.now();

    const existingList = existingChildren.length > 0
      ? existingChildren.map(c => `  - ${c.name}`).join('\n')
      : '  (none — the region has no children yet)';

    const auditPrompt = `You are a travel geography expert. A user is building a region hierarchy for travel tracking.

=== REGION: "${regionName}" ===

=== EXISTING CHILDREN (${existingChildren.length} total): ===
${existingList}

=== RAW WIKITEXT from the "Regions" section of the Wikivoyage page: ===
${wikitext.slice(0, 4000)}
=== END WIKITEXT ===

YOUR TASK — full audit of the children list:

1. **Add**: Extract ALL sub-regions from the wikitext that are NOT in the existing children list (case-insensitive). The wikitext may use various formats: {{Regionlist}} templates, bullet-point wikilinks, bold text, subsections, or prose. Only include actual regions/areas/provinces/states — NOT cities or towns.

2. **Remove**: Identify existing children that should NOT be in the list. Reasons: it's a city/town (not a region), it doesn't appear in the Wikivoyage page as a sub-region, or it doesn't geographically belong as a direct child of "${regionName}".

3. **Rename**: Identify existing children whose names don't match the canonical Wikivoyage name. Suggest the correct name.

4. Provide a brief analysis summary.

Respond with JSON only (no markdown fences):
{
  "actions": [
    { "type": "add", "name": "Region Name", "reason": "brief reason" },
    { "type": "remove", "childName": "Existing Name", "reason": "brief reason" },
    { "type": "rename", "childName": "Current Name", "newName": "Correct Name", "reason": "brief reason" }
  ],
  "analysis": "1-2 sentence summary"
}

Rules:
- Use canonical region names from the Wikivoyage page (not alternate spellings).
- Only suggest regions that genuinely belong as direct children of "${regionName}".
- If everything looks correct, return an empty actions array.
- For renames, the childName must exactly match an existing child name.`;

    const auditResponse = await chatCompletion(client, {
      model,
      temperature: 0.3,
      max_completion_tokens: 4000,
      messages: [
        { role: 'system', content: auditPrompt },
        { role: 'user', content: `Audit the children of "${regionName}": compare wikitext against the ${existingChildren.length} existing children.` },
      ],
    });

    const auditTokensIn = auditResponse.usage?.prompt_tokens ?? 0;
    const auditTokensOut = auditResponse.usage?.completion_tokens ?? 0;

    // Parse audit response
    const auditContent = auditResponse.choices[0]?.message?.content ?? '';
    let auditResult: {
      actions: Array<{
        type: 'add' | 'remove' | 'rename';
        name?: string;
        childName?: string;
        newName?: string;
        reason: string;
      }>;
      analysis: string;
    };
    try {
      let jsonStr = auditContent;
      const fenceMatch = auditContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1];
      auditResult = JSON.parse(jsonStr.trim());
    } catch {
      const auditCost = calculateCost(auditTokensIn, auditTokensOut, model);
      logAIUsage({
        feature: 'review_children',
        model, apiCalls: 1,
        promptTokens: auditTokensIn, completionTokens: auditTokensOut,
        totalCost: auditCost.totalCost, durationMs: Date.now() - startTime,
        description: `Review children for "${regionName}" (region ${regionId}) — parse error`,
      }).catch((err) => console.warn('[AI Usage] Failed to log:', err));
      res.json({
        actions: [],
        analysis: auditContent || 'AI response could not be parsed.',
        stats: { inputTokens: auditTokensIn, outputTokens: auditTokensOut, cost: auditCost.totalCost },
      });
      return;
    }

    // Normalize actions: unify name field
    const actions = (auditResult.actions ?? []).map((a) => ({
      type: a.type,
      name: a.type === 'add' ? (a.name ?? '') : (a.childName ?? ''),
      newName: a.type === 'rename' ? (a.newName ?? '') : undefined,
      reason: a.reason ?? '',
    }));

    // Find existing children missing metadata — candidates for enrichment
    const renamedNames = new Set(actions.filter(a => a.type === 'rename').map(a => a.name.toLowerCase()));
    const removedNames = new Set(actions.filter(a => a.type === 'remove').map(a => a.name.toLowerCase()));
    const childrenNeedingEnrichment = existingChildren.filter(c =>
      (!c.sourceUrl || !c.sourceExternalId) &&
      !renamedNames.has(c.name.toLowerCase()) &&
      !removedNames.has(c.name.toLowerCase()),
    );

    // Combine enrichable audit actions + existing children needing metadata
    const enrichableActions = actions.filter(a => a.type === 'add' || a.type === 'rename');
    const allEnrichTargets = [
      ...enrichableActions.map(a => a.type === 'rename' ? (a.newName ?? a.name) : a.name),
      ...childrenNeedingEnrichment.map(c => c.name),
    ];

    if (allEnrichTargets.length === 0) {
      const auditCost = calculateCost(auditTokensIn, auditTokensOut, model);
      logAIUsage({
        feature: 'review_children',
        model, apiCalls: 1,
        promptTokens: auditTokensIn, completionTokens: auditTokensOut,
        totalCost: auditCost.totalCost, durationMs: Date.now() - startTime,
        description: `Review children for "${regionName}" (region ${regionId}) — no enrichable actions`,
      }).catch((err) => console.warn('[AI Usage] Failed to log:', err));
      res.json({
        actions: actions.map(a => ({ ...a, sourceUrl: null, sourceExternalId: null, verified: false })),
        analysis: auditResult.analysis ?? '',
        stats: { inputTokens: auditTokensIn, outputTokens: auditTokensOut, cost: auditCost.totalCost },
      });
      return;
    }

    // 5. AI Call 2 — Enrichment
    const enrichTargets = allEnrichTargets;

    const enrichPrompt = `You are a Wikivoyage and Wikidata expert. Given a list of region names and the raw wikitext they were extracted from, provide the exact Wikivoyage page title and Wikidata QID for each.

=== RAW WIKITEXT: ===
${wikitext.slice(0, 4000)}
=== END WIKITEXT ===

=== REGIONS TO ENRICH: ===
${enrichTargets.map(n => `  - ${n}`).join('\n')}

For each region, extract:
1. **wikivoyageTitle**: The exact Wikivoyage page title. Look for wikilinks like [[Page Title]] or [[Page Title|Display Name]] in the wikitext. If no wikilink exists, use the region name as-is.
2. **wikidataQID**: The Wikidata QID (e.g. Q12345) if referenced in the wikitext (e.g. in {{Regionlist}} wikidata= parameters). If not in the wikitext, provide your best guess or null.

Respond with JSON only (no markdown fences):
{
  "enrichments": [
    { "name": "Region Name", "wikivoyageTitle": "Page Title", "wikidataQID": "Q12345" }
  ]
}

Rules:
- The "name" field must exactly match one of the regions listed above.
- wikivoyageTitle should be the page title WITHOUT the "en.wikivoyage.org/wiki/" prefix.
- If unsure about a QID, set it to null rather than guessing wrong.`;

    const enrichResponse = await chatCompletion(client, {
      model,
      temperature: 0.1,
      max_completion_tokens: 2000,
      messages: [
        { role: 'system', content: enrichPrompt },
        { role: 'user', content: `Enrich these ${enrichTargets.length} regions with Wikivoyage titles and Wikidata QIDs.` },
      ],
    });

    const enrichTokensIn = enrichResponse.usage?.prompt_tokens ?? 0;
    const enrichTokensOut = enrichResponse.usage?.completion_tokens ?? 0;

    let enrichments: Array<{ name: string; wikivoyageTitle: string | null; wikidataQID: string | null }> = [];
    try {
      let jsonStr = enrichResponse.choices[0]?.message?.content ?? '';
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1];
      const parsed = JSON.parse(jsonStr.trim());
      enrichments = parsed.enrichments ?? [];
    } catch {
      console.warn('[AI Review Children] Failed to parse enrichment response');
    }

    // Build lookup: name (lowercase) -> enrichment
    const enrichMap = new Map(
      enrichments.map(e => [e.name.toLowerCase(), e]),
    );

    // 6. Programmatic verification via Wikivoyage API
    const titlesToVerify = enrichments
      .map(e => e.wikivoyageTitle)
      .filter((t): t is string => t != null && t.length > 0);

    const verifiedPages = new Map<string, { exists: boolean; wikidataQID: string | null }>();

    if (titlesToVerify.length > 0) {
      // Batch query — MediaWiki API supports up to 50 titles per request
      for (let i = 0; i < titlesToVerify.length; i += 50) {
        const batch = titlesToVerify.slice(i, i + 50);
        try {
          const verifyData = await fetcher.apiGet({
            action: 'query',
            titles: batch.join('|'),
            prop: 'pageprops',
            ppprop: 'wikibase_item',
            format: 'json',
          });
          fetcher.save();

          const pages = (verifyData.query as { pages?: Record<string, { title: string; missing?: string; pageprops?: { wikibase_item?: string } }> })?.pages ?? {};
          for (const page of Object.values(pages)) {
            const exists = !('missing' in page);
            const qid = page.pageprops?.wikibase_item ?? null;
            verifiedPages.set(page.title.toLowerCase(), { exists, wikidataQID: qid });
          }
        } catch (err) {
          console.warn('[AI Review Children] Wikivoyage verification batch failed:', err);
        }
      }
    }

    // 7. Merge enrichment + verification into actions
    const totalTokensIn = auditTokensIn + enrichTokensIn;
    const totalTokensOut = auditTokensOut + enrichTokensOut;
    const totalCost = calculateCost(totalTokensIn, totalTokensOut, model);
    const durationMs = Date.now() - startTime;

    logAIUsage({
      feature: 'review_children',
      model, apiCalls: 2,
      promptTokens: totalTokensIn, completionTokens: totalTokensOut,
      totalCost: totalCost.totalCost, durationMs,
      description: `Review children for "${regionName}" (region ${regionId}) in wv ${worldViewId} — ${actions.length} actions`,
    }).catch((err) => console.warn('[AI Usage] Failed to log:', err));

    const enrichedActions = actions.map((action) => {
      if (action.type === 'remove') {
        return { ...action, sourceUrl: null, sourceExternalId: null, verified: false };
      }

      const lookupName = action.type === 'rename' ? (action.newName ?? action.name) : action.name;
      const enrichment = enrichMap.get(lookupName.toLowerCase());

      if (!enrichment?.wikivoyageTitle) {
        return { ...action, sourceUrl: null, sourceExternalId: null, verified: false };
      }

      const verification = verifiedPages.get(enrichment.wikivoyageTitle.toLowerCase());
      if (!verification?.exists) {
        return { ...action, sourceUrl: null, sourceExternalId: null, verified: false };
      }

      // Page verified — use real QID from Wikivoyage API (not AI's guess)
      const encodedTitle = encodeURIComponent(enrichment.wikivoyageTitle.replace(/ /g, '_'));
      return {
        ...action,
        sourceUrl: `https://en.wikivoyage.org/wiki/${encodedTitle}`,
        sourceExternalId: verification.wikidataQID ?? enrichment.wikidataQID ?? null,
        verified: true,
      };
    });

    // Build enrich actions for existing children missing metadata
    const enrichActions = childrenNeedingEnrichment.map((child) => {
      const enrichment = enrichMap.get(child.name.toLowerCase());
      if (!enrichment?.wikivoyageTitle) {
        return null;
      }
      const verification = verifiedPages.get(enrichment.wikivoyageTitle.toLowerCase());
      if (!verification?.exists) {
        return null;
      }
      const encodedTitle = encodeURIComponent(enrichment.wikivoyageTitle.replace(/ /g, '_'));
      const newSourceUrl = `https://en.wikivoyage.org/wiki/${encodedTitle}`;
      const newExternalId = verification.wikidataQID ?? enrichment.wikidataQID ?? null;
      // Only suggest enrichment if we actually have new data
      if (child.sourceUrl && child.sourceExternalId) return null;
      const parts: string[] = [];
      if (!child.sourceUrl && newSourceUrl) parts.push('Wikivoyage URL');
      if (!child.sourceExternalId && newExternalId) parts.push('Wikidata QID');
      if (parts.length === 0) return null;
      return {
        type: 'enrich' as const,
        name: child.name,
        reason: `add missing ${parts.join(' and ')}`,
        sourceUrl: newSourceUrl,
        sourceExternalId: newExternalId,
        verified: true,
      };
    }).filter((a): a is NonNullable<typeof a> => a != null);

    res.json({
      actions: [...enrichedActions, ...enrichActions],
      analysis: auditResult.analysis ?? '',
      stats: { inputTokens: totalTokensIn, outputTokens: totalTokensOut, cost: totalCost.totalCost },
    });
  } catch (err) {
    console.error(`[WV Import] AI review children failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI review children failed' });
  }
}

/**
 * AI-assisted cluster-to-region matching.
 * Given K-means color clusters (each containing GADM division names) and a list
 * of child region names, asks the AI to match each cluster to a region.
 */
export async function aiSuggestClusterRegions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { clusters, childRegions, model: modelOverride } = req.body as {
    clusters: Array<{ clusterId: number; color: string; pixelShare: number; divisionNames: string[] }>;
    childRegions: Array<{ id: number; name: string }>;
    model?: string;
  };
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-suggest-clusters — ${clusters.length} clusters, ${childRegions.length} regions${modelOverride ? ` (model override: ${modelOverride})` : ''}`);

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI API not configured' });
    return;
  }

  const startMs = Date.now();
  const model = modelOverride || await getModelForFeature('cv_cluster_match');
  const client = getClient();

  const clusterDescriptions = clusters.map(c =>
    `Cluster ${c.clusterId} (${Math.round(c.pixelShare * 100)}% of map): ${c.divisionNames.join(', ')}`
  ).join('\n');

  const regionNames = childRegions.map(r => r.name).join(', ');

  const systemPrompt = `You are an expert in world geography and administrative divisions.
You are given clusters of GADM administrative divisions detected on a Wikivoyage travel region map, and a list of Wikivoyage sub-region names.
Your job: match each cluster to the most likely Wikivoyage sub-region based on geographic knowledge.

Rules:
- Each cluster should map to exactly one region (or null if no match).
- CRITICAL: Each region name must appear AT MOST ONCE across all matches. Never assign the same region to two different clusters. If two clusters seem to match the same region, pick the better fit and set the other to null.
- Use your knowledge of where these divisions are located geographically.
- The division names are official GADM names. The region names are Wikivoyage travel region names (may be informal, e.g. "Wild Coast" for the Transkei area).
- It is OK to leave some clusters unmatched (null) if there is no good fit. Do not force a match.
- Return valid JSON only.`;

  const userPrompt = `Available Wikivoyage regions: ${regionNames}

Clusters of GADM divisions:
${clusterDescriptions}

Return JSON: { "matches": [{ "clusterId": <number>, "regionName": <string|null> }] }
Match each cluster to the best Wikivoyage region name, or null if no match.`;

  try {
    const response = await chatCompletion(client, {
      model,
      temperature: 0.1,
      max_completion_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    let matches: Array<{ clusterId: number; regionName: string | null }>;
    try {
      const parsed = JSON.parse(content);
      matches = Array.isArray(parsed) ? parsed : parsed.matches ?? parsed.result ?? [];
    } catch {
      matches = [];
    }

    // Map region names back to IDs (case-insensitive) + dedup (keep first occurrence)
    const regionMap = new Map(childRegions.map(r => [r.name.toLowerCase(), r.id]));
    const usedRegionIds = new Set<number>();
    const result = matches.map(m => {
      const regionId = m.regionName ? (regionMap.get(m.regionName.toLowerCase()) ?? null) : null;
      if (regionId && usedRegionIds.has(regionId)) {
        console.log(`  [AI Suggest Clusters] Dedup: cluster ${m.clusterId} tried to use already-assigned region "${m.regionName}" → null`);
        return { clusterId: m.clusterId, regionId: null, regionName: null };
      }
      if (regionId) usedRegionIds.add(regionId);
      return { clusterId: m.clusterId, regionId, regionName: m.regionName };
    });

    // Log usage stats
    const usage = response.usage;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const costResult = calculateCost(promptTokens, completionTokens, model, false);
    const durationMs = Date.now() - startMs;

    logAIUsage({
      feature: 'cv_cluster_match',
      model,
      description: `${clusters.length} clusters → ${childRegions.length} regions (wv ${worldViewId})`,
      apiCalls: 1,
      promptTokens,
      completionTokens,
      totalCost: costResult.totalCost,
      durationMs,
    });

    console.log(`  [AI Suggest Clusters] model=${model} ${promptTokens} in, ${completionTokens} out, cost=$${costResult.totalCost.toFixed(4)}, ${durationMs}ms, matched=${result.filter(r => r.regionId).length}/${clusters.length}`);

    res.json({
      matches: result,
      stats: { model, promptTokens, completionTokens, cost: costResult.totalCost, durationMs },
    });
  } catch (err) {
    console.error('[AI Suggest Clusters] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI suggestion failed' });
  }
}
