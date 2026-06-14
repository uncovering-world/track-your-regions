# Plan 4c: Multi-Select Batch Accept/Reject

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Sub-plan of `import-review-workflow-redesign-plan-4-complete-new-ui.md`.

**Goal:** Add checkbox multi-select to the workspace Proposed list so the operator can accept/reject a chosen subset in one action — for the common "12 suggestions, 7 correct" case that today forces one-by-one. Reuse the batch mutations that already exist in `useTreeMutations`.

**Architecture:** Selection state lives in `SuggestionList`; a selection toolbar appears when ≥1 proposal is checked, wired to the existing `acceptSelectedMutation` / `acceptSelectedRejectRestMutation` / `rejectSelectedMutation` (`{regionId, divisionIds}`). A selected subset containing conflict suggestions routes through the existing `onPreviewTransfer` batch path (multi-donor grouping) instead of a blind batch accept. The existing "Accept all" / "Dismiss all" (act on ALL) stay.

**Tech Stack:** React + MUI + TanStack Query. Frontend-only. Gates: `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run` + root knip.

**Conventions:** `front:` commits, `-s`, Co-Authored-By: Claude Fable 5 trailer. Never stage `.claude/commands/commit.md` / `frontend/package-lock.json` / `data/`.

**Existing reusables (verified):** `mutations.acceptSelectedMutation.mutate({ regionId, divisionIds })`, `mutations.acceptSelectedRejectRestMutation.mutate({ regionId, divisionIds })`, `mutations.rejectSelectedMutation.mutate({ regionId, divisionIds })`. `onPreviewTransfer(sug.conflict, ..., regionId, allDivisionIds, allSuggestions)` already groups a batch of conflicts by donor (see `handleConflictAccept`/`useWorkspacePreview`). Each suggestion row carries `sug.conflict` (present iff it conflicts with a sibling assignment).

---

### Task 1: Selection state + per-row checkboxes + select-all

**Files:** `frontend/src/components/admin/importWorkspace/SuggestionList.tsx`. READ it first (the `PROPOSED (N)` header with Accept-all/Dismiss-all, the `suggestions.map(sug => …)` row block, `handleConflictAccept`, the source-chip/score/geo rendering, the `onHoverProposed` wiring).

- [ ] **Step 1:** Add local state `const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())` (division ids). Reset it to empty whenever `node.id` changes (effect keyed on `node.id`) and after any bulk action succeeds.
- [ ] **Step 2:** Add a small leading `Checkbox` (size small) to each Proposed row: checked = `selectedIds.has(sug.divisionId)`, onChange toggles it in the set. Clicking the checkbox must `stopPropagation` so it doesn't trigger row hover/preview. Keep the existing per-row 👁/✓/✗ and conflict-↑ exactly.
- [ ] **Step 3:** Add a "select all" `Checkbox` in the `PROPOSED (N)` header (indeterminate when some-but-not-all selected; checked when all). Toggles all current suggestion division ids.
- [ ] **Step 4:** Gates; commit `front: Add multi-select checkboxes to the Proposed list.`

### Task 2: Selection toolbar + batch actions

**Files:** same.

- [ ] **Step 1:** When `selectedIds.size > 0`, render a compact selection toolbar (replace or sit above the Accept-all/Dismiss-all row) showing `N selected` + buttons: **Accept selected**, **Accept + reject rest**, **Reject selected**, **Clear**. When `selectedIds.size === 0`, show the existing Accept-all/Dismiss-all as today.
- [ ] **Step 2:** Wire actions on the selected division ids (`const ids = [...selectedIds]`):
  - **Reject selected** → `mutations.rejectSelectedMutation.mutate({ regionId, divisionIds: ids })` then clear selection.
  - **Accept + reject rest** → `mutations.acceptSelectedRejectRestMutation.mutate({ regionId, divisionIds: ids })` then clear.
  - **Accept selected** — split by conflict: `const selectedSugs = suggestions.filter(s => selectedIds.has(s.divisionId))`. If NONE have `conflict` → `mutations.acceptSelectedMutation.mutate({ regionId, divisionIds: ids })` then clear. If SOME have `conflict` → route the whole selected set through the existing transfer-preview batch path: call `onPreviewTransfer` with the first conflicted sug's conflict + `allDivisionIds = ids` + `allSuggestions = selectedSugs.map(s => ({ divisionId: s.divisionId, conflict: s.conflict }))` (match the exact `onPreviewTransfer` signature in this file's props — read it; the dialog's Accept Transfer then executes the grouped transfer + the clean accepts). Clearing selection happens on the preview's done callback (same as the single-row conflict path).
  - **Clear** → `setSelectedIds(new Set())`.
- [ ] **Step 3:** Disable the toolbar buttons while any relevant mutation `isPending` (reuse `mutations.*.isPending` / the existing `isMutating` flag).
- [ ] **Step 4:** Gates; commit `front: Add batch accept/reject toolbar for selected proposals.`

### Task 3: review + docs
Combined review: selection toggles + select-all/indeterminate; the three bulk actions hit the right mutations with the selected ids; a mixed selection (some conflicts) routes through `onPreviewTransfer` batch (not a blind accept) and the clean ones still get accepted; selection resets on node change + after each action; Accept-all/Dismiss-all unchanged when nothing selected; no regression to single-row accept/reject/preview/transfer or the Proposed source chips / map hover. Gates + runtime smoke. Fold fixes. Docs: one line in `docs/tech/world-view-import.md` workspace paragraph (multi-select batch accept/reject in the Proposed list).

**Self-review:** the win is "select 7 of 12 → Accept selected in one click" — verify that exact flow, including when some of the 7 are conflicts (transfer preview opens for those, clean ones accepted).
