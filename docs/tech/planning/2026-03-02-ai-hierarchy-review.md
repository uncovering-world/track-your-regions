# AI Hierarchy Review — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a two-pass AI review feature that analyzes a region hierarchy from a travel-expert perspective, identifying depth issues, duplicates, and structural problems.

**Architecture:** Backend controller builds compact tree text, sends to OpenAI in two passes (survey → drill-down). Frontend shows toolbar + per-node buttons that open a report dialog.

**Tech Stack:** OpenAI chat completion (via existing `chatCompletion` wrapper), Express endpoint, React dialog with MUI.

**Design doc:** `docs/tech/planning/2026-03-02-ai-hierarchy-review-design.md`

---

### Task 1: Backend — Tree Formatting Helpers + AI Endpoint

**Files:**
- Create: `backend/src/controllers/admin/aiHierarchyReviewController.ts`
- Modify: `backend/src/routes/adminRoutes.ts:114` (add import), `:347` (add route)

**Step 1: Create the controller**

Create `backend/src/controllers/admin/aiHierarchyReviewController.ts` with:

1. `queryTree(worldViewId, rootRegionId?)` — recursive CTE returning all nodes with `id, name, depth, parent_id, child_count, match_status`. Then a JS bottom-up pass to compute `leaf_count` and `max_depth` per node.

2. `formatTreeText(rows, detailDepth)` — formats the tree as indented text. Full detail to `detailDepth`, then compact one-liners for deeper branches: `"Eastern Cape (6 leaves, max depth +2) [no_candidates]"`.

3. `buildTreeSummary(worldViewId)` → calls `queryTree` + `formatTreeText(rows, 3)`.

4. `buildSubtreeDetail(worldViewId, regionIds[])` → for each regionId, `queryTree(worldViewId, regionId)` + `formatTreeText(rows, Infinity)`.

5. `hierarchyReview(req, res)` — the endpoint:
   - If `regionId` provided → single-pass subtree review
   - If omitted → two-pass: pass 1 sends summary, parses JSON response for `flaggedBranches`, pass 2 sends detail of flagged branches
   - Uses `getModelForFeature('hierarchy_review')` from `aiSettingsService`
   - Uses `chatCompletion()` wrapper from `chatCompletion.ts`
   - Logs via `logAIUsage()` with feature `'hierarchy_review'`
   - Returns `{ report: string, stats: { passes, inputTokens, outputTokens, cost } }`

OpenAI client: create a module-level lazy singleton like `aiClassifier.ts` does — import `OpenAI` type, create from `OPENAI_API_KEY` env var on first use. Check `isOpenAIAvailable()` at request time.

System prompts:
- **Pass 1**: Instructs AI as travel expert, asks for JSON with `flaggedBranches: [{ regionId, reason }]` and `observations`. Temperature 0.2, max 2000 tokens.
- **Pass 2**: Asks for structured markdown report with sections: Summary, Issues Found (Excessive Depth, Structural Problems, Balance Concerns), Recommendations. Temperature 0.3, max 6000 tokens.
- **Subtree**: Same as pass 2 but scoped. Temperature 0.3, max 4000 tokens.

**Step 2: Add route**

In `adminRoutes.ts`, add import:
```typescript
import { hierarchyReview } from '../controllers/admin/aiHierarchyReviewController.js';
```

Add route after line 347 (after last AI route, before image proxy section):
```typescript
router.post('/ai/hierarchy-review/:worldViewId', validate(worldViewIdParamSchema, 'params'), validate(z.object({
  regionId: z.number().int().positive().optional(),
})), hierarchyReview);
```

**Step 3: Verify**

Run: `npm run check`
Expected: 0 errors

**Step 4: Commit**

```
feat: add AI hierarchy review backend endpoint (two-pass)
```

---

### Task 2: Frontend — API Function

**Files:**
- Modify: `frontend/src/api/adminAI.ts` (append before final line)

**Step 1: Add types and function**

```typescript
// =============================================================================
// Hierarchy Review
// =============================================================================

export interface HierarchyReviewStats {
  passes: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface HierarchyReviewResult {
  report: string;
  stats: HierarchyReviewStats;
}

export async function runHierarchyReview(
  worldViewId: number,
  regionId?: number,
): Promise<HierarchyReviewResult> {
  return authFetchJson(`${API_URL}/api/admin/ai/hierarchy-review/${worldViewId}`, {
    method: 'POST',
    body: JSON.stringify(regionId != null ? { regionId } : {}),
  });
}
```

**Step 2: Verify**

Run: `npm run check`
Expected: 0 errors

**Step 3: Commit**

```
feat: add hierarchy review API client
```

---

### Task 3: Frontend — Report Dialog + Toolbar Button

