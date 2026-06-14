# Import Review Workflow Redesign — Plan 3g: Gap Boundaries (minimal high-level set)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** The Coverage Gaps panel must list the **minimal set of highest-level uncovered divisions** (gap *boundaries*) — e.g. one row "Cunene" (the whole uncovered province), not its 27 districts/communes. Assigning the boundary covers the entire subtree in one action.

**Root cause (verified):** `analyzeCoverageGaps` (`backend/src/controllers/admin/wvImportCoverageCompareController.ts`) computes the gap area via PostGIS `ST_Difference(parent_union, descendant_union)` then returns EVERY GADM division overlapping it >30% (`LIMIT 30`) — province + districts + communes all match (27 rows). Meanwhile `verifyWorkUnit`'s `SCOPED_COVERAGE_SQL` (`backend/src/services/worldViewImport/verifyWorkUnit.ts:48`) is tree-based and returns only the boundary (uncovered division whose parent has coverage-below) — Cunene = 1, which is why the ChecksBar chip says "1 gaps". The two endpoints disagree on granularity. Make the panel endpoint use the SAME boundary logic.

**Why boundaries are exactly right:** a boundary is the highest-level division that is entirely uncovered AND whose parent is partially covered. Entirely-uncovered province → boundary = the province (assign once). Partially-covered province → boundary descends to its uncovered districts (you can't assign the whole province without overlapping the covered districts). So boundaries = the minimal correct set to assign, at every depth. Assigning a parent division covers all descendants (coverage counts a division as covered if it or an ancestor is a member).

**Conventions:** `back:`/`front:` commits, gates per commit (backend `cd backend && npx tsc --noEmit && npx vitest run`; frontend `cd frontend && npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run`), root knip at end, `-s` + Co-Authored-By trailer; never stage the two dirty files or `data/`. Dev DB: world view 2, region **164 = Angola** has the Cunene gap — use for live verification.

---

### Task 1 (backend) — analyzeCoverageGaps returns boundaries

**Files:** `backend/src/services/worldViewImport/verifyWorkUnit.ts` (export the boundary query as a reusable helper), `backend/src/controllers/admin/wvImportCoverageCompareController.ts` (`analyzeCoverageGaps`), tests.

1. **DRY the boundary query.** In `verifyWorkUnit.ts`, extract the `SCOPED_COVERAGE_SQL` usage into an exported helper, e.g. `export async function getCoverageBoundaries(regionId: number, referenceDivisionIds: number[]): Promise<Array<{ id: number; name: string; parentName: string | null }>>` running `SCOPED_COVERAGE_SQL`. Refactor `verifyWorkUnit` to call it (so verify + analyze share ONE source of boundary truth — their counts can never drift). Keep `verifyWorkUnit`'s behavior identical (existing tests must stay green).
2. **Rewrite `analyzeCoverageGaps`’ gap step.** Replace the geometric `ST_Difference` + `overlap_pct > 0.3` + `LIMIT 30` query (the `gapResult` block) with:
   - `const reference = await resolveReference(regionId)` (already imported/available from verifyWorkUnit). If `reference.source === null` → return `{ gapDivisions: [], siblingRegions: [] , message: 'No reference territory' }` (matches verify's no_reference behavior).
   - `const boundaries = await getCoverageBoundaries(regionId, reference.divisionIds)`. `const boundaryIds = boundaries.map(b => b.id)`.
   - If empty → `{ gapDivisions: [], siblingRegions: [...] }` (still compute siblingRegions for the map if cheap, else []).
   - **Enrich** the boundary ids with geometry + area + path + parent_id via one query: `SELECT id, name, parent_id, safe_geo_area(geom_simplified_medium)/1e6 AS area_km2, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom_simplified_medium, 0.01)) AS geojson FROM administrative_divisions WHERE id = ANY($1)`. Build `path` the way the rest of this controller / the GADM path helper does (full ancestor path string, e.g. "Africa > Angola > Cunene"); reuse whatever path util exists (grep `getPath`/`path` in the gadm/division services) — if none is cheap, build from a recursive parent-name walk over `administrative_divisions`.
   - `suggestedTargets = await findNearestChildPerGapDivision(boundaryIds, regionId, directChildren.length)` — REUSE the existing helper unchanged.
   - Build `gapDivisions: GapDivision[]` from boundaries + enrichment + suggestedTargets, SAME shape as today (`{divisionId, name, path, geometry, areaKm2, gadmParentId, suggestedTarget}`). Keep `siblingRegions` as today.
   - Keep the timing logs (relabel "boundary" instead of "overlap").
3. The frontend contract (`CoverageGapDivision[]`) is UNCHANGED — only the set shrinks to boundaries. No frontend change needed (panel + map auto-update; the panel "Coverage gaps (N)" count now equals the ChecksBar "N gaps").
4. **Tests:** a mocked-pool/source-contract test that `analyzeCoverageGaps` calls the boundary helper (not the old ST_Difference query) — assert the handler's SQL no longer contains `ST_Difference`/`overlap_pct` and that `getCoverageBoundaries` is invoked; verifyWorkUnit's existing tests stay green; add a getCoverageBoundaries shape test if cheap.
5. **LIVE verify (dev DB, region 164):** call/inspect — the boundary set for Angola must be **Cunene (1 row)**, not 27. Run the boundary helper SQL by hand via psql for region 164 + Angola's reference div, and confirm it returns Cunene with a non-null geometry + area ≈ 77,251 km². Report the rows. Also confirm assigning Cunene (province division id) to a region and re-running the boundary query returns 0 (gap resolved) — do this read-only/in a rolled-back tx so the dev DB is left unchanged, OR just reason it through from the SQL and state so.

Commit `back: Return gap boundaries (minimal high-level set) from coverage-gap analysis.`

### Task 2 — review + fixes + docs
Combined review: boundary helper shared by verify + analyze (counts can't drift); analyzeCoverageGaps no longer geometric-overlap; the no-reference path; geometry/area/path/suggestedTarget enrichment correct; assigning a boundary resolves it (covers subtree) — trace the coverage SQL; legacy `useImportTreeDialogs` consumer still renders without crash (fewer divisions, same shape) — note it's acceptable (legacy retiring); frontend panel/map show boundaries with live refetch on assign; **panel count now == ChecksBar count**; gates (backend tsc/vitest + frontend tsc/eslint/vitest + root knip); live smoke on region 164 (1 gap = Cunene). Fold fixes. Docs: update the `docs/tech/world-view-import.md` gap-panel sentence to say the panel lists the highest-level uncovered divisions (boundaries), assigning one covers its whole subtree.
