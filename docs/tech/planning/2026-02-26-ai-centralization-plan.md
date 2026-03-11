# AI Centralization & Extraction Rework — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a centralized AI settings & usage page to the admin panel, then rework Wikivoyage extraction to use AI for ambiguous pages.

**Architecture:** Two new DB tables (`ai_settings`, `ai_usage_log`), two new backend services, one new admin panel section, and modifications to existing AI callers to use centralized model selection + usage logging.

**Tech Stack:** PostgreSQL, Express, React/MUI, TanStack Query, OpenAI API (gpt-4.1-mini)

---

## Part 1: Centralized AI Settings & Usage

### Task 1: Database Schema

**Files:**
- Modify: `db/init/01-schema.sql` (append at end, before any closing comments)

**Step 1: Add ai_settings and ai_usage_log tables to schema**

Append to `db/init/01-schema.sql`:

```sql
-- =============================================================================
-- AI Settings & Usage Tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ai_settings IS 'Key-value store for AI model selections per feature';

-- Seed defaults
INSERT INTO ai_settings (key, value) VALUES
    ('model.matching', 'gpt-4.1-mini'),
    ('model.hierarchy_review', 'gpt-4.1'),
    ('model.extraction', 'gpt-4.1-mini'),
    ('model.subdivision_assist', 'gpt-4.1-mini')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_usage_log (
    id SERIAL PRIMARY KEY,
    feature TEXT NOT NULL,
    model TEXT NOT NULL,
    description TEXT,
    api_calls INTEGER NOT NULL DEFAULT 1,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost NUMERIC(10,6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_feature ON ai_usage_log(feature);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created ON ai_usage_log(created_at DESC);

COMMENT ON TABLE ai_usage_log IS 'Per-session AI usage log with token counts and costs';
```

**Step 2: Apply schema to running DB**

Run the same SQL directly against the running database:
```bash
docker exec tyr-ng-db psql -U postgres -d track_regions -c "<the SQL above>"
```

**Step 3: Commit**

```
feat: add ai_settings and ai_usage_log tables
```

---

### Task 2: AI Settings Service (Backend)

**Files:**
- Create: `backend/src/services/ai/aiSettingsService.ts`

**Step 1: Implement the service**

```typescript
/**
 * AI Settings Service
 *
 * Reads/writes AI model selections from the ai_settings table.
 * In-memory cache with 60s TTL to avoid DB round-trips on every AI call.
 */

import { pool } from '../../db/index.js';

const CACHE_TTL_MS = 60_000;
let cache: Map<string, string> | null = null;
let cacheTime = 0;

async function loadCache(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;

  const result = await pool.query('SELECT key, value FROM ai_settings');
  cache = new Map(result.rows.map(r => [r.key as string, r.value as string]));
  cacheTime = now;
  return cache;
}

function invalidateCache(): void {
  cache = null;
}

/** Get the model ID configured for a feature. Falls back to gpt-4.1-mini. */
export async function getModelForFeature(feature: string): Promise<string> {
  const settings = await loadCache();
  return settings.get(`model.${feature}`) ?? 'gpt-4.1-mini';
}

/** Get all AI settings (for admin page). */
export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await loadCache();
  return Object.fromEntries(settings);
}

/** Update a single AI setting. */
export async function updateSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO ai_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value],
  );
  invalidateCache();
}
```

**Step 2: Commit**

```
feat: add AI settings service with cached DB reads
```

---

### Task 3: AI Usage Logger (Backend)

**Files:**
- Create: `backend/src/services/ai/aiUsageLogger.ts`

**Step 1: Implement the logger**

```typescript
/**
 * AI Usage Logger
 *
 * Logs per-session AI usage to the ai_usage_log table.
 * Provides summary queries for the admin dashboard.
 */

import { pool } from '../../db/index.js';

export interface UsageLogEntry {
  id: number;
  feature: string;
  model: string;
  description: string | null;
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  createdAt: string;
  durationMs: number | null;
}

export interface UsageSummary {
  today: number;
  thisMonth: number;
  allTime: number;
  recentSessions: UsageLogEntry[];
}

/** Log a completed AI session. Returns the log entry ID. */
export async function logAIUsage(entry: {
  feature: string;
  model: string;
  description?: string;
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  durationMs?: number;
}): Promise<number> {
  const result = await pool.query(
    `INSERT INTO ai_usage_log (feature, model, description, api_calls, prompt_tokens, completion_tokens, total_cost, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [entry.feature, entry.model, entry.description ?? null, entry.apiCalls,
     entry.promptTokens, entry.completionTokens, entry.totalCost, entry.durationMs ?? null],
  );
  return result.rows[0].id as number;
}

