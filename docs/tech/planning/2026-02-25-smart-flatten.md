# Smart Flatten Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Smart Flatten" button that auto-matches a region's children to GADM divisions, then absorbs all descendant divisions into the parent and deletes descendants — turning the parent into a leaf with full GADM coverage.

**Architecture:** New backend endpoint `POST .../smart-flatten` in the controller that: (1) auto-matches unmatched descendants via trigram search, (2) blocks if any remain unmatched, (3) absorbs divisions + deletes descendants in a transaction with undo support. Frontend adds a button to TreeNodeActions + mutation in WorldViewImportTree.

**Tech Stack:** Express backend, PostgreSQL (trigram similarity), React/MUI frontend, TanStack Query mutations

**Design doc:** `docs/tech/planning/smart-flatten-design.md`

---

### Task 1: Export `trigramSearch` from aiMatcher.ts

The `trigramSearch` function (line 333 in `backend/src/services/worldViewImport/aiMatcher.ts`) is currently private. The smart flatten handler needs it to auto-match unmatched descendants.

**Files:**
- Modify: `backend/src/services/worldViewImport/aiMatcher.ts:333`

**Step 1: Export trigramSearch**

Change `async function trigramSearch(` to `export async function trigramSearch(` on line 333.

**Step 2: Verify**

Run: `npm run check`

---

### Task 2: Backend handler — `smartFlatten`

**Files:**
- Modify: `backend/src/controllers/admin/worldViewImportController.ts`

**Step 1: Add 'smart-flatten' to UndoEntry type**

At line 48, change:
```typescript
operation: 'dismiss-children' | 'handle-as-grouping';
```
to:
```typescript
operation: 'dismiss-children' | 'handle-as-grouping' | 'smart-flatten';
```

**Step 2: Import trigramSearch**

Add `trigramSearch` to the import from `aiMatcher.js` (line 75–82):
```typescript
import {
  startAIMatching,
  getAIMatchProgress,
  cancelAIMatch,
  aiMatchSingleRegion,
  dbSearchSingleRegion,
  geocodeMatchRegion,
  trigramSearch,
} from '../../services/worldViewImport/aiMatcher.js';
```

**Step 3: Add the handler**

Add after the `dismissChildren` handler (after line ~1110). The handler follows the exact same pattern as `dismissChildren` — same client transaction, same snapshot structure, same undo entry format.

