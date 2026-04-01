# Geoshape Scope Fallback + Division Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When geoshape matching finds no candidates in the nearest ancestor's scope, let the user progressively try wider ancestor scopes and transfer divisions from donor regions (with automatic GADM splitting when needed).

**Architecture:** Extend existing `geoshapeMatchRegion()` with an optional `scopeAncestorId` parameter and conflict detection. New `accept-with-transfer` endpoint handles atomic split+move. Frontend extends the geocode progress area with a retry button and renders conflict info on suggestion rows.

**Tech Stack:** Express + PostgreSQL/PostGIS (backend), React + MUI + react-map-gl/maplibre (frontend), Zod validation, TanStack Query mutations

---

## File Structure

### Backend — new/modified files
| File | Responsibility |
|------|---------------|
| `backend/src/services/worldViewImport/geoshapeCache.ts` | Modify `geoshapeMatchRegion()`: add `scopeAncestorId` param, return `nextScope`/`scopeAncestorName`, add conflict detection |
| `backend/src/controllers/admin/wvImportMatchController.ts` | New `acceptWithTransfer()` handler, new `getTransferPreview()` handler |
| `backend/src/controllers/admin/wvImportAIController.ts` | Pass `scopeAncestorId` from request body to `geoshapeMatchRegion()` |
| `backend/src/routes/adminRoutes.ts` | Register new routes, import new handlers |
| `backend/src/types/index.ts` | New Zod schemas: `wvImportGeoshapeMatchSchema`, `wvImportAcceptTransferSchema`, `wvImportTransferPreviewSchema` |

### Frontend — new/modified files
| File | Responsibility |
|------|---------------|
| `frontend/src/api/adminWorldViewImport.ts` | Extend `geoshapeMatchRegion()` params/return, new `acceptWithTransfer()` and `getTransferPreview()` API functions, extend `MatchSuggestion` type |
| `frontend/src/components/admin/useTreeMutations.ts` | Extend `geocodeProgress` state with `nextScope`, add transfer mutation, scope retry logic |
| `frontend/src/components/admin/TreeNodeActions.tsx` | Render scope retry button when `nextScope` present in geocode progress |
| `frontend/src/components/admin/TreeNodeContent.tsx` | Show conflict chips on `SuggestionRow`, wire transfer accept |
| `frontend/src/components/admin/TreeNodeRow.tsx` | Pass new callbacks through (onGeoshapeMatchWider, onAcceptTransfer, onPreviewTransfer) |
| `frontend/src/components/WorldViewEditor/components/dialogs/DivisionPreviewDialog.tsx` | Add transfer preview mode with 3-layer map rendering |

---

### Task 1: Backend — Extend Zod schema for geoshape-match endpoint

**Files:**
- Modify: `backend/src/types/index.ts:497-499`
- Modify: `backend/src/routes/adminRoutes.ts:419`

- [ ] **Step 1: Add `wvImportGeoshapeMatchSchema` to types**

In `backend/src/types/index.ts`, replace the `wvImportRegionIdSchema` usage for geoshape-match with a dedicated schema that accepts the optional `scopeAncestorId`:

```typescript
export const wvImportGeoshapeMatchSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  scopeAncestorId: z.coerce.number().int().positive().optional(),
});
```

Add this right after `wvImportRegionIdSchema` (after line 499).

- [ ] **Step 2: Update route to use new schema**

In `backend/src/routes/adminRoutes.ts`, change the geoshape-match route validation from `wvImportRegionIdSchema` to `wvImportGeoshapeMatchSchema`:

```typescript
router.post('/wv-import/matches/:worldViewId/geoshape-match', validate(worldViewIdParamSchema, 'params'), validate(wvImportGeoshapeMatchSchema), geoshapeMatch);
```

