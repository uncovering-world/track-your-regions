/**
 * Admin WorldView Import — AI Match controller
 *
 * Owns: AI-assisted matching endpoints (start/status/cancel), single-region
 * fallbacks (DB search, geocode), reset, AI-match-one-region, and
 * AI-review-children (audit + enrichment + verification).
 * See ADR-0009 for the domain-split rationale.
 */

import OpenAI from 'openai';
import { Response } from 'express';
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
import { isOpenAIAvailable, getModel } from '../../services/ai/openaiService.js';
import { calculateCost } from '../../services/ai/pricingService.js';
import { geoshapeMatchRegion, computeGeoSimilarityForRegion } from '../../services/worldViewImport/geoshapeCache.js';
import { pointMatchRegion } from '../../services/worldViewImport/pointMatcher.js';
import { WikivoyageFetcher } from '../../services/wikivoyageExtract/fetcher.js';
import { findRegionsSection } from '../../services/wikivoyageExtract/parser.js';
import type { WikiSection } from '../../services/wikivoyageExtract/types.js';

// =============================================================================
// AI match orchestration
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

// =============================================================================
// Single-region operations
// =============================================================================

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
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] DB search one failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB search failed' });
  }
}

/**
 * Geocode-match a single region: name → Nominatim coordinates → ST_Contains on GADM.
 * POST /api/admin/wv-import/matches/:worldViewId/geocode-match
 */
export async function geocodeMatch(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/geocode-match — regionId=${regionId}`);

  try {
    const result = await geocodeMatchRegion(worldViewId, regionId);
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] Geocode match failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Geocode match failed' });
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
    res.json(result);
  } catch (err) {
    console.error(`[WV Import] AI match one failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI matching failed' });
  }
}

// =============================================================================
// Geo similarity helper
// =============================================================================

/**
 * Compute geo similarity if the region now has multiple suggestions.
 * Called after geoshape/point match to score and auto-accept/reject candidates.
 */
async function computeGeoSimilarityIfNeeded(regionId: number): Promise<void> {
  const sugResult = await pool.query(
    `SELECT division_id AS "divisionId" FROM region_match_suggestions WHERE region_id = $1 AND rejected = false`,
    [regionId],
  );
  if (sugResult.rows.length <= 1) return;

  const client = await pool.connect();
  try {
    await computeGeoSimilarityForRegion(client, regionId, sugResult.rows as Array<{ divisionId: number }>);
  } finally {
    client.release();
  }
}

// =============================================================================
// Geoshape and point matching
// =============================================================================

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

// =============================================================================
// aiSuggestChildren — AI Review Children
// =============================================================================

// Lazy OpenAI singleton for this controller
let openaiClient: OpenAI | null = null;
function getAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// Code-fence regex (no inner \s* to avoid super-linear backtracking)
const FENCE_REGEX = /```(?:json)?([\s\S]*?)```/;

interface ExistingChild {
  name: string;
  sourceUrl: string | null;
  sourceExternalId: string | null;
}

interface AuditAction {
  type: 'add' | 'remove' | 'rename';
  name?: string;
  childName?: string;
  newName?: string;
  reason: string;
}

interface AuditResult {
  actions: AuditAction[];
  analysis: string;
}

interface NormalizedAction {
  type: 'add' | 'remove' | 'rename';
  name: string;
  newName?: string;
  reason: string;
}

interface Enrichment {
  name: string;
  wikivoyageTitle: string | null;
  wikidataQID: string | null;
}

interface PageVerification {
  exists: boolean;
  wikidataQID: string | null;
}

/** Strip an optional ```json ... ``` code fence and JSON-parse the result. */
function parseFencedJson<T>(raw: string): T {
  let jsonStr = raw;
  const fenceMatch = FENCE_REGEX.exec(raw);
  if (fenceMatch) jsonStr = fenceMatch[1];
  return JSON.parse(jsonStr.trim()) as T;
}

