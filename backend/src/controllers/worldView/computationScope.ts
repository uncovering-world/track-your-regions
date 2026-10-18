/**
 * Which regions a world view's geometry computation takes (#1658): read when
 * an admin queues one, to say how many, and again when the worker starts it,
 * since the tree may have moved in between.
 */

import { pool } from '../../db/index.js';

export interface GroupRow {
  id: number;
  name: string;
  depth: number;
}

const GROUP_DEPTH_CTE = `
  WITH RECURSIVE group_depth AS (
    SELECT id, name, parent_region_id, 0 as depth
    FROM regions
    WHERE world_view_id = $1 AND parent_region_id IS NULL
    UNION ALL
    SELECT cg.id, cg.name, cg.parent_region_id, gd.depth + 1
    FROM regions cg
    JOIN group_depth gd ON cg.parent_region_id = gd.id
  )
`;

/**
 * The regions this run has to compute, deepest first.
 *
 * A forced run takes every region. An ordinary one takes those with no
 * geometry **and every ancestor of one**, which is the difference between a run
 * that converges and a run that leaves the tree inconsistent: a parent's
 * geometry is the union of its children, so a child gaining one leaves every
 * ancestor describing a smaller world than it contains. Selecting `geom IS
 * NULL` alone never revisits a parent that already has geometry, which is how
 * North America came to draw Mexico and the Caribbean while the United States
 * and Greenland stood underneath it (#667).
 *
 * Deepest first, so a parent is unioned after the children it is the union of.
 *
 * A user-drawn boundary is not derived from its members and must never be
 * recomputed from them (#283), so it is excluded from what a forced run takes,
 * from what an ordinary one takes, and from the closure's two arms as well: an
 * empty custom boundary asks nothing of the regions above it, and a custom
 * boundary in the middle of the tree does not pass a child's news any further
 * up, because its own shape does not move when that child gains one.
 */
export async function loadGroupsToCompute(worldViewId: number, forceRecompute: boolean): Promise<GroupRow[]> {
  const sql = forceRecompute
    ? `
      ${GROUP_DEPTH_CTE}
      SELECT gd.id, gd.name, gd.depth
      FROM group_depth gd
      JOIN regions cg ON gd.id = cg.id
      WHERE cg.is_custom_boundary IS NOT TRUE
      ORDER BY gd.depth DESC, gd.id
    `
    : `
      ${GROUP_DEPTH_CTE},
      -- The regions with nothing to draw, and every ancestor of one: walking up
      -- from each of them and collecting what is passed on the way. A custom
      -- boundary stops the walk on both arms: its shape is drawn, not derived
      -- from members, so it never asks to be recomputed and nothing under it
      -- reaches what is above it either (#283).
      needs_geometry AS (
        SELECT gd.id, gd.parent_region_id
        FROM group_depth gd
        JOIN regions r ON r.id = gd.id
        WHERE r.geom IS NULL AND r.is_custom_boundary IS NOT TRUE
        UNION
        SELECT p.id, p.parent_region_id
        FROM group_depth p
        JOIN regions pr ON pr.id = p.id
        JOIN needs_geometry n ON n.parent_region_id = p.id
        WHERE pr.is_custom_boundary IS NOT TRUE
      )
      SELECT gd.id, gd.name, gd.depth
      FROM group_depth gd
      JOIN regions cg ON gd.id = cg.id
      WHERE cg.is_custom_boundary IS NOT TRUE
        AND gd.id IN (SELECT id FROM needs_geometry)
      ORDER BY gd.depth DESC, gd.id
    `;
  const result = await pool.query(sql, [worldViewId]);
  return result.rows as GroupRow[];
}