Update the import at the top of the file to include `wvImportGeoshapeMatchSchema`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/index.ts backend/src/routes/adminRoutes.ts
git commit -m "feat: add Zod schema for geoshape match with optional scopeAncestorId"
```

---

### Task 2: Backend — Modify scope walk in geoshapeMatchRegion

**Files:**
- Modify: `backend/src/services/worldViewImport/geoshapeCache.ts:487-538`

- [ ] **Step 1: Update function signature**

Change the function signature at line 487 to accept `scopeAncestorId` and return the extended type:

```typescript
export async function geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<{
  found: number;
  suggestions: Array<{ divisionId: number; name: string; path: string; score: number }>;
  totalCoverage?: number;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}> {
```

- [ ] **Step 2: Modify ancestor walk to track scope name and next scope**

Replace the scope walk block (lines 515-538) with logic that:
1. Uses the same recursive CTE but also fetches `name` for each ancestor
2. If `scopeAncestorId` is provided, skips all ancestors until reaching that ID, then uses the next one with divisions
3. Tracks both the chosen scope ancestor name and the next ancestor with divisions

Replace lines 515-538 with:

```typescript
  // 3. Scope: walk up the region tree to find nearest ancestor with assigned GADM divisions
  const ancestorResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_region_id, 0 AS depth FROM regions WHERE id = $1
      UNION ALL
      SELECT r.id, r.name, r.parent_region_id, a.depth + 1
      FROM regions r JOIN ancestors a ON r.id = a.parent_region_id
    )
    SELECT a.id, a.name,
      (SELECT array_agg(rm.division_id) FROM region_members rm WHERE rm.region_id = a.id) AS division_ids
    FROM ancestors a
    ORDER BY a.depth
  `, [regionId]);

  // Find the scope ancestor and the next one above it
  let scopeDivisionIds: number[] = [];
  let scopeAncestorName: string | undefined;
  let nextScope: { ancestorId: number; ancestorName: string } | undefined;
  let foundScope = false;
  // If scopeAncestorId is given, skip ancestors until we pass it
  const skipUntilPassed = scopeAncestorId != null;
  let passedRequestedAncestor = false;

  for (const row of ancestorResult.rows) {
    const rowId = row.id as number;
    const rowName = row.name as string;
    const ids = row.division_ids as number[] | null;
    const hasDivisions = ids != null && ids.length > 0;

    if (rowId === regionId) continue; // skip self

    if (skipUntilPassed && !passedRequestedAncestor) {
      if (rowId === scopeAncestorId) {
        passedRequestedAncestor = true;
        // Use this ancestor's scope if it has divisions
        if (hasDivisions) {
          scopeDivisionIds = ids;
          scopeAncestorName = rowName;
          foundScope = true;
          continue; // keep looking for nextScope
        }
      }
      continue; // skip ancestors below the requested one
    }

    if (!foundScope) {
      if (hasDivisions) {
        scopeDivisionIds = ids;
        scopeAncestorName = rowName;
        foundScope = true;
        continue; // keep looking for nextScope
      }
    } else {
      // Already found scope — look for the next ancestor with divisions
      if (hasDivisions) {
        nextScope = { ancestorId: rowId, ancestorName: rowName };
        break;
      }
    }
  }
```

- [ ] **Step 3: Update the return statements to include new fields**

Find the early return at line 604-606 (`if (candidateResult.rows.length === 0)`) and change it to:

```typescript
  if (candidateResult.rows.length === 0) {
    console.log(`[Geoshape Match] No spatial candidates for region ${regionId} (${wikidataId}) in scope ${scopeAncestorName ?? 'global'}`);
    return { found: 0, suggestions: [], scopeAncestorName, nextScope };
  }
```

Find the final return at line 814-816 and change it to:

```typescript
  console.log(`[Geoshape Match] Covering set for region ${regionId}: ${suggestions.map(s => `${s.name} (${(s.score / 10).toFixed(1)}%)`).join(', ')} — total coverage: ${roundedTotalCoverage != null ? (roundedTotalCoverage * 100).toFixed(1) : '?'}%`);
  return { found: suggestions.length, suggestions, totalCoverage: roundedTotalCoverage, scopeAncestorName, nextScope };
```

- [ ] **Step 4: Pass scopeAncestorId from the controller**

In `backend/src/controllers/admin/wvImportAIController.ts`, update the `geoshapeMatch` handler (line 144-160) to extract and pass `scopeAncestorId`:

```typescript
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
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/worldViewImport/geoshapeCache.ts backend/src/controllers/admin/wvImportAIController.ts
git commit -m "feat: progressive scope widening in geoshapeMatchRegion

Return scopeAncestorName and nextScope when no candidates found,
accept optional scopeAncestorId to start search from a specific ancestor."
```

---

### Task 3: Backend — Add conflict detection for wider-scope matches

**Files:**
- Modify: `backend/src/services/worldViewImport/geoshapeCache.ts` (after candidate finding, before covering set)

- [ ] **Step 1: Add conflict detection after candidate filtering**

After the candidate result is processed and before the coverage computation, add conflict detection that runs only in wider-scope mode. Insert this after the `candidateResult` query (around line 602, before the `candidateResult.rows.length === 0` check):

In `geoshapeMatchRegion`, after computing `candidateResult` and before the early-return check, add a conflict detection block. This goes right after line 602 (`const candidateResult = await pool.query(candidateQuery, candidateParams);`):

```typescript
  // 4b. Conflict detection: when using wider scope, check if candidates are assigned elsewhere
  // Maps divisionId → conflict info
  const conflictMap = new Map<number, { type: 'direct' | 'split'; donorRegionId: number; donorRegionName: string; donorDivisionId: number; donorDivisionName: string }>();
  if (scopeAncestorId != null && candidateResult.rows.length > 0) {
    const candidateIds = candidateResult.rows.map(r => r.id as number);
    // For each candidate, walk up its GADM ancestry and check region_members in this world view
    const conflictResult = await pool.query(`
      WITH RECURSIVE candidate_ancestors AS (
        -- Start from each candidate division
        SELECT ad.id AS candidate_id, ad.id AS ancestor_id, ad.name AS ancestor_name, ad.parent_id, 0 AS depth
        FROM administrative_divisions ad
        WHERE ad.id = ANY($1)
        UNION ALL
        SELECT ca.candidate_id, ad.id, ad.name, ad.parent_id, ca.depth + 1
        FROM administrative_divisions ad
        JOIN candidate_ancestors ca ON ad.id = ca.parent_id
      )
      SELECT DISTINCT ON (ca.candidate_id)
        ca.candidate_id,
        ca.ancestor_id AS donor_division_id,
        ca.ancestor_name AS donor_division_name,
        ca.depth,
        rm.region_id AS donor_region_id,
        r.name AS donor_region_name
      FROM candidate_ancestors ca
      JOIN region_members rm ON rm.division_id = ca.ancestor_id
      JOIN regions r ON r.id = rm.region_id AND r.world_view_id = $2
      WHERE rm.region_id != $3
      ORDER BY ca.candidate_id, ca.depth ASC
    `, [candidateIds, worldViewId, regionId]);

    for (const row of conflictResult.rows) {
      const candidateId = row.candidate_id as number;
      const donorDivisionId = row.donor_division_id as number;
      conflictMap.set(candidateId, {
        type: candidateId === donorDivisionId ? 'direct' : 'split',
        donorRegionId: row.donor_region_id as number,
        donorRegionName: row.donor_region_name as string,
        donorDivisionId,
        donorDivisionName: row.donor_division_name as string,
      });
    }
  }
```

