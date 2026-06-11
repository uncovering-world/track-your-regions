# Import Review Workflow Redesign — Plan 3/4: Country Workspace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The per-country workspace at `/admin/import/:worldViewId/region/:regionId` — scoped tree (no row-icon chaos), persistent map, stage-grouped action panel, checks bar, hard-gated sign-off — replacing the legacy tree as the place where assignment work happens.

**Architecture:** New components under `frontend/src/components/admin/importWorkspace/`. Heavy reuse of the legacy tree's decoupled machinery: `useTreeMutations(worldViewId, deps)` (~30 named mutations, deps are plain callbacks: `onPreview`, `mapPickerStateRef`, `setMapPickerState`, `setRemoveDialogState`, `onMatchChange`), `useImportTreeDialogs` (dialog state + handlers), `ImportTreeDialogs` (the dialog layer), `DivisionPreviewDialog` (preview + accept/reject), `VerifyDialog` from Plan 2 (sign-off). Map: `react-map-gl/maplibre` + carto positron style (same as `CoverageMapPreview`), data from `getChildrenRegionGeometry` (per-child colored unions), `analyzeCoverageGaps` (gap polygons), `getWorkUnitVerification` (blockers/lists). Member assignment from the map uses `addDivisionsToRegion` / `removeDivisionsFromRegion` (`api/regions.ts:148/177`) — both already sync match status + stale the unit server-side.

**Tech Stack:** React 18 + MUI + TanStack Query + react-map-gl/maplibre + @tanstack/react-virtual (already used by the legacy tree).

**Descopes (Plan 4):** deleting the legacy screen; moving Re-match/Compute-Geometries; global-gaps resolution flow; CV/mapshape pipelines stay launched from the legacy tree (the panel links there when prerequisites exist).

**Conventions:** commits `front: <Topic>.`, body what+why, `-s`, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Gates per commit: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`; root `npm run knip` at the end of each task. NEVER stage `.claude/commands/commit.md` / `frontend/package-lock.json`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/components/admin/importWorkspace/workspaceUtils.ts` (+test) | Create | Subtree extraction/flattening, child-color assignment, stage derivation |
| `.../importWorkspace/CountryWorkspacePage.tsx` | Create | Route shell: guard, data, header (checklist, sign-off, next-country), layout |
| `.../importWorkspace/WorkspaceTree.tsx` | Create | Scoped virtualized tree; state-only rows; selection |
| `.../importWorkspace/ActionPanel.tsx` | Create | Stage-grouped actions for the selected node (consumes the hooks) |
| `.../importWorkspace/SuggestionList.tsx` | Create | Selected node's suggestions + assigned divisions (accept/reject/preview/clear) |
| `.../importWorkspace/WorkspaceMap.tsx` | Create | Persistent map: children colors, gap/overlap overlays, hover sync, click-assign |
| `.../importWorkspace/ChecksBar.tsx` | Create | Run checks → blocker worklist → feeds sign-off gating + map focus |
| `frontend/src/App.tsx` | Modify | Route |
| `.../importDashboard/CountryRow.tsx` | Modify | Row click + menu item → workspace |
| `docs/tech/world-view-import.md`, `docs/vision/vision.md` | Modify | Workspace docs |

---

### Task 1: Utils (TDD) — subtree, colors, stages

Create `workspaceUtils.ts` + `workspaceUtils.test.ts`.

- [ ] **Step 1: Failing tests** for: `findSubtree(tree, regionId)` (returns the node or null); `flattenSubtree(root, expandedIds)` (depth-annotated visible rows, root always included); `childColorMap(root)` (stable color per direct child id from a fixed 12-color palette, cycling); `deriveStage(unit, verify)` → `'hierarchy' | 'assignment' | 'verification' | 'done'` (hierarchy unconfirmed → hierarchy; unassigned leaves > 0 → assignment; blockers beyond that → verification; signed_off → done). Write concrete cases for each (≥8 tests).
- [ ] **Step 2:** Implement (pure functions; palette: the 12 MUI-ish hexes used by `SmartSimplifyDialog`-style coloring — pick 12 visually distinct hexes, document them).
- [ ] **Step 3:** Gates; commit `front: Add workspace derivation utils.` (+body, trailer).

### Task 2: Page shell + route + header

Create `CountryWorkspacePage.tsx`; modify `App.tsx` (route ABOVE `/admin/*`, below or above the dashboard route — order irrelevant between the two literals):

```tsx
<Route path="/admin/import/:worldViewId/region/:regionId" element={<CountryWorkspacePage />} />
```

