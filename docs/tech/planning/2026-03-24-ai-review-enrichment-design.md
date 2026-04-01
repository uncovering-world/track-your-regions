# AI Review Enrichment — Design

**Date**: 2026-03-24
**Status**: Approved

## Problem

The AI hierarchy review system receives only `[status]` tags per node. It lacks visibility into:
- How many GADM divisions are assigned to each node
- Whether a container's children are matched
- The intermediate matching workflow (container-first, then children)

This causes false positives (flagging valid intermediate states) and missed insights (can't suggest GADM assignments for uncovered containers).

### Example: China subtree

```
Northwest China (5 children) [manual_matched]   ← AI flags as inconsistent (children are no_candidates)
  Gansu [no_candidates]                          ← Actually fine: container has 6 GADM members, children next
```

```
East China (4 children) [no_candidates]          ← AI should flag: all children matched, status stale
  Fujian [manual_matched]
  Jiangsu [manual_matched]
  Shanghai [manual_matched]
  Zhejiang [manual_matched]
```

## Solution: Approach A — Enrich Tree Text Inline

### 1. Data Enrichment

Add two fields to each tree node's text annotation:

**Before:**
```
East China (4 children) [no_candidates]
```

**After:**
```
East China (4 children) [no_candidates] {members:0, matched:4/4}
Northwest China (5 children) [manual_matched] {members:6, matched:0/5}
Fujian (3 children) [manual_matched] {members:1}
Heilongjiang [no_candidates]
```

| Field | Meaning | Source | Cost |
|---|---|---|---|
| `members:N` | GADM divisions directly assigned | `COUNT` subquery on `region_members` in existing CTE | ~0 |
| `matched:X/Y` | Resolved children / total children | Bottom-up JS pass (piggyback on existing `leaf_count` loop) | ~0 |

Leaf nodes with no members omit the annotation entirely. Leaf nodes with members show only `{members:N}`.

#### `TreeRow` interface change

```typescript
interface TreeRow {
  // ... existing fields ...
  member_count: number;      // NEW
  matched_children: number;  // NEW: computed in JS
}
```

#### `queryTree` SQL change

Add subquery to both seed and recursive SELECT:

```sql
(SELECT COUNT(*)::int FROM region_members rm WHERE rm.region_id = r.id) AS member_count
```

#### Initialization in `rows.map()`

Add `matched_children: 0` alongside existing `leaf_count: 0, max_depth: 0`:

```typescript
const rows: TreeRow[] = result.rows.map((r) => ({
  // ... existing fields ...
  member_count: r.member_count as number,   // NEW: from SQL
  matched_children: 0,                       // NEW: computed below
}));
```

#### Bottom-up pass change

In the existing loop that computes `leaf_count` and `max_depth`:

```typescript
if (row.parent_id != null) {
  const parent = byId.get(row.parent_id);
  if (parent) {
    parent.leaf_count += row.leaf_count;
    parent.max_depth = Math.max(parent.max_depth, row.max_depth + 1);
    // NEW: count resolved direct children (not all descendants)
    const resolved = ['auto_matched', 'manual_matched', 'children_matched'].includes(row.match_status);
    if (resolved) parent.matched_children++;
  }
}
```

Note: `matched_children` only counts **direct** children (one level), not all descendants. Each row increments its own parent's counter exactly once in this loop, which is correct because the CTE returns parent-child relationships.

#### `formatTreeText` change

Append annotation after status tag:

```typescript
const annotation = node.child_count > 0
  ? ` {members:${node.member_count}, matched:${node.matched_children}/${node.child_count}}`
  : node.member_count > 0 ? ` {members:${node.member_count}}` : '';
```

### 2. `children_matched` Auto-Promotion

**Bug**: When children are manually matched one-by-one via `acceptMatch()`, the parent status never updates to `children_matched`. Only bulk operations (`autoResolveChildren`, `matchChildrenAsCountries`) do this.

**Fix**: A shared helper `maybePromoteParent(regionId)` called after any status-changing operation.

#### Logic

```typescript
async function maybePromoteParent(regionId: number): Promise<void> {
  // 1. Find parent, count total children vs resolved children vs parent members
  // 2. If total == resolved AND parent has no direct members → promote to children_matched
  // 3. Recurse up: if parent was promoted, check grandparent too
}
```

#### Rules

- Only promotes if parent has **no direct GADM members** (member_count = 0). If container has its own assignments, it stays `manual_matched` (valid intermediate state)
- Only promotes if **all** direct children are resolved
- Recursive upward: promoting East China might make China eligible too
- Does NOT demote on un-match (different operation)

#### SQL check

```sql
SELECT
  p.id AS parent_id,
  (SELECT COUNT(*)::int FROM regions c WHERE c.parent_region_id = p.id) AS total_children,
  (SELECT COUNT(*)::int FROM regions c
   JOIN region_import_state ris ON ris.region_id = c.id
   WHERE c.parent_region_id = p.id
   AND ris.match_status IN ('auto_matched', 'manual_matched', 'children_matched')
  ) AS resolved_children,
  (SELECT COUNT(*)::int FROM region_members rm WHERE rm.region_id = p.id) AS parent_members
FROM regions r
JOIN regions p ON p.id = r.parent_region_id
WHERE r.id = $1
```

#### Call sites in `wvImportMatchController.ts`

Only call `maybePromoteParent` when the child reaches a **resolved** status — not when it stays `needs_review`:

1. `acceptMatch()` — **only when `newStatus === 'manual_matched'`** (i.e., no remaining suggestions). When `needs_review`, the child is not resolved so promotion is impossible.
2. `acceptAndRejectRest()` — after setting `manual_matched` (always resolves)
3. `acceptBatchMatches()` — after the batch loop, for each region that reached `manual_matched`

Not called from `rejectMatch()` / `rejectRemaining()` — rejecting moves status to `no_candidates` or keeps `manual_matched`, neither of which would newly promote a parent.

#### Excluded: `clearMembers()`

`clearMembers()` sets a child back to `no_candidates`, which could make a parent's `children_matched` status stale. However, auto-demotion is explicitly out of scope (see below). The `clearMembers` endpoint is a deliberate admin action; the admin can manually adjust the parent status afterward.

### 3. Prompt Updates

#### 3a. Add annotation format explanation to `SYSTEM_CONTEXT`

```
DATA ANNOTATIONS (shown in curly braces):
- {members:N} — Number of GADM administrative divisions directly assigned to this node.
  A container with members:6 has territory coverage at the container level.
  A leaf with members:1 has a confirmed GADM match.
  members:0 means no GADM divisions assigned yet.
- {matched:X/Y} — How many of the node's direct children have a resolved match status
  (auto_matched, manual_matched, or children_matched) out of total children.
  Example: {matched:4/4} means all children are matched.
  Example: {matched:1/3} means only 1 of 3 children has a match.
```

#### 3b. Explain intermediate workflow in "ABOUT THE DATA"

```
MATCHING WORKFLOW:
Matching proceeds top-down. Admins often assign GADM divisions to a container FIRST
(making it [manual_matched] with members:N), then match its children individually as a
second step. This is normal — it enables coverage tracking and computer-vision matching
for the container while children are still being resolved.

So a container showing [manual_matched] {members:6, matched:0/5} is NOT inconsistent —
it means "container territory is covered, children matching is in progress."

A container showing [no_candidates] {members:0, matched:4/4} IS inconsistent — all
children are matched but the container status wasn't updated. Recommend updating status
to [children_matched].

A container showing [no_candidates] {members:0, matched:1/3} needs attention — neither
the container itself has GADM coverage nor are its children fully matched. Recommend
assigning GADM divisions to the container to enable coverage tracking.
```

#### 3c. New action types in `ACTION_TYPES_SCHEMA`

```
- "assign_divisions": Suggest assigning GADM divisions to a container that has none.
  params: { "reason": "string" }. Description should explain WHY (enable coverage
  tracking, fill gap) and suggest which provinces/divisions to look for based on
  travel knowledge. The admin will use the search/match tools to find the right
  GADM entries.
- "update_status": Flag a status that should be corrected.
  params: { "expectedStatus": "string" }. Description should explain why current
  status is wrong.
```

#### 3d. Updated check #3 in PASS2 and SUBTREE prompts

Replace:
```
3. **Match status inconsistencies** — e.g., a container showing [no_candidates] when all children are matched (should be [children_matched])
```

With:
```
3. **Match status & coverage gaps** — Check the {members:N, matched:X/Y} annotations:
   - Container with matched:X/X (all children resolved) but status is NOT [children_matched] → suggest update_status
   - Container with members:0 AND matched far from complete → suggest assign_divisions to enable coverage tracking
   - Container with [manual_matched] but members:0 → unexpected, flag it
   - Do NOT flag containers with [manual_matched] + members:N + low matched ratio — that's normal intermediate state
```

## Files Modified

| File | Change |
|---|---|
| `backend/src/controllers/admin/aiHierarchyReviewController.ts` | `TreeRow` interface, `queryTree` SQL, bottom-up pass, `formatTreeText`, all 3 prompts, `ACTION_TYPES_SCHEMA` |
| `backend/src/controllers/admin/wvImportMatchController.ts` | Add `maybePromoteParent()`, call from 5 accept/reject functions |

## Not In Scope

- Geometric coverage % in AI context (expensive PostGIS operation, child-match ratio provides sufficient insight)
- Auto-demotion when children are unmatched via `clearMembers()` (separate feature — admin can adjust parent status manually)
- Changes to the frontend tree UI (already shows coverage separately)

## Edge Cases

- **`dismissed` status**: Not in the `MatchStatus` type union (`types.ts` defines only 6 values). The `[dismissed]` mention in the AI prompt describes a conceptual state. `manual_fix_needed` is a separate boolean column (`needs_manual_fix`), not a `match_status` value. So the resolved set `['auto_matched', 'manual_matched', 'children_matched']` is complete.
- **Regions with no `region_import_state` row**: The CTE already handles this via `COALESCE(ris.match_status, 'no_candidates')`. The `member_count` subquery on `region_members` will return 0 for these.