- [ ] **Step 2: Include conflict info in the suggestion output**

The suggestions are built in the covering set / suggestion storage section (around lines 784-815). The existing code builds `suggestions` array with `{ divisionId, name, path, score }`. We need to add `conflict` from `conflictMap`.

Find the section where suggestions array is built from the covering set (look for `suggestions.push` or the array construction). The final suggestions are returned from the stored suggestions query. Modify the mapping to include conflict:

In the return statement, map the suggestions to include conflict info:

```typescript
  const suggestionsWithConflict = suggestions.map(s => ({
    ...s,
    conflict: conflictMap.get(s.divisionId),
  }));
```

Update both return statements (the early return for 0 candidates, and the final return) to use `suggestionsWithConflict` instead of `suggestions` where applicable:

For the final return:
```typescript
  return { found: suggestionsWithConflict.length, suggestions: suggestionsWithConflict, totalCoverage: roundedTotalCoverage, scopeAncestorName, nextScope };
```

Also update the function's return type to include the optional `conflict` field on each suggestion:

```typescript
): Promise<{
  found: number;
  suggestions: Array<{
    divisionId: number;
    name: string;
    path: string;
    score: number;
    conflict?: {
      type: 'direct' | 'split';
      donorRegionId: number;
      donorRegionName: string;
      donorDivisionId: number;
      donorDivisionName: string;
    };
  }>;
  totalCoverage?: number;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}> {
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/worldViewImport/geoshapeCache.ts
git commit -m "feat: conflict detection for wider-scope geoshape matches

When scopeAncestorId is provided, detect which candidate divisions
are already assigned to other regions (direct or via parent GADM split)."
```

---

### Task 4: Backend — Create acceptWithTransfer endpoint

**Files:**
- Modify: `backend/src/types/index.ts`
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts`
- Modify: `backend/src/routes/adminRoutes.ts`

- [ ] **Step 1: Add Zod schema**

In `backend/src/types/index.ts`, add after `wvImportGeoshapeMatchSchema`:

```typescript
export const wvImportAcceptTransferSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  divisionIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  donorRegionId: z.coerce.number().int().positive(),
  donorDivisionId: z.coerce.number().int().positive(),
  transferType: z.enum(['direct', 'split']),
});
```

- [ ] **Step 2: Implement acceptWithTransfer controller**

In `backend/src/controllers/admin/wvImportMatchController.ts`, add the handler. Import `invalidateRegionGeometry` and `syncImportMatchStatus` from the tree ops file (check existing imports pattern).

```typescript
export async function acceptWithTransfer(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionIds, donorRegionId, donorDivisionId, transferType } = req.body as {
    regionId: number; divisionIds: number[]; donorRegionId: number; donorDivisionId: number; transferType: 'direct' | 'split';
  };
  console.log(`[WV Import] POST /matches/${worldViewId}/accept-with-transfer — target=${regionId} donor=${donorRegionId} type=${transferType} divisions=${divisionIds.join(',')}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify both regions belong to this world view
    const regionCheck = await client.query(
      'SELECT id FROM regions WHERE id = ANY($1) AND world_view_id = $2',
      [[regionId, donorRegionId], worldViewId],
    );
    if (regionCheck.rows.length < 2) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Region or donor region not found in this world view' });
      return;
    }

    const divisionIdSet = new Set(divisionIds);

    if (transferType === 'split') {
      // 1. Remove donor division from donor region
      await client.query(
        'DELETE FROM region_members WHERE region_id = $1 AND division_id = $2',
        [donorRegionId, donorDivisionId],
      );

      // 2. Get GADM children of the donor division
      const childrenResult = await client.query(
        'SELECT id FROM administrative_divisions WHERE parent_id = $1',
        [donorDivisionId],
      );

      // 3. Add children NOT being transferred back to donor region
      const keepIds = childrenResult.rows
        .map(r => r.id as number)
        .filter(id => !divisionIdSet.has(id));
      if (keepIds.length > 0) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id)
           SELECT $1, unnest($2::int[])
           ON CONFLICT DO NOTHING`,
          [donorRegionId, keepIds],
        );
      }
    } else {
      // direct: just remove transferred divisions from donor
      await client.query(
        'DELETE FROM region_members WHERE region_id = $1 AND division_id = ANY($2)',
        [donorRegionId, divisionIds],
      );
    }

    // 4. Add transferred divisions to target region
    await client.query(
      `INSERT INTO region_members (region_id, division_id)
       SELECT $1, unnest($2::int[])
       ON CONFLICT DO NOTHING`,
      [regionId, divisionIds],
    );

    // 5. Remove accepted suggestions
    await client.query(
      'DELETE FROM region_match_suggestions WHERE region_id = $1 AND division_id = ANY($2) AND rejected = false',
      [regionId, divisionIds],
    );

    // 6. Update match statuses
    const remainingResult = await client.query(
      'SELECT COUNT(*) FROM region_match_suggestions WHERE region_id = $1 AND rejected = false',
      [regionId],
    );
    const remainingCount = parseInt(remainingResult.rows[0].count as string);
    const targetStatus = remainingCount > 0 ? 'needs_review' : 'manual_matched';
    await client.query(
      'UPDATE region_import_state SET match_status = $1 WHERE region_id = $2',
      [targetStatus, regionId],
    );

    await client.query('COMMIT');

    // Post-commit: invalidate geometry for both regions
    await Promise.all([
      invalidateRegionGeometry(regionId),
      invalidateRegionGeometry(donorRegionId),
    ]);

    res.json({ transferred: divisionIds.length, transferType });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