/** Encode a Wikivoyage page title as a URL (spaces become underscores). */
function wikivoyagePageUrl(title: string): string {
  return `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Build an initial progress stub for the WikivoyageFetcher constructor. */
function buildFetcherProgress() {
  return {
    cancel: false, status: 'extracting' as const, statusMessage: '',
    regionsFetched: 0, estimatedTotal: 0, currentPage: '', apiRequests: 0,
    cacheHits: 0, startedAt: Date.now(), createdRegions: 0, totalRegions: 0,
    countriesMatched: 0, totalCountries: 0, subdivisionsDrilled: 0,
    noCandidates: 0, worldViewId: null, aiApiCalls: 0, aiPromptTokens: 0,
    aiCompletionTokens: 0, aiTotalCost: 0, pendingQuestions: [],
    nextQuestionId: 1, decisions: [],
  };
}

/** Fetch the raw "Regions" section wikitext. Returns null when missing or empty. */
async function fetchRegionsSectionWikitext(
  fetcher: WikivoyageFetcher,
  pageTitle: string,
): Promise<string | null> {
  const sectionsData = await fetcher.apiGet({
    action: 'parse', page: pageTitle, prop: 'sections', format: 'json',
  });
  const sections = (sectionsData.parse as { sections: WikiSection[] })?.sections ?? [];

  const regionsSectionIdx = findRegionsSection(sections);
  if (!regionsSectionIdx) {
    fetcher.save();
    return null;
  }

  const wikitextData = await fetcher.apiGet({
    action: 'parse', page: pageTitle, prop: 'wikitext',
    section: regionsSectionIdx, format: 'json',
  });
  const wikitext = ((wikitextData.parse as { wikitext: Record<string, string> })?.wikitext?.['*']) ?? '';
  fetcher.save();
  return wikitext.length === 0 ? null : wikitext;
}

/** Build the audit prompt for AI Call 1. */
function buildAuditPrompt(regionName: string, existingChildren: ExistingChild[], wikitext: string): string {
  const existingList = existingChildren.length > 0
    ? existingChildren.map(c => `  - ${c.name}`).join('\n')
    : '  (none — the region has no children yet)';

  return `You are a travel geography expert. A user is building a region hierarchy for travel tracking.

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
}

