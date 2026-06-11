# Import Review Workflow Redesign — Plan 3b: Sub-continental Groupings

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Surface and curate the skeleton's intermediate groupings (West Africa, Eastern Europe, …) which Plans 2–3 left invisible: the Countries tab groups by full ancestor path, and the Skeleton tab becomes a container tree with grouping curation (add / rename / reparent / remove / promote / demote).

**Why:** user review finding — the original Wikivoyage hierarchy has sub-continental groupings between continents and countries; the dashboard grouped by root only and the skeleton tab showed flat lists, so that layer became invisible and un-editable in the new UI.

**Conventions:** as Plans 1–3 (commit prefixes `back:`/`front:`, gates per commit, never stage the two dirty files).

---

### Task 1 (backend): dashboard returns ancestor paths

**Files:** `backend/src/controllers/admin/wvImportWorkflowController.ts` (`getWorkflowDashboard`), its test.

- In the dashboard SQL, extend `root_walk` with a `depth` column (0 at the unit, +1 per parent step). Add a CTE aggregating, per unit, the STRICT-ancestor names root-first:
  `ancestor_paths AS (SELECT unit_id, array_agg(root_name ORDER BY depth DESC) AS path FROM root_walk WHERE current_id <> unit_id GROUP BY unit_id)`
  (`roots` stays as-is for `continent`, or derive `continent` = `path[1]`; keep response field `continent` unchanged for compatibility.)
- Response: each unit gains `ancestorPath: string[]` (empty array when the unit is a root).
- Test: extend the existing dashboard test — second query SQL matches `/ancestor_paths/` and `/ORDER BY depth DESC/`.
- Verify live: psql-run the new SQL for world view 2; spot-check a unit under a known grouping (e.g. a West-African country shows `{Africa,West Africa}`-style path; report 3 samples).
- Commit `back: Return ancestor paths in the workflow dashboard.` (body: enables sub-continental grouping in the UI).

### Task 2 (frontend): Countries tab groups by ancestor path

**Files:** `frontend/src/api/admin/wvImportWorkflow.ts` (`DashboardUnit.ancestorPath: string[]`), `importDashboard/dashboardUtils.ts` + test, `CountriesTab.tsx`.

- New util `groupUnitsByAncestorPath(units)` → groups keyed by `ancestorPath.join(' › ')` (fallback `continent ?? 'Ungrouped'` when path empty), sorted by the joined label (Ungrouped last), units name-sorted. TDD: 3 tests (nested path label, fallback, ordering).
- `CountriesTab` uses it for `ListSubheader` labels (replaces `groupUnitsByContinent` there; keep the old util — the workspace's next-country ordering uses it — or migrate both consistently if trivial; state the choice).
- Commit `front: Group dashboard countries by full ancestor path.`

### Task 3 (frontend): Skeleton tab container tree + grouping curation

**Files:** create `importDashboard/SkeletonTree.tsx`; rework `SkeletonTab.tsx`; utils + tests.

- Util `buildSkeletonForest(tree: MatchTreeNode[]): SkeletonNode[]` — walk `getMatchTree` result; containers (non-unit nodes with children) keep children but DESCENT STOPS at `isWorkUnit` nodes (units become leaves; their subtrees dropped); non-unit unresolved leaves stay (they're the worklist candidates). Each node: `{id, name, isWorkUnit, matchStatus, childUnits: number, children}`. TDD: unit-boundary pruning, counts.
- `SkeletonTree`: indented expandable tree (no virtualization needed — skeleton is small; verify count live and note it). Unit rows: status dot (reuse `STATUS_DOT`) + demote switch. Container rows: name, `N countries` badge, action menu: **Add grouping…** (creates child container via the add-child machinery), **Rename…**, **Move under…** (reparent), **Remove (children move up)**, **Promote to work unit**.
- Wiring: instantiate `useTreeMutations` + `useImportTreeDialogs` in `SkeletonTab` with the same minimal-deps pattern `CountryWorkspacePage` uses (read it first); render the needed `ImportTreeDialogs` subset (rename, reparent, add-child, remove confirm). All mutations already invalidate `matchTree`; also invalidate `workflowDashboard` via `onMatchChange` so ancestor-path groupings refresh.
- Keep: confirm-skeleton banner, unidentified worklist (now sourced from the pruned forest's unresolved non-unit leaves — reuse/adapt `collectSkeletonCandidates`), promote switches.
- Commit `front: Add skeleton container tree with grouping curation.`

### Task 4: review + docs line

- Combined review (contract vs backend, wiring vs hooks, gates incl. root knip, runtime smoke on both routes).
- `docs/tech/world-view-import.md` skeleton-tab paragraph updated (one commit with Task 3 or standalone docs commit).

**Self-review focus:** reparenting a UNIT under a new grouping must keep dashboard/workspace coherent (paths refresh via invalidation); removing a grouping reparent-children semantics must match the backend remove-region endpoint's options (read it).