```typescript
/**
 * Smart flatten: auto-match children → absorb all descendant divisions into parent → delete descendants.
 * POST /api/admin/wv-import/matches/:worldViewId/smart-flatten
 */
export async function smartFlatten(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId } = req.body;
  console.log(`[WV Import] POST /matches/${worldViewId}/smart-flatten — regionId=${regionId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify region belongs to this world view and has children
    const region = await client.query(
      'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      res.status(404).json({ error: 'Region not found in this world view' });
      return;
    }

    // Get all descendant region IDs (recursive)
    const descendants = await client.query(`
      WITH RECURSIVE desc_regions AS (
        SELECT id, name FROM regions WHERE parent_region_id = $1
        UNION ALL
        SELECT r.id, r.name FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
      )
      SELECT id, name FROM desc_regions
    `, [regionId]);

    if (descendants.rows.length === 0) {
      res.status(400).json({ error: 'Region has no children to flatten' });
      return;
    }

    const descendantIds = descendants.rows.map(r => r.id as number);

    // Phase 1: Auto-match unmatched descendants
    // Find which descendants have no region_members
    const membersCheck = await client.query(
      `SELECT DISTINCT region_id FROM region_members WHERE region_id = ANY($1)`,
      [descendantIds],
    );
    const matchedIds = new Set(membersCheck.rows.map(r => r.region_id as number));
    const unmatchedDescendants = descendants.rows.filter(r => !matchedIds.has(r.id as number));

    // Try trigram search for each unmatched descendant
    // Release client temporarily — trigramSearch uses pool
    await client.query('COMMIT');
    client.release();

    const stillUnmatched: Array<{ id: number; name: string }> = [];
    for (const desc of unmatchedDescendants) {
      const descId = desc.id as number;
      const descName = desc.name as string;
      const candidates = await trigramSearch(descName, 3);

      if (candidates.length === 1 && candidates[0].similarity >= 0.5) {
        // Single confident match — auto-assign
        await pool.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [descId, candidates[0].divisionId],
        );
        await pool.query(
          `INSERT INTO region_import_state (region_id, match_status)
           VALUES ($1, 'auto_matched')
           ON CONFLICT (region_id) DO UPDATE SET match_status = 'auto_matched'`,
          [descId],
        );
      } else if (candidates.length > 1 && candidates[0].similarity >= 0.7
        && candidates[0].similarity - candidates[1].similarity >= 0.15) {
        // Top candidate is clearly dominant — auto-assign
        await pool.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [descId, candidates[0].divisionId],
        );
        await pool.query(
          `INSERT INTO region_import_state (region_id, match_status)
           VALUES ($1, 'auto_matched')
           ON CONFLICT (region_id) DO UPDATE SET match_status = 'auto_matched'`,
          [descId],
        );
      } else {
        stillUnmatched.push({ id: descId, name: descName });
      }
    }

    // Phase 2: Block if any remain unmatched
    if (stillUnmatched.length > 0) {
      res.status(400).json({
        error: 'Cannot flatten: some children have no GADM match',
        unmatched: stillUnmatched,
      });
      return;
    }

    // Phase 3: Snapshot + flatten (new transaction)
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');

      // Re-fetch descendant IDs (same set, just need fresh connection)
      // Snapshot parent import state + members
      const parentImportStateResult = await client2.query(
        `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
                region_map_url, map_image_reviewed, import_run_id
         FROM region_import_state WHERE region_id = $1`,
        [regionId],
      );
      const parentImportState = parentImportStateResult.rows.length > 0
        ? parentImportStateResult.rows[0] as ImportStateSnapshot
        : null;
      const parentMembersResult = await client2.query(
        'SELECT region_id, division_id FROM region_members WHERE region_id = $1',
        [regionId],
      );

      // Snapshot all descendants (same queries as dismissChildren)
      const descRegionsResult = await client2.query(
        `SELECT id, name, parent_region_id, is_leaf, world_view_id
         FROM regions WHERE id = ANY($1) ORDER BY id`,
        [descendantIds],
      );
      const descImportStatesResult = await client2.query(
        `SELECT region_id, match_status, needs_manual_fix, fix_note, source_url, source_external_id,
                region_map_url, map_image_reviewed, import_run_id
         FROM region_import_state WHERE region_id = ANY($1)`,
        [descendantIds],
      );
      const descSuggestionsResult = await client2.query(
        `SELECT region_id, division_id, name, path, score, rejected
         FROM region_match_suggestions WHERE region_id = ANY($1)`,
        [descendantIds],
      );
      const descMembersResult = await client2.query(
        'SELECT region_id, division_id FROM region_members WHERE region_id = ANY($1)',
        [descendantIds],
      );

      // Absorb: collect all descendant division IDs → assign to parent
      const allDescDivisionIds = descMembersResult.rows.map(r => r.division_id as number);
      const uniqueDivisionIds = [...new Set(allDescDivisionIds)];
      for (const divId of uniqueDivisionIds) {
        await client2.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [regionId, divId],
        );
      }

      // Delete descendant members first
      await client2.query(
        'DELETE FROM region_members WHERE region_id = ANY($1)',
        [descendantIds],
      );

      // Delete descendants (deepest-first)
      await client2.query(`
        WITH RECURSIVE desc_regions AS (
          SELECT id, 1 AS depth FROM regions WHERE parent_region_id = $1
          UNION ALL
          SELECT r.id, d.depth + 1 FROM regions r JOIN desc_regions d ON r.parent_region_id = d.id
        )
        DELETE FROM regions WHERE id IN (SELECT id FROM desc_regions ORDER BY depth DESC)
      `, [regionId]);

      // Update parent status
      await client2.query(
        `UPDATE region_import_state SET match_status = 'manual_matched' WHERE region_id = $1`,
        [regionId],
      );
      // Clear parent suggestions (no longer relevant)
      await client2.query(
        `DELETE FROM region_match_suggestions WHERE region_id = $1`,
        [regionId],
      );

      await client2.query('COMMIT');

      // Store undo entry (same structure as dismiss-children)
      undoEntries.set(worldViewId, {
        operation: 'smart-flatten',
        regionId,
        timestamp: Date.now(),
        parentImportState,
        parentMembers: parentMembersResult.rows as Array<{ region_id: number; division_id: number }>,
        descendantRegions: descRegionsResult.rows as UndoEntry['descendantRegions'],
        descendantImportStates: descImportStatesResult.rows as ImportStateSnapshot[],
        descendantSuggestions: descSuggestionsResult.rows as SuggestionSnapshot[],
        descendantMembers: descMembersResult.rows as Array<{ region_id: number; division_id: number }>,
        childSnapshots: [],
      });

      console.log(`[WV Import] Smart flatten: absorbed ${descendantIds.length} descendants (${uniqueDivisionIds.length} divisions) into region ${regionId}`);
      res.json({
        absorbed: descendantIds.length,
        divisions: uniqueDivisionIds.length,
        undoAvailable: true,
      });
    } catch (err) {
      await client2.query('ROLLBACK');
      throw err;
    } finally {
      client2.release();
    }
  } catch (err) {
    // If we still have the first client active, rollback
    try { await client.query('ROLLBACK'); } catch { /* already released */ }
    console.error(`[WV Import] Smart flatten failed:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Smart flatten failed' });
  }
}
```

**Important implementation note:** The handler has two phases — phase 1 (auto-matching) uses `pool` queries because `trigramSearch` uses `pool` internally, and phase 3 (snapshot + flatten) uses a dedicated client transaction. The first transaction is committed before auto-matching starts, and a second transaction is opened for the flatten.

**Step 4: Extend undo handler for smart-flatten**

In the `undoLastOperation` handler (around line 1344), `smart-flatten` undo is identical to `dismiss-children` undo, plus restoring parent members. Add a case:

After the `dismiss-children` block (line ~1395) and before the `handle-as-grouping` block:

```typescript
    } else if (entry.operation === 'smart-flatten') {
      // Undo is like dismiss-children (restore descendants) + restore parent members
      // Re-insert descendant regions in parent-first order
      const sorted = [...entry.descendantRegions].sort((a, b) => a.id - b.id);
      for (const region of sorted) {
        await client.query(
          `INSERT INTO regions (id, name, parent_region_id, is_leaf, world_view_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [region.id, region.name, region.parent_region_id, region.is_leaf, region.world_view_id],
        );
      }
      // Re-insert descendant import states
      for (const state of entry.descendantImportStates) {
        await client.query(
          `INSERT INTO region_import_state (region_id, match_status, needs_manual_fix, fix_note,
            source_url, source_external_id, region_map_url, map_image_reviewed, import_run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (region_id) DO NOTHING`,
          [state.region_id, state.match_status, state.needs_manual_fix, state.fix_note,
           state.source_url, state.source_external_id, state.region_map_url,
           state.map_image_reviewed, state.import_run_id],
        );
      }
      // Re-insert descendant suggestions
      for (const sugg of entry.descendantSuggestions) {
        await client.query(
          `INSERT INTO region_match_suggestions (region_id, division_id, name, path, score, rejected)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sugg.region_id, sugg.division_id, sugg.name, sugg.path, sugg.score, sugg.rejected],
        );
      }
      // Re-insert descendant members
      for (const member of entry.descendantMembers) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [member.region_id, member.division_id],
        );
      }
      // Restore parent: clear absorbed members, restore original
      await client.query('DELETE FROM region_members WHERE region_id = $1', [entry.regionId]);
      for (const member of entry.parentMembers) {
        await client.query(
          `INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [member.region_id, member.division_id],
        );
      }
      // Restore parent import state
      if (entry.parentImportState) {
        await client.query(
          `UPDATE region_import_state SET match_status = $1, needs_manual_fix = $2, fix_note = $3
           WHERE region_id = $4`,
          [entry.parentImportState.match_status, entry.parentImportState.needs_manual_fix,
           entry.parentImportState.fix_note, entry.regionId],
        );
      }
```

**Step 5: Verify**

Run: `npm run check`

---

### Task 3: Backend route

**Files:**
- Modify: `backend/src/routes/adminRoutes.ts`

**Step 1: Import smartFlatten**

Add `smartFlatten` to the import from the controller. Find the existing import block for worldViewImportController functions (search for `dismissChildren` import) and add `smartFlatten`.

**Step 2: Add route**

After the dismiss-children route (line 242), add:

```typescript
// Smart flatten: auto-match children, absorb divisions into parent, delete descendants
router.post('/wv-import/matches/:worldViewId/smart-flatten', validate(worldViewIdParamSchema, 'params'), validate(wvImportRegionIdSchema), smartFlatten);
```

Uses the same validators as dismiss-children: `worldViewIdParamSchema` for params, `wvImportRegionIdSchema` for body (`{ regionId }`).

**Step 3: Verify**

Run: `npm run check`

---

### Task 4: Frontend API function

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts`

**Step 1: Add smartFlatten function**

After the `dismissChildren` function (around line 199), add:

```typescript
export async function smartFlatten(
  worldViewId: number,
  regionId: number,
): Promise<{
  absorbed: number;
  divisions: number;
  undoAvailable?: boolean;
  error?: string;
  unmatched?: Array<{ id: number; name: string }>;
}> {
  const resp = await fetch(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/smart-flatten`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ regionId }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    // Return the structured error (includes unmatched list) instead of throwing
    return data;
  }
  return data;
}
```

**Note:** This function does NOT use `authFetchJson` because it needs to handle 400 responses without throwing — the 400 response contains the list of unmatched children which the UI needs to display.

**Step 2: Verify**

Run: `npm run check`

---

### Task 5: Frontend — TreeNodeActions button

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeActions.tsx`