/** Get usage summary for the admin dashboard. */
export async function getUsageSummary(): Promise<UsageSummary> {
  const [totals, recent] = await Promise.all([
    pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE THEN total_cost END), 0)::float AS today,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', CURRENT_DATE) THEN total_cost END), 0)::float AS this_month,
        COALESCE(SUM(total_cost), 0)::float AS all_time
      FROM ai_usage_log
    `),
    pool.query(`
      SELECT id, feature, model, description, api_calls, prompt_tokens, completion_tokens,
             total_cost::float, created_at, duration_ms
      FROM ai_usage_log
      ORDER BY created_at DESC
      LIMIT 50
    `),
  ]);

  return {
    today: totals.rows[0].today as number,
    thisMonth: totals.rows[0].this_month as number,
    allTime: totals.rows[0].all_time as number,
    recentSessions: recent.rows.map(mapRow),
  };
}

/** Get paginated usage log. */
export async function getUsageLog(limit: number, offset: number): Promise<UsageLogEntry[]> {
  const result = await pool.query(
    `SELECT id, feature, model, description, api_calls, prompt_tokens, completion_tokens,
            total_cost::float, created_at, duration_ms
     FROM ai_usage_log
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): UsageLogEntry {
  return {
    id: r.id as number,
    feature: r.feature as string,
    model: r.model as string,
    description: r.description as string | null,
    apiCalls: r.api_calls as number,
    promptTokens: r.prompt_tokens as number,
    completionTokens: r.completion_tokens as number,
    totalCost: r.total_cost as number,
    createdAt: (r.created_at as Date).toISOString(),
    durationMs: r.duration_ms as number | null,
  };
}
```

**Step 2: Commit**

```
feat: add AI usage logger with summary queries
```

---

### Task 4: Admin API Endpoints

**Files:**
- Modify: `backend/src/routes/adminRoutes.ts`
- Modify: `backend/src/controllers/admin/worldViewImportController.ts` (or create a new `aiController.ts`)

Better to create a new controller to keep concerns separate.

**Step 1: Create AI admin controller**

Create `backend/src/controllers/admin/aiController.ts`:

```typescript
/**
 * AI Admin Controller
 *
 * Endpoints for AI settings and usage dashboard.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { getAllSettings, updateSetting } from '../../services/ai/aiSettingsService.js';
import { getUsageSummary } from '../../services/ai/aiUsageLogger.js';
import { getAllPricing } from '../../services/ai/pricingService.js';

export async function getAISettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const settings = await getAllSettings();
  // Also return available models from pricing CSV
  const models = getAllPricing().map(p => ({ id: p.model, inputPer1M: p.inputPer1M, outputPer1M: p.outputPer1M }));
  res.json({ settings, models });
}

export async function updateAISetting(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { key } = req.params;
  const { value } = req.body;
  await updateSetting(key, value);
  res.json({ ok: true });
}

export async function getAIUsage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const summary = await getUsageSummary();
  res.json(summary);
}
```

**Step 2: Add routes to adminRoutes.ts**

Add imports and routes after existing admin route sections:

```typescript
import { getAISettings, updateAISetting, getAIUsage } from '../controllers/admin/aiController.js';

// AI Settings & Usage
router.get('/ai/settings', getAISettings);
router.put('/ai/settings/:key', validate(z.object({ key: z.string() }), 'params'), validate(z.object({ value: z.string() })), updateAISetting);
router.get('/ai/usage', getAIUsage);
```

**Step 3: Commit**

```
feat: add admin API endpoints for AI settings and usage
```

---

### Task 5: Frontend API Layer

**Files:**
- Create: `frontend/src/api/adminAI.ts`

**Step 1: Implement API functions**

```typescript
import { authFetchJson } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || '';

export interface AIModelOption {
  id: string;
  inputPer1M: number;
  outputPer1M: number;
}

export interface AISettingsResponse {
  settings: Record<string, string>;
  models: AIModelOption[];
}

export interface UsageLogEntry {
  id: number;
  feature: string;
  model: string;
  description: string | null;
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  createdAt: string;
  durationMs: number | null;
}

export interface UsageSummaryResponse {
  today: number;
  thisMonth: number;
  allTime: number;
  recentSessions: UsageLogEntry[];
}

export async function getAISettings(): Promise<AISettingsResponse> {
  return authFetchJson(`${API_URL}/api/admin/ai/settings`);
}

export async function updateAISetting(key: string, value: string): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/ai/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function getAIUsage(): Promise<UsageSummaryResponse> {
  return authFetchJson(`${API_URL}/api/admin/ai/usage`);
}
```

**Step 2: Commit**

```
feat: add frontend API layer for AI settings and usage
```

---

### Task 6: Admin AI Settings Panel (Frontend)

**Files:**
- Create: `frontend/src/components/admin/AISettingsPanel.tsx`
- Modify: `frontend/src/components/admin/AdminDashboard.tsx`

**Step 1: Create AISettingsPanel component**

Build a panel with two cards:

Card 1 — **Model Configuration**: One row per feature (`matching`, `hierarchy_review`, `extraction`, `subdivision_assist`), each with a `<Select>` dropdown populated from the `models` list returned by the settings endpoint. On change, call `updateAISetting()` and show a success snackbar.

Card 2 — **Usage Dashboard**: Top row with three stat chips (Today / This Month / All Time costs). Below, a `<Table>` of recent sessions with columns: Date, Feature, Model, API Calls, Tokens (prompt + completion), Cost, Duration, Description.

Use `useQuery` for fetching settings and usage. Use `useMutation` for saving model changes with `invalidateQueries` on success.

Feature labels for display:
- `model.matching` → "AI Matching"
- `model.hierarchy_review` → "Hierarchy Review"
- `model.extraction` → "Extraction (Wikivoyage)"
- `model.subdivision_assist` → "Subdivision Assist"

**Step 2: Register in AdminDashboard.tsx**

In `AdminDashboard.tsx`:
1. Add to imports: `import { AISettingsPanel } from './AISettingsPanel';`
2. Add `SmartToy as AIIcon` to MUI icon imports
3. Add to `AdminSection` type: `'ai'`
4. Add to `menuItems` array (between curators and wvImport): `{ id: 'ai', label: 'AI Settings', icon: <AIIcon /> }`
5. Add to `renderContent` switch: `case 'ai': return <AISettingsPanel />;`

**Step 3: Commit**

```
feat: add AI Settings panel to admin dashboard
```

---

### Task 7: Integrate Usage Logging into AI Matcher

**Files:**
- Modify: `backend/src/services/worldViewImport/aiMatcher.ts`

**Step 1: Replace hardcoded MODEL with settings service**

Replace line 77 `const MODEL = 'gpt-4.1-mini';` — instead, at the start of `runAIMatching()` and `aiMatchSingleRegion()`, call:
```typescript
import { getModelForFeature } from '../ai/aiSettingsService.js';
const model = await getModelForFeature('matching');
```

Pass `model` to `processAIBatch()` and use it in the OpenAI call instead of `MODEL`.

**Step 2: Add usage logging after batch completion**

At the end of `runAIMatching()` (where `progress.status = 'complete'`), add:
```typescript
import { logAIUsage } from '../ai/aiUsageLogger.js';

await logAIUsage({
  feature: 'matching',
  model,
  description: `Batch match for WV ${worldViewId}: ${progress.processedLeaves} regions, ${progress.improved} improved`,
  apiCalls: Math.ceil(progress.processedLeaves / BATCH_SIZE),
  promptTokens: progress.totalPromptTokens,  // new accumulator
  completionTokens: progress.totalCompletionTokens,  // new accumulator
  totalCost: progress.totalCost,
  durationMs: Date.now() - startTime,
});
```

Add `totalPromptTokens` and `totalCompletionTokens` to `AIMatchProgress` and accumulate them alongside `totalCost` in `processAIBatch`.

**Step 3: Add usage logging to single-region matching**

In `aiMatchSingleRegion()`, after the AI call returns, log:
```typescript
await logAIUsage({
  feature: 'matching',
  model,
  description: `Single match: region ${regionId}`,
  apiCalls: 1,
  promptTokens: ...,
  completionTokens: ...,
  totalCost: cost.totalCost,
  durationMs: Date.now() - startTime,
});
```

**Step 4: Commit**

```
feat: integrate centralized model selection and usage logging into AI matcher
```

---

### Task 8: Integrate Usage Logging into Other AI Callers

**Files:**
- Modify: `backend/src/services/ai/openaiService.ts` (hierarchy review, subdivision assist)

**Step 1: Add model selection from settings**

In functions that call OpenAI (e.g., `suggestGroupForRegion`, `suggestGroupsForMultipleRegions`), replace the hardcoded model with `getModelForFeature('subdivision_assist')`.

For hierarchy review calls (find where `openaiService` is called for hierarchy review in the import controller), use `getModelForFeature('hierarchy_review')`.

**Step 2: Add usage logging**

After each OpenAI call that returns `TokenUsage`, log it:
```typescript
await logAIUsage({
  feature: 'subdivision_assist',  // or 'hierarchy_review'
  model: usage.model,
  description: `...`,
  apiCalls: 1,
  promptTokens: usage.promptTokens,
  completionTokens: usage.completionTokens,
  totalCost: usage.cost.totalCost,
});
```

**Step 3: Commit**

```
feat: integrate usage logging into subdivision assist and hierarchy review
```

---

### Task 9: Verification

**Step 1: Run checks**

```bash
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

**Step 2: Manual test**

1. Open admin panel → AI Settings
2. Verify model dropdowns show available models with current selections
3. Change a model → verify snackbar + persisted on reload
4. Run an AI match on a region → verify usage appears in the dashboard
5. Check Today/Month/All Time totals update

**Step 3: Commit any fixes**

---

## Part 2: AI-Assisted Wikivoyage Extraction

### Task 10: AI Extraction Service

**Files:**
- Create: `backend/src/services/wikivoyageExtract/aiRegionParser.ts`

**Step 1: Implement AI-based region extraction**

```typescript
/**
 * AI-based region extraction from Wikivoyage wikitext.
 *
 * Replaces heuristic multi-link classification and plain-text parsing.
 * Only called for pages where parseRegionlist() encounters ambiguity.
 */

