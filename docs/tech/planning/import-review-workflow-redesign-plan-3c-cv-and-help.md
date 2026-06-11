# Import Review Workflow Redesign — Plan 3c: CV Match in Workspace + Action Help

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** (1) CV color match + Mapshape match launchable from the workspace ActionPanel (full pipeline, not a legacy link). (2) Every ActionPanel action self-explains: rich hover tooltips (title + what-it-does + requirement note when disabled) and inline descriptions inside the Restructure menu.

**Why:** user review — CV match was missing from the workspace (Plan-3 descope) and the panel's terse labels don't explain what actions do (the exact confusion the redesign spec set out to kill).

**Facts (verified):** `useCvMatchPipeline(worldViewId, tree, onComplete?)` is decoupled — returns `handleCVMatch`, `handleMapshapeMatch`, `cvMatchingRegionId`, `mapshapeMatchingRegionId`, dialog state; the legacy tree instantiates it at `WorldViewImportTree.tsx:180` and renders `<CvMatchDialog …>` at `:779` (read that block for the exact props). Prereqs: CV needs node `regionMapUrl` + children; mapshape needs `sourceUrl` + children.

---

### Task 1: CV + Mapshape in the workspace

**Files:** `importWorkspace/CountryWorkspacePage.tsx`, `importWorkspace/ActionPanel.tsx`.

- Page: `const cvPipeline = useCvMatchPipeline(worldViewId, tree, /* onComplete */ (regionId) => { invalidate matchTree + dashboard + onMatchChange; })` — READ the legacy instantiation first (it passes `dialogs.handleSmartSimplify` as onComplete — decide: the workspace passes a callback that invalidates and opens nothing; note why in the commit body). Render `<CvMatchDialog …>` with the same props the legacy tree passes (read `WorldViewImportTree.tsx:779+` and replicate; `highlightClusterId` state lives in the pipeline hook result).
- ActionPanel Assignment group gains two buttons wired to `cvPipeline.handleCVMatch(selectedId)` / `handleMapshapeMatch(selectedId)`, busy via the pipeline's busy ids, enabled per prereqs (`node.regionMapUrl` + children; `node.sourceUrl` + children), with requirement notes in the disabled tooltip.
- Gates; commit `front: Launch CV and mapshape match from the workspace.`

### Task 2: Action help layer

**Files:** create `importWorkspace/actionHelp.ts`; modify `ActionPanel.tsx` (+`SuggestionList.tsx` accept/reject/preview buttons if trivial).

- `actionHelp.ts`: `export interface ActionHelp { title: string; description: string; requires?: string }` and `export const ACTION_HELP: Record<string, ActionHelp>` covering EVERY panel action. Write accurate descriptions from the authoritative docs — `docs/tech/world-view-import.md` (match methods §"Per-Region Matching", restructure ops, simplify §`import-review-tree-ops.md`) — 1–2 sentences each, plain language, e.g. `geoshape: { title: 'Geoshape match', description: 'Fetches the region's Wikidata boundary and finds the GADM divisions that best tile it (IoU scoring). Best first choice when a Wikidata ID exists.', requires: 'Wikidata ID' }`. Cover: 5 match methods, auto-resolve, division search, match-children-independently, CV match, mapshape match, the 5 restructure ops, AI review children, rename/reparent/add/remove, simplify/simplify-children/smart-simplify, overlap check, clear members, reset match, waive, manual-fix, sync instances.
- `HelpTip` mini-component in ActionPanel (or small shared file): MUI `Tooltip` with structured content — bold title line, description, and when the button is disabled an italic `Requires: X` line — `enterDelay={300}`, `placement="top"`, arrow. Wrap every panel button. Restructure `MenuItem`s additionally get `ListItemText primary={title} secondary={description}` so the menu itself reads like documentation (menu width ~360px).
- Group headers get a one-line `Typography variant="caption"` purpose note (Hierarchy: "Shape the subtree before assigning"; Assignment: "Find and assign GADM divisions for the selected region"; Cleanup & checks: "Tidy granularity and validate before sign-off").
- Gates; commit `front: Add self-explaining help to workspace actions.`

### Task 3: review + fixes
Combined review: CvMatchDialog prop parity vs legacy (crash-on-open risk), pipeline busy/abort behavior in workspace context, help accuracy vs docs (spot-check 6 descriptions), gates (162+ frontend tests, knip), runtime smoke. Fold fixes.