Note: `invalidateRegionGeometry` is used in `wvImportTreeOpsController.ts`. Check if it's already exported or needs to be imported. It's likely in a shared utility — grep for it and import from the same source.

- [ ] **Step 3: Register route**

In `backend/src/routes/adminRoutes.ts`:
1. Import `acceptWithTransfer` from the match controller
2. Import `wvImportAcceptTransferSchema` from types
3. Add the route after the existing accept routes:

```typescript
router.post('/wv-import/matches/:worldViewId/accept-with-transfer', validate(worldViewIdParamSchema, 'params'), validate(wvImportAcceptTransferSchema), acceptWithTransfer);
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/types/index.ts backend/src/controllers/admin/wvImportMatchController.ts backend/src/routes/adminRoutes.ts
git commit -m "feat: accept-with-transfer endpoint for atomic split+move

Single transaction removes donor division, adds GADM children back to donor
(minus transferred ones), and assigns transferred divisions to target region."
```

---

### Task 5: Backend — Create transferPreview endpoint

**Files:**
- Modify: `backend/src/types/index.ts`
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts`
- Modify: `backend/src/routes/adminRoutes.ts`

- [ ] **Step 1: Add Zod schema**

In `backend/src/types/index.ts`:

```typescript
export const wvImportTransferPreviewSchema = z.object({
  donorDivisionId: z.coerce.number().int().positive(),
  movingDivisionIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  wikidataId: z.string().regex(/^Q\d+$/),
});
```

- [ ] **Step 2: Implement getTransferPreview controller**

In `backend/src/controllers/admin/wvImportMatchController.ts`:

```typescript
export async function getTransferPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { donorDivisionId, movingDivisionIds, wikidataId } = req.body as {
    donorDivisionId: number; movingDivisionIds: number[]; wikidataId: string;
  };

  // Fetch all three layers in one query
  const result = await pool.query(`
    WITH donor AS (
      SELECT 'donor' AS role, ad.name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ad.geom_simplified_medium), 3)))::json AS geometry
      FROM administrative_divisions ad WHERE ad.id = $1 AND ad.geom_simplified_medium IS NOT NULL
    ),
    moving AS (
      SELECT 'moving' AS role, ad.name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(ad.geom_simplified_medium), 3)))::json AS geometry
      FROM administrative_divisions ad WHERE ad.id = ANY($2) AND ad.geom_simplified_medium IS NOT NULL
    ),
    target_outline AS (
      SELECT 'target_outline' AS role, $3::text AS name,
        ST_AsGeoJSON(ST_ForcePolygonCCW(ST_CollectionExtract(ST_MakeValid(geom), 3)))::json AS geometry
      FROM wikidata_geoshapes WHERE wikidata_id = $3 AND not_available = FALSE
    )
    SELECT role, name, geometry FROM donor
    UNION ALL SELECT role, name, geometry FROM moving
    UNION ALL SELECT role, name, geometry FROM target_outline
  `, [donorDivisionId, movingDivisionIds, wikidataId]);

  const features = result.rows
    .filter(r => r.geometry != null)
    .map(r => ({
      type: 'Feature' as const,
      properties: { role: r.role as string, name: r.name as string },
      geometry: r.geometry as GeoJSON.Geometry,
    }));

  res.json({ type: 'FeatureCollection', features });
}
```

Add `import type { GeoJSON } from 'geojson';` at the top if not already imported (check existing imports — the file likely uses GeoJSON types already from the union-geometry handler).

- [ ] **Step 3: Register route**

In `backend/src/routes/adminRoutes.ts`:
1. Import `getTransferPreview` from the match controller
2. Import `wvImportTransferPreviewSchema` from types
3. Add route:

```typescript
router.post('/wv-import/matches/:worldViewId/transfer-preview', validate(worldViewIdParamSchema, 'params'), validate(wvImportTransferPreviewSchema), getTransferPreview);
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/types/index.ts backend/src/controllers/admin/wvImportMatchController.ts backend/src/routes/adminRoutes.ts
git commit -m "feat: transfer-preview endpoint returns 3-layer GeoJSON

