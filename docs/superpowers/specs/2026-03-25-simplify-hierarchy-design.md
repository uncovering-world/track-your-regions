# Simplify Hierarchy — Design Spec

## Problem

After auto-matching, regions often end up with many low-level GADM divisions (e.g., 50+ districts) when those divisions actually constitute complete higher-level divisions (e.g., states). For example, "Eastern India" might have all 24 districts of Chhattisgarh and all 18 districts of Jharkhand assigned individually. The user wants to replace those with the parent-level divisions.

## Solution

A single "Simplify hierarchy" button on matched region nodes in the Review dialog. When clicked, the backend detects which sets of assigned divisions fully cover a parent division, replaces them atomically, and repeats recursively until no more simplifications are possible. A snackbar summarizes what changed.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Replacement strategy | Atomic — remove children, add parent | Simplest; user can undo via clear + re-match |
| Hierarchy depth | Recursive — keep merging upward | Handles multi-level simplification in one click |
| Presentation | Apply all at once, show toast summary | Fast workflow, no extra dialog |
| Custom geometry | Skip — only merge when ALL children are full members (no `custom_geom`) | Ensures truly 100% coverage |
| Scope | Review dialog only | Not needed elsewhere |

## Backend

### New endpoint

`POST /api/admin/wv-import/matches/:worldViewId/simplify-hierarchy`

**Request body:**
```json
{ "regionId": 123 }
```

**Response:**
```json
{
  "replacements": [
    { "parentName": "Chhattisgarh", "parentPath": "Asia > India > Chhattisgarh", "replacedCount": 24 },
    { "parentName": "Jharkhand", "parentPath": "Asia > India > Jharkhand", "replacedCount": 18 }
  ],
  "totalReduced": 40
}
```

If nothing to simplify:
```json
{ "replacements": [], "totalReduced": 0 }
```

### Algorithm

```
function simplifyHierarchy(regionId):
  loop:
    members = SELECT rm.id, rm.division_id, ad.parent_id
              FROM region_members rm
              JOIN administrative_divisions ad ON ad.id = rm.division_id
              WHERE rm.region_id = regionId AND rm.custom_geom IS NULL

    group members by ad.parent_id (skip NULL parents — root divisions)

    replacements = []
    for each (parentId, childMembers) in groups:
      totalChildren = SELECT count(*) FROM administrative_divisions WHERE parent_id = parentId
      if childMembers.length == totalChildren:
        replacements.push({ parentId, memberIdsToRemove: childMembers.map(m => m.id) })

    if replacements is empty: break

    for each replacement:
      DELETE FROM region_members WHERE id IN (memberIdsToRemove)
      INSERT INTO region_members (region_id, division_id) VALUES (regionId, parentId)

    record replacement info for response

  invalidateRegionGeometry(regionId)
  syncImportMatchStatus(regionId)
  return accumulated replacements
```

All operations run in a single database transaction.

### File placement

- Controller: `backend/src/controllers/worldView/regionMemberMutations.ts` — new `simplifyHierarchy()` function
- Route: `backend/src/routes/adminRoutes.ts` — new POST route
- Validation: Zod schema for `{ regionId: z.number() }`

## Frontend

### API client

New function in `frontend/src/api/adminWvImportTreeOps.ts`:

```typescript
export async function simplifyHierarchy(
  worldViewId: number,
  regionId: number,
): Promise<{
  replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }>;
  totalReduced: number;
}> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/simplify-hierarchy`,
    { method: 'POST', body: JSON.stringify({ regionId }) },
  );
}
```

### Button in TreeNodeActions

- **Position:** Next to the "Clear all assigned divisions" button (before it)
- **Visibility:** Only when `node.assignedDivisions.length >= 2` and node is matched (`auto_matched` or `manual_matched`)
- **Icon:** `AccountTree` (already imported) or a new merge-up icon
- **Tooltip:** "Simplify hierarchy — merge child divisions into parents where possible"
- **Loading state:** Spinner while request in flight, disable other mutation buttons

### Props threading

- New callback: `onSimplifyHierarchy?: (regionId: number) => void`
- New loading state: `simplifyingRegionId?: number | null`
- Wired through `WorldViewImportTree.tsx` → `TreeNodeRow.tsx` → `TreeNodeActions.tsx`

### Mutation handler in WorldViewImportTree

- Uses `useMutation` from TanStack Query
- On success: invalidates match tree query, shows snackbar with summary
- Snackbar message: "Simplified: Chhattisgarh (24 -> 1), Jharkhand (18 -> 1)" or "Nothing to simplify" if no replacements

## Edge Cases

| Case | Behavior |
|------|----------|
| No full-coverage members | Return `{ replacements: [], totalReduced: 0 }`, snackbar says "Nothing to simplify" |
| All members have `custom_geom` | Same as above — nothing qualifies |
| Region has mix of full + custom members | Only full members participate in merge detection |
| Root-level divisions (no parent) | Skipped — cannot merge further |
| Single member | Button hidden (need >= 2) |
| Recursive: after first pass creates new complete parent | Next iteration catches it |

## Testing

- Unit test: mock DB responses, verify correct grouping and replacement logic
- Manual test: import Eastern India with district-level matches, click simplify, verify districts collapse to states
