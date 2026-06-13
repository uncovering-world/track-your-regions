# Import Review Workflow Redesign — Plan 3e: Match-Results Review UX

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make assignment finders never silent. Results enter a prominent **Proposed** bucket (the existing `suggestions`), every run gives viewport-anchored feedback (count / auto-assigned / loud "none found, try X"), proposed candidates carry a source-method chip, and they **render live on the map** in a distinct colour so the operator sees the candidate shape before accepting. (User chose "Inline + live on map" over a per-call modal — keeps the persistent map visible and supports trying several finders.)

**Data reality (verified):** SuggestionList already splits `node.suggestions` (proposed) vs `node.assignedDivisions` (assigned) — no new persistence needed. `MatchSuggestion` has no `source` column; provenance is tracked CLIENT-SIDE from each finder's returned suggestions (a `Map<divisionId, method>` reset on node change). Finder mutations live in `useTreeMutations` and return their API result (e.g. `dbSearchOne → {found, suggestions}`, `geoshapeMatch → {found, suggestions, scopeAncestorName?}`) — capture via per-call `mutate(vars, { onSuccess })` at the ActionPanel call sites (verify each result shape in `api/admin/worldViewImport.ts`; if a mutation returns void, read `mutation.data`).

**Layout note:** in the left column SuggestionList (proposed+assigned) sits ABOVE ActionPanel (finder buttons), so results appear above the click and often above the scroll fold — hence a **Snackbar toast is required** for feedback, plus an inline line by the buttons, plus a highlight on the Proposed section.

**Conventions:** `front:` commits, gates per commit (`cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`), root knip at task end, `-s` + Co-Authored-By trailer, never stage the two dirty files or `data/`.

---

### Task 1 — Feedback + Proposed bucket restyle + source chips

**Files:** `importWorkspace/ActionPanel.tsx`, `importWorkspace/SuggestionList.tsx`, `importWorkspace/CountryWorkspacePage.tsx` (lift state), maybe `importWorkspace/finderFeedback.ts` (small helper + tests).

1. **Per-finder feedback.** Wrap each finder button (geoshape/points/geocode/dbSearch/aiMatch/autoResolve) so its `mutate` uses a per-call `onSuccess(result)` that:
   - computes `{ method, found, autoAssigned }` — `found` = suggestions returned; `autoAssigned` = (for geoshape/points, which can auto-assign) the divisions that became members this run (derive: result may report it; if not cleanly available, compute found-vs-newly-assigned by comparing the node's assignedDivisions count before/after, OR just report `found` and note auto-assign generically — verify what each result exposes and do the honest thing).
   - sets a page-level `finderFeedback` state and shows a **Snackbar** (autoHideDuration ~4s) with a message built by a pure `formatFinderFeedback(method, found, autoAssigned, nextMethod)` helper (TDD this helper, ~4 tests): e.g. `"Geoshape match — 3 candidates (1 auto-assigned)"`, `"DB search — 1 candidate"`, and the empty case `"Geoshape match — no candidates. Try Points or DB search."` (nextMethod from a static order Geoshape→Points→Geocode→DB→AI; skip self/last).
   - also renders an **inline feedback line** in the Assignment group (below the buttons) with the same text, colour-coded (success when found>0, muted/warning when 0), persisting until the next run or node change. Keep the existing geoshape/point scope-retry "Try wider" link working alongside.
2. **Source tracking.** Page holds `proposedSource: Map<number, string>` (divisionId→method). On each finder onSuccess, set each returned suggestion's divisionId→method (accumulate; later finders overwrite). Reset to empty when `selectedRegionId` changes. Pass to SuggestionList.
3. **Proposed bucket restyle (SuggestionList).** Rename the suggestions section header to **`PROPOSED (N)`** with the existing "Accept all" plus a new **"Dismiss all"** (rejects every current suggestion — use a bulk reject mutation if one exists, else `Promise.all` of `rejectMutation` over the suggestion divisionIds; verify in `useTreeMutations`). Each proposed row gets a small source chip (`· Geoshape`) when `proposedSource` has it, alongside the existing score/geo%. When proposals exist, give the section a subtle highlight (e.g. left accent border / bgcolor) so it draws the eye. Keep per-row 👁 preview / ✓ accept / ✗ reject and the conflict-transfer path unchanged.
4. Reset `finderFeedback` on node change too.

Commit `front: Add match-result feedback and a prominent Proposed bucket.`

### Task 2 — Live proposed overlay on the map

**Files:** `importWorkspace/WorkspaceMap.tsx`, `CountryWorkspacePage.tsx` (lift `hoveredProposedId` + pass `proposedDivisionIds`), `SuggestionList.tsx` (row hover → set `hoveredProposedId`).

1. Page computes `proposedDivisionIds` = the SELECTED node's `suggestions.map(s => s.divisionId)` (selected node, not unit root). Pass to WorkspaceMap with `hoveredProposedId` (lifted; SuggestionList sets it on row mouseenter/leave).
2. WorkspaceMap: `useQuery` keyed `['admin','wvImport','proposedGeoms', wv, sorted(proposedDivisionIds)]` fetching each division geometry (`fetchDivisionGeometry`, low detail — same approach as the overlap layer) into a FeatureCollection with `divisionId` in properties; `enabled` only when there are ids. Render an **amber** layer (distinct from blue children fills, red gaps, orange overlaps): fill opacity ~.25 + dashed amber outline; the row-hovered division (`hoveredProposedId`) brightens (feature-state or a filtered top layer). Add a "Proposed" entry to the legend. Layer order: proposed above children fills but below the popover; reference outline stays on top (use `beforeId`).
3. Accept/reject already invalidates matchTree → node.suggestions changes → `proposedDivisionIds` changes → the proposed query refetches and the accepted one disappears from amber (and reappears as a solid child fill via the childrenGeometry refresh from Plan 3-fix). Verify this chain end-to-end manually.
4. Interactivity: clicking a proposed division on the MAP previews/accepts to the selected region (optional — at minimum hovering syncs; if cheap, click = accept to selected region with a confirm like the gap-assign popover). State what you implemented.

Commit `front: Show proposed match candidates live on the workspace map.`

### Task 3 — review + fixes
Combined review: feedback fires for all 6 finders incl. the 0-found path; source chips correct; Proposed/Assigned/Accept-all/Dismiss-all behaviour; map proposed layer paint/legend/hover/accept-refresh chain; no double-toast; gates (frontend tsc/eslint/vitest + root knip); runtime smoke. Fold fixes. Docs: one line in `docs/tech/world-view-import.md` workspace paragraph (proposed bucket + map overlay + feedback).
