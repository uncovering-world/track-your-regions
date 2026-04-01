# AI Review Children Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "AI Suggest Missing Children" with a full children audit that can add, remove, and rename children — enriched with Wikivoyage URLs and Wikidata QIDs, programmatically verified.

**Architecture:** Two sequential AI calls (audit + enrichment) followed by batch Wikivoyage API verification. The backend controller is rewritten; the frontend gets an updated dialog with grouped actions. Existing rename/remove/add endpoints are reused with minor extensions.

**Tech Stack:** OpenAI ChatCompletion, Wikivoyage MediaWiki API, React/MUI, TanStack Query

---

### Task 1: Extend `addChildRegion` Backend to Accept Enrichment Fields

**Files:**
- Modify: `backend/src/types/index.ts:520-523` (Zod schema)
- Modify: `backend/src/controllers/admin/wvImportFinalizeController.ts:99-141` (controller)

- [ ] **Step 1: Update Zod schema to accept optional enrichment fields**

In `backend/src/types/index.ts`, update `wvImportAddChildSchema`:

```typescript
export const wvImportAddChildSchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(500),
  sourceUrl: z.string().url().max(2000).optional(),
  sourceExternalId: z.string().max(100).optional(),
});
```

- [ ] **Step 2: Update controller to persist enrichment fields**

In `backend/src/controllers/admin/wvImportFinalizeController.ts`, update `addChildRegion` — after inserting the region and `region_import_state`, update import state with enrichment if provided:

