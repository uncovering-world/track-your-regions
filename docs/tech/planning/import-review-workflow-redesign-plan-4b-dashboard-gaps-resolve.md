# Plan 4b: Dashboard Global-Gaps Resolution

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sub-plan of `…-plan-4-complete-new-ui.md`.

**Goal:** Let the admin RESOLVE top-level GADM coverage gaps from the dashboard Global-gaps tab (currently only run-check + dismiss/undismiss). Per gap: approve the pre-computed suggestion (add to a region / create a region), or geo-suggest a target, or pick a region manually. Mirrors the legacy `CoverageResolveDialog` resolve capability at world-view scope (minus the obsolete gap-tree drill-down + shadow insertions).

**Architecture:** Frontend-only; reuse the existing global coverage API: `CoverageGap.suggestion` (`{action:'add_member'|'create_region', targetRegionId, targetRegionName}|null`), `geoSuggestGap(wv, divisionId)`, `approveCoverageSuggestion(wv, divisionId, regionId, action, gapName?)`, plus a region search (`searchRegions(worldViewId, query)` — find the exact export). On approve, patch the cached `CoverageResult` (drop the resolved gap, like the dismiss handler) and bump the dashboard so the Finalize gate (needs 0 active gaps) reflects it.

**Tech Stack:** React + MUI + TanStack Query. Gates: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run` + root knip.

**Conventions:** `front:` commits, `-s`, Co-Authored-By trailer; never stage the two dirty files / `data/`.

---

### Task 1: Per-gap resolve controls in GlobalGapsTab

**Files:** `frontend/src/components/admin/importDashboard/GlobalGapsTab.tsx`. READ it first (the active-gaps `coverage.gaps.map(g => …)` list, the `dismissMutation` cache-patch pattern, the `CoverageResult`/`CoverageGap` types in `api/admin/wvImportCoverage.ts`, and `geoSuggestGap`/`approveCoverageSuggestion`/`searchRegions` signatures).

- [ ] **Step 1:** For each active gap row, add (besides the existing Dismiss):
  - **Suggested target (when `g.suggestion` present):** show `→ {g.suggestion.targetRegionName}` + the action chip (`add to region` / `create region`) and an **Approve** button → `approveMutation.mutate({ divisionId: g.id, regionId: g.suggestion.targetRegionId, action: g.suggestion.action, gapName: g.name })`.
  - **Geo-suggest (icon button):** `geoSuggestGap(worldViewId, g.id)` → on result, render the nearest region + an Approve (`action:'add_member'`, regionId = the suggested region). Lazy per-row state.
  - **Manual:** a small "Choose region…" `Autocomplete` (searchRegions) per row (collapsed by default) → on select, an Approve with a choice of `add_member` (default) or `create_region` (when the gap should become a new region under the chosen region — keep it simple: an `add_member` Approve plus a separate "Create region here" affordance if cheap; if not, `add_member` only and note it).
- [ ] **Step 2:** `approveMutation`: `mutationFn` calls `approveCoverageSuggestion(...)`; `onSuccess` patches the `['admin','wvImport','coverage',worldViewId]` cache to remove the resolved gap (mirror the dismiss handler's `setQueryData`) AND invalidates `['admin','wvImport','workflowDashboard',worldViewId]` so the Finalize gate updates. Show a brief success line.
- [ ] **Step 3:** Keep run-check + dismiss/undismiss + dismissed section exactly. Disable a row's actions while its approve/geo-suggest is pending.
- [ ] **Step 4:** Gates; commit `front: Add global-gap resolution to the dashboard.`

### Task 2: review + docs
Combined review: approve (suggestion / geo-suggest / manual) hits `approveCoverageSuggestion` with the right `(divisionId, regionId, action)`; resolved gap leaves the list + dashboard gate updates (trace the cache patch + invalidation); geo-suggest lazy fetch; manual search uses the world-view-scoped region search; no regression to run/dismiss/undismiss; create_region path (if implemented) creates under the right region; gates + runtime smoke. Fold fixes. Docs: one line in `docs/tech/world-view-import.md` dashboard paragraph (Global-gaps tab now resolves, not just dismisses).

**Self-review:** an admin can take a real top-level gap (e.g. a missing micro-state) to resolved from the dashboard, and the Finalize button unblocks once the last active gap is resolved.
