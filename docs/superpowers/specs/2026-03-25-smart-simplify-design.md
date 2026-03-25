# Smart Simplify — Design Spec

## Problem

After auto-matching, divisions sometimes end up in the wrong sibling region. For example, India has children Eastern India and Western India. Eastern India has 21 of 24 Chhattisgarh districts, but 3 Chhattisgarh districts landed in Western India. The user can't simplify Chhattisgarh (24 districts → 1) because the divisions are split across siblings.

The user needs a way to detect these "straggler" divisions and move them to the correct sibling, then simplify — with a visual comparison to the source map to confirm the moves make sense.

## Solution

A "Smart Simplify" button on parent region nodes (e.g., India) that analyzes all child regions together. The backend detects which GADM parent divisions are split across siblings and suggests moves that would enable simplification. A dialog shows the source map alongside an interactive GADM map with the proposed moves, letting the user apply or skip each move individually.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Parent-level analysis, all children at once | Full picture of cross-sibling misplacements |
| Move trigger | Only suggest moves that enable simplification | Purposeful — every move has a concrete benefit |
| Apply granularity | Per-move (not batch) | User decides each move independently, in any order |
| Owner determination | Majority rule — sibling with most children of a GADM parent | Simple, intuitive, correct in the "straggler" scenario |
| Map comparison | Single map with Current/Proposed toggle | Full-size map; source map image on left for reference |
| Custom geometry | Skip — only full-coverage members participate | Same rule as simplify-hierarchy |

## Backend

### Detection endpoint

`POST /api/admin/wv-import/matches/:worldViewId/smart-simplify`

**Request body:**
```json
{ "parentRegionId": 100 }
```

**Algorithm:**

This is a read-only endpoint — uses `pool.query()` directly (no dedicated client, no transaction), following the pattern of other read-only admin endpoints like `getChildrenRegionGeometry`.

**Pre-check:** Verify `parentRegionId` belongs to `worldViewId` and has children.

```
function detectSmartSimplifyMoves(parentRegionId, worldViewId):
  // 1. Get all child regions
  children = pool.query(
    SELECT id, name FROM regions
    WHERE parent_region_id = parentRegionId AND world_view_id = worldViewId
  )
  if children.length === 0: return { moves: [] }

  // 2. Get all full-coverage members across ALL children in one query
  allMembers = pool.query(
    SELECT rm.id AS member_row_id, rm.division_id, rm.region_id,
           ad.parent_id AS gadm_parent_id, ad.name AS division_name
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = ANY(childIds) AND rm.custom_geom IS NULL
  )

  // 3. Group by GADM parent (skip nulls)
  byGadmParent = group allMembers by gadm_parent_id

  // 4. Batch-fetch child counts for all GADM parents at once (avoids N+1)
  gadmParentIds = [...byGadmParent.keys()]
  childCounts = pool.query(
    SELECT parent_id, count(*)::int AS cnt
    FROM administrative_divisions
    WHERE parent_id = ANY(gadmParentIds)
    GROUP BY parent_id
  )
  // Build lookup: gadmParentId → total children count
  totalChildrenMap = Map from childCounts

  // 5. For each GADM parent, check if ALL children are present and split across siblings
  moves = []
  for each (gadmParentId, members) in byGadmParent:
    totalChildren = totalChildrenMap.get(gadmParentId)
    if members.length != totalChildren: continue  // not complete — skip

    // Check if split across multiple sibling regions
    byRegion = group members by region_id
    if byRegion.size <= 1: continue  // all in one sibling — just simplify, no moves needed

    // Find owner (sibling with the most)
    ownerRegionId = region with max count in byRegion
    // Tie-breaker: lowest region ID (deterministic)
    ownerRegionName = children.find(c => c.id === ownerRegionId).name

    // Divisions in other siblings are the move suggestions
    divisionsToMove = members where region_id != ownerRegionId

    // Build GADM parent path (recursive ancestor query)
    parentPath = recursive ancestor query for gadmParentId

    moves.push({
      gadmParentId,
      gadmParentName: last name in path,
      gadmParentPath: full path string,
      totalChildren,
      ownerRegionId,
      ownerRegionName,
      divisions: divisionsToMove.map(d => ({
        divisionId: d.division_id,
        name: d.division_name,
        fromRegionId: d.region_id,
        fromRegionName: children.find(c => c.id === d.region_id).name,
        memberRowId: d.member_row_id,
      })),
    })

  return { moves }
```

