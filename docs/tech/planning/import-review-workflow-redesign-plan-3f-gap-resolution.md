# Import Review Workflow Redesign — Plan 3f: Coverage-Gap Resolution in the Workspace

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make detected coverage gaps *resolvable* in the workspace. Today checks find gaps (`cover 89% · 1 gaps`) and the map paints them red, but the only resolution is an undiscoverable "select a region, then click the red gap on the map" — no gap list, no map-focus from the count, no geo-suggested target. Port the legacy per-region GapAnalysisDialog into the workspace's inline + map-coupled style.

**Data reality (verified):**
- `verify.coverageGaps` (from `getWorkUnitVerification`) gives the COUNT + names — already shown in ChecksBar.
- `analyzeCoverageGaps(worldViewId, unitRegionId)` (POST `/coverage-gap-analysis/:regionId`) returns the RESOLVABLE list: `gapDivisions: [{divisionId, name, path, geometry, areaKm2, gadmParentId, suggestedTarget?: {regionId}}]` + `siblingRegions`. WorkspaceMap ALREADY fetches this (keyed `['admin','wvImport','gapAnalysis', wv, unitId, verify.verifiedAt]`) to paint red fills — reuse the SAME query key so the new panel shares the cache (no double fetch).
- Resolution = `addDivisionsToRegion(targetRegionId, [gapDivisionId])` (already used by the map gap-click; syncs status + stales the unit + computes geometry).
- `geoSuggestGap(worldViewId, divisionId)` returns a nearest-assigned-region suggestion + context tree — fallback when `suggestedTarget` is absent.
- `searchRegions(worldViewId, query)` for the manual region picker (verify the exact fn/name used by CoverageMapPreview's manual search).

**Out of scope (note in UI):** per-unit gap *dismissal* — `verifyWorkUnit`'s scoped coverage SQL does NOT honor `dismissed_coverage_ids`, so a "dismiss" wouldn't clear the sign-off blocker; assign-to-region is the resolution. "Create new region from gap" — assign-to-existing covers the common sub-national case; the manual picker can target any subtree region. Both deferred (mention in the panel's empty/help text only if natural).

**Conventions:** `front:` commits, gates per commit (`cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`), root knip at task end, `-s` + Co-Authored-By trailer; never stage the two dirty files or `data/`.

---

### Task 1 — Coverage-gaps panel + map focus + inline assign

**Files:** create `importWorkspace/CoverageGapsPanel.tsx`; modify `CountryWorkspacePage.tsx` (lift `focusedGapDivisionId` + a panel-open toggle), `ChecksBar.tsx` (the "N gaps" chip toggles the panel), `WorkspaceMap.tsx` (fly+pulse the focused gap; gap-click focuses the panel row).

1. **Panel visibility.** When `verify.coverageGaps.length > 0`, the ChecksBar "N gaps" chip becomes a toggle that shows/hides a `CoverageGapsPanel` (render it under the ChecksBar, spanning the top of the left column or as an inline section above the tree — pick the cleaner fit; it's unit-scoped, not per-selected-node). Clicking the chip no longer just "focuses the first region" — it opens the panel.

2. **CoverageGapsPanel.** Reuses the shared `analyzeCoverageGaps` query (same key as WorkspaceMap). Lists each `gapDivision`:
   - Name + `path` (muted) + area (`areaKm2` → human `N km²`).
   - **Focus** button → sets page `focusedGapDivisionId` (lifted) → map flies to that gap's geometry bbox + pulses/brightens it.
   - **Assign to** control — a region Autocomplete defaulting to `suggestedTarget.regionId`'s name (resolve the name from the tree data or `siblingRegions`); options = the unit's subtree regions (from the tree). On select + confirm (or an inline ✓) → `addDivisionsToRegion(targetRegionId, [divisionId])` → invalidate matchTree + childrenGeometry + gapAnalysis + workflowDashboard + verify (the gap disappears, the child fill grows, `cover %` climbs, gap count drops). If `suggestedTarget` is absent, on row expand call `geoSuggestGap` to fetch a default (show a small spinner); the user can still pick manually.
   - A short header note: "Assign each uncovered division to the region it belongs to. Coverage must reach 100% (no active gaps) to sign off."
   - When the list becomes empty (all resolved), show a success line and let the panel auto-collapse.

3. **Map coupling (WorkspaceMap).** Add a `focusedGapDivisionId` prop: when set, `fitBounds` to that gap feature's geometry and brighten it (feature property like the proposed-hover pattern). Change the gap-CLICK behavior: instead of "assign to selected region" popover, a gap click now (a) sets `focusedGapDivisionId` (so the panel scrolls/highlights that row) and (b) opens a popover offering **Assign to `<suggestedTarget name>`** (geo-suggested, NOT the tree-selected region) with a confirm — plus a "choose in panel" affording. Keep the gap red fill + legend. (Rationale: the old select-then-click-gap dance was the confusing part the user hit.)

4. Reset `focusedGapDivisionId` and panel-open on node/unit change.

Commit `front: Add coverage-gap resolution panel to the workspace.`

### Task 2 — review + fixes + docs
Combined review: panel reuses the shared gapAnalysis cache (no double fetch); assign uses the right target (suggested vs manual) and refresh chain clears the gap end-to-end (verify by reading invalidations + the verify/childrenGeometry/gapAnalysis keys); map focus fly+pulse + gap-click-to-suggested; the empty/all-resolved state; sign-off gate still requires zero gaps; no regression to the proposed/overlap layers; gates (frontend tsc/eslint/vitest + root knip) + runtime smoke. Fold fixes. Docs: one line in `docs/tech/world-view-import.md` workspace paragraph (gap panel + map-focus + assign-to-suggested).