import OpenAI from 'openai';
import type { RegionEntry } from './types.js';
import { getModelForFeature } from '../ai/aiSettingsService.js';
import { calculateCost } from '../ai/pricingService.js';

export interface AIExtractionAccumulator {
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}

const SYSTEM_PROMPT = `You extract subregions from Wikivoyage "Regions" section wikitext.

For each subregion, return a JSON array of objects with:
- "name": the region name as it should appear in a hierarchy
- "wikiLink": the exact Wikivoyage page title if linked with [[...]], or null if plain text
- "children": array of child wikiLink strings if this is a grouping node (e.g. "Northern Germany" groups several linked states), or empty array

Rules:
- For [[Link|Display text]], use "Link" as wikiLink
- For "[[France]] and [[Monaco]]", create a grouping node named "France and Monaco" with children ["France", "Monaco"]
- For "[[Russia]]'s [[North Caucasus]]", the target is "North Caucasus" (possessive pattern)
- For "[[Falster]] ([[Gedser]], ...)", the target is "Falster" (parenthetical pattern)
- For plain text names like "Northern Germany" with linked items in regionNitems, create a grouping node
- Ignore cross-references ("described separately/elsewhere")
- Only extract from the Regions/Countries/States section, not other content

Return ONLY a JSON array, no markdown fencing.`;

