/**
 * The writes to `regions` that are not a geometry computation (ADR-0069
 * applied to regions, #1073): the World View Editor's, the import's and the
 * import review's.
 *
 * The table's writers are a closed list the backend lint names
 * (`REGION_WRITE_RULES`): this module; the geometry computations, each of
 * which writes the outline its own pipeline made, in a statement the pipeline's
 * guards read (`controllers/worldView/geometryCompute.ts`,
 * `geometryComputeSSE.ts`, `geometryComputeSingle.ts`,
 * `computeSingleMemberFastPath.ts`); the hull generator
 * (`services/hull/generator.ts`); and the seed. Every write here is a named
 * function: the statement and what it does live here, and whether to issue it
 * stays with the caller that decided it.
 *
 * Each takes the connection it runs on, the caller's transaction client where
 * it has one. What a write changes on a tile is not the writer's to track: the
 * table bumps the world view's tile version at commit (ADR-0075).
 */

import type { PoolClient } from 'pg';
import { pool } from './index.js';

/** The connection a write runs on: the pool, or the caller's transaction client. */
export type RegionDb = Pick<PoolClient, 'query'>;

/** A region as a caller creates it, with no outline of its own. */
export interface NewRegion {
  worldViewId: number;
  name: string;
  parentRegionId: number | null;
  /** Null takes none, as the import's regions do; the editor names one. */
  color: string | null;
  description?: string | null;
}

/** Create a region with no outline. */
export async function insertRegion(db: RegionDb, region: NewRegion): Promise<{ id: number; name: string }> {
  const result = await db.query<{ id: number; name: string }>(
    `INSERT INTO regions (world_view_id, name, description, parent_region_id, color)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name`,
    [region.worldViewId, region.name, region.description ?? null, region.parentRegionId, region.color],
  );
  return result.rows[0];
}

/**
 * Create a region with a drawn outline, marked as a custom boundary so nothing
 * derived from members may replace it (#283).
 */
export async function insertDrawnRegion(
  db: RegionDb,
  region: NewRegion & { geometryJson: string },
): Promise<{ id: number; hasGeom: boolean; geomPoints: number | null }> {
  const result = await db.query<{ id: number; has_geom: boolean; geom_points: number | null }>(`
    INSERT INTO regions (world_view_id, name, description, parent_region_id, color, geom, is_custom_boundary)
    VALUES ($1, $2, $3, $4, $5, validate_multipolygon(ST_GeomFromGeoJSON($6)), true)
    RETURNING id, geom IS NOT NULL AS has_geom, ST_NPoints(geom) AS geom_points
  `, [region.worldViewId, region.name, region.description ?? null, region.parentRegionId, region.color, region.geometryJson]);
  const row = result.rows[0];
  return { id: row.id, hasGeom: row.has_geom, geomPoints: row.geom_points };
}

/**
 * Find or create the child of `parentRegionId` named `name`; a root (no parent)
 * is always created, since the index covers children only. Race-safe: the
 * partial unique index `idx_regions_unique_subregion_name` (migration 004)
 * makes concurrent callers either insert the row or surface the existing one.
 * `inserted` says which: `(xmax = 0)` holds for a freshly inserted row and not
 * for one returned by the conflict arm.
 *
 * The `DO UPDATE SET name = regions.name` is a no-op write whose only purpose
 * is to make Postgres return the conflicting row via `RETURNING`: `DO NOTHING`
 * would leave it empty on a conflict, and cost a round trip to fetch the id.
 * Writing a name to itself busts no tile (ADR-0075 compares).
 */
export async function ensureChildRegion(
  db: RegionDb,
  child: { worldViewId: number; parentRegionId: number | null; name: string; color: string | null },
): Promise<{ id: number; name: string; inserted: boolean }> {
  const result = await db.query<{ id: number; name: string; inserted: boolean }>(
    `INSERT INTO regions (world_view_id, name, parent_region_id, color)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (world_view_id, parent_region_id, name) WHERE parent_region_id IS NOT NULL
     DO UPDATE SET name = regions.name
     RETURNING id, name, (xmax = 0) AS inserted`,
    [child.worldViewId, child.name, child.parentRegionId, child.color],
  );
  return result.rows[0];
}

