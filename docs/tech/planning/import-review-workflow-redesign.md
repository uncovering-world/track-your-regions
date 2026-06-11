# Import Review Workflow Redesign

**Status**: Approved design, not yet implemented.
**Decided**: 2026-06-11, brainstorming session.
**Replaces**: the single "Match Review" screen workflow (tree + ~30 per-row
icon actions + modal coverage dialog).

## Problem

The imported-WorldView review was conceived as four sequential stages —
review the hierarchy, assign GADM to countries, find global gaps, assign
GADM to all subdivisions — but the UI never encoded those stages. Today:

- Every tree row exposes every tool for every stage at once
  (`TreeNodeActions.tsx` can render ~30 icon buttons mixing hierarchy
  surgery, five match methods, granularity ops, validation, and meta ops).
- There is no durable "done" concept for the natural unit of work (a
  country subtree). Progress state is per-region `match_status` plus one
  global coverage boolean that goes stale on any change.
- Stage order is neither supported nor suggested; doing subdivision work
  before hierarchy review silently wastes effort.
- Coverage gaps live in a modal dialog while fixes live in the tree,
  bridged by shadow-insertion choreography (ghost rows, apply/undo,
  dialog↔tree state sync).
- Work discovery is pull-based (nav categories, chips, banners); nothing
  says "here is the next decision, N remain."

The tool arsenal itself is strong and is retained. The redesign gives it
a workflow to live in.

## Decisions (from brainstorming Q&A)

| Question | Decision |
|----------|----------|
| Usage model | One canonical Wikivoyage import to finish; pipeline reused for other sources later; other operators someday. No repeated re-imports (no merge-preservation work). |
| Work unit | **Hybrid**: global skeleton pass → country-by-country deep work → global gap sweep. |
| Sign-off criteria | **Fully tiled, strictly**: every leaf has divisions (or custom geometry, or explicit waiver), local coverage shows zero unexplained gaps, no sibling overlaps. Explicit dismissals allowed. |
| Enforcement | **Soft path, hard sign-off**: tools grouped by stage, nothing locked; only the sign-off action is gated on verification. |
| UI surface | **Country workspace**: dashboard (country list) + per-country route with subtree, stage checklist, persistent map. |
| Delivery | **Big bang**: build the full target, switch over once. Old screen deleted after the new flow closes one real country end-to-end. |

## Workflow Model

### Tree zones

The import tree is partitioned into three zones:

- **Skeleton** — everything above and including the country boundary
  (continents, sub-regional groupings like "Balkans").
- **Work units** — country-level nodes; the dashboard's unit of progress.
  Flagged via `region_import_state.is_work_unit`, auto-derived from
  country-based matcher results, editable in the skeleton view (Hong Kong
  can be promoted to a unit; a grouping can be demoted to skeleton).
- **Country subtrees** — everything below a work unit.

Multi-parent duplicates (Russia under Europe and Asia) are separate work
units; sign-off offers the existing sync-to-instances mechanism, and the
dashboard badges duplicates ("×2").

### Stages

1. **Skeleton pass** (global, once, quick)
   - Confirm continent/grouping structure (restructure ops available).
   - Confirm the work-unit list (toggle flags).
   - Resolve unidentified countries — the worklist of country nodes with
     `needs_review` / `no_candidates`, with match tools inline. (This is
     the old "assign GADM to countries" stage; the matcher automates most
     of it, the human handles failures.)
   - Ends with **Confirm skeleton**.

