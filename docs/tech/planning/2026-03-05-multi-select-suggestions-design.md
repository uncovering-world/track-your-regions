# Multi-Select Suggestions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow selecting multiple suggestion divisions and performing batch accept/reject/preview-union operations on the selection.

**Architecture:** Add checkboxes to each SuggestionRow. Selection state lives in TreeNodeContent (local per-region). When 2+ checked, a batch action bar appears. Union preview reuses DivisionPreviewDialog with a new backend endpoint for union geometry. Batch accept+reject-rest reuses `acceptBatchMatches` + `rejectRemaining` in sequence.

**Tech Stack:** React/MUI (frontend), Express/PostGIS (backend union endpoint)

---

### Task 1: Backend — Union Geometry Endpoint

Add `POST /api/admin/wv-import/matches/:worldViewId/union-geometry` that accepts `divisionIds[]` and returns their union as GeoJSON.

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts` (add handler)
- Modify: `backend/src/routes/adminRoutes.ts` (add route)
- Modify: `backend/src/types/index.ts` (add Zod schema)

**Step 1: Add Zod schema**

In `backend/src/types/index.ts`, after `wvImportAcceptBatchSchema`:

```typescript
export const wvImportUnionGeometrySchema = z.object({
  divisionIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
});
```

**Step 2: Add controller handler**

In `backend/src/controllers/admin/wvImportMatchController.ts`, add:

```typescript
/**
 * Return the union geometry of multiple GADM divisions as GeoJSON.
 * POST /api/admin/wv-import/matches/:worldViewId/union-geometry
 */
export async function getUnionGeometry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { divisionIds } = req.body as { divisionIds: number[] };

  const result = await pool.query(`
    SELECT ST_AsGeoJSON(
      ST_ForcePolygonCCW(ST_CollectionExtract(
        ST_MakeValid(ST_Union(ad.geom_simplified_medium)), 3
      ))
    ) AS geojson
    FROM administrative_divisions ad
    WHERE ad.id = ANY($1) AND ad.geom_simplified_medium IS NOT NULL
  `, [divisionIds]);

  const geojson = result.rows[0]?.geojson;
  if (!geojson) {
    res.status(404).json({ error: 'No geometry found for given divisions' });
    return;
  }
  res.json({ geometry: JSON.parse(geojson as string) });
}
```

**Step 3: Add route**

In `backend/src/routes/adminRoutes.ts`, after the `accept-batch` route (~line 272), import and add:

```typescript
router.post('/wv-import/matches/:worldViewId/union-geometry',
  validate(worldViewIdParamSchema, 'params'),
  validate(wvImportUnionGeometrySchema),
  getUnionGeometry);
```

**Step 4: Commit**

```
feat: add union geometry endpoint for multi-division preview
```

---

### Task 2: Frontend API — Union Geometry + Batch Accept-Reject-Rest

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts`

**Step 1: Add `getUnionGeometry` API function**