/**
 * Put back regions an undo restores, under the ids and leaf flags they had. A
 * row already there is left alone. They come back with no outline, so the next
 * run computes them.
 *
 * A parent goes in before its child, since `parent_region_id` is checked per
 * statement. Not by id: the import review can move an older region under one
 * it added later, so a child may carry the lower id.
 */
export async function restoreRegions(
  db: RegionDb,
  regions: ReadonlyArray<{ id: number; name: string; parent_region_id: number | null; is_leaf: boolean; world_view_id: number }>,
): Promise<void> {
  for (const region of parentsFirst(regions)) {
    await db.query(
      `INSERT INTO regions (id, name, parent_region_id, is_leaf, world_view_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [region.id, region.name, region.parent_region_id, region.is_leaf, region.world_view_id],
    );
  }
}

/**
 * The rows in an order where each one's parent, when it is among them, comes
 * first. A parent outside the set is taken to exist already.
 */
function parentsFirst<Row extends { id: number; parent_region_id: number | null }>(rows: readonly Row[]): Row[] {
  const waiting = new Map(rows.map((row) => [row.id, row]));
  const ordered: Row[] = [];
  while (waiting.size > 0) {
    const ready = [...waiting.values()].filter((row) => row.parent_region_id === null || !waiting.has(row.parent_region_id));
    if (ready.length === 0) throw new Error(`Regions ${[...waiting.keys()].join(', ')} are each other's ancestors`);
    for (const row of ready) {
      ordered.push(row);
      waiting.delete(row.id);
    }
  }
  return ordered;
}

/** What the editor's form may change on a region, each a column of its own. */
export interface RegionFields {
  name?: string;
  description?: string | null;
  parentRegionId?: number | null;
  color?: string | null;
  usesHull?: boolean;
}

const FIELD_COLUMNS: ReadonlyArray<[keyof RegionFields, string]> = [
  ['name', 'name'],
  ['description', 'description'],
  ['parentRegionId', 'parent_region_id'],
  ['color', 'color'],
  ['usesHull', 'uses_hull'],
];

/**
 * Write the fields the form sent, and nothing else. False where the region is
 * gone; true, with no statement, where nothing was sent.
 */
export async function updateRegionFields(db: RegionDb, regionId: number, fields: RegionFields): Promise<boolean> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of FIELD_COLUMNS) {
    if (fields[key] === undefined) continue;
    values.push(fields[key]);
    setClauses.push(`${column} = $${values.length}`);
  }
  if (setClauses.length === 0) return true;
  values.push(regionId);
  const result = await db.query(`
    UPDATE regions
    SET ${setClauses.join(', ')}
    WHERE id = $${values.length}
    RETURNING id
  `, values);
  return result.rows.length > 0;
}

/** Rename a region. */
export async function setRegionName(db: RegionDb, regionId: number, name: string): Promise<void> {
  await db.query('UPDATE regions SET name = $1 WHERE id = $2', [name, regionId]);
}

/** Move a region under another parent. */
export async function setRegionParent(db: RegionDb, regionId: number, parentRegionId: number | null): Promise<void> {
  await db.query('UPDATE regions SET parent_region_id = $1 WHERE id = $2', [parentRegionId, regionId]);
}

/**
 * Move every child of `fromParentId` under `toParentId` (null makes them
 * roots), and answer how many moved. With `worldViewId`, only the children in
 * that world view.
 */
export async function moveChildRegions(
  db: RegionDb,
  fromParentId: number,
  toParentId: number | null,
  worldViewId?: number,
): Promise<number> {
  const result = worldViewId === undefined
    ? await db.query('UPDATE regions SET parent_region_id = $1 WHERE parent_region_id = $2', [toParentId, fromParentId])
    : await db.query(
      'UPDATE regions SET parent_region_id = $1 WHERE parent_region_id = $2 AND world_view_id = $3',
      [toParentId, fromParentId, worldViewId],
    );
  return result.rowCount ?? 0;
}