export async function extractRegionsWithAI(
  wikitext: string,
  openai: OpenAI,
  accumulator: AIExtractionAccumulator,
): Promise<RegionEntry[]> {
  const model = await getModelForFeature('extraction');

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: wikitext },
    ],
  });

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const cost = calculateCost(promptTokens, completionTokens, model, false);

  accumulator.apiCalls++;
  accumulator.promptTokens += promptTokens;
  accumulator.completionTokens += completionTokens;
  accumulator.totalCost += cost.totalCost;

  const text = response.choices[0]?.message?.content?.trim() ?? '[]';
  // Strip markdown fences if present
  const jsonStr = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  try {
    const parsed = JSON.parse(jsonStr) as Array<{
      name: string;
      wikiLink: string | null;
      children: string[];
    }>;

    return parsed.map(r => ({
      name: r.wikiLink ?? r.name,
      items: r.children ?? [],
      hasLink: !!r.wikiLink,
    }));
  } catch (err) {
    console.warn('[AI Extract] Failed to parse AI response:', err instanceof Error ? err.message : err);
    return [];
  }
}
```

**Step 2: Commit**

```
feat: add AI-based region extraction service for Wikivoyage
```

---

### Task 11: Integrate AI Extraction into Tree Builder

**Files:**
- Modify: `backend/src/services/wikivoyageExtract/treeBuilder.ts`
- Modify: `backend/src/services/wikivoyageExtract/types.ts`

**Step 1: Add AI accumulator to ExtractionProgress**

In `types.ts`, add to `ExtractionProgress`:
```typescript
  aiApiCalls: number;
  aiPromptTokens: number;
  aiCompletionTokens: number;
  aiTotalCost: number;