```typescript
export async function getUnionGeometry(
  worldViewId: number,
  divisionIds: number[],
): Promise<{ geometry: GeoJSON.Geometry }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/union-geometry`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds }),
  });
}
```

**Step 2: Add `acceptBatchAndRejectRest` API function**

This chains `acceptBatchMatches` + `rejectRemaining`:

```typescript
export async function acceptBatchAndRejectRest(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<void> {
  await acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d })));
  await rejectRemaining(worldViewId, regionId);
}
```

**Step 3: Add `rejectBatchSuggestions` API function**

```typescript
export async function rejectBatchSuggestions(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<void> {
  await Promise.all(divisionIds.map(d => rejectSuggestion(worldViewId, regionId, d)));
}
```

**Step 4: Commit**

```
feat: add API functions for union geometry and batch suggestion operations
```

---

### Task 3: TreeNodeContent — Checkboxes and Selection State

Add checkboxes to SuggestionRow and a batch action bar. Selection state is local to TreeNodeContent (per-region, not global).

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeContent.tsx`

**Step 1: Add selection state and modify SuggestionRow**

Add `checked` and `onToggle` props to SuggestionRow:

```typescript
function SuggestionRow({ suggestion, regionId, onAccept, onAcceptAndRejectRest, onReject, onPreview, isMutating, checked, onToggle }: {
  // ... existing props ...
  checked?: boolean;
  onToggle?: (divisionId: number) => void;
}) {
  // Add checkbox before the path text:
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {onToggle && (
        <Checkbox
          size="small"
          checked={checked ?? false}
          onChange={() => onToggle(suggestion.divisionId)}
          sx={{ p: 0, '& .MuiSvgIcon-root': { fontSize: 16 } }}
        />
      )}
      {/* ... rest of existing JSX unchanged ... */}
    </Box>
  );
}
```

**Step 2: Add selection state to TreeNodeContent**

Inside the suggestions section (the `Box` at line 247), wrap with selection state:

```typescript
// Inside TreeNodeContent, before the return:
const [selectedDivIds, setSelectedDivIds] = useState<Set<number>>(new Set());
const showCheckboxes = node.suggestions.length > 1;

const toggleSelection = useCallback((divisionId: number) => {
  setSelectedDivIds(prev => {
    const next = new Set(prev);
    if (next.has(divisionId)) next.delete(divisionId);
    else next.add(divisionId);
    return next;
  });
}, []);

// Clear selection when suggestions change (accept/reject)
useEffect(() => {
  setSelectedDivIds(new Set());
}, [node.suggestions.length]);
```

**Step 3: Pass checkbox props to SuggestionRow**

```typescript
<SuggestionRow
  key={`s-${suggestion.divisionId}`}
  suggestion={suggestion}
  regionId={node.id}
  onAccept={onAccept}
  onAcceptAndRejectRest={onAcceptAndRejectRest}
  onReject={onReject}
  onPreview={handlePreviewSuggestion}
  isMutating={isMutating}
  checked={selectedDivIds.has(suggestion.divisionId)}
  onToggle={showCheckboxes ? toggleSelection : undefined}
/>
```

**Step 4: Add batch action bar**

After the existing "Accept all" / "Reject remaining" buttons, add a batch bar that shows when selections exist:

```typescript
{selectedDivIds.size > 0 && (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, pl: 0.25 }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
      {selectedDivIds.size} selected
    </Typography>
    <Button size="small" variant="text" color="info"
      onClick={() => onPreviewUnion(node.id, [...selectedDivIds])}
      disabled={isMutating}
      sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
      Preview union
    </Button>
    <Button size="small" variant="text" color="success"
      onClick={() => onAcceptSelected(node.id, [...selectedDivIds])}
      disabled={isMutating}
      sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
      Accept {selectedDivIds.size}
    </Button>
    <Button size="small" variant="text" color="success"
      onClick={() => onAcceptSelectedRejectRest(node.id, [...selectedDivIds])}
      disabled={isMutating}
      sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
      Accept {selectedDivIds.size} + reject rest
    </Button>
    <Button size="small" variant="text" color="error"
      onClick={() => onRejectSelected(node.id, [...selectedDivIds])}
      disabled={isMutating}
      sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
      Reject {selectedDivIds.size}
    </Button>
  </Box>
)}
```

**Step 5: Add new callbacks to TreeNodeContentProps**

```typescript
onPreviewUnion?: (regionId: number, divisionIds: number[]) => void;
onAcceptSelected?: (regionId: number, divisionIds: number[]) => void;
onAcceptSelectedRejectRest?: (regionId: number, divisionIds: number[]) => void;
onRejectSelected?: (regionId: number, divisionIds: number[]) => void;
```

**Step 6: Commit**

```
feat: add checkboxes and batch action bar to suggestion rows
```

---

### Task 4: Mutations — Batch Accept/Reject Selected

**Files:**
- Modify: `frontend/src/components/admin/useTreeMutations.ts`

**Step 1: Add batch mutations**

```typescript
const acceptSelectedMutation = useMutation({
  mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
    acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d }))),
  onSuccess: (_data, { regionId }) => invalidateTree(regionId),
});

const acceptSelectedRejectRestMutation = useMutation({
  mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
    acceptBatchAndRejectRest(worldViewId, regionId, divisionIds),
  onSuccess: (_data, { regionId }) => invalidateTree(regionId),
});

const rejectSelectedMutation = useMutation({
  mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
    rejectBatchSuggestions(worldViewId, regionId, divisionIds),
  onSuccess: (_data, { regionId }) => invalidateTree(regionId),
});
```

**Step 2: Add to isMutating aggregate and return object**

**Step 3: Commit**

```
feat: add batch accept/reject mutations for selected suggestions
```

---

### Task 5: Preview Union — Wire Through TreeNodeRow and WorldViewImportReview

Thread the `onPreviewUnion` callback from WorldViewImportReview through TreeNodeRow to TreeNodeContent, fetch union geometry, and show in DivisionPreviewDialog.

**Files:**
- Modify: `frontend/src/components/admin/TreeNodeRow.tsx` (thread new props)
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx` (wire callbacks)
- Modify: `frontend/src/components/admin/WorldViewImportReview.tsx` (handle union preview state)
- Modify: `frontend/src/components/WorldViewEditor/components/dialogs/DivisionPreviewDialog.tsx` (support union mode)

**Step 1: TreeNodeRow — Add new props and thread**

Add to `TreeNodeRowProps`:
```typescript
onPreviewUnion?: (regionId: number, divisionIds: number[]) => void;
onAcceptSelected?: (regionId: number, divisionIds: number[]) => void;
onAcceptSelectedRejectRest?: (regionId: number, divisionIds: number[]) => void;
onRejectSelected?: (regionId: number, divisionIds: number[]) => void;
```

Thread through to `TreeNodeContent`.

Also update `arePropsEqual` — no changes needed since these are callback props (semantically stable, already skipped in the comparator).

**Step 2: WorldViewImportReview — Handle union preview**

Add state and handler in `WorldViewImportReview`:

```typescript
const handlePreviewUnion = useCallback(async (regionId: number, divisionIds: number[]) => {
  // Find the region's metadata from the tree
  const node = findNodeById(tree, regionId); // helper
  setPreviewDivision({
    name: `${divisionIds.length} divisions (union)`,
    wikidataId: node?.wikidataId ?? undefined,
    regionId,
    isAssigned: false,
    divisionIds, // NEW field
  });
  setPreviewGeometry(null);
  setPreviewLoading(true);
  try {
    const result = await getUnionGeometry(worldViewId, divisionIds);
    setPreviewGeometry(result.geometry);
  } finally {
    setPreviewLoading(false);
  }
}, [worldViewId, tree]);
```

Extend the `previewDivision` state type to include optional `divisionIds?: number[]`.

Wire DivisionPreviewDialog action callbacks for the union case:
- Accept: `acceptSelectedMutation` with `{ regionId, divisionIds }`
- Accept + reject rest: `acceptSelectedRejectRestMutation`
- Reject: `rejectSelectedMutation`

**Step 3: WorldViewImportTree — Wire new callbacks**

In the `TreeNodeRow` JSX, add:
```typescript
onPreviewUnion={handlePreviewUnion}
onAcceptSelected={(regionId, divisionIds) => {
  setLastMutatedRegionId(regionId);
  acceptSelectedMutation.mutate({ regionId, divisionIds });
}}
onAcceptSelectedRejectRest={(regionId, divisionIds) => {
  setLastMutatedRegionId(regionId);
  acceptSelectedRejectRestMutation.mutate({ regionId, divisionIds });
}}
onRejectSelected={(regionId, divisionIds) => {
  rejectSelectedMutation.mutate({ regionId, divisionIds });
}}
```

**Step 4: DivisionPreviewDialog — Minor adjustments**

The dialog already accepts `division.name` as display text. For union preview, name will be "3 divisions (union)". The geometry is already a single GeoJSON from the backend. No structural changes needed to the dialog — it renders whatever geometry it receives.

Optionally: show division count in dialog title when previewing a union.

**Step 5: Commit**

```
feat: wire union preview and batch actions through component tree
```

---

### Task 6: Pre-commit Checks and Cleanup

**Step 1:** Run `npm run check` (lint + typecheck)
**Step 2:** Run `npm run knip` (unused files/deps)
**Step 3:** Run `TEST_REPORT_LOCAL=1 npm test` (unit tests)
**Step 4:** Run `npm run security:all` (Semgrep + audit)
**Step 5:** Commit any fixes

---

## Implementation Notes

- Selection state is local to `TreeNodeContent` (per-region, per-render). No need for global state since it only matters within a single region's suggestion list.
- The union geometry endpoint reuses the same PostGIS pattern as `computeMultiDivisionCoverage` — ST_Union + ST_MakeValid + ST_CollectionExtract.
- `acceptBatchAndRejectRest` chains two existing API calls client-side. No new backend endpoint needed — `acceptBatchMatches` + `rejectRemaining` already exist.
- `rejectBatchSuggestions` uses `Promise.all` with individual reject calls. If volume becomes a concern, a dedicated batch reject endpoint can be added later.
- The `arePropsEqual` memo comparator in TreeNodeRow skips callback props (they're stable refs), so new callback props don't break memoization.