**Files:**
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx`

The report is markdown text from the AI. Render it as plain text with `whiteSpace: 'pre-wrap'` — no `dangerouslySetInnerHTML`, no HTML sanitization needed. The markdown headers/bullets are readable as-is in monospace-like rendering.

**Step 1: Add imports**

```typescript
import { Psychology as ReviewIcon } from '@mui/icons-material';
import { runHierarchyReview, type HierarchyReviewResult } from '../../api/adminAI';
```

Also verify `Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress` are already imported from MUI. Add `CloseIcon` import if not already present.

**Step 2: Add state** (after existing dialog states, ~line 260)

```typescript
const [reviewState, setReviewState] = useState<{
  open: boolean;
  loading: boolean;
  regionId: number | null;
  report: string | null;
  scope: string;
  stats: HierarchyReviewResult['stats'] | null;
  passInfo: string;
} | null>(null);
```

**Step 3: Add handler** (near other handlers)

```typescript
const handleReview = useCallback(async (regionId?: number) => {
  const scope = regionId ? 'Subtree review' : 'Full tree';
  setReviewState({ open: true, loading: true, regionId: regionId ?? null, report: null, scope, stats: null, passInfo: regionId ? 'Analyzing branch...' : 'Pass 1: surveying tree structure...' });
  try {
    const result = await runHierarchyReview(worldViewId, regionId);
    setReviewState(prev => prev ? { ...prev, loading: false, report: result.report, stats: result.stats, passInfo: '' } : prev);
  } catch (err) {
    setReviewState(prev => prev ? {
      ...prev, loading: false,
      report: `Error: ${err instanceof Error ? err.message : 'Review failed'}`,
      passInfo: '',
    } : prev);
  }
}, [worldViewId]);
```

**Step 4: Add toolbar button** (inside toolbar `<Box>`, ~line 693, before closing `</Box>`)

```tsx
<Button
  size="small"
  startIcon={reviewState?.loading ? <CircularProgress size={14} /> : <ReviewIcon />}
  onClick={() => handleReview()}
  disabled={reviewState?.loading}
>
  AI Review
</Button>
```

**Step 5: Add dialog** (after existing dialogs, ~line 823)

```tsx
{/* AI Hierarchy Review Dialog */}
<Dialog open={!!reviewState?.open} onClose={() => setReviewState(null)} maxWidth="md" fullWidth>
  <DialogTitle>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Box>
        <Typography variant="h6" component="span">Hierarchy Review</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {reviewState?.scope}
        </Typography>
      </Box>
      <IconButton size="small" onClick={() => setReviewState(null)}>
        <CloseIcon />
      </IconButton>
    </Box>
  </DialogTitle>
  <DialogContent dividers sx={{ minHeight: 300 }}>
    {reviewState?.loading ? (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">{reviewState.passInfo}</Typography>
      </Box>
    ) : (
      <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }}>
        {reviewState?.report ?? ''}
      </Typography>
    )}
  </DialogContent>
  <DialogActions sx={{ px: 2, py: 1.5, justifyContent: 'space-between' }}>
    <Typography variant="caption" color="text.secondary">
      {reviewState?.stats
        ? `${reviewState.stats.passes} pass${reviewState.stats.passes > 1 ? 'es' : ''} · ${(reviewState.stats.inputTokens + reviewState.stats.outputTokens).toLocaleString()} tokens · $${reviewState.stats.cost.toFixed(4)}`
        : ''}
    </Typography>
    <Button onClick={() => setReviewState(null)} variant="outlined" size="small">Close</Button>
  </DialogActions>
</Dialog>
```

**Step 6: Verify**

Run: `npm run check`
Expected: 0 errors

**Step 7: Commit**

```
feat: add AI review toolbar button and report dialog
```

---

### Task 4: Frontend — Per-Node Review Button

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeActions.tsx` (props + button)
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx` (props + memo + wiring)
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx` (pass handler)

**Step 1: TreeNodeActions — add props and button**

Add to `TreeNodeActionsProps` interface:
```typescript
onReviewSubtree?: (regionId: number) => void;
reviewingRegionId?: number | null;
```

Add icon import:
```typescript
import { Psychology as ReviewSubtreeIcon } from '@mui/icons-material';
```

Add button after the auto-resolve button block (~line 313):
```tsx
{/* AI review subtree */}
{hasChildren && onReviewSubtree && (
  <Tooltip title="AI review of this branch">
    <span>
      <IconButton
        size="small"
        onClick={() => onReviewSubtree(node.id)}
        disabled={isMutating || reviewingRegionId != null}
        sx={{ p: 0.25 }}
      >
        {reviewingRegionId === node.id
          ? <CircularProgress size={14} />
          : <ReviewSubtreeIcon sx={{ fontSize: 16, color: 'info.main' }} />
        }
      </IconButton>
    </span>
  </Tooltip>
)}
```

**Step 2: TreeNodeRow — wire through**

Add to `TreeNodeRowProps`:
```typescript
onReviewSubtree?: (regionId: number) => void;
reviewingRegionId?: number | null;
```

Add to `arePropsEqual` (after the autoResolvingRegionId check):
```typescript
if ((prev.reviewingRegionId === id) !== (next.reviewingRegionId === id)) return false;
```

Pass to `<TreeNodeActions>`:
```typescript
onReviewSubtree={onReviewSubtree}
reviewingRegionId={reviewingRegionId}
```

**Step 3: WorldViewImportTree — pass handler to renderRow**

In the `renderRow` where `<TreeNodeRow>` is rendered, add:
```typescript
onReviewSubtree={(regionId) => handleReview(regionId)}
reviewingRegionId={reviewState?.loading ? reviewState.regionId : null}
```

**Step 4: Verify**

Run: `npm run check`
Expected: 0 errors

**Step 5: Commit**

```
feat: add per-node AI review button in tree actions
```

---

### Task 5: Pre-Commit Checks & Manual Test

**Step 1: Run all checks**

```bash
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

**Step 2: Run `/security-check`**

Review new/changed files for: parameterized SQL, auth middleware on route, no secrets, no XSS.

**Step 3: Manual test**

1. Open admin import tree for world view 31
2. Click "AI Review" in toolbar → dialog shows loading with pass info, then report
3. Click review icon on a container node (e.g., United Kingdom) → subtree review in dialog
4. Verify AI Settings > `model.hierarchy_review` model selector works
5. Verify AI usage dashboard shows `hierarchy_review` entries after running review

**Step 4: Commit any cleanup**

```
chore: cleanup after AI hierarchy review implementation
```