```

Initialize all to 0 in `createInitialExtractionProgress()`.

**Step 2: Modify getPageData to detect ambiguity**

In `treeBuilder.ts`, after `parseRegionlist()` returns regions, check if any region has ambiguity (multi-link or plain text). Add a flag to `PageData`:

```typescript
// In PageData interface (types.ts):
needsAI?: boolean;
rawWikitext?: string;  // Regions section wikitext for AI fallback
```

In `getPageData()`, after parsing the Regionlist, check:
```typescript
const hasAmbiguity = regions.some(r => !r.hasLink || (r.items.length > 0 && !r.hasLink));
if (hasAmbiguity) {
  result.needsAI = true;
  result.rawWikitext = wikitext;
}
```

Also set `needsAI = true` for bullet-link-only pages (no Regionlist).

**Step 3: Use AI in buildTree when needed**

In `buildTree()`, after `getPageData()` returns, if `page.needsAI && openai`:
```typescript
if (page.needsAI && page.rawWikitext && openai) {
  const aiRegions = await extractRegionsWithAI(page.rawWikitext, openai, accumulator);
  if (aiRegions.length > 0) {
    page.regions = aiRegions;
  }
}
```

Pass the OpenAI client and accumulator through `buildTree()` parameters.

**Step 4: Log AI usage at end of extraction**

In `index.ts`, after the extraction phase completes, call `logAIUsage()` with the accumulator totals:
```typescript
if (progress.aiApiCalls > 0) {
  await logAIUsage({
    feature: 'extraction',
    model: await getModelForFeature('extraction'),
    description: `Wikivoyage extraction: ${progress.aiApiCalls} AI-parsed pages`,
    apiCalls: progress.aiApiCalls,
    promptTokens: progress.aiPromptTokens,
    completionTokens: progress.aiCompletionTokens,
    totalCost: progress.aiTotalCost,
    durationMs: ...,
  });
}
```

**Step 5: Commit**

```
feat: integrate AI extraction into Wikivoyage tree builder for ambiguous pages
```

---

### Task 12: Remove Dead Heuristic Code

**Files:**
- Modify: `backend/src/services/wikivoyageExtract/parser.ts`

**Step 1: Remove classifyMultiLink**

Remove the `classifyMultiLink()` function (lines 215-236) and its usage in `parseRegionlist()` (the `coreLinks.length > 1` branch, lines 309-321).

For the multi-link branch, simplify to: set `needsAI = true` on the page and let AI handle it. Or just keep the raw entries and let the treeBuilder decide.

Actually, since the AI handles these cases, the simplest approach is: when `coreLinks.length > 1` or `coreLinks.length === 0`, still emit a `RegionEntry` but mark `hasLink: false` so the treeBuilder knows to use AI. The detection logic in `getPageData` then triggers AI.

**Step 2: Update tests**

Update `parser.test.ts` to reflect that multi-link classification is no longer done by the parser. Tests for `classifyMultiLink` can be removed. Tests for `parseRegionlist` should verify that multi-link regions come through as `hasLink: false`.

**Step 3: Commit**

```
refactor: remove multi-link classification heuristics (replaced by AI extraction)
```

---

### Task 13: Final Verification

**Step 1: Run all checks**

```bash
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

**Step 2: Manual end-to-end test**

1. Start dev environment
2. Open Admin → AI Settings → verify model dropdowns
3. Run a Wikivoyage extraction → verify AI is used for ambiguous pages (check logs)
4. Check AI Settings → Usage table shows extraction session with token counts
5. Run AI matching → verify usage logged
6. Verify Today/Month/All Time totals

**Step 3: Update docs**

- Update `docs/tech/planning/2026-02-26-ai-centralization-design.md` — trim to unimplemented ideas only
- Update `docs/vision/vision.md` — add AI settings admin page to admin capabilities

**Step 4: Commit**

```
docs: update vision and planning docs for AI centralization
```
