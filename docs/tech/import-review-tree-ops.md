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