Returns donor division, moving divisions, and target Wikidata geoshape
as a FeatureCollection with role-tagged features for map rendering."
```

---

### Task 6: Frontend — Extend API types and functions

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts`

- [ ] **Step 1: Extend MatchSuggestion type**

In `frontend/src/api/adminWorldViewImport.ts`, update the `MatchSuggestion` interface (lines 51-57):

```typescript
export interface MatchSuggestion {
  divisionId: number;
  name: string;
  path: string;
  score: number;
  geoSimilarity: number | null;
  conflict?: {
    type: 'direct' | 'split';
    donorRegionId: number;
    donorRegionName: string;
    donorDivisionId: number;
    donorDivisionName: string;
  };
}
```

- [ ] **Step 2: Add GeoshapeMatchResult type and update geoshapeMatchRegion**

Add a result type and update the function (lines 221-229):

```typescript
export interface GeoshapeMatchResult {
  found: number;
  suggestions: MatchSuggestion[];
  totalCoverage?: number;
  scopeAncestorName?: string;
  nextScope?: { ancestorId: number; ancestorName: string };
}

export async function geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,
): Promise<GeoshapeMatchResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geoshape-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId, ...(scopeAncestorId != null ? { scopeAncestorId } : {}) }),
  });
}
```

- [ ] **Step 3: Add acceptWithTransfer and getTransferPreview API functions**

```typescript
export async function acceptWithTransfer(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
  donorRegionId: number,
  donorDivisionId: number,
  transferType: 'direct' | 'split',
): Promise<{ transferred: number; transferType: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/accept-with-transfer`, {
    method: 'POST',
    body: JSON.stringify({ regionId, divisionIds, donorRegionId, donorDivisionId, transferType }),
  });
}

export async function getTransferPreview(
  worldViewId: number,
  donorDivisionId: number,
  movingDivisionIds: number[],
  wikidataId: string,
): Promise<GeoJSON.FeatureCollection> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/transfer-preview`, {
    method: 'POST',
    body: JSON.stringify({ donorDivisionId, movingDivisionIds, wikidataId }),
  });
}
```

Add the GeoJSON import at the top if not present: check existing imports — if the file uses `GeoJSON.FeatureCollection` elsewhere, the import already exists.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/adminWorldViewImport.ts
git commit -m "feat: frontend API types and functions for scope fallback and transfer"
```

---

### Task 7: Frontend — Scope fallback UI in useTreeMutations

**Files:**
- Modify: `frontend/src/components/admin/useTreeMutations.ts`

- [ ] **Step 1: Extend geocodeProgress state type**

Change the `geocodeProgress` state (line 78) to include optional scope info and a retry callback:

```typescript
const [geocodeProgress, setGeocodeProgress] = useState<{
  regionId: number;
  message: string;
  nextScope?: { ancestorId: number; ancestorName: string };
} | null>(null);
```

- [ ] **Step 2: Update geoshapeMatchMutation to pass scopeAncestorId and handle nextScope**

Replace the mutation definition (lines 332-353). The `mutationFn` needs to accept an object with optional `scopeAncestorId`:

```typescript
const geoshapeMatchMutation = useMutation({
  mutationFn: ({ regionId, scopeAncestorId }: { regionId: number; scopeAncestorId?: number }) =>
    geoshapeMatchRegion(worldViewId, regionId, scopeAncestorId),
  onMutate: ({ regionId }) => {
    setGeocodeProgress({ regionId, message: 'Matching by geoshape...' });
  },
  onSuccess: (data, { regionId }) => {
    const coverageMsg = data.totalCoverage != null
      ? ` (${Math.round(data.totalCoverage * 100)}% coverage)`
      : '';
    if (data.found > 0) {
      setGeocodeProgress({
        regionId,
        message: `Covering set: ${data.found} division(s)${coverageMsg}`,
      });
      setTimeout(() => setGeocodeProgress(null), 4000);
    } else if (data.nextScope) {
      // No matches in current scope — offer wider scope
      setGeocodeProgress({
        regionId,
        message: `No matches in ${data.scopeAncestorName ?? 'current'} scope`,
        nextScope: data.nextScope,
      });
      // Do NOT auto-dismiss — user needs to decide
    } else {
      setGeocodeProgress({
        regionId,
        message: 'No geoshape matches found',
      });
      setTimeout(() => setGeocodeProgress(null), 4000);
    }
    invalidateTree(regionId);
  },
  onError: () => {
    setGeocodeProgress(null);
  },
});
```

- [ ] **Step 3: Update the geoshape match trigger callback**

Find where `geoshapeMatchMutation.mutate` is exposed/called. The existing code passes `regionId` directly. Update the exposed callback to wrap it:

Find the `onGeoshapeMatch` callback in the hook's return value. It currently calls `geoshapeMatchMutation.mutate(regionId)`. Change it to:

```typescript
onGeoshapeMatch: (regionId: number, scopeAncestorId?: number) =>
  geoshapeMatchMutation.mutate({ regionId, scopeAncestorId }),
