# Plan 4g: Create-Region-From-Gap

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sub-plan of `…-plan-4-complete-new-ui.md`.

**Goal:** Let the operator resolve a coverage gap by **creating a new region** for it (not only assigning it to an existing region) — for gaps that should become their own region rather than fold into a sibling. Done in the workspace `CoverageGapsPanel`, reusing `approveCoverageSuggestion(..., 'create_region', gapName)`.

**Scope note (non-unit gap analysis):** the umbrella's "non-unit gap analysis" is intentionally NOT added as a separate per-sub-container view — the unit-level boundary panel (Plan 3g) already surfaces the minimal highest-level uncovered divisions at the correct depth for the whole unit, so a per-non-unit-node analysis would be redundant. Only the create-region capability is the genuine gap. (Recorded so the umbrella's checklist isn't read as incomplete.)

**Architecture:** `CoverageGapsPanel` already resolves via `addDivisionsToRegion` (assign to existing) / its assign control. Add a per-gap "Create region" path: `approveCoverageSuggestion(worldViewId, divisionId, parentRegionId, 'create_region', gap.name)` creates a new child region under `parentRegionId` named after the gap + assigns the gap division to it. Default `parentRegionId` to the unit root (or the geo-suggested region's parent if available). After create → invalidate matchTree + childrenGeometry + gapAnalysis (the gap leaves, the new region + its fill appear) + bump dashboard/verify.

**Tech Stack:** React + MUI + TanStack Query. Gates: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run` + root knip.

**Conventions:** `front:` commits, `-s`, Co-Authored-By trailer; never stage the two dirty files / `data/`.

---

### Task 1: Create-region affordance per gap

**Files:** `frontend/src/components/admin/importWorkspace/CoverageGapsPanel.tsx`. READ it (the `GapRow` resolve controls — the assign Autocomplete + Assign button, the `assignMutation` using `addDivisionsToRegion`, the invalidations, `suggestedTarget`), and `approveCoverageSuggestion` in `api/admin/wvImportCoverage.ts`.

- [ ] **Step 1:** Add a **"Create region"** action to each GapRow (a button next to "Assign", or a small menu "Assign ▾ / Create region"). It creates a new region named after the gap. Choose the parent: default to the unit root region id (the panel knows `unitId`); allow overriding the parent via the same region Autocomplete already in the row (so the operator can place the new region under a specific container). Confirm copy: "Create region '<gap name>' under <parent name>".
- [ ] **Step 2:** Wire a `createRegionMutation`: `mutationFn` → `approveCoverageSuggestion(worldViewId, gap.divisionId, parentRegionId, 'create_region', gap.name)`. `onSuccess` → invalidate `['admin','wvImport','matchTree',worldViewId]`, `['admin','wvImport','childrenGeometry',worldViewId]`, the `gapAnalysis` key (so the gap leaves the panel + map), `['admin','wvImport','workflowDashboard',worldViewId]`, and call the panel's `onMatchChange` (stale the checks). Drop the resolved gap from the local list like the assign path does.
- [ ] **Step 3:** Keep the existing assign-to-existing path unchanged; the Create-region path is additive. Disable the row's actions while either mutation pends.
- [ ] **Step 4:** Gates; commit `front: Add create-region-from-gap to the coverage panel.`

### Task 2: review + docs
Combined review: Create region calls `approveCoverageSuggestion(divisionId, parentRegionId, 'create_region', gapName)` with the RIGHT args (divisionId = the gap GADM division, regionId = the chosen PARENT, action='create_region', gapName = the new region's name) — trace the backend `approve-coverage` create_region branch creates a region under the parent + a member; the new region appears in the tree (matchTree refetch) and its fill on the map (childrenGeometry refetch); the gap leaves the panel; assign-to-existing path unregressed; gates + runtime smoke. Fold fixes. Docs: one line in `docs/tech/world-view-import.md` (coverage panel can now create a region from a gap, not just assign).

**Self-review:** a gap that should be its own region (e.g. an unclaimed territory that isn't part of any sibling) can be turned into a new region in one action from the workspace.