```typescript
export async function addChildRegion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { parentRegionId, name, sourceUrl, sourceExternalId } = req.body as {
    parentRegionId: number;
    name: string;
    sourceUrl?: string;
    sourceExternalId?: string;
  };
  console.log(`[WV Import] POST /matches/${worldViewId}/add-child-region — parent=${parentRegionId}, name="${name}"`);

  // Verify parent belongs to world view
  const parent = await pool.query(
    'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
    [parentRegionId, worldViewId],
  );
  if (parent.rows.length === 0) {
    res.status(404).json({ error: 'Parent region not found in this world view' });
    return;
  }

  // Get import_run_id from parent's import state
  const parentState = await pool.query(
    'SELECT import_run_id FROM region_import_state WHERE region_id = $1',
    [parentRegionId],
  );
  const importRunId = parentState.rows[0]?.import_run_id ?? null;

  // Create child region
  const result = await pool.query(
    `INSERT INTO regions (world_view_id, name, parent_region_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [worldViewId, name, parentRegionId],
  );
  const regionId = result.rows[0].id as number;

  // Create region_import_state with optional enrichment
  await pool.query(
    `INSERT INTO region_import_state (region_id, import_run_id, match_status, source_url, source_external_id)
     VALUES ($1, $2, 'no_candidates', $3, $4)`,
    [regionId, importRunId, sourceUrl ?? null, sourceExternalId ?? null],
  );

  res.json({ created: true, regionId });
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/types/index.ts backend/src/controllers/admin/wvImportFinalizeController.ts
git commit -m "feat: extend addChildRegion to accept sourceUrl and sourceExternalId"
```

---

### Task 2: Extend `renameRegion` Backend to Accept Enrichment Fields

**Files:**
- Modify: `backend/src/types/index.ts:531-534` (Zod schema)
- Modify: `backend/src/controllers/admin/wvImportRenameController.ts:16-40` (controller)

- [ ] **Step 1: Update Zod schema**

In `backend/src/types/index.ts`, update `wvImportRenameRegionSchema`:

```typescript
export const wvImportRenameRegionSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(500),
  sourceUrl: z.string().url().max(2000).optional(),
  sourceExternalId: z.string().max(100).optional(),
});
```

- [ ] **Step 2: Update controller to persist enrichment on rename**

In `backend/src/controllers/admin/wvImportRenameController.ts`, update `renameRegion`:

```typescript
export async function renameRegion(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const worldViewId = Number(req.params.worldViewId);
  const { regionId, name, sourceUrl, sourceExternalId } = req.body as {
    regionId: number;
    name: string;
    sourceUrl?: string;
    sourceExternalId?: string;
  };

  // Verify region belongs to this world view
  const check = await pool.query(
    'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (check.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  const oldName = check.rows[0].name as string;
  await pool.query(
    'UPDATE regions SET name = $1 WHERE id = $2',
    [name.trim(), regionId],
  );

  // Update enrichment in region_import_state if provided
  if (sourceUrl !== undefined || sourceExternalId !== undefined) {
    const setClauses: string[] = [];
    const values: (string | number)[] = [];
    let paramIdx = 1;

    if (sourceUrl !== undefined) {
      setClauses.push(`source_url = $${paramIdx++}`);
      values.push(sourceUrl);
    }
    if (sourceExternalId !== undefined) {
      setClauses.push(`source_external_id = $${paramIdx++}`);
      values.push(sourceExternalId);
    }
    values.push(regionId);

    await pool.query(
      `UPDATE region_import_state SET ${setClauses.join(', ')} WHERE region_id = $${paramIdx}`,
      values,
    );
  }

  res.json({ renamed: true, regionId, oldName, newName: name.trim() });
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/types/index.ts backend/src/controllers/admin/wvImportRenameController.ts
git commit -m "feat: extend renameRegion to accept sourceUrl and sourceExternalId"
```

---

### Task 3: Rewrite `aiSuggestChildren` Backend Controller

This is the core change — rewrite the controller in `wvImportAIController.ts` to do audit + enrichment + verification.

**Files:**
- Modify: `backend/src/controllers/admin/wvImportAIController.ts:245-442` (rewrite `aiSuggestChildren`)

- [ ] **Step 1: Replace the `aiSuggestChildren` function**

Replace the entire `aiSuggestChildren` function (lines 245-442) in `backend/src/controllers/admin/wvImportAIController.ts` with:

```typescript
/**
 * AI review children: audit + enrich + verify.
 *
 * Phase 1 — AI audit: compare existing children against Wikivoyage wikitext,
 *           suggest add/remove/rename actions.
 * Phase 2 — AI enrichment: for add/rename targets, extract Wikivoyage page
 *           titles and Wikidata QIDs from the wikitext.
 * Phase 3 — Programmatic verification: batch-query Wikivoyage API to confirm
 *           pages exist and QIDs match.
 *
 * POST /api/admin/wv-import/matches/:worldViewId/ai-suggest-children
 */
export async function aiSuggestChildren(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/ai-review-children — regionId=${regionId}`);

  try {
    // ── 1. Fetch region metadata ────────────────────────────────────────────
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

    // ── 2. Fetch existing children with their metadata ──────────────────────
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

    // ── 3. Fetch Wikivoyage "Regions" section wikitext ──────────────────────
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

    // ── 4. AI Call 1 — Audit ────────────────────────────────────────────────
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
      // If parsing fails, return the raw text as analysis
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

    // If no add/rename actions, skip enrichment phase
    const enrichableActions = actions.filter(a => a.type === 'add' || a.type === 'rename');

    if (enrichableActions.length === 0) {
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

    // ── 5. AI Call 2 — Enrichment ───────────────────────────────────────────
    const enrichTargets = enrichableActions.map(a =>
      a.type === 'rename' ? (a.newName ?? a.name) : a.name
    );

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

    // ── 6. Programmatic verification via Wikivoyage API ─────────────────────
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

    // ── 7. Merge enrichment + verification into actions ─────────────────────
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
```

- [ ] **Step 2: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Manual test — verify API call works**

Start backend (`npm run dev:backend`), then:
```bash
curl -X POST http://localhost:3001/api/admin/wv-import/matches/2/ai-suggest-children \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"regionId": <a-region-with-source-url>}'
```

Expected: Response with `actions` array (each having `type`, `name`, `reason`, `sourceUrl`, `sourceExternalId`, `verified`), `analysis` string, `stats` object.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportAIController.ts
git commit -m "feat: rewrite aiSuggestChildren as full audit + enrichment + verification"
```

---

### Task 4: Update Frontend API Types and Function

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts:283-297` (type + function)

- [ ] **Step 1: Update the `AISuggestChildrenResult` interface and keep the function**

In `frontend/src/api/adminWorldViewImport.ts`, replace the current type and function:

```typescript
// =============================================================================
// AI Review Children
// =============================================================================

export interface ReviewChildAction {
  type: 'add' | 'remove' | 'rename';
  name: string;
  newName?: string;
  reason: string;
  sourceUrl?: string | null;
  sourceExternalId?: string | null;
  verified: boolean;
}

export interface AISuggestChildrenResult {
  actions: ReviewChildAction[];
  analysis: string;
  stats: { inputTokens: number; outputTokens: number; cost: number } | null;
}

export async function aiSuggestChildren(
  worldViewId: number,
  regionId: number,
): Promise<AISuggestChildrenResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-suggest-children`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: Errors in files that reference `result.suggestions` (this is expected — we'll fix in next tasks)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/adminWorldViewImport.ts
git commit -m "feat: update AISuggestChildrenResult type to support add/remove/rename actions"
```

---

### Task 5: Update `SuggestChildrenState` and Dialog Hook

**Files:**
- Modify: `frontend/src/components/admin/useImportTreeDialogs.ts:60-65,233-258`

- [ ] **Step 1: Update `SuggestChildrenState` type**

In `useImportTreeDialogs.ts`, update the `SuggestChildrenState` interface:

```typescript
export interface SuggestChildrenState {
  regionId: number;
  regionName: string;
  result: AISuggestChildrenResult;
  selected: Set<string>;  // key = `${type}:${name}` to avoid collisions
}
```

- [ ] **Step 2: Update `handleAISuggestChildren` to use new selection keys**

Update the handler — default: add and rename pre-selected, remove not pre-selected:

```typescript
const handleAISuggestChildren = useCallback(async (regionId: number) => {
  const regionName = tree ? findNameById(tree, regionId) || 'Region' : 'Region';
  setAISuggestingRegionId(regionId);
  try {
    const result = await apiAISuggestChildren(worldViewId, regionId);
    // Pre-select add and rename, NOT remove (destructive)
    const selected = new Set(
      result.actions
        .filter(a => a.type !== 'remove')
        .map(a => `${a.type}:${a.name}`),
    );
    setSuggestChildrenResult({ regionId, regionName, result, selected });
  } catch (err) {
    console.error('AI review children failed:', err);
    setUndoSnackbar({
      open: true,
      message: `Review children failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      worldViewId,
    });
  } finally {
    setAISuggestingRegionId(null);
  }
}, [tree, worldViewId, setUndoSnackbar]);
```

- [ ] **Step 3: Update the import** — the `AISuggestChildrenResult` import already comes from `adminWorldViewImport`, no change needed since the type name is unchanged.

- [ ] **Step 4: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: Errors only in `ImportTreeDialogs.tsx` and `WorldViewImportTree.tsx` (the dialog and onSubmit — fixed in next tasks)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/useImportTreeDialogs.ts
git commit -m "feat: update SuggestChildrenState for add/remove/rename action keys"
```

---

### Task 6: Rewrite `AISuggestChildrenDialog` Component

**Files:**
- Modify: `frontend/src/components/admin/ImportTreeDialogs.tsx:514-574`

- [ ] **Step 1: Rewrite the dialog with grouped action sections**

Replace the `AISuggestChildrenDialog` function in `ImportTreeDialogs.tsx`:

```typescript
/** Dialog showing AI-reviewed children actions grouped by type */
export function AISuggestChildrenDialog({ state, onClose, onToggle, onSubmit, isPending }: {
  state: SuggestChildrenState | null;
  onClose: () => void;
  onToggle: (key: string) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  if (!state) return null;

  const addActions = state.result.actions.filter(a => a.type === 'add');
  const removeActions = state.result.actions.filter(a => a.type === 'remove');
  const renameActions = state.result.actions.filter(a => a.type === 'rename');

  const renderEnrichment = (action: ReviewChildAction) => {
    if (action.type === 'remove') return null;
    if (!action.verified) {
      return action.sourceUrl === null && action.sourceExternalId === null ? null : (
        <Typography variant="caption" color="warning.main">
          enrichment not verified
        </Typography>
      );
    }
    return (
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {action.sourceUrl && (
          <Typography variant="caption" color="text.secondary">
            <LinkIcon sx={{ fontSize: 12, mr: 0.25, verticalAlign: 'middle' }} />
            <MuiLink href={action.sourceUrl} target="_blank" rel="noopener" sx={{ fontSize: 'inherit' }}>
              {decodeURIComponent(action.sourceUrl.split('/wiki/')[1] ?? '')}
            </MuiLink>
          </Typography>
        )}
        {action.sourceExternalId && (
          <Typography variant="caption" color="text.secondary">
            <MuiLink
              href={`https://www.wikidata.org/wiki/${action.sourceExternalId}`}
              target="_blank"
              rel="noopener"
              sx={{ fontSize: 'inherit' }}
            >
              {action.sourceExternalId}
            </MuiLink>
          </Typography>
        )}
      </Box>
    );
  };

  const renderSection = (
    title: string,
    actions: ReviewChildAction[],
    color: string,
  ) => {
    if (actions.length === 0) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" color={color} sx={{ mb: 0.5 }}>
          {title} ({actions.length})
        </Typography>
        {actions.map((a) => {
          const key = `${a.type}:${a.name}`;
          return (
            <Box key={key} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.5 }}>
              <Checkbox
                size="small"
                checked={state.selected.has(key)}
                onChange={() => onToggle(key)}
                sx={{ p: 0.25, mt: 0.25 }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2">
                  {a.type === 'rename' ? (
                    <>{a.name} <ArrowForwardIcon sx={{ fontSize: 14, verticalAlign: 'middle', mx: 0.5 }} /> {a.newName}</>
                  ) : (
                    a.name
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">{a.reason}</Typography>
                {renderEnrichment(a)}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Review Children for &quot;{state.regionName}&quot;</DialogTitle>
      <DialogContent>
        {state.result.analysis && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {state.result.analysis}
          </Typography>
        )}
        {state.result.actions.length === 0 && (
          <Typography variant="body2">All children look correct — no changes suggested.</Typography>
        )}
        {renderSection('Add', addActions, 'success.main')}
        {renderSection('Remove', removeActions, 'error.main')}
        {renderSection('Rename', renameActions, 'warning.main')}
        {state.result.stats && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            {(state.result.stats.inputTokens + state.result.stats.outputTokens).toLocaleString()} tokens
            {' \u00b7 '}${state.result.stats.cost.toFixed(4)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!state.selected.size || isPending}
          onClick={onSubmit}
        >
          Apply {state.selected.size} Selected
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add missing imports at the top of the file**

Add to the imports in `ImportTreeDialogs.tsx`:

```typescript
import LinkIcon from '@mui/icons-material/Link';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Link as MuiLink } from '@mui/material';
import type { ReviewChildAction } from '../../api/adminWorldViewImport';
```

Check which of `Link`, `Box`, `Typography`, `Checkbox`, `Button`, `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` are already imported and only add the missing ones.

- [ ] **Step 3: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: Only `WorldViewImportTree.tsx` errors remain (onSubmit logic — fixed in next task)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/ImportTreeDialogs.tsx
git commit -m "feat: rewrite AISuggestChildrenDialog with grouped add/remove/rename sections"
```

---

### Task 7: Update `WorldViewImportTree.tsx` onSubmit Logic

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx:631-652`

- [ ] **Step 1: Update the onSubmit handler and onToggle for the dialog**

Replace the `<AISuggestChildrenDialog>` usage (around lines 631-652):

```typescript
<AISuggestChildrenDialog
  state={dialogs.suggestChildrenResult}
  onClose={() => dialogs.setSuggestChildrenResult(null)}
  onToggle={(key) => {
    dialogs.setSuggestChildrenResult(prev => {
      if (!prev) return prev;
      const next = new Set(prev.selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, selected: next };
    });
  }}
  onSubmit={async () => {
    if (!dialogs.suggestChildrenResult) return;
    const { regionId, result, selected } = dialogs.suggestChildrenResult;

    for (const key of selected) {
      const [type, ...nameParts] = key.split(':');
      const name = nameParts.join(':'); // rejoin in case name contains ':'
      const action = result.actions.find(
        a => a.type === type && a.name === name,
      );
      if (!action) continue;

      if (action.type === 'add') {
        addChildMutation.mutate({
          parentRegionId: regionId,
          name: action.name,
          sourceUrl: action.sourceUrl ?? undefined,
          sourceExternalId: action.sourceExternalId ?? undefined,
        });
      } else if (action.type === 'remove') {
        const childId = tree ? findChildIdByName(tree, regionId, action.name) : undefined;
        if (childId) {
          removeRegionMutation.mutate({ regionId: childId, reparentChildren: true });
        }
      } else if (action.type === 'rename') {
        const childId = tree ? findChildIdByName(tree, regionId, action.name) : undefined;
        if (childId) {
          renameMutation.mutate({
            regionId: childId,
            name: action.newName ?? action.name,
            sourceUrl: action.sourceUrl ?? undefined,
            sourceExternalId: action.sourceExternalId ?? undefined,
          });
        }
      }
    }

    dialogs.setSuggestChildrenResult(null);
  }}
  isPending={addChildMutation.isPending}
/>
```

Note: This uses the existing `removeRegionMutation` and `renameMutation` from `useTreeMutations`. We need to look up child IDs from the tree by name + parentId since the AI actions reference children by name, not by ID.

- [ ] **Step 2: Extract a helper to find child ID by name**

`MatchTreeNode` has no `parentId` field, so find the parent first, then search its `children`. Add this helper near the top of the file (or reuse in the component scope):

```typescript
/** Find a child region's ID by name under a specific parent */
function findChildIdByName(tree: MatchTreeNode[], parentId: number, childName: string): number | undefined {
  for (const node of tree) {
    if (node.id === parentId) {
      return node.children.find(c => c.name === childName)?.id;
    }
    const found = findChildIdByName(node.children, parentId, childName);
    if (found) return found;
  }
  return undefined;
}
```

Then use it in the onSubmit for both remove and rename cases:

```typescript
} else if (action.type === 'remove') {
  const childId = tree ? findChildIdByName(tree, regionId, action.name) : undefined;
  if (childId) {
    removeRegionMutation.mutate({ regionId: childId, reparentChildren: true });
  }
} else if (action.type === 'rename') {
  const childId = tree ? findChildIdByName(tree, regionId, action.name) : undefined;
  if (childId) {
    renameMutation.mutate({
      regionId: childId,
      name: action.newName ?? action.name,
      sourceUrl: action.sourceUrl ?? undefined,
      sourceExternalId: action.sourceExternalId ?? undefined,
    });
  }
}
```

- [ ] **Step 4: Update `addChildMutation` type in `useTreeMutations.ts` to accept enrichment**

In `frontend/src/components/admin/useTreeMutations.ts`, update the `addChildMutation`:

```typescript
const addChildMutation = useMutation({
  mutationFn: ({ parentRegionId, name, sourceUrl, sourceExternalId }: {
    parentRegionId: number;
    name: string;
    sourceUrl?: string;
    sourceExternalId?: string;
  }) =>
    addChildRegion(worldViewId, parentRegionId, name, sourceUrl, sourceExternalId),
  onSuccess: () => invalidateTree(),
});
```

- [ ] **Step 5: Update `renameMutation` type in `useTreeMutations.ts` to accept enrichment**

Find the existing `renameMutation` in `useTreeMutations.ts` and extend its mutationFn parameters:

```typescript
const renameMutation = useMutation({
  mutationFn: ({ regionId, name, sourceUrl, sourceExternalId }: {
    regionId: number;
    name: string;
    sourceUrl?: string;
    sourceExternalId?: string;
  }) =>
    renameRegion(worldViewId, regionId, name, sourceUrl, sourceExternalId),
  // ... keep existing onMutate/onSettled
});
```

- [ ] **Step 6: Update frontend API functions to accept enrichment parameters**

In `frontend/src/api/adminWvImportTreeOps.ts`, update `addChildRegion`:

```typescript
export async function addChildRegion(
  worldViewId: number,
  parentRegionId: number,
  name: string,
  sourceUrl?: string,
  sourceExternalId?: string,
): Promise<{ created: boolean; regionId: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/add-child-region`, {
    method: 'POST',
    body: JSON.stringify({ parentRegionId, name, sourceUrl, sourceExternalId }),
  });
}
```

And update `renameRegion`:

```typescript
export async function renameRegion(
  worldViewId: number,
  regionId: number,
  name: string,
  sourceUrl?: string,
  sourceExternalId?: string,
): Promise<{ renamed: boolean; regionId: number; oldName: string; newName: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/rename-region`, {
    method: 'POST',
    body: JSON.stringify({ regionId, name, sourceUrl, sourceExternalId }),
  });
}
```

- [ ] **Step 7: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/admin/WorldViewImportTree.tsx \
       frontend/src/components/admin/useTreeMutations.ts \
       frontend/src/api/adminWvImportTreeOps.ts
git commit -m "feat: wire up add/remove/rename apply logic for AI review children"
```

---

### Task 8: Update Button Label and Tooltip

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeActions.tsx:776-793`

- [ ] **Step 1: Update tooltip text**

In `TreeNodeActions.tsx`, change the tooltip and comment:

```typescript
{/* AI review children (Wikivoyage + AI) */}
{node.sourceUrl && onAISuggestChildren && (
  <Tooltip title="AI review children">
    <span>
      <IconButton
        size="small"
        onClick={() => onAISuggestChildren(node.id)}
        disabled={isMutating || aiSuggestingRegionId != null}
        sx={{ p: 0.25 }}
      >
        {aiSuggestingRegionId === node.id
          ? <CircularProgress size={14} />
          : <SuggestChildrenIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
        }
      </IconButton>
    </span>
  </Tooltip>
)}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/TreeNodeActions.tsx
git commit -m "feat: rename AI suggest children button to AI review children"
```

---

### Task 9: Update AI Model Settings for `review_children`

**Files:**
- Modify: `backend/src/services/ai/aiSettingsService.ts` (if feature name mapping exists)

- [ ] **Step 1: Check if `suggest_children` is referenced in AI settings**

Search for `suggest_children` in the backend. If `getModelForFeature` has a mapping or default, add `review_children` as the new key. If `suggest_children` was the only reference, replace it.

The `getModelForFeature` function may fall back to a default model — in that case, `review_children` will work automatically. Verify and update if needed.

- [ ] **Step 2: Run full pre-commit checks**

```bash
cd /home/nikolay/projects/track-your-regions
npm run check
npm run knip
TEST_REPORT_LOCAL=1 npm test
```

Fix any lint, type, or unused-export issues.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: update AI feature key from suggest_children to review_children"
```

---

### Task 10: Update Documentation

**Files:**
- Modify: `docs/tech/planning/2026-03-30-ai-review-children.md` (trim completed sections)

- [ ] **Step 1: Trim the planning doc**

Remove fully implemented sections from the planning doc. Keep only any future ideas/improvements that weren't implemented (e.g., out-of-scope items that might be revisited).

- [ ] **Step 2: Commit**

```bash
git add docs/tech/planning/2026-03-30-ai-review-children.md
git commit -m "docs: trim AI review children plan to remaining ideas only"
```
