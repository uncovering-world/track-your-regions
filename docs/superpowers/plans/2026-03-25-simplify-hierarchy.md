# Simplify Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Simplify hierarchy" button that recursively replaces sets of child GADM divisions with their parent when 100% coverage is detected.

**Architecture:** New backend endpoint in the wvImport tree-ops controller that loops over region members, groups by GADM parent, checks for complete coverage, and replaces atomically in a transaction. Frontend adds an icon button to matched nodes that triggers a mutation and shows a snackbar summary.

**Tech Stack:** Express, PostgreSQL, React, MUI, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-25-simplify-hierarchy-design.md`

---

### Task 1: Backend — Controller function

**Files:**
- Modify: `backend/src/controllers/admin/wvImportTreeOpsController.ts` (append new export)
- Modify: `backend/src/controllers/admin/worldViewImportController.ts` (add re-export)

- [ ] **Step 1: Add `simplifyHierarchy` function to `wvImportTreeOpsController.ts`**

Append this function at the end of the file, after the existing exports. It follows the same pattern as `mergeChildIntoParent` (pool.connect, BEGIN/COMMIT/ROLLBACK, verify region belongs to world view):

```typescript
/**
 * Simplify hierarchy by merging child divisions into parents when 100% coverage is found.
 * Recursive: keeps merging upward until no more simplifications possible.
 * POST /api/admin/wv-import/matches/:worldViewId/simplify-hierarchy
 */
export async function simplifyHierarchy(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/simplify-hierarchy — regionId=${regionId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region belongs to this world view
    const region = await client.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    const allReplacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> = [];

    // Recursive simplification loop
    for (;;) {
      // Get all full-coverage members (no custom_geom) with their GADM parent
      const members = await client.query(`
        SELECT rm.id AS member_id, rm.division_id, ad.parent_id
        FROM region_members rm
        JOIN administrative_divisions ad ON ad.id = rm.division_id
        WHERE rm.region_id = $1 AND rm.custom_geom IS NULL
      `, [regionId]);

      // Group by parent_id (skip nulls — root divisions can't merge further)
      const byParent = new Map<number, Array<{ memberId: number; divisionId: number }>>();
      for (const row of members.rows) {
        if (row.parent_id == null) continue;
        const parentId = row.parent_id as number;
        if (!byParent.has(parentId)) byParent.set(parentId, []);
        byParent.get(parentId)!.push({ memberId: row.member_id, divisionId: row.division_id });
      }

      // Check which parents are fully covered
      const replacements: Array<{ parentId: number; memberIds: number[]; count: number }> = [];
      for (const [parentId, children] of byParent) {
        const totalResult = await client.query(
          'SELECT count(*)::int AS cnt FROM administrative_divisions WHERE parent_id = $1',
          [parentId],
        );
        const totalChildren = totalResult.rows[0].cnt as number;
        if (children.length === totalChildren) {
          replacements.push({
            parentId,
            memberIds: children.map(c => c.memberId),
            count: children.length,
          });
        }
      }

      if (replacements.length === 0) break;

      // Execute replacements
      for (const rep of replacements) {
        // Delete child members
        await client.query(
          'DELETE FROM region_members WHERE id = ANY($1::int[])',
          [rep.memberIds],
        );

        // Check if parent is already a member (avoid duplicates)
        const existing = await client.query(
          'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
          [regionId, rep.parentId],
        );
        if (existing.rows.length === 0) {
          await client.query(
            'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)',
            [regionId, rep.parentId],
          );
        }

        // Build parent path using recursive ancestor query
        const pathResult = await client.query(`
          WITH RECURSIVE ancestors AS (
            SELECT id, name, parent_id, 1 AS depth
            FROM administrative_divisions WHERE id = $1
            UNION ALL
            SELECT ad.id, ad.name, ad.parent_id, a.depth + 1
            FROM administrative_divisions ad
            JOIN ancestors a ON ad.id = a.parent_id
          )
          SELECT name FROM ancestors ORDER BY depth DESC
        `, [rep.parentId]);
        const names = pathResult.rows.map(r => r.name as string);
        const parentPath = names.join(' > ');
        const parentName = names[names.length - 1];

        allReplacements.push({ parentName, parentPath, replacedCount: rep.count });
      }
    }

    await client.query('COMMIT');

    // Post-transaction: invalidate geometry and sync match status
    if (allReplacements.length > 0) {
      await invalidateRegionGeometry(regionId);
      await syncImportMatchStatus(regionId);
    }

    const totalReduced = allReplacements.reduce((sum, r) => sum + r.replacedCount, 0) - allReplacements.length;
    res.json({ replacements: allReplacements, totalReduced });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

**New imports needed** — the existing `wvImportTreeOpsController.ts` does NOT import these. Add at the top of the file alongside the existing imports:

```typescript
import { invalidateRegionGeometry } from '../worldView/helpers.js';
import { syncImportMatchStatus } from '../worldView/helpers.js';
```

Or combine into one import:

```typescript
import { invalidateRegionGeometry, syncImportMatchStatus } from '../worldView/helpers.js';
```

The relative path from `backend/src/controllers/admin/` to `backend/src/controllers/worldView/helpers.js` is `../worldView/helpers.js`. This is the same pattern used by `wvImportCoverageController.ts` which also imports `syncImportMatchStatus` from this path.

- [ ] **Step 2: Add re-export in barrel file**

In `backend/src/controllers/admin/worldViewImportController.ts`, update the tree-ops re-export line:

```typescript
// Change:
export { mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves } from './wvImportTreeOpsController.js';
// To:
export { mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves, simplifyHierarchy } from './wvImportTreeOpsController.js';
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportTreeOpsController.ts backend/src/controllers/admin/worldViewImportController.ts
git commit -m "feat: add simplifyHierarchy controller for recursive division merging"
```

---

### Task 2: Backend — Route wiring

**Files:**
- Modify: `backend/src/routes/adminRoutes.ts` (add route + import)

- [ ] **Step 1: Add route**

In `backend/src/routes/adminRoutes.ts`:

1. Add `simplifyHierarchy` to the import from `worldViewImportController.js` (find the `// Tree ops` comment line in the import block and add it there):

```typescript
  // Tree ops
  mergeChildIntoParent, removeRegionFromImport, dismissChildren, pruneToLeaves, simplifyHierarchy,
```

2. Add the route near the other tree-ops routes (after the `merge-child` route around line 436):

```typescript
router.post('/wv-import/matches/:worldViewId/simplify-hierarchy', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), simplifyHierarchy);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p backend/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/adminRoutes.ts
git commit -m "feat: wire simplify-hierarchy route in adminRoutes"
```

---

### Task 3: Frontend — API client function

**Files:**
- Modify: `frontend/src/api/adminWvImportTreeOps.ts` (add new function)

- [ ] **Step 1: Add `simplifyHierarchy` function to `adminWvImportTreeOps.ts`**

Append to `frontend/src/api/adminWvImportTreeOps.ts`:

```typescript
// =============================================================================
// Simplify Hierarchy
// =============================================================================

export interface SimplifyHierarchyResult {
  replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }>;
  totalReduced: number;
}

export async function simplifyHierarchy(
  worldViewId: number,
  regionId: number,
): Promise<SimplifyHierarchyResult> {
  return authFetchJson(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/simplify-hierarchy`,
    { method: 'POST', body: JSON.stringify({ regionId }) },
  );
}
```

- [ ] **Step 2: Add re-export in `adminWorldViewImport.ts`**

All tree-ops functions are re-exported from `frontend/src/api/adminWorldViewImport.ts` for backward compatibility. The hook (`useTreeMutations.ts`) imports everything from `adminWorldViewImport`, not directly from `adminWvImportTreeOps`. Add to the existing re-export blocks:

In the `export { ... } from './adminWvImportTreeOps'` block (around line 339-360), add:

```typescript
  simplifyHierarchy,