Shell responsibilities (write complete code in the established idioms — model the guard/data plumbing on `ImportDashboardPage.tsx`):
- Params → ints; admin guard; `useQuery` dashboard (`['admin','wvImport','workflowDashboard',wv]`) to find this unit (name, signoffStatus, signedOffAt, hierarchyConfirmed, hasReference, leaf counts) + ordered unit list for **next-country nav** (same continent ordering as the dashboard: reuse `groupUnitsByContinent`).
- `useQuery` match tree (`['admin','wvImport','matchTree',wv]`, `getMatchTree`) → `findSubtree` for this region; missing → friendly "not part of this import" + back link.
- Header row: back button (`/admin/import/:wv`), unit name + status dot (reuse `deriveUnitStatus` + the dot map — EXPORT `STATUS_DOT` from `CountryRow.tsx` or duplicate a tiny local copy, prefer export), reference chip (`Reference: N divisions` or red `no reference`; tooltip lists ids; setting it stays an API-only escape hatch this plan), stage checklist chips (`Hierarchy ✓/✗`, `Leaves x/y`, `Checks …` from ChecksBar state), **Sign off** button opening Plan 2's `VerifyDialog` (import it), "Next country →" (first unit after this one in dashboard order that isn't signed_off; tooltip shows its name).
- Layout: left 40% column (tree on top, ActionPanel below, `overflow:auto`), right 60% `WorkspaceMap`, full height (`calc(100vh - 120px)`).
- Selection state `selectedRegionId` (default: the unit itself) lifted here; hover state `hoveredRegionId` likewise (tree↔map sync).
- Mount `ChecksBar` between header and the columns.

Commit `front: Add country workspace route and shell.` after gates (tree/panel/map/checks may be minimal-but-real first versions from Tasks 3-6 if you build in dependency order — same sanctioned approach as Plan 2: build all, commit in dependency order: utils → tree → suggestions/panel → map → checks → shell+route last).

### Task 3: WorkspaceTree