2. **Country loop** (bulk of the work; per work unit; soft sub-stages)
   - **Hierarchy** — subtree matches admin intent: hierarchy warnings,
     AI Review Children, rename / reparent / add / remove / restructure.
     Human ticks **hierarchy confirmed** per country (distinct from the
     per-region `hierarchy_reviewed` AI-ran flag).
   - **Assignment** — every leaf region gets GADM divisions, or custom
     geometry, or an explicit **waiver** (renders nothing on purpose; its
     territory must still be tiled by siblings, so strictness holds).
   - **Verification** — local checks: coverage (the unit's **reference
     territory** minus union of subtree assignments = zero unexplained
     gaps) and sibling-overlap (no division claimed by two sibling
     subtrees, including via GADM parent/child relationships).
     - *Reference territory* resolution order: own `region_members`,
       else `reference_division_ids`. **No name-match fallback at
       verification time** — a unit with neither is itself a sign-off
       blocker ("no reference territory"), fixable via a "set reference"
       action (division search) in the workspace header.
     - A unit's own members act as the reference and do **not** count as
       overlap against its children — parent-member + child-members is
       the expected tiling relationship, not a violation. (The existing
       `check-overlap` already scopes to divisions shared *between
       children*.)
   - **Sign off** — hard-gated on: hierarchy confirmed + all leaves
     resolved (have member rows — custom geometry counts via its member
     row — or waived) + reference territory present + both checks green
     and fresh.

3. **Global gaps** (continuous, dashboard tab)
   - GADM top-level divisions claimed by no work unit (Antarctica,
     missing micro-states). Resolving one can create a new work unit.
   - Not a one-shot gate; a standing list workable at any time.