/** Build the enrichment prompt for AI Call 2. */
function buildEnrichPrompt(enrichTargets: string[], wikitext: string): string {
  return `You are a Wikivoyage and Wikidata expert. Given a list of region names and the raw wikitext they were extracted from, provide the exact Wikivoyage page title and Wikidata QID for each.

=== RAW WIKITEXT: ===
${wikitext.slice(0, 4000)}
=== END WIKITEXT ===

=== REGIONS TO ENRICH: ===
${enrichTargets.map(n => `  - ${n}`).join('\n')}

For each region, extract:
1. **wikivoyageTitle**: The exact Wikivoyage page title. Look for wikilinks like [[Page Title]] or [[Page Title|Display Name]] in the wikitext. If no wikilink exists, use the region name as-is.
2. **wikidataQID**: The Wikidata QID (e.g. Q12345) if referenced in the wikitext. If not present, set to null.

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
}

/** Normalize AI audit actions into a uniform shape. */
function normalizeAuditActions(actions: AuditAction[]): NormalizedAction[] {
  return actions.map((a) => ({
    type: a.type,
    name: a.type === 'add' ? (a.name ?? '') : (a.childName ?? ''),
    newName: a.type === 'rename' ? (a.newName ?? '') : undefined,
    reason: a.reason ?? '',
  }));
}

/** Collect all names that need Wikivoyage enrichment. */
function collectEnrichTargets(actions: NormalizedAction[]): string[] {
  return actions
    .filter(a => a.type === 'add' || a.type === 'rename')
    .map(a => a.type === 'rename' ? (a.newName ?? a.name) : a.name);
}

/** Parse the AI enrichment response. Returns [] on malformed JSON. */
function parseEnrichmentResponse(raw: string): Enrichment[] {
  try {
    const parsed = parseFencedJson<{ enrichments?: Enrichment[] }>(raw);
    return parsed.enrichments ?? [];
  } catch {
    console.warn('[AI Review Children] Failed to parse enrichment response');
    return [];
  }
}

/** Verify a batch of Wikivoyage page titles via the MediaWiki API. */
async function verifyBatch(
  batch: string[],
  fetcher: WikivoyageFetcher,
  verifiedPages: Map<string, PageVerification>,
): Promise<void> {
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

/** Verify which Wikivoyage page titles exist (batches of 50). */
async function verifyWikivoyagePages(
  titles: string[],
  fetcher: WikivoyageFetcher,
): Promise<Map<string, PageVerification>> {
  const verifiedPages = new Map<string, PageVerification>();
  for (let i = 0; i < titles.length; i += 50) {
    await verifyBatch(titles.slice(i, i + 50), fetcher, verifiedPages);
  }
  return verifiedPages;
}

/** Merge AI enrichment + page verification into each audit action. */
function buildEnrichedActions(
  actions: NormalizedAction[],
  enrichMap: Map<string, Enrichment>,
  verifiedPages: Map<string, PageVerification>,
) {
  return actions.map((action) => {
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
    return {
      ...action,
      sourceUrl: wikivoyagePageUrl(enrichment.wikivoyageTitle),
      sourceExternalId: verification.wikidataQID ?? enrichment.wikidataQID ?? null,
      verified: true,
    };
  });
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
    const { name: regionName, source_url: sourceUrl } = regionResult.rows[0] as { name: string; source_url: string | null };
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
    const existingChildren: ExistingChild[] = childrenResult.rows.map((r) => ({
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

    const fetcher = new WikivoyageFetcher('data/cache/wikivoyage-cache.json', buildFetcherProgress());

    const wikitext = await fetchRegionsSectionWikitext(fetcher, pageTitle);
    if (wikitext == null) {
      res.json({ actions: [], analysis: 'No "Regions" section found on the Wikivoyage page.', stats: null });
      return;
    }

    if (!isOpenAIAvailable()) {
      res.status(503).json({ error: 'OpenAI API is not configured' });
      return;
    }

    // 4. AI Call 1 — Audit
    const model = getModel();
    const client = getAIClient();
    const startTime = Date.now();

    const auditPrompt = buildAuditPrompt(regionName, existingChildren, wikitext);

    const auditResponse = await client.chat.completions.create({
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
    let auditResult: AuditResult;
    try {
      auditResult = parseFencedJson<AuditResult>(auditContent);
    } catch {
      const auditCost = calculateCost(auditTokensIn, auditTokensOut, model);
      res.json({
        actions: [],
        analysis: auditContent || 'AI response could not be parsed.',
        stats: { inputTokens: auditTokensIn, outputTokens: auditTokensOut, cost: auditCost.totalCost },
      });
      return;
    }

    const actions = normalizeAuditActions(auditResult.actions ?? []);
    const enrichTargets = collectEnrichTargets(actions);

    if (enrichTargets.length === 0) {
      const auditCost = calculateCost(auditTokensIn, auditTokensOut, model);
      res.json({
        actions: actions.map(a => ({ ...a, sourceUrl: null, sourceExternalId: null, verified: false })),
        analysis: auditResult.analysis ?? '',
        stats: { inputTokens: auditTokensIn, outputTokens: auditTokensOut, cost: auditCost.totalCost },
      });
      return;
    }

    // 5. AI Call 2 — Enrichment
    const enrichPrompt = buildEnrichPrompt(enrichTargets, wikitext);

    const enrichResponse = await client.chat.completions.create({
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

    const enrichments = parseEnrichmentResponse(enrichResponse.choices[0]?.message?.content ?? '');
    const enrichMap = new Map(enrichments.map(e => [e.name.toLowerCase(), e]));

    // 6. Programmatic verification via Wikivoyage API
    const titlesToVerify = enrichments
      .map(e => e.wikivoyageTitle)
      .filter((t): t is string => t != null && t.length > 0);

    const verifiedPages = await verifyWikivoyagePages(titlesToVerify, fetcher);

    // 7. Merge enrichment + verification into actions
    const totalTokensIn = auditTokensIn + enrichTokensIn;
    const totalTokensOut = auditTokensOut + enrichTokensOut;
    const totalCost = calculateCost(totalTokensIn, totalTokensOut, model);

    console.log(`[WV Import] AI review children for "${regionName}" (${regionId}) — ${actions.length} actions, ${Date.now() - startTime}ms, $${totalCost.totalCost.toFixed(4)}`);

    const enrichedActions = buildEnrichedActions(actions, enrichMap, verifiedPages);

    res.json({
      actions: enrichedActions,
      analysis: auditResult.analysis ?? '',
      stats: { inputTokens: totalTokensIn, outputTokens: totalTokensOut, cost: totalCost.totalCost },
    });
  } catch (err) {
    console.error(`[WV Import] AI review children failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI review children failed' });
  }
}