**Step 1: Add icon import**

Add `Compress as SmartFlattenIcon` to the `@mui/icons-material` import block (line 7–21).

**Step 2: Add props**

Add to `TreeNodeActionsProps` interface (line 25–58):

```typescript
onSmartFlatten?: (regionId: number) => void;
flatteningRegionId?: number | null;
```

**Step 3: Add button**

After the "Merge single child" button block (line 244), add:

```typescript
      {/* Smart flatten — absorb children's divisions */}
      {hasChildren && node.children.length > 1 && onSmartFlatten && (
        node.matchStatus == null || node.matchStatus === 'no_candidates' || node.matchStatus === 'children_matched'
      ) && (
        <Tooltip title="Smart flatten: match children to GADM, absorb their divisions">
          <span>
            <IconButton
              size="small"
              onClick={() => onSmartFlatten(node.id)}
              disabled={isMutating || flatteningRegionId != null}
              sx={{ p: 0.25 }}
            >
              {flatteningRegionId === node.id
                ? <CircularProgress size={14} />
                : <SmartFlattenIcon sx={{ fontSize: 16, color: 'info.main' }} />
              }
            </IconButton>
          </span>
        </Tooltip>
      )}
```

**Visibility conditions:**
- `hasChildren && node.children.length > 1` — has multiple children (single-child uses merge instead)
- `matchStatus` is null, `no_candidates`, or `children_matched` — container/grouping nodes
- `onSmartFlatten` is provided (optional prop)

