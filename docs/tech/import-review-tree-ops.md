# Import Review Tree Operations

The import review pipeline supports several tree-shaping operations on the
in-flight region hierarchy:

## What a tree operation leaves stale

A region's outline is the union of its children and of its own member divisions,
so every operation here changes one. Since ADR-0035 a *geometry* write needs no
help: nulling a region's `geom` fires `trg_regions_geom_invalidates_parent`,
which nulls the parent, which is itself a geometry write — the walk upward is
the trigger cascade. **A structural change writes no geometry at all**, so the
trigger never sees it, and the handler has to name the rows whose own union
changed. Ancestors are never named here; they are the cascade's.

Getting it wrong is permanent rather than late. An ordinary run computes every
region with no geometry *and every ancestor of one*
(`computationProgress.loadGroupsToCompute`), so a region left holding a stale
outline with nothing `NULL` beneath it is not selected again, and every run
reports Complete. Only a forced run recovers it. This is invisible during an
ordinary import — every imported region is created with `geom = NULL` — and
stops being invisible the moment an operator presses **Compute Geometries**
mid-review.

| Operation | What changed | What the handler nulls |
|---|---|---|
| `reparent-region` | a region changes parents | the old parent and the new one |
| `merge-child` | the parent absorbs its only child's members and grandchildren | the parent |
| `remove-region` | a region is deleted, its children and divisions moved up or deleted with it | the parent, when there is one |
| `dismiss-children` | every descendant is deleted and nothing moves up | the region they were under |
| `prune-to-leaves` | every grandchild and deeper is deleted | each direct child that lost descendants |
| `smart-flatten` | the descendants are deleted and their divisions absorbed | the region that absorbed them |
| `simplify-hierarchy`, `simplify-children`, `smart-simplify/apply-move` | members are folded up to their GADM parent | the region simplified — these three always did |

