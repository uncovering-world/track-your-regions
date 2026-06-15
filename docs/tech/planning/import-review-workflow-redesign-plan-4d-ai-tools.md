# Plan 4d: AI Tools in the Workspace

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sub-plan of `…-plan-4-complete-new-ui.md`.

**Goal:** (1) Re-enable **AI-suggest-children APPLY** in the workspace (Plan 3 stubbed it to a "Close" button). (2) Bring the **AIReviewDrawer** (AI hierarchy-review report) into the workspace. Both reuse machinery that already exists; the legacy `WorldViewImportTree` is left UNTOUCHED (it stays as the fallback).

**Architecture:** The workspace already instantiates `useImportTreeDialogs` (which already exposes `reviewReports`, `activeReviewKey`, `reviewLoading`, `handleReview`, `suggestChildrenResult`, `setSuggestChildrenResult`). Part 1 adds a shared apply handler to that hook (or a small `applySuggestChildren` helper) — porting the legacy apply logic (`WorldViewImportTree.tsx:250-447`: maps each selected `ReviewChildAction` to `addChildRegion`/`removeRegionFromImport`/`renameRegion`, `Promise.allSettled`, then invalidate the tree) — and the workspace's `AISuggestChildrenDialog onSubmit` calls it. Part 2 renders `<AIReviewDrawer>` in the workspace wired to the hook's review state, with an "AI review branch" entry in the Hierarchy stage.

**Tech Stack:** React + MUI + TanStack Query + react-markdown. Gates: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run` + root knip.

**Conventions:** `front:` commits, `-s`, Co-Authored-By trailer; never stage the two dirty files / `data/`. Do NOT modify `WorldViewImportTree.tsx` / the legacy screen.

---

### Task 1: AI-suggest-children APPLY in the workspace

**Files:** `frontend/src/components/admin/useImportTreeDialogs.ts` (add the apply handler), `frontend/src/components/admin/importWorkspace/CountryWorkspacePage.tsx` (wire `onSubmit` + restore the apply label/caption). READ the legacy apply block `WorldViewImportTree.tsx:250-447` (the `ReviewChildAction → add/remove/rename` mapping + `Promise.allSettled` + invalidate) and the `AISuggestChildrenDialog` props in `ImportTreeDialogs.tsx:524-645` (it already supports `onSubmit`, `submitLabel`, `submitCaption`, selection state).

- [ ] **Step 1:** Add `applySuggestChildren(parentRegionId: number, actions: ReviewChildAction[]): Promise<void>` to `useImportTreeDialogs` (or as a returned handler), porting the legacy logic: for each selected action — `type:'add'` → `addChildRegion(worldViewId, parentRegionId, name, sourceUrl?, sourceExternalId?)`; `type:'remove'` → `removeRegionFromImport(worldViewId, childId, true, true)`; `type:'rename'` → `renameRegion(worldViewId, childId, newName, sourceUrl?, sourceExternalId?)` — via `Promise.allSettled`, then invalidate `['admin','wvImport','matchTree',worldViewId]` (+ call an `onMatchChange`-style callback if the hook has one). Track pending via the hook's existing state. Read the legacy block for the exact action fields (`action.type`, `action.name/newName`, `action.childId`, `action.sourceUrl`, `action.sourceExternalId`).
- [ ] **Step 2:** In `CountryWorkspacePage.tsx` (~:752-767), change the `AISuggestChildrenDialog` from `submitLabel="Close"` / the Plan-3 caption to the real apply: `onSubmit={() => applySuggestChildren(selectedRegionId, dialogs.suggestChildrenResult.actions)}` (match the actual prop/state shape), default `submitLabel` (the dialog's "Apply N Selected"), drop the "migrates this" caption. After apply, close the dialog + the matchTree invalidation refreshes the tree; also bump `handleMatchChange` so the dashboard/verify update.
- [ ] **Step 3:** Gates; commit `front: Enable AI-suggest-children apply in the workspace.`

### Task 2: AIReviewDrawer in the workspace

**Files:** `CountryWorkspacePage.tsx` (render the drawer + an entry), `importWorkspace/ActionPanel.tsx` (HierarchyTools — add an "AI review branch" button). READ `AIReviewDrawer.tsx` (props: `open`, `reviewReports`, `activeReviewKey`, `reviewLoading`, `handleReview`, close/regenerate) and how the legacy tree wires its "AI Review" button + drawer to the hook's review state.

- [ ] **Step 1:** Render `<AIReviewDrawer …>` in `CountryWorkspacePage`, wired to `dialogs.reviewReports` / `dialogs.activeReviewKey` / `dialogs.reviewLoading` / `dialogs.handleReview` / a local `reviewDrawerOpen` state (open it when a review is triggered). Match the legacy drawer prop wiring exactly.
- [ ] **Step 2:** Add an **"AI review branch"** button to HierarchyTools (it's a hierarchy-stage tool) with an `actionHelp` entry, calling `dialogs.handleReview(selectedRegionId)` and opening the drawer. (Keep the existing per-node "AI review children" — that's the suggest-children flow; this is the report drawer. Distinct labels so they don't confuse: "AI review children" = suggest add/remove/rename; "AI review branch" = the report.) If that distinction is muddy, name them clearly and note it.
- [ ] **Step 3:** Linkified region names in the report that navigate — if the drawer's link handler expects a navigate callback, wire it to select the region in the workspace tree (or no-op with a note if cross-navigation is non-trivial). Gates; commit `front: Add AI review drawer to the workspace.`

### Task 3: review + docs
Combined review: apply maps each action type to the right endpoint with the right args (add/remove/rename), `Promise.allSettled`, tree invalidation + dashboard/verify bump; the dialog now applies (not "Close"); the drawer renders reports, regenerate works, no crash on empty; the two AI entries (suggest-children vs review-branch) are distinct and both wired; legacy `WorldViewImportTree` untouched (`git diff` shows no change there); gates + runtime smoke. Fold fixes. Docs: update `docs/tech/world-view-import.md` (workspace AI tools: suggest-children apply + review drawer now in the workspace).

**Self-review:** an admin can run AI review of a branch and APPLY add/remove/rename suggestions entirely from the workspace, without the legacy screen.