```

In the `export type { ... } from './adminWvImportTreeOps'` block (around line 361-367), add:

```typescript
  SimplifyHierarchyResult,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/adminWvImportTreeOps.ts frontend/src/api/adminWorldViewImport.ts
git commit -m "feat: add simplifyHierarchy API client function"
```

---

### Task 4: Frontend — Mutation in useTreeMutations

**Files:**
- Modify: `frontend/src/components/admin/useTreeMutations.ts`

- [ ] **Step 1: Add import**

Add `simplifyHierarchy` to the existing import from `adminWorldViewImport` (where all other tree-ops functions are imported). Find the import block from `'../../api/adminWorldViewImport'` and add `simplifyHierarchy` to it:

```typescript
  simplifyHierarchy,
```

Also add the type import if needed for the onSuccess handler:

```typescript
  type SimplifyHierarchyResult,
```

- [ ] **Step 2: Add mutation**

After the `clearMembersMutation` definition (around line 393), add:

```typescript
  const simplifyHierarchyMutation = useMutation({
    mutationFn: (regionId: number) => simplifyHierarchy(worldViewId, regionId),
    onSuccess: (_data, regionId) => invalidateTree(regionId),
  });
```

- [ ] **Step 3: Add to isMutating aggregate**

In the `isMutating` const (around line 603), add `simplifyHierarchyMutation.isPending ||` to the chain.

- [ ] **Step 4: Add to return object**

In the return object (around line 614), add `simplifyHierarchyMutation,` alongside the other mutations.

- [ ] **Step 5: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/useTreeMutations.ts
git commit -m "feat: add simplifyHierarchy mutation to useTreeMutations"
```

---

