# Import Review Workflow Redesign — Plan 4: Complete the New UI (umbrella)

> **For agentic workers:** This is an UMBRELLA roadmap. Each sub-plan (4a…4i) is written as its own detailed TDD plan doc when it is started (the pattern used for plans 3b–3h) and executed via superpowers:subagent-driven-development with two-stage review. Do not implement from this doc directly — it defines scope, ordering, and acceptance per sub-plan.

**Goal:** Migrate the remaining legacy-only capabilities into the new dashboard/workspace and fix the deferred backend-correctness items, so the new UI is a complete replacement — **without deleting the legacy `WorldViewImportReview` screen** (kept as a fallback via the `?wvReview=` deep-link).

**Scope decision (2026-06-14):** the destructive cutover — deleting `WorldViewImportReview.tsx` / `WorldViewImportTree.tsx` / `TreeNodeActions.tsx` etc., plus the "new UI is primary, legacy removed" ADR — is **explicitly deferred to a separate future branch**, done once the new UI is fully trusted in real use. Plan 4 only ADDS to / completes the new UI and fixes correctness; it removes nothing the operator relies on.

**Tech Stack:** Express + raw `pg`/PostGIS backend, React 18 + MUI + TanStack Query + react-map-gl/maplibre frontend. Gates: backend `cd backend && npx tsc --noEmit && npx vitest run`; frontend `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`; root `npm run knip`. Python gates via Docker (see [[python-gates-need-docker]]). Branch: `feat/import-review-dashboard-ui` (continue here).

**Conventions:** every sub-plan ships independently (gate-clean, reviewed, committed). Commit prefixes `back:`/`front:`, `-s`, Co-Authored-By: Claude Fable 5 trailer. Never stage `.claude/commands/commit.md` / `frontend/package-lock.json` / `data/`.

---

## What is already done (do NOT re-do)

Plans 1, 2, 3, 3b–3h are complete on this branch: backend work-unit/sign-off model; the `/admin/import/:wv` dashboard (Countries/Skeleton/Global-gaps tabs); the `/admin/import/:wv/region/:id` workspace (scoped tree, persistent map, **stage-driven** action area — HierarchyTools/AssignmentTools/VerificationTools, Proposed bucket, finder feedback, coverage-gap resolution panel with boundary granularity, CV/mapshape match, preview/transfer/union/view-map suite). Most of the legacy tree's tools already live in the workspace.

## Legitimately obsolete (do NOT migrate — replaced by a better model)

Per the 2026-06-12 parity audit: the world-scale stats-chips bar, the unresolved/single-child/warnings/incomplete-coverage nav categories, expand/collapse-all, and the shadow-insertion choreography are superseded by the dashboard progress + ChecksBar worklists + scoped tree + direct map click-assign. They are intentionally not ported.

---

## Sub-plans (ordered by value × the operator's actual workflow; each shippable on its own)

### 4a — Write-side suggestion dedup (backend correctness) ← START HERE
**Why first:** the recurring "same division twice in Proposed" bugs the operator keeps hitting. Plan 3g/this-session added only a read-side filter; the ~10 finder/matcher INSERT sites still accumulate duplicate `region_match_suggestions` rows.
**Scope:** add a partial unique index on `region_match_suggestions(region_id, division_id)` (WHERE `rejected = false`); convert all insert sites to `ON CONFLICT (region_id, division_id) WHERE rejected = false DO UPDATE SET score = GREATEST(...), geo_similarity = COALESCE(EXCLUDED..., ...), …` (or a shared `upsertSuggestion` helper that all ~10 sites call); finder inserts also skip divisions already in `region_members` for that region; a migration deletes existing dups (keep best score) before adding the index. Keep the Plan-3g read-side dedup as defense-in-depth.
**Key files:** `backend/src/services/worldViewImport/{matcher,matcherGrouping,aiMatcherApply,geocodeMatcher,dbSearchMatcher,pointMatcher,geoshapeCache}.ts`, `backend/src/controllers/admin/{wvImportHierarchyController,wvImportFlattenController}.ts`, new migration `db/migrations/007-*.sql` + `db/init/01-schema.sql`.
**Acceptance:** running any finder repeatedly on a region never creates a second suggestion row for the same division; dev DB existing dups (Chad etc.) cleaned by the migration; verify subquery still returns deduped.

### 4b — Dashboard global-gaps resolution
**Why:** the dashboard Global-gaps tab currently only runs the check + dismiss/undismiss. The legacy `CoverageResolveDialog` had the full resolve flow (geo-suggest per gap, assign-to-existing / create-new-region, manual region search). Reuse the workspace's `CoverageGapsPanel` patterns (boundary granularity, geo-suggested assign) at the world-view scope.
**Key files:** `frontend/src/components/admin/importDashboard/GlobalGapsTab.tsx`; reuse `wvImportCoverage` API (`geoSuggestGap`, `approveCoverageSuggestion`), `getCoverageBoundaries` semantics where applicable.
**Acceptance:** an admin can resolve a top-level GADM gap (assign to a region or create a region) entirely from the dashboard; coverage recheck reflects it; no shadow-insertion machinery.