```

Also verify the `geoshapeMatchingRegionId` derivation. It currently checks `geoshapeMatchMutation.variables`. Update to match the new shape:

Look for where `geoshapeMatchingRegionId` is derived (likely `geoshapeMatchMutation.isPending ? geoshapeMatchMutation.variables : null` or similar). Change references from `geoshapeMatchMutation.variables` to `geoshapeMatchMutation.variables?.regionId`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/useTreeMutations.ts
git commit -m "feat: scope fallback state in geoshape match mutation

When no matches found but wider scope available, persist nextScope
in geocodeProgress for the UI to render a retry button."
```

---

### Task 8: Frontend — Render scope retry button in TreeNodeActions

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeActions.tsx`
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx`

- [ ] **Step 1: Extend geocodeProgress prop type in TreeNodeActions**

Update the `nodeGeocodeMsg` prop to carry the full geocode progress for this node, including `nextScope`. In `TreeNodeActions.tsx`, change the prop from a plain string to a richer type.

First, in `TreeNodeRow.tsx`, change how `nodeGeocodeMsg` is derived (line 211):

```typescript
const nodeGeocode = geocodeProgress?.regionId === node.id ? geocodeProgress : null;
```

Pass both `nodeGeocodeMsg={nodeGeocode?.message ?? null}` and the new `nodeGeocodeNextScope={nodeGeocode?.nextScope}` to `TreeNodeActions`.

In `TreeNodeRow.tsx`, update the `TreeNodeActions` call to add the new prop:

```typescript
nodeGeocodeNextScope={nodeGeocode?.nextScope}
```

Also pass through `onGeoshapeMatch` — it's already passed. The retry will call `onGeoshapeMatch(node.id, nextScope.ancestorId)`.

Update the memo comparison function to handle the new geocodeProgress shape — the existing comparison at lines 183-184 compares messages. Update to also compare nextScope:

```typescript
const prevGeo = prev.geocodeProgress?.regionId === id ? prev.geocodeProgress : null;
const nextGeo = next.geocodeProgress?.regionId === id ? next.geocodeProgress : null;
if (prevGeo?.message !== nextGeo?.message || prevGeo?.nextScope?.ancestorId !== nextGeo?.nextScope?.ancestorId) return false;
```

- [ ] **Step 2: Render retry button in SearchActionButtons**

In `TreeNodeActions.tsx`, add `nodeGeocodeNextScope` prop to `SearchActionButtons`:

```typescript
nodeGeocodeNextScope?: { ancestorId: number; ancestorName: string };
```

Then update the rendering block (lines 175-179) to show either the plain message or the message + retry button:

```typescript
{nodeGeocodeMsg && (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: -0.5 }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
      {nodeGeocodeMsg}
    </Typography>
    {nodeGeocodeNextScope && (
      <Typography
        variant="caption"
        component="span"
        onClick={() => onGeoshapeMatch(nodeId, nodeGeocodeNextScope.ancestorId)}
        sx={{
          fontSize: '0.65rem',
          color: 'primary.main',
          cursor: 'pointer',
          textDecoration: 'underline',
          '&:hover': { color: 'primary.dark' },
        }}
      >
        Try wider: {nodeGeocodeNextScope.ancestorName}
      </Typography>
    )}
  </Box>
)}
```

Update the `onGeoshapeMatch` prop type from `(regionId: number) => void` to `(regionId: number, scopeAncestorId?: number) => void` in the `SearchActionButtons` interface.

- [ ] **Step 3: Update onGeoshapeMatch signature through the prop chain**

The `onGeoshapeMatch` callback flows through: `useTreeMutations` → `WorldViewImportTree` → `TreeNodeRow` → `TreeNodeActions`.

Update the type in each file:
- `TreeNodeRow` props: `onGeoshapeMatch: (regionId: number, scopeAncestorId?: number) => void`
- `TreeNodeActions` props: same
- `SearchActionButtons` inline props: same

The existing geoshape match button call `onClick={() => onGeoshapeMatch(nodeId)}` stays unchanged (no `scopeAncestorId` = default scope).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/TreeNodeActions.tsx frontend/src/components/admin/TreeNodeRow.tsx
git commit -m "feat: render 'Try wider' scope retry link in tree node actions

When geoshape match returns no candidates but has a nextScope,
show a clickable link to retry with the wider ancestor scope."
```

---

### Task 9: Frontend — Conflict chips on SuggestionRow

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeContent.tsx`

- [ ] **Step 1: Extend SuggestionRow to display conflict info**

Update the `SuggestionRow` component's suggestion prop type (line 52) to include the optional conflict:

```typescript
suggestion: { divisionId: number; name: string; path: string; score: number; geoSimilarity?: number | null; conflict?: { type: 'direct' | 'split'; donorRegionId: number; donorRegionName: string; donorDivisionId: number; donorDivisionName: string } };
```

Add a conflict chip inside the `SuggestionRow` render, right after the path text and before the geo similarity display:

```typescript
{suggestion.conflict && (
  <Typography
    variant="caption"
    sx={{
      color: 'warning.main',
      fontSize: '0.6rem',
      whiteSpace: 'nowrap',
      border: '1px solid',
      borderColor: 'warning.main',
      borderRadius: 0.5,
      px: 0.5,
      lineHeight: 1.4,
    }}
  >
    from {suggestion.conflict.donorRegionName}
    {suggestion.conflict.type === 'split' ? ` (split ${suggestion.conflict.donorDivisionName})` : ''}
  </Typography>
)}
```

