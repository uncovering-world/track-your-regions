# Import Review Tree Operations

The import review pipeline supports several tree-shaping operations on the
in-flight region hierarchy:

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

Triggered via the Smart Simplify button (swap icon) on any container node in `WorldViewImportTree`.