### Task 5: Frontend — Button in TreeNodeActions + wiring

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeActions.tsx` (add button + props)
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx` (pass props through)
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx` (wire mutation)

- [ ] **Step 1: Add props and button to TreeNodeActions**

1. Add icon import at the top (with the other `@mui/icons-material` imports):

```typescript
  LowPriority as SimplifyIcon,
```

(`LowPriority` looks like stacked items being consolidated — fits the "simplify" concept.)

2. Add to `TreeNodeActionsProps` interface (after `onClearMembers` / `clearingMembersRegionId`):

```typescript
  onSimplifyHierarchy?: (regionId: number) => void;
  simplifyingRegionId?: number | null;
```

3. Destructure in the component (add to the destructuring block).

4. Add the button JSX just before the "Clear all assigned divisions" block (before the `{/* Clear all assigned divisions */}` comment, around line 656):

```tsx
      {/* Simplify hierarchy — merge child divisions into parents */}
      {node.assignedDivisions.length >= 2
        && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched')
        && onSimplifyHierarchy && (
        <Tooltip title="Simplify — merge child divisions into parents where all children are assigned">
          <span>
            <IconButton
              size="small"
              onClick={() => onSimplifyHierarchy(node.id)}
              disabled={isMutating || simplifyingRegionId != null}
              sx={{ p: 0.25 }}
            >
              {simplifyingRegionId === node.id
                ? <CircularProgress size={14} />
                : <SimplifyIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}
```

- [ ] **Step 2: Pass through TreeNodeRow**

In `frontend/src/components/admin/TreeNodeRow.tsx`:

1. Add to the props interface (after `clearingMembersRegionId`):

```typescript
  onSimplifyHierarchy?: (regionId: number) => void;
  simplifyingRegionId?: number | null;
```

2. Add to the `arePropsEqual` function — add a check like the existing `clearingMembersRegionId` one:

```typescript
  if ((prev.simplifyingRegionId === id) !== (next.simplifyingRegionId === id)) return false;
```

3. Add to the destructured props list.

4. Pass to `<TreeNodeActions>`:

```tsx
  onSimplifyHierarchy={onSimplifyHierarchy}
  simplifyingRegionId={simplifyingRegionId}
```

- [ ] **Step 3: Wire in WorldViewImportTree**

In `frontend/src/components/admin/WorldViewImportTree.tsx`:

1. Add `simplifyHierarchyMutation` to the destructuring from `useTreeMutations` (around line 134).

2. Add a snackbar state for the result. After existing snackbar-related state, add:

```typescript
  const [simplifySnackbar, setSimplifySnackbar] = useState<string | null>(null);
```

3. Add a handler that calls the mutation and sets the snackbar on success. Add near the other handler definitions:

```typescript
  const handleSimplifyHierarchy = useCallback((regionId: number) => {
    simplifyHierarchyMutation.mutate(regionId, {
      onSuccess: (data) => {
        if (data.replacements.length === 0) {
          setSimplifySnackbar('Nothing to simplify');
        } else {
          const summary = data.replacements
            .map(r => `${r.parentName} (${r.replacedCount} → 1)`)
            .join(', ');
          setSimplifySnackbar(`Simplified: ${summary}`);
        }
      },
    });
  }, [simplifyHierarchyMutation]);
```

4. Pass to `<TreeNodeRow>` in the render (alongside the existing `onClearMembers` prop):

```tsx
  onSimplifyHierarchy={handleSimplifyHierarchy}
  simplifyingRegionId={simplifyHierarchyMutation.isPending ? (simplifyHierarchyMutation.variables ?? null) : null}
```

5. Add a `<Snackbar>` for the simplify result (alongside the existing snackbars):

```tsx
  <Snackbar
    open={simplifySnackbar !== null}
    autoHideDuration={6000}
    onClose={() => setSimplifySnackbar(null)}
    message={simplifySnackbar}
  />
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`
Expected: No lint or type errors

- [ ] **Step 5: Run knip**

Run: `cd /home/nikolay/projects/track-your-regions && npm run knip`
Expected: No new unused exports/files

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/TreeNodeActions.tsx frontend/src/components/admin/TreeNodeRow.tsx frontend/src/components/admin/WorldViewImportTree.tsx
git commit -m "feat: add Simplify Hierarchy button to review dialog

Adds a button on matched region nodes (2+ assigned divisions) that
recursively merges child divisions into their parent when 100% GADM
coverage is detected. Shows snackbar summary of changes."
```

---

### Task 6: Pre-commit checks

**Files:** None (validation only)

- [ ] **Step 1: Run full check suite**

```bash
cd /home/nikolay/projects/track-your-regions
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

Expected: All pass with no new errors.

- [ ] **Step 2: Run `/security-check`**

Run the Claude Code security review on changed files.

- [ ] **Step 3: Fix any issues found, commit fixes**