- [ ] **Step 2: Update accept tooltip for conflicted suggestions**

Modify the accept button's tooltip (line 91-92) to reflect the transfer:

```typescript
<Tooltip title={suggestion.conflict ? `Accept and transfer from ${suggestion.conflict.donorRegionName}` : 'Accept'}>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/TreeNodeContent.tsx
git commit -m "feat: show conflict chips on geoshape suggestions from wider scope

Display donor region name and split info on suggestions that
require division transfer from another region."
```

---

### Task 10: Frontend — Wire transfer accept mutation

**Files:**
- Modify: `frontend/src/components/admin/useTreeMutations.ts`
- Modify: `frontend/src/components/admin/TreeNodeContent.tsx`
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx`

- [ ] **Step 1: Add transfer accept mutation to useTreeMutations**

In `useTreeMutations.ts`, add a new mutation after the existing accept mutation:

```typescript
const acceptTransferMutation = useMutation({
  mutationFn: ({ regionId, divisionIds, donorRegionId, donorDivisionId, transferType }: {
    regionId: number; divisionIds: number[]; donorRegionId: number; donorDivisionId: number; transferType: 'direct' | 'split';
  }) => acceptWithTransfer(worldViewId, regionId, divisionIds, donorRegionId, donorDivisionId, transferType),
  onSuccess: (_data, { regionId }) => {
    invalidateTree(regionId);
  },
});
```

Import `acceptWithTransfer` from the API module at the top.

Expose in the hook return:

```typescript
onAcceptTransfer: (regionId: number, divisionId: number, conflict: { type: 'direct' | 'split'; donorRegionId: number; donorDivisionId: number }) =>
  acceptTransferMutation.mutate({
    regionId,
    divisionIds: [divisionId],
    donorRegionId: conflict.donorRegionId,
    donorDivisionId: conflict.donorDivisionId,
    transferType: conflict.type,
  }),
```

- [ ] **Step 2: Route accept through conflict check in TreeNodeContent**

In `TreeNodeContent.tsx`, the `SuggestionRow` calls `onAccept(regionId, divisionId)`. For conflicted suggestions, it should call `onAcceptTransfer` instead.

Add `onAcceptTransfer` prop to the `TreeNodeContent` component and pass it through. In `SuggestionRow`, change the accept button's onClick:

```typescript
onClick={() => {
  if (suggestion.conflict) {
    onAcceptTransfer(regionId, suggestion.divisionId, suggestion.conflict);
  } else {
    onAccept(regionId, suggestion.divisionId);
  }
}}
```

Add `onAcceptTransfer` to the `SuggestionRow` props:
```typescript
onAcceptTransfer: (regionId: number, divisionId: number, conflict: { type: 'direct' | 'split'; donorRegionId: number; donorDivisionId: number }) => void;
```

- [ ] **Step 3: Thread onAcceptTransfer through TreeNodeRow**

Pass `onAcceptTransfer` from `WorldViewImportTree` → `TreeNodeRow` → `TreeNodeContent`. Follow the same pattern as `onAccept`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/useTreeMutations.ts frontend/src/components/admin/TreeNodeContent.tsx frontend/src/components/admin/TreeNodeRow.tsx
git commit -m "feat: wire transfer accept mutation for conflicted suggestions

Conflicted suggestions call acceptWithTransfer instead of normal accept,
performing atomic split+move on the backend."
```

---

### Task 11: Frontend — Transfer preview map in DivisionPreviewDialog

**Files:**
- Modify: `frontend/src/components/WorldViewEditor/components/dialogs/DivisionPreviewDialog.tsx`
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx`
- Modify: `frontend/src/components/admin/WorldViewImportReview.tsx`

- [ ] **Step 1: Add transfer preview handler in WorldViewImportReview**

In `WorldViewImportReview.tsx`, add a handler that fetches transfer preview data and opens the preview dialog in transfer mode.

Add after `handlePreviewUnion` (around line 108):

```typescript
const handlePreviewTransfer = useCallback(async (
  divisionId: number, name: string, path: string | undefined,
  conflict: { donorDivisionId: number; donorDivisionName: string },
  wikidataId: string, regionName: string,
) => {
  setPreviewDivision({ name: `Transfer: ${name}`, path, regionMapUrl: undefined, wikidataId, regionId: undefined, regionName });
  setPreviewLoading(true);
  try {
    const fc = await getTransferPreview(worldViewId, conflict.donorDivisionId, [divisionId], wikidataId);
    setPreviewGeometry(fc);
  } catch {
    setPreviewGeometry(null);
  }
  setPreviewLoading(false);
}, [worldViewId]);
```

Import `getTransferPreview` from the API module.

Pass this handler down through the tree: `WorldViewImportTree` → `TreeNodeRow` → `TreeNodeContent` → `SuggestionRow`.

- [ ] **Step 2: Add transfer preview rendering in DivisionPreviewDialog**

In `DivisionPreviewDialog.tsx`, detect transfer preview mode by checking if the geometry is a `FeatureCollection` with `role` properties. When in transfer mode, render three layers on a single map instead of the two-panel layout:

Add a helper to check transfer mode:
```typescript
const isTransferPreview = geometry != null
  && 'type' in geometry && geometry.type === 'FeatureCollection'
  && (geometry as GeoJSON.FeatureCollection).features.some(f => f.properties?.role === 'donor');
