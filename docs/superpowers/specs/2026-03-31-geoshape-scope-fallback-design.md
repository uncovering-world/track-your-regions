# Geoshape Scope Fallback + Division Transfer

## Problem

Geoshape matching restricts spatial candidate search to descendants of the nearest ancestor region with assigned GADM divisions. When the matching GADM divisions fall outside that ancestor's subtree (e.g., Sporades islands are GADM-children of Thessaly, not Aegean), the search returns zero candidates even though the Wikidata geoshape clearly overlaps real GADM divisions.

**Concrete example:** Sporades Islands (Wikidata Q203447, geoshape with 1355 points) finds 9 matching GADM divisions globally (Skiathos, Skopelos, Alonnisos, Skyros, etc.). But its scope ancestor "Greek Islands" has divisions [Aegean, Ionian Islands, Salamina]. The Sporades divisions descend from Thessaly, not Aegean, so they're filtered out.

## Design

### 1. Progressive Scope Widening

#### Backend: `geoshapeMatchRegion()` changes

**New parameter:**
```typescript
geoshapeMatchRegion(
  worldViewId: number,
  regionId: number,
  scopeAncestorId?: number,  // NEW: override scope to start from this ancestor
)
```

**Scope walk modification:**
- If `scopeAncestorId` provided: use that ancestor's divisions as scope, then identify the next ancestor above it with divisions
- If not provided: current behavior (walk up from self)
- After selecting the scope, also identify the **next** ancestor with divisions (one level higher)

**Return type extension:**
```typescript
{
  found: number;
  suggestions: Array<{
    divisionId: number;
    name: string;
    path: string;
    score: number;
    conflict?: {                    // NEW: only present in wider-scope mode
      type: 'direct' | 'split';
      donorRegionId: number;
      donorRegionName: string;
      donorDivisionId: number;      // assigned GADM div (= candidate for direct, parent for split)
      donorDivisionName: string;
    };
  }>;
  totalCoverage?: number;
  scopeAncestorName?: string;       // NEW: which ancestor's scope was searched
  nextScope?: {                     // NEW: null/undefined if no more ancestors
    ancestorId: number;
    ancestorName: string;
  };
}
```

#### Frontend: scope prompt in tree node

When `found === 0` and `nextScope` exists:
- Show persistent message (not auto-dismissing): "No matches in **[scopeAncestorName]** scope"
- Button below: "Try wider: **[nextScope.ancestorName]**"
- Clicking re-triggers `geoshapeMatchMutation` with `scopeAncestorId` param

When `found === 0` and `!nextScope`:
- Current behavior: "No geoshape matches found" (all scopes exhausted)

### 2. Conflict Detection

Runs only in wider-scope mode (`scopeAncestorId` provided). For each spatial candidate, walks up its GADM ancestry checking `region_members` for this world view:

| Scenario | `conflict.type` | Meaning |
|----------|-----------------|---------|
| Exact division assigned to another region | `direct` | Simple reassign |
| A GADM parent assigned to another region | `split` | Split parent, then move child |
| Not assigned anywhere | no conflict | Normal accept |

**SQL approach:** Single query joining candidates to GADM ancestors to `region_members` to `regions` for this world view. Groups by candidate to find the nearest conflicting ancestor.

### 3. Atomic Split+Move Accept

**New endpoint:** `POST /api/admin/wv-import/matches/:worldViewId/accept-with-transfer`

**Body:**
```typescript
{
  regionId: number;          // target region (Sporades Islands)
  divisionIds: number[];     // GADM divisions to assign (Skiathos, Skopelos, ...)
  donorRegionId: number;     // region losing coverage (Thessaly region)
  donorDivisionId: number;   // GADM division to split (Thessaly GADM div)
  transferType: 'direct' | 'split';
}
```

**Single transaction for `split`:**
1. Remove `donorDivisionId` from `region_members` of `donorRegionId`
2. Fetch GADM children of `donorDivisionId`
3. Add children **except** transferred ones back to `donorRegionId`
4. Add `divisionIds` to target `regionId`'s `region_members`
5. Remove accepted suggestions from `region_match_suggestions`
6. Update `match_status` for both regions
7. Invalidate geometry for both regions

**Single transaction for `direct`:**
1. Remove `divisionIds` from `donorRegionId`'s members
2. Add `divisionIds` to target `regionId`'s members
3. Clean up suggestions + statuses

**Batch handling:** Multiple candidates from the same donor (e.g., Skiathos + Skopelos + Alonnisos all from Thessaly) are split+moved together in one transaction.

### 4. Conflict Visualization in Suggestion Rows

Each `SuggestionRow` with a `conflict` shows:
- Warning chip below division name: "from **[donorRegionName]**" (orange)
- For split type: "(will split [donorDivisionName])"
- Accept button tooltip: "Accept and transfer from [donorRegionName]"
- Accept action calls `accept-with-transfer` instead of normal accept

### 5. Transfer Preview Map

When previewing a conflicted suggestion, single map with three layers:

| Layer | Visual | Data source |
|-------|--------|-------------|
| Donor division (full) | Light gray fill + border | GADM geometry of `donorDivisionId` |
| Divisions being moved | Orange/amber fill | GADM geometry of candidate `divisionId`(s) |
| Target geoshape outline | Dashed line | `wikidata_geoshapes` for target region |

This implicitly shows before (gray = stays + orange = moves) and after (gray = stays, orange gone to target).

**Implementation:** Add a `transferPreview` prop to the existing preview callback in `TreeNodeRow`. When a conflicted suggestion is previewed, pass the three geometry IDs (donor division, candidate division(s), target Wikidata ID) to `GeometryMapPanel`, which renders them as separate MapLibre layers with distinct styles. No new component needed — just an additional rendering path in the existing panel.

**Data:** New backend endpoint `GET /api/admin/wv-import/matches/:worldViewId/transfer-preview` returns GeoJSON `FeatureCollection` with a `role` property per feature (`donor`, `moving`, `target_outline`). Single fetch, frontend splits by role into three layers.

## Edge Cases

- **No conflict candidates mixed with conflict ones:** Normal accept for no-conflict, transfer accept for conflicted. UI handles both in the same suggestion list.
- **Donor GADM division is a leaf (no children):** `split` type impossible; conflict detection returns `direct` type instead (move the leaf itself).
- **Multiple donors:** Each suggestion carries its own conflict info. The accept-with-transfer endpoint handles one donor at a time. User processes each group separately.
- **Transferred region had geoshape coverage stats:** Both donor and target regions get geometry invalidated post-transfer. Coverage chips refresh.

## Files to Modify

### Backend
- `backend/src/services/worldViewImport/geoshapeCache.ts` — scope fallback logic, conflict detection, return type extension
- `backend/src/controllers/admin/wvImportMatchController.ts` — new `acceptWithTransfer` handler
- `backend/src/routes/adminRoutes.ts` — new route
- Zod validation schemas for the new endpoint

### Frontend
- `frontend/src/api/adminWorldViewImport.ts` — API function for accept-with-transfer, extend geoshape match params
- `frontend/src/components/admin/useTreeMutations.ts` — scope fallback UI state, transfer mutation
- `frontend/src/components/admin/TreeNodeContent.tsx` — conflict chips on suggestion rows, transfer preview trigger
- `frontend/src/components/admin/treeNodeShared.tsx` — conflict type definition
- Geometry preview panel extension for three-layer rendering