/** Delete regions by id. Their children, if any are left, become roots (ON DELETE SET NULL). */
export async function deleteRegions(db: RegionDb, regionIds: readonly number[]): Promise<void> {
  if (regionIds.length === 1) {
    await db.query('DELETE FROM regions WHERE id = $1', [regionIds[0]]);
    return;
  }
  await db.query('DELETE FROM regions WHERE id = ANY($1)', [regionIds]);
}

/**
 * Delete everything below the given parents — children, grandchildren and on
 * down — leaving the parents themselves. The walk is one recursive statement;
 * `parent_region_id` is ON DELETE SET NULL, so the order the rows go in does
 * not matter.
 */
export async function deleteDescendants(db: RegionDb, parentIds: readonly number[]): Promise<void> {
  await db.query(`
    WITH RECURSIVE descendants AS (
      SELECT id FROM regions WHERE parent_region_id = ANY($1)
      UNION ALL
      SELECT r.id FROM regions r
      JOIN descendants d ON r.parent_region_id = d.id
    )
    DELETE FROM regions WHERE id IN (SELECT id FROM descendants)
  `, [parentIds]);
}

/**
 * Save an outline an admin drew, with the hull drawn beside it where one was.
 * `isCustomBoundary` says whether the shape is drawn rather than derived.
 */
export async function saveDrawnOutline(
  db: RegionDb,
  regionId: number,
  outline: { geometryJson: string; isCustomBoundary: boolean; hullJson?: string },
): Promise<void> {
  if (outline.hullJson) {
    await db.query(`
      UPDATE regions
      SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1)),
          is_custom_boundary = $2,
          hull_geom = validate_multipolygon(ST_GeomFromGeoJSON($3))
      WHERE id = $4
    `, [outline.geometryJson, outline.isCustomBoundary, outline.hullJson, regionId]);
    return;
  }
  await db.query(`
    UPDATE regions
    SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1)),
        is_custom_boundary = $2
    WHERE id = $3
  `, [outline.geometryJson, outline.isCustomBoundary, regionId]);
}

/**
 * Clear a region's own cached geometry, so the next world-view run recomputes
 * it — for a *structural* change, the one kind the database cannot see.
 *
 * A member edit needs no call: a write to region_members clears the regions
 * whose union it changed, in the same statement (ADR-0068). A region changing
 * parents, or a branch deleted, writes neither a member nor a geometry while
 * changing what a parent's union holds — one loses a child, another gains it —
 * so the writer names those parents itself: updateRegion and deleteRegion,
 * and the import review's reparent, merge, remove, dismiss, prune and smart
 * flatten. A parent's union holds a hand-drawn child too, since it collects
 * every child that has geometry, so relying on the moved region's own row to
 * reach its parent would fail for a drawn one.
 *
 * The walk upward is not here. Nulling geom is itself a write to regions.geom,
 * so trg_regions_geom_invalidates_parent carries it to the derived ancestors,
 * inside this statement (ADR-0035).
 *
 * Skips a hand-drawn boundary (is_custom_boundary): its shape is drawn, not
 * derived, and resetRegionToGADM is the explicit way to drop it (#283).
 *
 * `db` is the caller's transaction client where it has one, so the clearing
 * commits or rolls back with the change it answers for (#1026). There a lock
 * or deadlock is not swallowed: it has aborted the transaction, and the
 * operation fails whole. On the pool — a writer with no transaction — it is
 * swallowed, the tolerance carried from #283: what races an edit is usually
 * another edit clearing the same rows, and if not, Catalogue Checks reports
 * the stale outline (`parent-short-of-its-children`).
 */
export async function invalidateRegionGeometry(
  regionId: number,
  db: RegionDb = pool,
): Promise<void> {
  try {
    await db.query(`
      UPDATE regions
      SET geom = NULL,
          geom_3857 = NULL,
          geom_simplified_low = NULL,
          geom_simplified_medium = NULL
      WHERE id = $1
        AND is_custom_boundary IS NOT TRUE
    `, [regionId]);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isLockError = errorMessage.includes('could not obtain lock') || errorMessage.includes('deadlock');
    if (isLockError && db === pool) {
      console.log(`[invalidateRegionGeometry] Skipping region ${regionId} - already being updated by another operation`);
      return;
    }
    throw err;
  }
}