### 4c — Multi-select batch accept/reject (+ batch transfer preview)
**Why:** common "12 suggestions, 7 correct" case; today the workspace forces one-by-one. Legacy had checkbox multi-select + Accept N / Accept-N-reject-rest / batch transfer preview.
**Key files:** `frontend/src/components/admin/importWorkspace/SuggestionList.tsx` (selection state + bulk actions); reuse `acceptBatchMatches`, the existing transfer-preview path for the conflict subset.
**Acceptance:** select several proposals, Accept selected / Reject selected in one action; conflicted selections route through the existing transfer preview as a batch.

### 4d — AI tools into the workspace
**Why:** AI hierarchy review is stage-1 work but the `AIReviewDrawer` (global + per-subtree report/checklist) is absent from the workspace, and AI-suggest-children is view-only (apply disabled).
**Scope:** (1) wire AI-suggest-children **apply** in the workspace dialog (the apply endpoints already exist); (2) bring the `AIReviewDrawer` (or an equivalent) into the workspace Hierarchy stage / a dashboard entry.
**Key files:** `frontend/src/components/admin/importWorkspace/*` (Hierarchy stage), `AIReviewDrawer.tsx`, `useImportTreeDialogs.ts` (the suggest-children apply path).
**Acceptance:** an admin can run AI review of a branch and apply add/remove/rename actions from the new UI without the legacy screen.

### 4e — Map-image picker in the workspace
**Why:** selecting the correct region map from candidates was excluded from the workspace; it's the prereq for CV match and the region-map preview comparison.
**Key files:** `frontend/src/components/admin/MapImagePickerDialog.tsx` (reuse), wire into the workspace preview/CV entry points; the `mapPickerState` deps in `useTreeMutations` (currently no-op'd in the workspace).
**Acceptance:** an admin can pick/confirm a region's map image in the workspace; CV match and region-map preview use it.

### 4f — Relocate Re-match All + Compute Geometries to the dashboard
**Why:** these world-view-level operations live only on the legacy toolbar.
**Key files:** `frontend/src/components/admin/importDashboard/ImportDashboardPage.tsx` (danger-zone menu already mentioned in Plan 2 for Re-match); add Compute Geometries with progress; reuse existing geometry/rematch APIs + polling.
**Acceptance:** Re-match All (with confirm) and Compute Geometries (with progress/cancel) are runnable from the dashboard.

### 4g — Non-unit gap analysis + create-region-from-gap
**Why:** the workspace gap panel works at the unit root; the legacy `GapAnalysisDialog` also handled gaps for non-unit nodes and could create a new region from a gap.
**Key files:** `CoverageGapsPanel.tsx` (allow a selected non-unit container as the scope), the create-region action; reuse `analyzeCoverageGaps` (now boundary-based) + `addChildRegion`.
**Acceptance:** gaps under a selected sub-container are listable/resolvable; "create new region from this gap" works.

### 4h — Deferred backend-correctness items
**Scope (independent small fixes, can be one sub-plan):**
- `finalizeReview`: enforce the 3rd condition (zero active global gaps) **server-side** (currently client-only).
- Sync-instances: restore the legacy matched-status gate (`role==='country' && matched`).
- `WorkspaceMap` `computeBbox`: antimeridian-aware (west>east) — the `TODO(plan-4)` marker.
- `getChildrenRegionGeometry`: also fill a unit's own members when it has BOTH children AND own members (the mixed-unit edge noted when fixing CAR).
**Acceptance:** each has a test; finalize cannot pass with active global gaps even if the client is bypassed.

### 4i — Docs (new UI primary; legacy retained)
**Scope:** update `docs/tech/world-view-import.md` so the dashboard/workspace is described as the primary review UI and the legacy screen is documented as a temporary fallback reachable via `?wvReview=`; trim the planning docs to only-unimplemented; update `docs/vision/vision.md` for any user-facing capability added in 4a–4h. **No deletion ADR here** — that belongs to the future cutover branch.
**Acceptance:** docs reflect the shipped new UI; CLAUDE.md doc-sync rules satisfied.

---

## Sequencing & notes
- **Recommended order:** 4a → 4c → 4b → 4d → 4e → 4f → 4g → 4h → 4i (value × workflow; correctness first). Re-orderable per the operator's testing priorities.
- Each sub-plan: write its detailed TDD plan doc (`…-plan-4a-*.md`), execute via subagent-driven-development with spec + quality review, fold fixes, ship.
- **Out of scope (future branch):** deleting legacy `WorldViewImportReview`/`WorldViewImportTree`/`TreeNodeActions` and the cutover ADR; the umbrella "World View levels & perspectives" Phase 1a (gated on import-review merge — see [[world-view-levels-perspectives-design]]).
- Before opening the import-review PR: `npm run security:all` (slow Semgrep + Trivy) per project policy.
