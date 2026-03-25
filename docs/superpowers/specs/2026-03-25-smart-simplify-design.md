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

Uses a dedicated client connection with explicit transaction (`BEGIN`/`COMMIT`/`ROLLBACK`).

**Pre-check:** Verify `parentRegionId` belongs to `worldViewId` and has children.

```
function detectSmartSimplifyMoves(parentRegionId, worldViewId):
  client = pool.connect()

  // 1. Get all child regions
  children = client.query(
    SELECT id, name FROM regions
    WHERE parent_region_id = parentRegionId AND world_view_id = worldViewId
  )

  // 2. For each child, get full-coverage members with GADM parent
  allMembers = []
  for each child in children:
    members = client.query(
      SELECT rm.id AS member_row_id, rm.division_id, rm.region_id,
             ad.parent_id AS gadm_parent_id, ad.name AS division_name
      FROM region_members rm
      JOIN administrative_divisions ad ON ad.id = rm.division_id
      WHERE rm.region_id = child.id AND rm.custom_geom IS NULL
    )
    allMembers.push(...members)

  // 3. Group by GADM parent (skip nulls)
  byGadmParent = group allMembers by gadm_parent_id

  // 4. For each GADM parent, check if ALL children are present across siblings
  moves = []
  for each (gadmParentId, members) in byGadmParent:
    totalChildren = client.query(
      SELECT count(*)::int FROM administrative_divisions WHERE parent_id = gadmParentId
    )
    if members.length != totalChildren: continue  // not complete — skip

    // Check if split across multiple sibling regions
    byRegion = group members by region_id
    if byRegion.size <= 1: continue  // all in one sibling — just simplify, no moves needed

    // Find owner (sibling with the most)
    ownerRegionId = region with max count in byRegion
    ownerRegionName = children.find(c => c.id === ownerRegionId).name

    // Divisions in other siblings are the move suggestions
    divisionsToMove = members where region_id != ownerRegionId

    // Build GADM parent path
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

  client.release()
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

Uses a dedicated client connection with `BEGIN`/`COMMIT`/`ROLLBACK`.

```
function applySmartSimplifyMove(parentRegionId, ownerRegionId, memberRowIds, worldViewId):
  client = pool.connect()
  client.query('BEGIN')

  // Verify regions belong to world view
  verify parentRegionId and ownerRegionId exist in worldViewId

  // Move each member to the owner region
  affectedRegionIds = Set()
  for each memberRowId in memberRowIds:
    result = client.query(
      UPDATE region_members SET region_id = ownerRegionId
      WHERE id = memberRowId RETURNING region_id  -- old region_id from before update? No — need to capture source first
    )
    // Actually: get the source region before moving
    source = client.query(SELECT region_id FROM region_members WHERE id = memberRowId)
    affectedRegionIds.add(source.region_id)
    client.query(UPDATE region_members SET region_id = ownerRegionId WHERE id = memberRowId)

  affectedRegionIds.add(ownerRegionId)

  client.query('COMMIT')

  // Post-transaction: run simplify on the owner region
  // (reuse the simplifyHierarchy logic but as a function, not an endpoint)
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

### File placement

- Controller: `backend/src/controllers/admin/wvImportTreeOpsController.ts` — new `detectSmartSimplify()` and `applySmartSimplifyMove()` exports
- Barrel: `backend/src/controllers/admin/worldViewImportController.ts` — add re-exports
- Routes: `backend/src/routes/adminRoutes.ts` — two new POST routes
- Validation: New Zod schemas for both request bodies in `backend/src/types/index.ts`
- Shared logic: Extract the core simplification loop from `simplifyHierarchy` into a reusable function (e.g., `runSimplifyHierarchy(regionId, worldViewId, client?)`) so both the standalone simplify endpoint and the apply-move endpoint can use it

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

A full-width MUI `Dialog` (like `DivisionPreviewDialog`).

**Layout:**
- Left panel (42%): Source map image (`regionMapUrl` of the parent region)
- Right panel top: MapLibre map — all sibling divisions color-coded by owning region
  - Current/Proposed toggle
  - Selected move's divisions highlighted with dashed red border
  - Non-relevant divisions dimmed
- Right panel bottom: Scrollable moves list
  - Each move shows: count + GADM parent name, from → to regions (color-coded), division names, simplification result
  - Click to select → highlights on map, shows Apply/Skip buttons
  - Applied moves: struck through, dimmed, "applied" badge

**Map data:**
- On open: calls `detectSmartSimplify` endpoint + fetches `getRegionMemberGeometries` for each child region
- Each division rendered as a GeoJSON polygon, colored by its owning sibling
- Color palette: use each child region's own `color` property, or generate distinct colors if not set

**State management:**
- `selectedMoveIndex: number | null` — which move is selected in the list
- `appliedMoves: Set<number>` — indices of applied moves (by gadmParentId)
- `viewMode: 'current' | 'proposed'` — toggle state

**On Apply:**
1. Call `applySmartSimplifyMove` endpoint
2. Mark move as applied in local state (struck through)
3. Update map: in "current" view, moved divisions now show in their new region's color
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
| Move applied but another move becomes invalid | Each apply-move is independent. If user applies move A and that somehow affects move B's validity, the apply-move endpoint will still work (it just moves members by row ID). The simplification step may find nothing new to simplify, which is fine. |
| Tie in majority (e.g., 12 districts in Eastern, 12 in Western) | Pick the first sibling alphabetically (or by region ID). The user can skip if they disagree. |

## Testing

- Unit test: detection with 2 siblings, one GADM parent split across them → correct move suggested
- Unit test: detection with 3 siblings, divisions split 3 ways → majority owner identified
- Unit test: partial GADM coverage (not all children present) → no move suggested
- Unit test: all divisions in one sibling already → no move suggested
- Unit test: apply-move moves members and runs simplification
- Manual test: India with Eastern/Western children, Chhattisgarh split → detect, apply, verify simplification