Complete code expectations:
- Props: `{ root: MatchTreeNode; selectedId: number; hoveredId: number | null; onSelect(id): void; onHover(id|null): void }`.
- `useState<Set<number>>` expanded (default: root + its direct children); `flattenSubtree` from utils; `@tanstack/react-virtual` (copy the virtualization setup from `WorldViewImportTree.tsx`'s scroll container, simplified).
- Row: indent by depth, expand caret (only when children), name, then STATE ONLY: status chip (color-coded like legacy `CountryStatusChip`: matched green / manual info / review warning / no match default / children_matched green), `N div` badge when `assignedDivisions.length > 0`, ⚠ chip when unreviewed warnings, `waived` chip when `assignmentWaived`. NO action icons. Click selects; hover calls `onHover`. Selected row highlighted (`bgcolor: action.selected`), hovered row subtle.
- Commit `front: Add workspace scoped tree with state-only rows.`

### Task 4: SuggestionList + ActionPanel (the reuse task)

READ FIRST: `useTreeMutations.ts` (deps interface at ~:64, return at ~:694), `useImportTreeDialogs.ts` (signature at ~:204, return shown there), `ImportTreeDialogs.tsx` props, and how `WorldViewImportTree.tsx` instantiates all three (it passes tree data + handlers; mirror its wiring minimally). Then:

- Page-level wiring (in `CountryWorkspacePage`): instantiate `useTreeMutations(worldViewId, deps)` with deps implemented like `WorldViewImportReview`/`WorldViewImportTree` do — `onPreview` opens a local `DivisionPreviewDialog` state (copy the slim version of `handlePreviewDivision` + dialog props from `WorldViewImportReview.tsx:278-294/812-830`, accept/reject handlers from `usePreviewMutations` there — REUSE that exported hook if importable, else inline the 2 mutations you need: accept, reject). `mapPickerStateRef`/`setMapPickerState`: reuse the `MapImagePickerDialog` wiring only if trivial; otherwise pass a no-op ref + state and EXCLUDE the map-image-picker action from the panel (declare in commit body). `setRemoveDialogState`: local confirm dialog (small inline Dialog). `onMatchChange`: invalidate dashboard + verify keys.
- `useImportTreeDialogs(...)` per its real signature; render `<ImportTreeDialogs {...} />` with the subset it needs (read its props; pass the hook outputs through).
- `SuggestionList.tsx` (selected node): assigned divisions list (name + path + preview icon + remove via `removeDivisionsFromRegion` then `onMatchChange`), suggestions list (name/path/score + conflict chip when present + Accept (`acceptMutation` / `onAcceptTransfer` when conflict) + Reject + preview icon), `Reject remaining` when ≥1 assigned, `Accept all` when multiple clean suggestions.
- `ActionPanel.tsx` — three labeled groups of MUI `Button`s (size small, startIcon) acting on `selectedRegionId`:
  - **Hierarchy**: AI review children (`dialogs.handleAISuggestChildren`), Rename (`dialogs.setRenameDialog`), Reparent, Add child, Remove (`dialogs.handleRemoveRegion` / remove dialog), Restructure ▾ menu → Dismiss children (`dismissMutation`), Prune to leaves (`pruneMutation`), Collapse to parent (`collapseToParentMutation`), Merge single child (`mergeMutation`, enabled when exactly 1 child), Smart flatten (`dialogs.handleSmartFlatten`).
  - **Assignment**: Geoshape (`geoshapeMatchMutation`, disabled w/o wikidataId), Points (`pointMatchMutation`, same), Geocode (`geocodeMatchMutation`), DB search (`dbSearchOneMutation`), AI match (`aiMatchOneMutation`), Auto-resolve subtree (`autoResolveMutation`), Division search (`dialogs.handleManualDivisionSearch`), Match children independently (`groupingMutation`).
  - **Cleanup & checks**: Simplify (`simplifyHierarchyMutation`), Simplify children (`simplifyChildrenMutation`), Smart simplify (`dialogs.handleSmartSimplify`), Overlap check (`overlapCheckMutation`), Clear members (`clearMembersMutation`), Reset match (`resetMatchMutation`), Waive toggle (`setAssignmentWaived` from `wvImportWorkflow.ts` + invalidations), Manual-fix flag (`manualFixMutation` / `dialogs.setFixDialogState` per legacy wiring), Sync instances (`syncMutation`, only when duplicate sourceUrl — accept a prop).
  - Disable-with-tooltip rules mirror the legacy `show` conditions where they encode REQUIREMENTS (e.g. wikidataId); availability-by-stage is soft — everything visible, grouped.
  - Undo snackbar: render `mutations.undoSnackbar` state with the same Snackbar+Undo button as the legacy tree (read its JSX; ~10 lines).
- Commit(s): `front: Add workspace suggestion list.` and `front: Add stage-grouped action panel.` (two commits, suggestions first).

### Task 5: WorkspaceMap

- Props: `{ worldViewId, unit: {regionId, referenceDivisionIds}, root: MatchTreeNode, selectedId, hoveredId, onSelectRegion(id), verify: VerifyResult | null }`.
- Data: `useQuery getChildrenRegionGeometry(worldViewId, unit.regionId)` (`['admin','wvImport','childrenGeometry',wv,unitId]`) → FeatureCollection with per-child colors via `childColorMap`; `useQuery analyzeCoverageGaps(worldViewId, unit.regionId)` enabled only after verify reports gaps (`['admin','wvImport','gapAnalysis',wv,unitId, verify?.verifiedAt]`) → red gap fills.
- Layers: child fills (opacity .35, hover/selected → .6 via feature-state or filter on hovered id), child outlines, gap fill+outline (red), overlap divisions (from `verify.overlaps` — fetch their geometries via the same gap-analysis result if present, else outline-only list omitted: declare). Fit bounds to children union on load (`mapRef.fitBounds` from a bbox computed over the FC; turf not available? compute manually).
- Interactions: `onMouseMove`/`onClick` with `interactiveLayerIds`: hover → `onHover(regionId)` of the feature's owning child; click on a child fill → `onSelectRegion`; click on a GAP feature → confirm popover "Assign <division> to <selected region name>?" → `addDivisionsToRegion(selectedId, [divisionId])` → invalidate tree/dashboard/verify keys.
- Legend (small Paper, top-right): child color squares (first 8 + "+N"), red = gap.
- Commit `front: Add persistent workspace map with click-assign.`

### Task 6: ChecksBar + wiring + docs

- `ChecksBar.tsx`: `useQuery(['admin','wvImport','verify',wv,unitId], getWorkUnitVerification, { enabled:false })` + "Run checks" button (refetch); after any mutation (subscribe via a `lastMutationAt` prop bumped by `onMatchChange`) show "stale — re-run" chip. Render blocker chips (labels from Plan 2's map — export `BLOCKER_LABEL` from `VerifyDialog.tsx` or move both to a shared `blockerLabels.ts`); counts (`N unassigned`, `N gaps`, `N overlaps`) clicking focuses the map (lift `verify` to the page; ChecksBar gets `verify` + `onRun`). Sign-off button in the header turns enabled when verify clean + hierarchyConfirmed (it still re-validates server-side via the dialog).
- `CountryRow.tsx`: row primary click (and a first menu item "Open workspace") → `navigate(\`/admin/import/${worldViewId}/region/${unit.regionId}\`)`.
- Docs: `world-view-import.md` workspace paragraph (route, layout, what moved off the legacy tree); `vision.md` one line (admins work countries in a focused workspace with map-driven assignment).
- Full gates + root knip. Commit `front: Add checks bar and route dashboard rows to workspace.` (+docs in same commit).

---

## Self-review checklist
1. Selecting any node in the tree drives panel + suggestion list + map highlight coherently; the unit itself is selectable (its own suggestions/actions apply).
2. Every mutation invalidates: matchTree + workflowDashboard + verify (stale chip) — grep for missed invalidations.
3. No action icons on tree rows; everything reachable via panel/menus; legacy screen untouched.
4. Contract drift: none — all calls go through existing api modules.
