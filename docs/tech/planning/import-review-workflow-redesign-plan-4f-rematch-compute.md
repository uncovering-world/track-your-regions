# Plan 4f: Re-match All + Compute Geometries on the Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sub-plan of `…-plan-4-complete-new-ui.md`.

**Goal:** Make the two world-view-level operations — **Re-match All** (destructive; clears matches, resets sign-off) and **Compute Geometries** — runnable from the dashboard (today only on the legacy toolbar).

**Architecture:** Port the legacy logic (`WorldViewImportReview.tsx`) into `ImportDashboardPage`: a "Danger zone" area in the header with **Re-match All** (confirm dialog → `startRematch` → poll `getRematchStatus` via the `['admin','wvImport','rematchStatus',wv]` query → progress alert; on complete invalidate dashboard+tree+coverage) and **Compute Geometries** (`startWorldViewGeometryComputation` → poll `fetchWorldViewComputationStatus` → progress alert with Cancel via `cancelWorldViewGeometryComputation`). Reuse the existing APIs + query key. Legacy `WorldViewImportReview` UNTOUCHED.

**Tech Stack:** React + MUI + TanStack Query. Gates: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run` + root knip.

**Conventions:** `front:` commits, `-s`, Co-Authored-By trailer; never stage the two dirty files / `data/`. Do NOT modify `WorldViewImportReview.tsx`.

---

### Task 1: Re-match All on the dashboard

**Files:** `frontend/src/components/admin/importDashboard/ImportDashboardPage.tsx`. READ the legacy rematch block (`WorldViewImportReview.tsx:497-524` mutation, `:504-522` the `getRematchStatus` polling `useQuery` with `refetchInterval` that invalidates tree/stats/coverage on `'complete'` and avoids the self-invalidation infinite loop, `:832-860` the confirm dialog). Import `startRematch, getRematchStatus` from `api/admin/worldViewImport` (confirm the module).

- [ ] **Step 1:** Add a **Danger zone** to the dashboard header (a small section or a `⋮`/"Danger" menu, visually de-emphasised / warning-tinted) with a **Re-match All** button → opens a confirm `Dialog` ("Re-match All Regions? This clears all match assignments and suggestions and resets sign-off; manual matches are lost."). Confirm → `rematchMutation.mutate()` (`startRematch(worldViewId)`).
- [ ] **Step 2:** Port the `getRematchStatus` polling `useQuery` (key `['admin','wvImport','rematchStatus',worldViewId]`, `refetchInterval` 1000 while `status==='matching'`, on `'complete'` invalidate `workflowDashboard`+`matchTree`+`coverage` but NOT rematchStatus itself — replicate the legacy's infinite-loop guard). Show a progress `Alert` ("Re-matching… {statusMessage}") while running and a success alert on complete. Disable Re-match while running.
- [ ] **Step 3:** Gates; commit `front: Add Re-match All to the dashboard danger zone.`

### Task 2: Compute Geometries on the dashboard

**Files:** same. READ the legacy compute block (`WorldViewImportReview.tsx:526-584` the polling-based `startGeomPolling`/`handleComputeGeometries`/`handleCancelGeomComputation` + `geomStatus`/`geomComputing` state, `:224-258` the `GeomComputationAlert` component, `:720-728` the button). Import `startWorldViewGeometryComputation, fetchWorldViewComputationStatus, cancelWorldViewGeometryComputation` from `api/geometry` (confirm).

- [ ] **Step 1:** Add a **Compute Geometries** button to the dashboard header (danger zone or main header — it's not destructive, so the main header is fine). Port `handleComputeGeometries` (start → `setInterval` poll `fetchWorldViewComputationStatus` → update `geomStatus`; stop when `!running`) + `handleCancelGeomComputation`. Clean up the interval on unmount (the legacy uses a ref + `useEffect` cleanup — replicate).
- [ ] **Step 2:** Render a progress alert (replicate the slim `GeomComputationAlert`: "Computing geometries… {computed}/{total}" + `LinearProgress` + a Cancel button while running; "{status} — {computed} computed, {errors} errors" when done). Keep it a small local component in the dashboard (do NOT import from the legacy file).
- [ ] **Step 3:** Gates; commit `front: Add Compute Geometries to the dashboard.`

### Task 3: review + docs
Combined review: Re-match confirm → startRematch → polling shows progress → on complete the dashboard/tree/coverage refetch (all units reset to not_started, etc.) and the infinite-loop guard holds (no runaway refetch); Compute Geometries polls + cancels + cleans up the interval on unmount (no leak); both reuse the existing query keys; legacy `WorldViewImportReview` untouched (`git diff` empty); the danger-zone styling makes Re-match clearly destructive; gates + runtime smoke (start a compute on a small WV, confirm progress + completion). Fold fixes. Docs: one line in `docs/tech/world-view-import.md` dashboard paragraph (Re-match All + Compute Geometries now on the dashboard).

**Self-review:** an admin can re-match and compute geometries from the dashboard without the legacy screen; the re-match confirm + progress + reset is correct and not accidentally triggerable.
