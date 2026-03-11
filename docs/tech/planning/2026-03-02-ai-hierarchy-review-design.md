# AI Hierarchy Review — Design

## Problem

After importing a Wikivoyage region tree (~3,400 nodes, max depth 7), it's hard to assess whether the hierarchy makes sense from a travel perspective. Some branches go too deep (Lincolnshire → tiny towns at depth 7), some countries are duplicated (Georgia under both Asia and Europe Caucasus), and depth varies wildly between countries. A manual review is tedious — an AI travel-expert review can flag issues quickly.

## Solution

A two-pass AI review that analyzes the region tree and produces a travel-expert report identifying depth issues, structural problems, and balance concerns.

### Data Pipeline

The backend builds tree data in two plain-text formats:

**Summary format (Pass 1):** Full node detail to depth 3. Deeper branches show a compact one-liner: `Eastern Cape (6 leaves, max depth +2)`. Built from a single recursive CTE returning id, name, depth, child_count, leaf_count, max_descendant_depth, match_status. Formatted as indented text — token-efficient and natural for AI reasoning. The full tree (~3,400 nodes) compresses to ~400-600 lines / ~8-12K tokens.

**Detailed format (Pass 2 / subtree):** Full expansion of specific branches showing every node with match status. Same CTE filtered to descendants of specific region IDs. Individual branches add ~2-5K tokens each.

### Backend API

Two operations via one endpoint in `backend/src/controllers/admin/aiHierarchyReviewController.ts`:

**`POST /api/admin/ai/hierarchy-review`**
- Body: `{ worldViewId: number, regionId?: number }`
- `regionId` omitted → full tree review (two-pass): pass 1 sends summary, AI returns flagged branches; pass 2 sends full detail of flagged branches, AI produces final report
- `regionId` provided → subtree review (single pass): sends full detail of that subtree directly
- Response: `{ report: string, stats: { passes: number, inputTokens: number, outputTokens: number, cost: number } }`
- Uses `model.hierarchy_review` from `aiSettingsService`
- Logs usage via `logAIUsage()` with feature `'hierarchy_review'`

**Helper functions:**
- `buildTreeSummary(worldViewId)` — recursive CTE → compact indented text
- `buildSubtreeDetail(worldViewId, regionIds)` — recursive CTE → full expansion text

**System prompt** instructs the AI as a travel expert reviewing a region hierarchy for a travel tracking app. Evaluation criteria:
- Depth appropriateness (granularity useful for travelers?)
- Structural issues (duplicates, orphans, naming inconsistencies)
- Geographic accuracy (regions under wrong parents)
- Balance (some countries over-detailed vs under-detailed)

**Pass 1 response format:** AI returns JSON with `flaggedBranches: Array<{ regionId, reason }>` plus preliminary observations.

**Pass 2 / final response format:** Structured markdown with sections: Summary, Issues Found (categorized), Recommendations.

### Frontend UI

**Entry points:**

1. Toolbar button in WorldViewImportTree — "AI Review" `size="small"` button after existing navigation buttons. Triggers full-tree review.
2. Per-node button in TreeNodeActions — on container nodes with children. Triggers subtree review.

**Report dialog:**
- `<Dialog maxWidth="md" fullWidth>`
- `DialogTitle`: "Hierarchy Review" + scope subtitle + close button
- `DialogContent`: Markdown report rendered as formatted text
- `DialogActions`: "Close" button only (v1 — analysis only, no actionable buttons)
- Loading state: `CircularProgress` with pass indicator ("Analyzing... pass 1/2")

**State:** `reviewDialog: { open: boolean, report: string | null, loading: boolean, scope: string }` in WorldViewImportTree. Plain `useState` + `useCallback` — no TanStack Query (one-shot analysis, not cached).

**AI Settings:** `model.hierarchy_review` already exists as a slot in AISettingsPanel with token estimates (~75K input / ~20K output). No changes needed.

### Cost Estimate

Full tree review: ~25-40K input + ~5-10K output tokens across 2 API calls. At gpt-4.1-mini rates: ~$0.02-0.03 per review. Subtree review: ~5-15K input + ~3-5K output: ~$0.01.

## Files to Create/Modify

### New files
- `backend/src/controllers/admin/aiHierarchyReviewController.ts` — endpoint + tree formatting + AI orchestration

### Modified files
- `backend/src/routes/adminRoutes.ts` — add route
- `frontend/src/api/adminAI.ts` — add API function + response type
- `frontend/src/components/admin/WorldViewImportTree.tsx` — toolbar button + dialog state + report dialog
- `frontend/src/components/admin/TreeNodeActions.tsx` — per-node review button
- `frontend/src/components/admin/TreeNodeRow.tsx` — wire through onReview prop + loading state
- `frontend/src/components/admin/useTreeMutations.ts` — (not needed — review is read-only, not a mutation)

## Future (v2)

- Actionable suggestions with "Apply" buttons (flatten, merge, remove)
- Diff view comparing before/after for suggested changes
- Review history stored in DB