4. **Finalize**
   - Enabled when: skeleton confirmed + every work unit signed off +
     zero active global gaps (dismissed don't count).
   - Then compute geometries and close review (existing endpoints).

### Status transitions & staleness

- `not_started → in_progress`: first mutation anywhere in the unit's
  subtree (same chokepoint as below). Merely opening the workspace does
  not start a unit.
- `signed_off → in_progress`: any mutation inside the subtree (member
  change, tree op, accept/reject) reverts it automatically; the
  dashboard shows a "modified after sign-off" badge (`signed_off_at`
  retained). This includes **WorldViewEditor** edits — the editor's
  member-mutation paths already call `syncImportMatchStatus()`, so
  post-import editor work correctly invalidates sign-offs.
- Verification results carry `verified_at` and go stale the same way.
  No hard locks anywhere.

### Re-match interaction

`Re-match All` today deletes all `region_members` + suggestions, resets
every `match_status` to `no_candidates`, and clears
`dismissed_coverage_ids`. Under the new model it additionally:

- resets `signoff_status` to `not_started` and clears `signed_off_at`
  (assignments are gone; a staleness badge would be noise),
- **keeps** `hierarchy_confirmed` and `is_work_unit` (re-match does not
  touch the tree shape or the admin's unit curation),
- lets the matcher overwrite `reference_division_ids` on units it
  re-identifies; manually-set references on units the matcher does not
  identify are kept.

## Data Model

All on existing tables; no new tables.

`region_import_state` (new columns):

| Column | Type | Meaning |
|--------|------|---------|
| `is_work_unit` | BOOLEAN NOT NULL DEFAULT FALSE | Node appears on the dashboard as a country. |
| `hierarchy_confirmed` | BOOLEAN NOT NULL DEFAULT FALSE | Work-unit-level human confirmation of the subtree shape. |
| `signoff_status` | TEXT NOT NULL DEFAULT 'not_started' | `not_started` / `in_progress` / `signed_off` (CHECK constraint). Meaningful on work units only. |
| `signed_off_at` | TIMESTAMPTZ | Set on sign-off; **retained** on staleness revert. `signoff_status = 'in_progress'` with non-null `signed_off_at` renders the "modified after sign-off" badge. Cleared only by explicit reopen. |
| `assignment_waived` | BOOLEAN NOT NULL DEFAULT FALSE | Leaf intentionally has no geometry. |
| `reference_division_ids` | INTEGER[] | Work units only: the GADM division(s) defining the unit's territory for verification. Populated by the matcher at country-identification time (it knows the GADM country during drill-down). For directly-matched units it mirrors their own members; for `children_matched` units it is the only territory record. |

`world_views` (new column): `skeleton_confirmed BOOLEAN NOT NULL DEFAULT
FALSE`.

**Source of truth for "what is a country"**: the matcher. Today the
only "country" notion is a display heuristic (`getNodeRole()` in
`frontend/src/components/admin/TreeNodeRow.tsx`) based on match status —
not reliable identification. Going forward, `matchCountryLevel()` sets
`is_work_unit` and `reference_division_ids` on the nodes it identifies
as countries; admins adjust flags in the skeleton view. The display role
heuristic stays for rendering only.

**Migration backfill** (for the in-flight import): `is_work_unit` and
`reference_division_ids` from own members where the assigned division is
GADM level 0; for `children_matched` nodes, a name-match restricted to
**level-0 divisions** (the level restriction avoids collisions like
Georgia-the-state out-area-ing Georgia-the-country, which the existing
unrestricted name fallback in `loadParentDivIdsWithFallback` is exposed
to). Units the backfill cannot resolve appear in the skeleton tab's
worklist as missing a reference.

## UI: Dashboard

Route: `/admin/import/:worldViewId` (replaces "Review Matches" → Match
Review). Header: progress bar (*38/195 signed off*),
**Finalize** (gated), Compute Geometries. `Re-match All` moves to a
danger-zone menu here. Three tabs:

- **Countries** (default) — work units grouped by continent. Row: status
  dot (○ not started / ◐ in progress / ⬤ signed off / ⚠ modified after
  sign-off), mini-progress (`Hierarchy ✓ · 13/22 leaves · checks ✗`),
  warnings count, "×2" duplicate badge. Sort by status/name/size; text
  filter. Click → country workspace.
- **Skeleton** — compact tree of containers + work-unit boundary rows.
  Toggle work-unit flags, restructure containers, inline worklist of
  unidentified countries with match tools. **Confirm skeleton** button.
- **Global gaps** — the `CoverageResolveDialog` content promoted to a
  tab: gap list + map side by side, geo-suggest / manual assign /
  dismiss, dismissed section, SSE re-check. **Shadow insertions are
  removed**: assignment applies directly with the existing undo
  snackbar; no ghost rows, no dialog↔tree sync.

The current flat all-world tree remains reachable as a read-mostly "Raw
tree" debug view, outside the workflow.

## UI: Country Workspace

Route: `/admin/import/:worldViewId/region/:regionId`. Both new screens
are real routes (deep-linkable, browser back works) — unlike today's
`AdminDashboard`, which is local tab state under a single `/admin/*`
route. Header: back link, country name + status, **reference-territory
chip** ("Reference: France · GADM" with a change action), stage
checklist (`☑ Hierarchy ◐ Assign 13/22 ☐ Verify`), **Sign off** (gated;
tooltip lists exact blockers), "Next country →" quick-jump.

- **Left (~40%)** — the country's subtree (reuse the virtualized tree,
  scoped). Rows show state only: status chip, warnings badge, "N div"
  badge. **No action icons on rows.** Selection drives the action panel;
  a right-click context menu mirrors the panel for power use.
- **Right (~60%)** — persistent MapLibre map: country GADM outline as
  context, assigned divisions colored by owning region
  (`children-geometry`), coverage gaps red, overlaps striped. Tree-hover
  ↔ map-highlight both ways. Clicking an unassigned division on the map
  offers "assign to selected region" — the map is an input, not just a
  preview.
- **Action panel** (under the tree, for the selected node), grouped by
  sub-stage:
  - **Hierarchy**: AI Review Children, rename, reparent, add child,
    remove, and one **Restructure ▾** menu absorbing the five flattening
    variants (dismiss children / prune to leaves / collapse to parent /
    merge single child / smart flatten) with plain-language descriptions
    and previews where destructive.
  - **Assignment**: suggestions inline (accept / reject / preview); the
    five match methods as labeled buttons in recommended order
    (Geoshape → Points → Geocode → DB → AI); **Auto-resolve** (runs the
    chain across the subtree); manual division search; CV match and
    Mapshape match shown only when prerequisites exist (map image /
    source URL).
  - **Cleanup & checks**: simplify / simplify children / smart simplify /
    overlap check, clear members, reset match, waive assignment,
    manual-fix flag, sync instances.
- **Checks bar** — "Run checks" executes local coverage + overlap;
  results render as a worklist (each gap/overlap → map focus + one-click
  resolve via existing dialogs) and feed the sign-off gate. Goes stale
  visibly on any mutation. Explicit trigger (not auto-run) because
  verification on large countries is expensive.

Dialogs that survive: `DivisionPreviewDialog` (source-map comparison),
`CvMatchDialog` (multi-step CV pipeline), Smart Simplify / Smart Flatten
previews, `MapImagePickerDialog`. Everything else inlines into the panel.

## API

All new endpoints: admin auth + Zod validation + IDOR guard (regionId
belongs to worldViewId), matching existing patterns.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/matches/:wvId/dashboard` | Work units with computed progress (per-subtree leaf/status/warning counts + signoff fields) in one query — dashboard never fetches the full tree. |
| GET | `/matches/:wvId/verify/:regionId` | Combined local check: `{ referenceDivisionIds, unassignedLeaves, coverageGaps, overlaps, verifiedAt }`. A leaf is unassigned iff it has no member rows and is not waived (custom geometry counts via its member row). Composes existing children-coverage / coverage-gap-analysis / check-overlap internals; uses the reference-territory resolution order (no name fallback). |
| POST | `/matches/:wvId/set-reference` | Set/replace a work unit's `reference_division_ids` (division search in the workspace header). |
| POST | `/matches/:wvId/work-unit` | Toggle `is_work_unit` for a region. |
| POST | `/matches/:wvId/confirm-hierarchy` | Set/clear `hierarchy_confirmed`. |
| POST | `/matches/:wvId/confirm-skeleton` | Set/clear `world_views.skeleton_confirmed`. |
| POST | `/matches/:wvId/sign-off` | Re-runs `verify()` server-side; 409 with a structured blocker list on failure. |
| POST | `/matches/:wvId/reopen` | Revert a signed-off work unit to `in_progress`. |

One shared `verify(regionId)` routine backs both the UI checks bar and
the sign-off gate so they cannot drift. `finalize` gains the new
conditions (skeleton confirmed + all units signed off + 0 active global
gaps).

**Staleness chokepoint**: `syncImportMatchStatus()` (already called by
every member-mutating endpoint) gains `revertSignoffForAncestors
(regionId)` — walk up to the nearest work unit, drop `signed_off →
in_progress`. Tree-op endpoints (add / remove / rename / reparent /
restructure) call the same helper.

## Migration & Cutover

- Migration SQL for the new columns + `db/init/01-schema.sql` update.
- Backfill `is_work_unit` + `reference_division_ids` as described under
  Data Model (level-0-restricted; unresolved units surface in the
  skeleton worklist).
- Big bang: old Match Review stays until the new flow closes one real
  country end-to-end, then is deleted in the same PR series (no
  long-lived dead code; knip enforces).

## Risks

- **Verify cost on huge countries (e.g. Russia)** — explicit "Run
  checks" with spinner + cached `verifiedAt`; wrap in the existing SSE
  pattern if it outgrows a sync request.
- **Single-operator assumption** — kept (matches the existing in-memory
  undo store). Sign-off state is plain columns; concurrent admins lose
  only live updates, not correctness.

## Testing

- Backend: `verify()` + sign-off gate against fixtures (fully tiled /
  gap / overlap / waived-leaf / missing-reference countries);
  staleness-revert hook (including via editor mutation paths); re-match
  field-survival rules; dashboard count query.
- Frontend: dashboard status derivation; action-panel visibility logic
  per node state (the current 30-icon `show` conditions finally get unit
  tests).
- Existing endpoint tests remain valid (internals reused).

## Documentation Plan

- New ADR: "Per-country sign-off workflow for import review" (work-unit
  model, hard sign-off gate, big-bang replacement; references ADR-0012).
- `docs/tech/world-view-import.md`: Frontend section rewritten around
  dashboard/workspace.
- `docs/vision/vision.md`: admin workflow change.

## Out of Scope

- Re-import with preservation of review decisions (explicitly not
  needed per usage-model decision).
- Multi-operator collaboration features (live presence, locking).
- Changes to the matching algorithms, CV pipeline internals, or the
  Wikivoyage extraction service.
