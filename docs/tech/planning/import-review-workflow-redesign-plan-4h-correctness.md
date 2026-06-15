# Plan 4h: Deferred Backend/Map Correctness Items

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sub-plan of `…-plan-4-complete-new-ui.md`. Four independent small fixes; each ships on its own.

**Goal:** Close the four deferred correctness items: (1) finalize enforces zero active global gaps server-side, (2) sync-instances restores the matched-status gate, (3) the workspace map bbox is antimeridian-aware, (4) a unit's own members fill on the map even when it also has children.

**Gates per task:** backend `cd backend && npx tsc --noEmit && npx vitest run`; frontend `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`; root knip. `front:`/`back:` commits, `-s`, Co-Authored-By trailer; never stage the two dirty files / `data/`.

---

### Task 1 (backend): finalize enforces zero active global gaps

**Files:** `backend/src/controllers/admin/wvImportFinalizeController.ts` (the gate ~:84-103), reuse `COVERAGE_GAPS_SQL` from `wvImportCoverageController.ts` (export it if not exported). Test: extend the finalize gate test.

The gate currently checks `skeleton_confirmed` + `unsigned_units` only, with a comment "Global-gap zero-count remains validated client-side." The dashboard does NOT actually gate Finalize on gaps. Make finalize reject when active global gaps remain.

- [ ] **Step 1:** Export `COVERAGE_GAPS_SQL` from `wvImportCoverageController.ts` (or add a `countActiveCoverageGaps(worldViewId): Promise<number>` helper there that runs it + subtracts `world_views.dismissed_coverage_ids`). Run it in `finalizeReview` to get `activeGaps` (gaps NOT in `dismissed_coverage_ids`).
- [ ] **Step 2:** Add `activeGaps` to the 400 gate: if `!skeletonConfirmed || unsignedUnits > 0 || activeGaps > 0` → 400 `{error:'Workflow incomplete', skeletonConfirmed, unsignedUnits, activeGaps}`. Update the comment.
- [ ] **Step 3:** Test (`wvImportFinalizeController.gate.test.ts`): a 400 case with `activeGaps > 0` (skeleton ok, units signed off, but gaps remain); the pass case now mocks 0 active gaps too. Run.
- [ ] **Step 4:** Commit `back: Gate finalize on zero active global gaps.`

### Task 2 (frontend): sync-instances matched-status gate

**Files:** `frontend/src/components/admin/importWorkspace/ActionPanel.tsx` (VerificationTools sync button). READ the legacy gate (`TreeNodeActions.tsx` `SyncToInstancesButton`: requires `role==='country' && hasDuplicate && isMatched` where isMatched = matchStatus in auto/manual/children_matched).

- [ ] **Step 1:** The workspace sync button shows on `hasDuplicateSourceUrl` (+ `isSynced` disable). Add the matched-status condition: only show/enable when `node.matchStatus` is one of `auto_matched`/`manual_matched`/`children_matched` (an unmatched duplicate has nothing to sync). Keep the `isSynced` "already in sync" disable.
- [ ] **Step 2:** Gates; commit `front: Gate sync-instances on matched status.`

### Task 3 (frontend): antimeridian-aware map bbox

**Files:** `frontend/src/components/admin/importWorkspace/WorkspaceMap.tsx` (`computeBbox` ~:81, the `TODO(plan-4)` marker), maybe a small `bboxUtils.ts` + test.

`computeBbox` does naive min/max longitude — a geometry crossing the antimeridian (e.g. Russia/Fiji, points near both +180 and −180) yields a whole-world bbox. Per CLAUDE.md (`focus_bbox` west>east ⇒ crossing; MapLibre `cameraForBounds` doesn't handle it; shift `east+360`).

- [ ] **Step 1:** Detect crossing: if the computed lng span (`maxLng - minLng`) > 180, treat as antimeridian crossing. Recompute by shifting all longitudes < 0 by +360, take min/max in the shifted space, then the bbox is `[shiftedWest, south, shiftedEast, north]` with east possibly >180. Return a flag or the shifted bbox so `fitBounds` frames the unit correctly (MapLibre wraps lng>180). Extract the logic into a pure `computeBbox`/`bboxOf` helper and unit-test it (a non-crossing bbox unchanged; a crossing fixture — points at +179 and −179 — yields a narrow shifted bbox, not the whole world).
- [ ] **Step 2:** Wire `fitBounds` to use the (possibly shifted) bbox. Verify it doesn't break the common (non-crossing) case. Note: a real crossing unit may not exist in dev data; verify the helper via the unit test + reason about fitBounds.
- [ ] **Step 3:** Gates; commit `front: Make the workspace map bbox antimeridian-aware.`

### Task 4 (backend): fill a unit's own members even with children

**Files:** `backend/src/controllers/admin/wvImportCoverageCompareController.ts` (`getChildrenRegionGeometry` ~:841-858). Test: the existing/related test if any, else a source-shape assertion.

Currently the unit's own members are added as a fill region only when `!hasChildren` (`:857`). A unit with BOTH children AND own members doesn't fill its own members.

- [ ] **Step 1:** Change the condition so the root's own members are included whenever `rootDivisionIds.length > 0` (regardless of `hasChildren`): `if (rootDivisionIds.length > 0) childRegionDivIds.set(regionId, rootDivisionIds);`. The `children_matched` case (0 own members) stays unaffected (empty → not added). Keep everything else.
- [ ] **Step 2:** Live-verify on the dev DB: a unit with both children and own members now returns its own geometry as a region entry (find one or reason from the SQL); the childless CAR case (region 177) still returns its own fill; a children_matched unit (0 own members) still returns only child fills.
- [ ] **Step 3:** Commit `back: Fill a unit's own members on the map even with children.`

### Task 5: review + docs
Combined review: (1) finalize 400s with active gaps (trace the count = gaps − dismissed; a fully-dismissed world still finalizes); the dashboard Finalize error surfaces `activeGaps`; (2) sync gated on matched status (unmatched duplicate hides it); (3) antimeridian helper correct (crossing fixture narrow, non-crossing unchanged), fitBounds wired; (4) mixed-unit fills own members, children_matched unaffected. Gates (backend + frontend + knip) + runtime smoke. Fold fixes. Docs: a line in `docs/tech/world-view-import.md` noting finalize now enforces zero active gaps server-side.

**Self-review:** finalize cannot pass with active global gaps even if the client is bypassed; the other three are correctness/edge fixes with tests.
