# AI-Assisted Cluster-to-Region Matching

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "AI Suggest" button to the CV match Suggested Assignments section that uses OpenAI to match division clusters to child region names.

**Architecture:** When the user clicks "AI Suggest", the frontend sends the cluster data (division names per cluster) and child region names to a new backend endpoint. The backend calls OpenAI with a focused prompt asking it to match each cluster's divisions to the most likely region. The response auto-populates the region dropdowns. Uses the existing OpenAI infrastructure (client, pricing, cost logging).

**Tech Stack:** OpenAI API (gpt-4.1-mini), existing `aiMatcher.ts` patterns, React state updates.

---

## Data Available at Suggestion Time

At the "Suggested Assignments" stage, the frontend has:

```typescript
// Clusters — each has a list of GADM division names
cvMatchDialog.clusters: Array<{
  clusterId: number;
  color: string;
  pixelShare: number;
  divisions: Array<{ id: number; name: string; confidence: number }>;
  unsplittable: Array<{ id: number; name: string }>;
}>

// Child regions — the Wikivoyage region names we want to match TO
cvMatchDialog.childRegions: Array<{ id: number; name: string }>
```

Example for Eastern Cape:
- Cluster 0 (yellow, 38%): divisions = [Chris Hani, Joe Gqabi, ...]
- Cluster 1 (olive, 24%): divisions = [Amathole, Buffalo City, ...]
- ...
- Child regions: [Baviaans, Karoo Heartland, Settler Country, Sunshine Coast, Tsitsikamma, Wild Coast]

The AI's job: "Cluster 0 has Chris Hani and Joe Gqabi → that's probably Karoo Heartland."

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/routes/adminRoutes.ts` | Modify | Add POST route for AI cluster suggestion |
| `backend/src/controllers/admin/wvImportAIController.ts` | Modify | Add handler calling OpenAI |
| `frontend/src/api/adminWorldViewImport.ts` | Modify | Add `aiSuggestClusterRegions()` API function |
| `frontend/src/components/admin/WorldViewImportTree.tsx` | Modify | Add "AI Suggest" button + handle response |

---

### Task 1: Backend Endpoint

**Files:**
- Modify: `backend/src/controllers/admin/wvImportAIController.ts`
- Modify: `backend/src/routes/adminRoutes.ts`
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: Add the controller function**

In `wvImportAIController.ts`, add:

```typescript
export async function aiSuggestClusterRegions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { clusters, childRegions } = req.body;
  // clusters: Array<{ clusterId: number; color: string; pixelShare: number; divisionNames: string[] }>
  // childRegions: Array<{ id: number; name: string }>

  if (!isOpenAIAvailable()) {
    res.status(503).json({ error: 'OpenAI API not configured' });
    return;
  }

  const client = getClient();

  // Build prompt: list each cluster with its divisions, ask AI to match to regions
  const clusterDescriptions = clusters.map((c: { clusterId: number; color: string; pixelShare: number; divisionNames: string[] }) =>
    `Cluster ${c.clusterId} (${Math.round(c.pixelShare * 100)}% of map): ${c.divisionNames.join(', ')}`
  ).join('\n');

  const regionNames = childRegions.map((r: { name: string }) => r.name).join(', ');

  const systemPrompt = `You are an expert in world geography and administrative divisions.
You are given clusters of GADM administrative divisions detected on a Wikivoyage travel region map, and a list of Wikivoyage sub-region names.
Your job: match each cluster to the most likely Wikivoyage sub-region based on geographic knowledge.

Rules:
- Each cluster should map to exactly one region (or null if no match).
- Each region should be used at most once.
- Use your knowledge of where these divisions are located geographically.
- The division names are official GADM names. The region names are Wikivoyage travel region names (may be informal, e.g. "Wild Coast" for the Transkei area).
- Return JSON only, no explanation.`;

  const userPrompt = `Available Wikivoyage regions: ${regionNames}

Clusters of GADM divisions:
${clusterDescriptions}

Return a JSON array: [{ "clusterId": <number>, "regionName": <string|null> }]
Match each cluster to the best Wikivoyage region name, or null if no match.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.1,
      max_tokens: 1000,
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

    // Map region names back to IDs
    const regionMap = new Map(childRegions.map((r: { id: number; name: string }) => [r.name.toLowerCase(), r.id]));
    const result = matches.map(m => ({
      clusterId: m.clusterId,
      regionId: m.regionName ? (regionMap.get(m.regionName.toLowerCase()) ?? null) : null,
      regionName: m.regionName,
    }));

    // Log AI usage
    const usage = response.usage;
    if (usage) {
      const { calculateCost } = await import('../../services/pricingService.js');
      const cost = calculateCost('gpt-4.1-mini', usage.prompt_tokens, usage.completion_tokens);
      console.log(`  [AI Suggest Clusters] ${usage.prompt_tokens} in, ${usage.completion_tokens} out, cost=$${cost.toFixed(4)}`);
    }

    res.json({ matches: result });
  } catch (err) {
    console.error('[AI Suggest Clusters] Error:', err);
    res.status(500).json({ error: 'AI suggestion failed' });
  }
}
```