**Response:**
```json
{
  "moves": [
    {
      "gadmParentId": 456,
      "gadmParentName": "Chhattisgarh",
      "gadmParentPath": "Asia > India > Chhattisgarh",
      "totalChildren": 24,
      "ownerRegionId": 101,
      "ownerRegionName": "Eastern India",
      "divisions": [
        { "divisionId": 789, "name": "Balod", "fromRegionId": 102, "fromRegionName": "Western India", "memberRowId": 5001 },
        { "divisionId": 790, "name": "Durg", "fromRegionId": 102, "fromRegionName": "Western India", "memberRowId": 5002 },
        { "divisionId": 791, "name": "Rajnandgaon", "fromRegionId": 102, "fromRegionName": "Western India", "memberRowId": 5003 }
      ]
    }
  ]
}
```

If nothing found: `{ "moves": [] }`

### Apply-move endpoint

`POST /api/admin/wv-import/matches/:worldViewId/smart-simplify/apply-move`

**Request body:**
```json
{
  "parentRegionId": 100,
  "ownerRegionId": 101,
  "memberRowIds": [5001, 5002, 5003]
}
```

**Algorithm:**

Uses a dedicated client connection with `BEGIN`/`COMMIT`/`ROLLBACK` for the move transaction. Simplification runs post-commit in its own transaction (reusing `runSimplifyHierarchy`).

**Security:** Verify that each `memberRowId` belongs to a child region of `parentRegionId` within the specified world view. Reject the request if any member row does not belong.

```
function applySmartSimplifyMove(parentRegionId, ownerRegionId, memberRowIds, worldViewId):
  client = pool.connect()
  client.query('BEGIN')

  // Verify regions belong to world view
  verify parentRegionId and ownerRegionId exist in worldViewId

  // Verify all memberRowIds belong to children of parentRegionId
  childIds = client.query(
    SELECT id FROM regions WHERE parent_region_id = parentRegionId AND world_view_id = worldViewId
  )
  verification = client.query(
    SELECT id, region_id FROM region_members WHERE id = ANY(memberRowIds)
  )
  for each row in verification:
    if row.region_id not in childIds: return 400 "Member row does not belong to a child of this parent"

  // Collect source regions, then move all members
  affectedRegionIds = Set(verification.rows.map(r => r.region_id))
  affectedRegionIds.add(ownerRegionId)

  client.query(
    UPDATE region_members SET region_id = ownerRegionId WHERE id = ANY(memberRowIds)
  )

  client.query('COMMIT')
  client.release()

  // Post-commit: run simplify on the owner region (opens its own transaction)
  // If this fails, the moves are already committed — user sees "moved N, simplified 0"
  // which is an acceptable partial-success state (simplify can be re-run manually)
  simplifyResult = await runSimplifyHierarchy(ownerRegionId, worldViewId)

  // Invalidate geometries and sync match status for all affected regions
  for each regionId in affectedRegionIds:
    await invalidateRegionGeometry(regionId)
    await syncImportMatchStatus(regionId)

  return {
    moved: memberRowIds.length,
    simplification: simplifyResult
  }
```

**Response:**
```json
{
  "moved": 3,
  "simplification": {
    "replacements": [{ "parentName": "Chhattisgarh", "parentPath": "...", "replacedCount": 24 }],
    "totalReduced": 23
  }
}
```

### Zod schemas

In `backend/src/types/index.ts`:

```typescript
export const wvImportSmartSimplifySchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
});

export const wvImportSmartSimplifyApplySchema = z.object({
  parentRegionId: z.coerce.number().int().positive(),
  ownerRegionId: z.coerce.number().int().positive(),
  memberRowIds: z.array(z.number().int().positive()).min(1),
});
```

### Shared simplify logic

Extract the core simplification loop from the existing `simplifyHierarchy` endpoint into a reusable function:

```typescript
async function runSimplifyHierarchy(
  regionId: number,
  worldViewId: number,
): Promise<{ replacements: Array<{...}>; totalReduced: number }>
```

The existing `simplifyHierarchy` endpoint becomes a thin wrapper that calls `runSimplifyHierarchy`. The apply-move endpoint also calls it post-commit.

### File placement

- Controller: `backend/src/controllers/admin/wvImportTreeOpsController.ts` — new `detectSmartSimplify()` and `applySmartSimplifyMove()` exports, plus extracted `runSimplifyHierarchy()` helper
- Barrel: `backend/src/controllers/admin/worldViewImportController.ts` — add re-exports
- Routes: `backend/src/routes/adminRoutes.ts` — two new POST routes
- Validation: `backend/src/types/index.ts` — `wvImportSmartSimplifySchema` and `wvImportSmartSimplifyApplySchema`

## Frontend

### API client

New functions in `frontend/src/api/adminWvImportTreeOps.ts`:

```typescript
export interface SmartSimplifyMove {
  gadmParentId: number;
  gadmParentName: string;
  gadmParentPath: string;
  totalChildren: number;
  ownerRegionId: number;
  ownerRegionName: string;
  divisions: Array<{
    divisionId: number;
    name: string;
    fromRegionId: number;
    fromRegionName: string;
    memberRowId: number;
  }>;
}

export interface SmartSimplifyResult {
  moves: SmartSimplifyMove[];
}

export async function detectSmartSimplify(worldViewId: number, parentRegionId: number): Promise<SmartSimplifyResult>;

export async function applySmartSimplifyMove(
  worldViewId: number,
  parentRegionId: number,
  ownerRegionId: number,
  memberRowIds: number[],
): Promise<{ moved: number; simplification: SimplifyHierarchyResult }>;
```

Re-exported from `adminWorldViewImport.ts`.

### Button in TreeNodeActions

- **Position:** Among hierarchy action buttons (near merge/flatten)
- **Visibility:** Only when `hasChildren` — the node must be a parent with child regions
- **Icon:** A suitable MUI icon (e.g., `SwapHoriz` or `AutoFixNormal`)
- **Tooltip:** "Smart simplify — detect misplaced divisions across children"
- **On click:** Opens `SmartSimplifyDialog`

### SmartSimplifyDialog

A full-width MUI `Dialog`. New component file: `frontend/src/components/admin/SmartSimplifyDialog.tsx`.

**Layout:**
- Left panel (42%): Source map image (`regionMapUrl` of the parent region). Falls back to placeholder if none available.
- Right panel top: MapLibre map — all sibling divisions color-coded by owning region
  - Current/Proposed toggle. "Proposed" mode is computed client-side: divisions in the selected move are reassigned to the owner region's color.
  - Selected move's divisions highlighted with dashed red border
  - Non-relevant divisions dimmed
- Right panel bottom: Scrollable moves list
  - Each move shows: count + GADM parent name, from → to regions (color-coded), division names, simplification result
  - Click to select → highlights on map, shows Apply/Skip buttons
  - Applied moves: struck through, dimmed, "applied" badge

**Map data:**
- On open: calls `detectSmartSimplify` endpoint + fetches division geometries for display
- Uses `getChildrenRegionGeometry` admin endpoint (single call for all children) for the base color-coded view, plus individual division geometries for highlight via existing `fetchDivisionGeometry` from `frontend/src/api/regions.ts`
- Each division rendered as a GeoJSON polygon, colored by its owning sibling
- Color palette: use each child region's own `color` property, or generate distinct colors if not set

**State management:**
- `selectedMoveIndex: number | null` — which move is selected in the list
- `appliedGadmParentIds: Set<number>` — set of applied moves' gadmParentIds (survives re-ordering)
- `viewMode: 'current' | 'proposed'` — toggle state

**On Apply:**
1. Call `applySmartSimplifyMove` endpoint
2. Mark move as applied in local state (add gadmParentId to `appliedGadmParentIds`)
3. Update map: moved divisions now show in their new region's color
4. Invalidate tree query in background (so the tree updates when dialog closes)

**On close:** Tree already refreshed from invalidation during applies.

## Edge Cases

| Case | Behavior |
|------|----------|
| No children | Button hidden |
| All divisions already in correct siblings | Detection returns `{ moves: [] }`, dialog shows "Nothing to simplify" |
| GADM parent only partially present across all siblings | Not suggested (all children must be present) |
| Same GADM parent has members with custom_geom | Those members excluded from analysis |
| Division appears in multiple siblings (duplicates) | Count by sibling; owner is max count; duplicates in other siblings become move targets |
| Parent has no `regionMapUrl` | Left panel shows placeholder or falls back to ancestor's map |
| Move applied but another move becomes invalid | Each apply-move is independent. It moves members by row ID — if already moved, UPDATE is idempotent (sets region_id to ownerRegionId which it already is). Simplification may find nothing new, which is fine. |
| Tie in majority (e.g., 12 in Eastern, 12 in Western) | Pick the sibling with the lowest region ID (deterministic). User can skip if they disagree. |
| Apply-move succeeds but simplify fails | Partial success: divisions moved but not simplified. User can re-run simplify manually. Response still returns the move count. |
| memberRowIds don't belong to children of parentRegionId | Return 400 error. Security check prevents cross-world-view manipulation. |

## Testing

- Unit test: detection with 2 siblings, one GADM parent split across them → correct move suggested
- Unit test: detection with 3 siblings, divisions split 3 ways → majority owner identified
- Unit test: partial GADM coverage (not all children present) → no move suggested
- Unit test: all divisions in one sibling already → no move suggested (but simplify would work — button still useful)
- Unit test: apply-move moves members and runs simplification
- Unit test: apply-move rejects memberRowIds not belonging to children of parentRegionId
- Integration test: detect → apply → detect again → previously applied move no longer appears
- Manual test: India with Eastern/Western children, Chhattisgarh split → detect, apply, verify simplification
