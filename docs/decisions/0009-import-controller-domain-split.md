# ADR-0009: Split worldViewImportController by domain (lifecycle, match, coverage, AI, tree-ops, etc.)

## Status
Accepted — 2026-04-25

## Context
`backend/src/controllers/admin/worldViewImportController.ts` grew to 2376 lines covering
seven distinct concerns: import session lifecycle, region-to-division match operations
(accept/reject/batch), coverage gap analysis, AI-assisted match endpoints, tree
operations (dismiss children, undo), hierarchy flattening, and finalization/rematch
flows. Editing one concern requires loading the entire file in context; testing one
concern requires understanding shared state across all of them. CLAUDE.md flags files
over ~1000 lines for refactor consideration.

## Decision
Split by **domain** (the conceptual operation a handler performs) rather than by
**HTTP verb** (GET vs POST) or **lifecycle phase** (import vs review vs finalize).
Eight focused files, each owning one domain:

- `wvImportLifecycleController.ts` — session start/status/cancel + Wikidata geoshape proxy
- `wvImportMatchController.ts` — accept/reject/batch match operations + match tree retrieval
- `wvImportCoverageController.ts` — coverage gap detection + SSE progress + geo-suggest
- `wvImportAIController.ts` — AI-assisted match endpoints (start, status, cancel, single-region search)
- `wvImportTreeOpsController.ts` — destructive tree operations (dismiss children)
- `wvImportHierarchyController.ts` — non-destructive hierarchy ops (undo)
- `wvImportFlattenController.ts` — flattening + sync-instances + handle-as-grouping
- `wvImportFinalizeController.ts` + `wvImportRematchController.ts` — finalization + rematch flow

The monolith `worldViewImportController.ts` becomes a re-export barrel so existing
import sites in `adminRoutes.ts` don't change.

## Alternatives considered
- **By HTTP verb:** Group all `GET` handlers together, all `POST` together. Rejected
  because verb says nothing about cohesion — `GET /coverage` and `GET /match-tree` have
  no shared concepts.
- **By lifecycle phase (import / review / finalize):** Initially appealing but the
  match operations span all three phases, so splitting by phase produces fragmented
  files that all touch `region_match_status`.
- **Keep monolith, split into helper modules:** Solves file size but not the
  conceptual coupling — handlers still cohabit, exports still flat.

## Consequences
- **+** Each domain file fits comfortably in an editor context (largest is ~600
  lines after extraction).
- **+** Future feature work on one domain (e.g. CV matching enhancements) doesn't
  touch unrelated domain files.
- **+** The monolith becomes a routing-stable barrel; route imports never need to
  follow split events.
- **−** Some shared state (`undoEntries` Map, used by tree-ops + flatten + hierarchy)
  remains in the monolith / a shared utils module rather than being inlined in any
  one domain. Documented per-PR.
- **−** Initial split costs 8 stacked PRs of refactor churn before any feature work
  resumes. Acceptable: tier-0 cleanup unblocks the lint gate, spine refactor
  unblocks all subsequent feature PRs from inheriting the monolith.

## Implementation
Spine PRs 10–17 in `docs/inbox/2026-04-25-rebuild-spine-plan.md`.