```

When `isTransferPreview` is true, render a single `MapGL` instance with three source/layer pairs:

```typescript
{isTransferPreview && (() => {
  const fc = geometry as GeoJSON.FeatureCollection;
  const donorFeatures = { type: 'FeatureCollection' as const, features: fc.features.filter(f => f.properties?.role === 'donor') };
  const movingFeatures = { type: 'FeatureCollection' as const, features: fc.features.filter(f => f.properties?.role === 'moving') };
  const outlineFeatures = { type: 'FeatureCollection' as const, features: fc.features.filter(f => f.properties?.role === 'target_outline') };
  const allBbox = bbox({ type: 'FeatureCollection', features: fc.features });
  return (
    <Box sx={{ width: '100%', height: 400 }}>
      <MapGL
        initialViewState={{ bounds: [allBbox[0], allBbox[1], allBbox[2], allBbox[3]] as [number, number, number, number], fitBoundsOptions: { padding: 40 } }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      >
        <Source id="donor" type="geojson" data={donorFeatures}>
          <Layer id="donor-fill" type="fill" paint={{ 'fill-color': '#9e9e9e', 'fill-opacity': 0.3 }} />
          <Layer id="donor-line" type="line" paint={{ 'line-color': '#757575', 'line-width': 1.5 }} />
        </Source>
        <Source id="moving" type="geojson" data={movingFeatures}>
          <Layer id="moving-fill" type="fill" paint={{ 'fill-color': '#ff9800', 'fill-opacity': 0.5 }} />
          <Layer id="moving-line" type="line" paint={{ 'line-color': '#e65100', 'line-width': 2 }} />
        </Source>
        <Source id="target-outline" type="geojson" data={outlineFeatures}>
          <Layer id="target-line" type="line" paint={{ 'line-color': '#1976d2', 'line-width': 2, 'line-dasharray': [4, 3] }} />
        </Source>
      </MapGL>
    </Box>
  );
})()}
```

Add a legend below the map:
```typescript
<Box sx={{ display: 'flex', gap: 2, mt: 1, justifyContent: 'center' }}>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Box sx={{ width: 12, height: 12, bgcolor: '#9e9e9e', opacity: 0.5, borderRadius: 0.5 }} />
    <Typography variant="caption">Stays with donor</Typography>
  </Box>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Box sx={{ width: 12, height: 12, bgcolor: '#ff9800', borderRadius: 0.5 }} />
    <Typography variant="caption">Moving to target</Typography>
  </Box>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Box sx={{ width: 12, height: 12, border: '2px dashed #1976d2', borderRadius: 0.5 }} />
    <Typography variant="caption">Target geoshape</Typography>
  </Box>
</Box>
```

Import `Source`, `Layer` from `react-map-gl/maplibre` and `bbox` from `@turf/bbox` (check existing imports — both are likely already imported in this file).

- [ ] **Step 3: Wire preview button for conflicted suggestions**

In `SuggestionRow`, when a suggestion has a conflict, the preview button should call the transfer preview handler instead of the regular preview. Add `onPreviewTransfer` prop:

```typescript
onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string }, wikidataId: string) => void;
```

Update the preview button onClick:
```typescript
onClick={() => {
  if (suggestion.conflict && onPreviewTransfer) {
    onPreviewTransfer(suggestion.divisionId, suggestion.name, suggestion.path, suggestion.conflict, wikidataId);
  } else {
    onPreview(suggestion.divisionId, suggestion.name, suggestion.path);
  }
}}
```

Thread `onPreviewTransfer` and `wikidataId` through the component chain from `WorldViewImportReview` → `TreeNodeRow` → `TreeNodeContent` → `SuggestionRow`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WorldViewEditor/components/dialogs/DivisionPreviewDialog.tsx frontend/src/components/admin/TreeNodeRow.tsx frontend/src/components/admin/WorldViewImportReview.tsx frontend/src/components/admin/TreeNodeContent.tsx
git commit -m "feat: transfer preview map with 3-layer visualization

Shows donor division (gray), moving divisions (orange), and target
geoshape outline (blue dashed) on a single map for transfer preview."
```

---

### Task 12: Pre-commit checks and cleanup

**Files:** All modified files

- [ ] **Step 1: Run lint + typecheck**

```bash
npm run check
```

Fix any type errors or lint issues. Common issues:
- Missing imports for new types
- Prop type mismatches in the threading chain
- Unused variables from refactored code

- [ ] **Step 2: Run knip**

```bash
npm run knip
```

Verify no unused exports were introduced.

- [ ] **Step 3: Run tests**

```bash
TEST_REPORT_LOCAL=1 npm test
```

Ensure existing tests still pass.

- [ ] **Step 4: Run security checks**

```bash
npm run security:all
```

- [ ] **Step 5: Final commit if any fixes**

```bash
git add -A
git commit -m "fix: address lint, type, and knip issues from scope fallback feature"
```
