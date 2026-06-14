# Import Review Workflow Redesign — Plan 3h: Stage-Driven Action Area

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The implementer SHOULD invoke the `frontend-design` skill for the stage-tab + tool-layout visual craft (keep it cohesive with the existing MUI admin aesthetic — no jarring new theme).

**Goal:** Replace the bottom monolithic ActionPanel (25 buttons in 3 always-stacked groups) with a **stage-driven** action area: the header stage chips become a clickable switcher (Hierarchy · Assign · Verify), and the lower-left shows ONLY the active stage's tools + that stage's context. Of 25 actions, ~5 show at a time.

**Why (usage data, 48h):** the operator uses ~6 ops constantly (geoshape ×8, point ×6, gap-analysis ×9, accept-batch ×5, reject ×5, reset ×4, ai-match ×1) and **zero** of the other ~20. All 25 currently sit with equal weight at the bottom of a scrolling column, splitting the find→review loop. Chosen direction: stage-driven (the three existing ActionPanel groups already map 1:1 to the stages).

**Key alignment:** the current ActionPanel groups ALREADY are Hierarchy / Assignment / Cleanup&checks — so this is mostly presentational reorg (show one group at a time + relocate two context blocks), not new wiring. All mutation/dialog wiring (`useTreeMutations`, `useImportTreeDialogs`, preview suite) stays in `CountryWorkspacePage` and is passed down unchanged.

**Stage → tools map:**
- **Hierarchy** (node-scoped): AI review children, Rename, Reparent, Add child, Remove, Restructure ▾ (dismiss/prune/collapse/merge/smart-flatten), Match children independently.
- **Assign** (node-scoped) + context: the 5 finders (Geoshape, Points, Geocode, DB, AI) + Auto-resolve + Division search + CV/Mapshape (prereq-gated), the finder result-feedback line, **and the Proposed/Assigned `SuggestionList`** (find→review adjacency).
- **Verify** (unit-scoped) + context: **`CoverageGapsPanel`** + Overlap check, Simplify, Simplify children, Smart simplify, Clear members, Reset match, Waive, Manual-fix, Sync instances. (Run-checks + counts stay in the top `ChecksBar`.)

**Conventions:** `front:` commits, gates per commit (`cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`), root knip at end, `-s` + Co-Authored-By trailer; never stage the two dirty files or `data/`.

---

### Task 1 — Stage switcher + render one stage's tools

**Files:** `CountryWorkspacePage.tsx` (header stage chips → switcher; `activeStageTab` state; render the active stage view), `ActionPanel.tsx` (split its 3 groups into 3 exported sub-components or render one group by a `stage` prop), `ChecksBar.tsx` (the "N gaps"/counts chips switch to Verify tab instead of the toggle).

1. **`activeStageTab` state** (`'hierarchy' | 'assignment' | 'verification'`) lifted in CountryWorkspagePage. Default = `deriveStage(unit, verify)` mapped to a tab (`done`→`verification`). Re-derive default on node/unit change BUT keep a user override until then (i.e., changing the selected node resets to its derived stage; clicking a tab overrides until the next node change). State the exact reset rule in the commit.
2. **Header stage switcher.** Replace the current stage chips (`Hierarchy ✓ · Assign 13/22 · Verify`) with a MUI segmented control / `Tabs` / `ToggleButtonGroup` (pick the one that looks cleanest per frontend-design) showing the three stages, each with its progress glyph (Hierarchy ✓/✗ from `hierarchyConfirmed`; Assign `n/m` leaves; Verify ✓/⚠/— from checks state) and active highlight. Clicking sets `activeStageTab`. The glyphs still reflect unit progress (tab = view, badge = progress).
3. **Lower-left renders by `activeStageTab`:**
   - `hierarchy` → `<HierarchyTools>` (the current Hierarchy group). No suggestion list.
   - `assignment` → `<AssignmentTools>` (finders + feedback line) **then** `<SuggestionList>` (Proposed/Assigned) directly below.
   - `verification` → `<CoverageGapsPanel>` (when gaps exist) **then** `<VerificationTools>` (the current Cleanup&checks group minus run-checks).
   - Keep the selected-node header line above all stages. The map (right) is unchanged across stages.
4. **ChecksBar** "N gaps"/overlap/unassigned count chips → on click set `activeStageTab='verification'` (and keep focus behavior). Remove the separate gaps-panel open/close toggle (Verify stage now owns the gaps panel; if no gaps, the Verify view shows the cleanup tools + a "Run checks / no active gaps" line).
5. Split `ActionPanel.tsx` into `HierarchyTools` / `AssignmentTools` / `VerificationTools` (export from the same file or new files under `importWorkspace/`). They receive the SAME props ActionPanel does today (mutations, dialogs, node, handlers) — pure presentational split; reuse `HelpTip`, the Restructure menu, prereq gating, undo snackbar, finder feedback, etc. exactly. No behavior change per button.

Commit `front: Make the workspace action area stage-driven.`

### Task 2 — Per-stage polish

**Files:** the three tool components + the switcher.

- **Assign**: lay the 5 finders as a tidy primary cluster (the prominent ones — Geoshape/Points/AI — first; Geocode/DB/Auto/Division-search secondary; CV/Mapshape only when prereqs exist), with the feedback line under them, then the SuggestionList. This is the hot path — make it the cleanest.
- **Hierarchy**: AI-review / rename / reparent / add / remove as a row, Restructure ▾ menu as today; a one-line caption.
- **Verify**: gaps panel first (when present), then cleanup actions grouped tightly; reset/clear/waive visually separated (slightly destructive) from simplify/overlap.
- Stage switcher: clear active state, progress glyphs, keyboard-navigable; consistent with the MUI admin look. Apply `frontend-design` judgment for spacing/hierarchy/density — cohesive, not a new theme.
- Empty/contextual: in a stage where an action is inapplicable to the selected node (e.g. merge with ≠1 child, finders on a non-leaf with children already matched), keep the existing disabled+tooltip rather than hiding, so the layout is stable.

Commit `front: Polish per-stage workspace tool layouts.`

### Task 3 — review + docs
Combined review: switcher default/override/reset-on-node-change; all 25 actions reachable in exactly one stage (none lost); SuggestionList only in Assign, CoverageGapsPanel only in Verify, both fully functional there; ChecksBar chips switch tabs; mutation/dialog wiring intact (spot-trace 5 actions across stages incl. an accept, a finder, a restructure, a gap-assign, reset); no regression to map/preview/feedback; gates + runtime smoke. Fold fixes. Docs: update `docs/tech/world-view-import.md` workspace paragraph (stage-driven action area; one stage's tools at a time).

**Self-review:** the find→review loop (finders + Proposed list) must be co-located in the Assign stage with no scroll between them; that's the core win — verify it.
