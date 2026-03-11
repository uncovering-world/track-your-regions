# AI Hierarchy Review v2 — Design

## Problem

The AI hierarchy review (v1) produces a markdown report that the user reads, closes, and then manually acts on from memory. Three gaps:

1. **Missing controls**: The AI recommends renaming regions and moving them to different parents, but the tree has no rename or reparent buttons.
2. **Report is ephemeral**: Once the dialog closes, the report is gone. The user can't refer back to it while editing.
3. **Recommendations are prose**: The user must mentally translate "Rename Nenetsia → Nenets Autonomous Okrug" into finding the node and... there's no rename button anyway.

## Solution

Three parts that build on each other:

### Part A: Rename & Reparent Controls

**Rename** — new standalone tree button (edit icon) on every node.
- Backend: `POST /api/admin/wv-import/matches/:worldViewId/rename-region`, body `{ regionId, name }`.
- Simple `UPDATE regions SET name = $1 WHERE id = $2 AND world_view_id = $3`.
- Frontend: opens inline text field or small dialog pre-filled with current name.
- Undo: stores previous name via existing undo infrastructure.

**Reparent (Move)** — new standalone tree button (move icon) on non-root nodes.
- Backend: `POST /api/admin/wv-import/matches/:worldViewId/reparent-region`, body `{ regionId, newParentId }`.
- Validates no circular reference (recursive CTE confirms newParentId is not a descendant of regionId).
- Updates `parent_region_id`. Existing `update_is_leaf()` trigger handles leaf flag.
- Frontend: opens dialog with dropdown of nearby regions (parent's siblings, grandparent, root-level nodes) plus type-ahead search fallback for arbitrary targets.
- Undo: stores previous `parent_region_id`.

### Part B: Persistent Reports with Checklist

Reports stored in React state as `Map<string, ReviewReport>` keyed by `"full"` or `"region-{id}"`. Survives drawer close/reopen, lost on page refresh.

```typescript
interface ReviewAction {
  id: string;
  type: 'rename' | 'reparent' | 'remove' | 'merge' | 'dismiss_children' | 'add_child' | 'other';
  regionId: number;
  regionName: string;
  description: string;
  params?: Record<string, unknown>;
  choices?: Array<{ label: string; value: string }>;
  selectedChoice?: string;
  completed: boolean;
}

interface ReviewReport {
  scope: string;
  regionId: number | null;
  report: string;          // markdown summary
  actions: ReviewAction[];
  stats: { passes: number; inputTokens: number; outputTokens: number; cost: number };
  generatedAt: string;
}
```

Drawer behavior:
- Clicking "AI Review" on a region with an existing report reopens it (no API call).
- "Regenerate" button in drawer header triggers a new AI call, replaces old report.
- Checkbox state persists in the Map. Footer shows "3/6 completed".
- Actions rendered below the markdown: checkboxes for each action, radio buttons for actions with `choices`.

### Part C: Structured AI Output

Update system prompts to request JSON with two fields:
- `report`: markdown with Summary + Issues Found (no Recommendations section — those become actions).
- `actions`: array of concrete actions typed to match available tree controls.

The prompt lists available action types with their params schemas so the AI outputs actionable items.

Parsing: backend tries JSON parse. If it fails (model returns pure markdown), falls back to `{ report: rawContent, actions: [] }` — graceful degradation.

## Files to Create/Modify

### New files
- `backend/src/controllers/admin/wvImportRenameController.ts` — rename + reparent endpoints

### Modified files
- `backend/src/routes/adminRoutes.ts` — add rename + reparent routes
- `backend/src/types/index.ts` — add Zod schemas for rename/reparent
- `backend/src/controllers/admin/wvImportUtils.ts` — add rename/reparent to undo operation types
- `backend/src/controllers/admin/aiHierarchyReviewController.ts` — structured JSON prompts + response parsing
- `frontend/src/api/adminWorldViewImport.ts` — add `renameRegion()`, `reparentRegion()`
- `frontend/src/api/adminAI.ts` — update `HierarchyReviewResult` to include `actions[]`
- `frontend/src/components/admin/WorldViewImportTree.tsx` — `Map<string, ReviewReport>` state, drawer with actions checklist, regenerate button
- `frontend/src/components/admin/TreeNodeActions.tsx` — rename + reparent buttons
- `frontend/src/components/admin/TreeNodeRow.tsx` — wire new props
- `frontend/src/components/admin/useTreeMutations.ts` — rename + reparent mutations

## Cost Estimate

Same as v1 — the structured JSON output adds ~500 tokens to the prompt (action type definitions) and ~1-2K to the output. Total per review: ~$0.02-0.04.