Two shapes are worth reading twice. `reparent-region` names two rows where the
World View Editor's `updateRegion` names three, because the editor's reparent
also carries a division membership between the two parents while this one writes
`parent_region_id` and nothing else. `prune-to-leaves` names the direct children
that actually lost descendants — carried out of its recursive CTE as
`root_child` — rather than the region asked about, and rather than every direct
child: it is their unions that lost something, a child that was already a leaf
draws exactly what it drew, and clearing a child is a geometry write, so the
news reaches the region above through the trigger. The walk stops at a
hand-drawn child, correctly, since deleting what was under a drawn outline does
not move it (#283).

The call is made **last**: after the `COMMIT` for the five handlers that open a
transaction, and after the statement itself for `reparent-region`, which runs on
the pool and opens none. Where the handler stores an undo entry — as
`dismiss-children`, `prune-to-leaves` and `smart-flatten` do, while
`reparent-region`, `merge-child` and `remove-region` offer no undo at all — the
call comes after that too, so a failure here cannot cost the operator their
undo. Matching `regionCrud`, it is a second statement that can fail on its own,
which is the trade ADR-0035 recorded for the structural case.

**Undo names nothing, deliberately.** Every region an undo recreates arrives
with `geom NULL`, which is exactly what seeds the run's closure, so the restored
rows are selected and every ancestor of one with them. The invariant that makes
this true — the restoring `INSERT` names no geometry column — is pinned by
`backend/src/controllers/admin/wvImportStructuralInvalidation.test.ts`, together
with the rows each handler above nulls.

The **member** half of the same rule is still open (#718): a dozen import-review
routes rewrite `region_members` *without* moving or deleting a region — accepting
a match, clearing members, resolving an overlap, collapsing a parent — and not
one of those invalidates, so a region can go on drawing divisions it no longer
holds. The three handlers above that move members as part of a structural change
(`merge-child`, `remove-region` with `reparentDivisions`, `smart-flatten`) are
covered by the call they already make. The three undo arms
that restore members without recreating a region — `handle-as-grouping`,
`auto-resolve-children`, `collapse-to-parent` — belong to that half, which is why
undo is self-healing only for the operations listed above.

## Simplify Hierarchy

Replaces fully-covered groups of GADM division members with a single entry
for their shared GADM parent. Operates at the **division-membership** level
(\`region_members\`), not at the region-tree level.

For a region's GADM division members (excluding members with a custom
geometry), the algorithm:

1. Groups members by their GADM parent (\`administrative_divisions.parent_id\`).
2. For each GADM parent represented in the group, counts the total number of
   children that GADM parent has in the catalogue.
3. If the region's members under that GADM parent equal the parent's total
   child count (i.e. 100% sibling coverage), the algorithm replaces all those
   child member entries with a single entry for the parent itself.
4. Loops until no more replacements are found, so coverage cascades upward
   when grandparents become fully covered after a parent collapse.

So a region with 50 assigned divisions, 12 of which happen to cover an entire
GADM parent (say all departments of a French region), gets those 12 collapsed
into the one parent entry — independent of any region-tree shape.

- \`POST /api/admin/wv-import/matches/:worldViewId/simplify-hierarchy\`
  — apply to one region
- \`POST /api/admin/wv-import/matches/:worldViewId/simplify-children\`
  — apply independently to each direct child of the given region

Implementation: shared helpers \`findFullyCoveredParents\` and
\`applySimplifyReplacement\` (the discovery + replacement primitives) in
\`backend/src/controllers/admin/wvImportSimplifyShared.ts\`. Both endpoints
ultimately call the wrapper \`runSimplifyHierarchy\` which puts the loop in
a single transaction per region.

## Smart Simplify

Detects cross-sibling division splits and proposes consolidation moves.
A "split" is when a GADM parent's children are distributed across two or more
sibling regions — all children are present, but in different regions. Smart
Simplify finds these cases and proposes moving the minority children to the
region that already owns the majority.

### Detection

`POST /api/admin/wv-import/matches/:worldViewId/smart-simplify`

Body: `{ parentRegionId }`. Read-only — no mutations.

Algorithm:
1. Load all `region_members` for direct children of `parentRegionId`, grouped by `ad.parent_id` (GADM parent).
2. Count total GADM children for each candidate parent.
3. Candidate = GADM parent where (a) all its children are present across siblings and (b) those children are spread across 2+ regions.
4. For each candidate, pick the "owner" region (the one with the most children; tie-break by lower ID).
5. Build move: divisions to move = children not already in the owner region.
6. Return moves sorted by number of divisions to move (largest first).

### Apply

`POST /api/admin/wv-import/matches/:worldViewId/smart-simplify/apply-move`

Body: `{ parentRegionId, ownerRegionId, memberRowIds }`.

Steps:
1. Verify `parentRegionId` and `ownerRegionId` belong to the world view.
2. Verify `ownerRegionId` is a direct child of `parentRegionId`.
3. Verify all `memberRowIds` belong to direct children of `parentRegionId` (IDOR guard).
4. Deduplicate: if a division already exists in the owner region, delete the duplicate rather than moving.
5. Move remaining rows to the owner region.
6. Invalidate geometry and sync match status for all affected regions.

The Simplify Hierarchy step (folding fully-covered subtrees up to their GADM
parent) is **not** applied automatically after a Smart Simplify move — it
remains a separate explicit operator action via the simplify icon on the
tree row.

### Map Support

`GET /api/admin/wv-import/matches/:worldViewId/children-geometry/:regionId`

Returns per-child region geometries (union of assigned GADM divisions, simplified
at medium LOD) for rendering the color-coded map in `SmartSimplifyDialog`.

### Frontend

`SmartSimplifyDialog` (`frontend/src/components/admin/SmartSimplifyDialog.tsx`):
- Split view: source region map image (left) + MapLibre map with color-coded child regions (right).
- Current/Proposed toggle: "Current" shows division overlays with dashed red borders; "Proposed" recolors them to the owner region's color.
- Move list: each detected move shows the GADM parent name, how many divisions move where, and Apply/Skip buttons.
- Applied moves are dimmed with a green "Applied" chip; the view auto-advances to the next pending move.
- **Spatial Anomalies section**: below the moves list, disconnected fragments and exclaves are highlighted.
  Each anomaly shows the fragment's divisions, the size ratio (fragment/total), and the suggested target region.
  "Accept" applies the reassignment via the existing apply-move endpoint; "Skip" advances to the next anomaly.
  Selecting an anomaly flies the map to the fragment's divisions and highlights the source/target regions.

### Spatial Anomaly Detection

`backend/src/services/worldViewImport/spatialAnomalyDetector.ts`:
- `detectSpatialAnomalies(assignments, edges)` — pure BFS function; groups divisions by region, finds
  connected components, identifies non-largest components as fragments, votes on the dominant neighboring
  region for each fragment. Returns results sorted by score (fragmentSize/totalSize) ascending.
- `getAdjacencyGraph(divisionIds)` — PostGIS query: two divisions adjacent ⟺ they touch or are within
  0.0001° (~11m) of each other (handles sliver gaps in simplified geometries).
- `detectAnomaliesForRegion(worldViewId, parentRegionId)` — convenience wrapper that queries child regions,
  members, and adjacency, then calls `detectSpatialAnomalies`.

`frontend/src/utils/spatialAnomalyDetector.ts` — client-side mirror of the pure function for future
interactive use (e.g. paint mode re-checks without a round-trip to the server).

See ADR-0010 for the algorithm choice rationale.

Triggered via the Smart Simplify button (swap icon) on any container node in `WorldViewImportTree`.