**Step 4: Verify**

Run: `npm run check`

---

### Task 6: Frontend — WorldViewImportTree mutation + wiring

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx`

**Step 1: Import smartFlatten API**

Add `smartFlatten` to the import from `../../api/adminWorldViewImport` (line 39–62).

**Step 2: Add mutation**

After the `mergeMutation` (around line 610), add:

```typescript
  // Smart flatten mutation
  const smartFlattenMutation = useMutation({
    mutationFn: (regionId: number) => smartFlatten(worldViewId, regionId),
    onSuccess: (data) => {
      if (data.error) {
        // 400 — unmatched children, show names in snackbar
        const names = data.unmatched?.map(u => u.name).join(', ') ?? 'unknown';
        setUndoSnackbar({
          open: true,
          message: `Cannot flatten: ${data.unmatched?.length ?? 0} unmatched: ${names}`,
          worldViewId,
        });
        return;
      }
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Absorbed ${data.absorbed} children (${data.divisions} divisions)`,
          worldViewId,
        });
      }
    },
  });
```

**Step 3: Add to isMutating check**

In the `isMutating` const (around line 756), add `|| smartFlattenMutation.isPending`.

**Step 4: Wire to TreeNodeRow**

In the `<TreeNodeRow>` JSX (around line 880), add these props:

```typescript
onSmartFlatten={(regionId) => smartFlattenMutation.mutate(regionId)}
flatteningRegionId={smartFlattenMutation.isPending ? (smartFlattenMutation.variables ?? null) : null}
```

**Step 5: Verify**

Run: `npm run check`

---

### Task 7: Wire through TreeNodeRow to TreeNodeActions

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx`

Check `TreeNodeRow`'s props interface — it receives callbacks and passes them to `TreeNodeActions`. Add `onSmartFlatten` and `flatteningRegionId` to:
1. The `TreeNodeRow` props interface
2. The destructured props
3. The `<TreeNodeActions>` JSX

Follow the exact same pattern as `onMergeChild` / `mergingRegionId`.

**Verify:**

Run: `npm run check`

---

### Task 8: Verification + cleanup

**Step 1: Run all checks**

```bash
npm run check           # lint + typecheck
npm run knip            # unused files + deps
npm run security:all    # Semgrep + npm audit
TEST_REPORT_LOCAL=1 npm test  # unit tests
```

**Step 2: Manual test**

1. Find a region with children (e.g., a country with provinces)
2. Click the Smart Flatten button (compress icon, blue)
3. If children are all matchable → tree refreshes, parent is now a leaf with absorbed divisions, undo snackbar appears
4. If some children can't be matched → snackbar shows names of unmatched children
5. Click Undo → tree restores to previous state with all descendants

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Smart Flatten to absorb children's GADM divisions into parent"
```