- [ ] **Step 2: Add Zod schema and route**

In `types/index.ts`, add:
```typescript
export const wvImportAISuggestClustersSchema = z.object({
  clusters: z.array(z.object({
    clusterId: z.number(),
    color: z.string(),
    pixelShare: z.number(),
    divisionNames: z.array(z.string()),
  })),
  childRegions: z.array(z.object({
    id: z.number(),
    name: z.string(),
  })),
});
```

In `adminRoutes.ts`, add route:
```typescript
router.post('/wv-import/matches/:worldViewId/ai-suggest-clusters',
  validate(worldViewIdParamSchema, 'params'),
  validate(wvImportAISuggestClustersSchema),
  aiSuggestClusterRegions
);
```

- [ ] **Step 3: Verify backend compiles**

Run: `npx tsc --noEmit --project backend/tsconfig.json`

- [ ] **Step 4: Commit**

```
feat: add AI cluster-to-region suggestion endpoint
```

---

### Task 2: Frontend API Function

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts`

- [ ] **Step 1: Add the API function**

```typescript
export async function aiSuggestClusterRegions(
  worldViewId: number,
  clusters: Array<{ clusterId: number; color: string; pixelShare: number; divisionNames: string[] }>,
  childRegions: Array<{ id: number; name: string }>,
): Promise<{ matches: Array<{ clusterId: number; regionId: number | null; regionName: string | null }> }> {
  return authFetchJson(`/api/admin/wv-import/matches/${worldViewId}/ai-suggest-clusters`, {
    method: 'POST',
    body: JSON.stringify({ clusters, childRegions }),
  });
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit --project frontend/tsconfig.json`

- [ ] **Step 3: Commit**

```
feat: add frontend API for AI cluster suggestion
```

---

### Task 3: "AI Suggest" Button in UI

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx`

- [ ] **Step 1: Add the button next to "View source page"**

Find the `<Box>` with "Suggested Assignments" header (around line 2575) and add the button:

```tsx
<Button
  size="small"
  variant="outlined"
  color="primary"
  sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75, textTransform: 'none' }}
  disabled={cvMatchDialog.clusters.length === 0 || cvMatchDialog.childRegions.length === 0}
  title="Use AI to match clusters to region names based on division geography"
  onClick={async () => {
    try {
      setCVMatchDialog(prev => prev ? { ...prev, progressText: 'AI suggesting region matches...' } : prev);
      const clusterData = cvMatchDialog.clusters.map(c => ({
        clusterId: c.clusterId,
        color: c.color,
        pixelShare: c.pixelShare,
        divisionNames: [
          ...c.divisions.map(d => d.name),
          ...c.unsplittable.map(d => d.name),
        ],
      }));
      const result = await aiSuggestClusterRegions(worldViewId, clusterData, cvMatchDialog.childRegions);
      // Apply matches to cluster dropdowns
      setCVMatchDialog(prev => {
        if (!prev) return prev;
        const matchMap = new Map(result.matches.filter(m => m.regionId).map(m => [m.clusterId, m.regionId!]));
        const newClusters = prev.clusters.map(c => {
          const regionId = matchMap.get(c.clusterId);
          if (!regionId) return c;
          const region = prev.childRegions.find(r => r.id === regionId);
          return region ? { ...c, suggestedRegion: region } : c;
        });
        // Also update geoPreview
        const newGeo = prev.geoPreview ? {
          ...prev.geoPreview,
          clusterInfos: prev.geoPreview.clusterInfos.map(ci => {
            const regionId = matchMap.get(ci.clusterId);
            if (!regionId) return ci;
            const region = prev.childRegions.find(r => r.id === regionId);
            return region ? { ...ci, regionId, regionName: region.name } : ci;
          }),
          featureCollection: {
            ...prev.geoPreview.featureCollection,
            features: prev.geoPreview.featureCollection.features.map(f => {
              if (!f.properties?.clusterId) return f;
              const regionId = matchMap.get(f.properties.clusterId);
              if (!regionId) return f;
              const region = prev.childRegions.find(r => r.id === regionId);
              return region ? { ...f, properties: { ...f.properties, regionId, regionName: region.name } } : f;
            }),
          },
        } : prev.geoPreview;
        return { ...prev, clusters: newClusters, geoPreview: newGeo, progressText: `AI suggested ${matchMap.size} matches` };
      });
    } catch (err) {
      console.error('AI suggest failed:', err);
      setCVMatchDialog(prev => prev ? { ...prev, progressText: 'AI suggestion failed' } : prev);
    }
  }}
>
  AI Suggest
</Button>
```

- [ ] **Step 2: Import the new API function**

Add `aiSuggestClusterRegions` to the import from `adminWorldViewImport.ts`.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit --project frontend/tsconfig.json`

- [ ] **Step 4: Test end-to-end**

1. Run Eastern Cape CV match with poly raster
2. Get to Suggested Assignments section
3. Click "AI Suggest"
4. Verify dropdowns are auto-populated
5. Verify accept buttons become enabled

- [ ] **Step 5: Commit**

```
feat: add AI Suggest button for cluster-to-region matching
```
