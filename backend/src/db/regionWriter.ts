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
 * **Every write runs in a transaction (#689).** Each takes a `RegionTx`, which
 * only `beginRegionTransaction` and `inRegionTransaction` produce, after
 * `BEGIN` has run on that connection. A handler's statements then commit
 * together or not at all: a reparent never lands without the invalidation of
 * both parents, and a delete never leaves the members it moved moved. Where a
 * handler decides on what it read of a region, it reads it with `lockRegion`,
 * in the same transaction. What a write changes on a tile is not the writer's
 * to track: the table bumps the world view's tile version at commit
 * (ADR-0075).
 */

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from './index.js';

declare const regionTransaction: unique symbol;

/**
 * A connection inside an open transaction, on which `regions` may be written.
 * Produced only here, after `BEGIN` has run on it.
 */
export type RegionTx = Pick<PoolClient, 'query'> & { readonly [regionTransaction]: true };

/** Open a transaction on a client the caller holds, for a writer that manages its own. */
export async function beginRegionTransaction(client: PoolClient): Promise<RegionTx> {
  await client.query('BEGIN');
  return client as unknown as RegionTx;
}

/**
 * Run `work` in one transaction on a client of its own: committed when it
 * returns, rolled back when it throws, and the client released either way —
 * as unusable when the rollback itself failed, so an open transaction never
 * goes back to the pool.
 */
export async function inRegionTransaction<T>(work: (tx: RegionTx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    const tx = await beginRegionTransaction(client);
    const result = await work(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    unusable = await rollbackQuietly(client);
    throw err;
  } finally {
    client.release(unusable);
  }
}

/**
 * Lock a region for the rest of the transaction and read `columns` of it, so
 * what the handler decides on is what it will write over. Null where the row
 * is gone. `columns` is the caller's constant select list, never input.
 */
export async function lockRegion<Row extends Record<string, unknown>>(
  tx: RegionTx,
  regionId: number,
  columns: string,
): Promise<Row | null> {
  const result = await tx.query(`SELECT ${columns} FROM regions WHERE id = $1 FOR UPDATE`, [regionId]);
  return (result.rows[0] as Row | undefined) ?? null;
}

/** A region of a locked branch, and the root of `lockSubtree` it hangs under. */
export interface BranchRow { id: number; root: number }

/** How many times `lockSubtree` walks again before it gives up on a branch that keeps changing. */
const BRANCH_WALKS = 5;

/**
 * Lock the regions below `rootIds` — and the roots too, `withRoots` — for the
 * rest of the transaction, and answer them with the root each hangs under. A
 * caller that moves or deletes a branch reads it here and then acts on exactly
 * these ids: a branch read in one statement and deleted by walking it again in
 * another can lose a region moved out in between, its members deleted and the
 * region kept (#689).
 *
 * The walk that finds the rows runs before their locks are granted, so a
 * region moved out while a lock was awaited would be locked where it now is,
 * and one attached just before its new parent was locked would be missed. So
 * the branch is walked again once locked, until two walks agree. Locked, the
 * rows cannot be moved or deleted, and no region can be moved under one of
 * them, until the commit, so the last walk is the branch.
 */
export async function lockSubtree(tx: RegionTx, rootIds: readonly number[], withRoots: boolean): Promise<BranchRow[]> {
  const start = withRoots ? 'id' : 'parent_region_id';
  const walk = `
    WITH RECURSIVE subtree AS (
      SELECT id, ${start} AS root FROM regions WHERE ${start} = ANY($1)
      UNION ALL
      SELECT r.id, s.root FROM regions r JOIN subtree s ON r.parent_region_id = s.id
    )`;
  for (let attempt = 0; attempt < BRANCH_WALKS; attempt++) {
    const locked = await tx.query<BranchRow>(`${walk}
      SELECT r.id, s.root FROM regions r JOIN subtree s ON s.id = r.id
      FOR UPDATE OF r
    `, [rootIds]);
    const again = await tx.query<BranchRow>(`${walk} SELECT id, root FROM subtree`, [rootIds]);
    const lockedIds = new Set(locked.rows.map((row) => row.id));
    if (again.rows.length === lockedIds.size && again.rows.every((row) => lockedIds.has(row.id))) return again.rows;
  }
  throw new Error(`The branch under ${rootIds.join(', ')} kept changing while it was being locked`);
}

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
export async function insertRegion(tx: RegionTx, region: NewRegion): Promise<{ id: number; name: string }> {
  const result = await tx.query<{ id: number; name: string }>(
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
  tx: RegionTx,
  region: NewRegion & { geometryJson: string },
): Promise<{ id: number; hasGeom: boolean; geomPoints: number | null }> {
  const result = await tx.query<{ id: number; has_geom: boolean; geom_points: number | null }>(`
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
  tx: RegionTx,
  child: { worldViewId: number; parentRegionId: number | null; name: string; color: string | null },
): Promise<{ id: number; name: string; inserted: boolean }> {
  const result = await tx.query<{ id: number; name: string; inserted: boolean }>(
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
  tx: RegionTx,
  regions: ReadonlyArray<{ id: number; name: string; parent_region_id: number | null; is_leaf: boolean; world_view_id: number }>,
): Promise<void> {
  for (const region of parentsFirst(regions)) {
    await tx.query(
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
export async function updateRegionFields(tx: RegionTx, regionId: number, fields: RegionFields): Promise<boolean> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of FIELD_COLUMNS) {
    if (fields[key] === undefined) continue;
    values.push(fields[key]);
    setClauses.push(`${column} = $${values.length}`);
  }
  if (setClauses.length === 0) return true;
  values.push(regionId);
  const result = await tx.query(`
    UPDATE regions
    SET ${setClauses.join(', ')}
    WHERE id = $${values.length}
    RETURNING id
  `, values);
  return result.rows.length > 0;
}

/** Rename a region. */
export async function setRegionName(tx: RegionTx, regionId: number, name: string): Promise<void> {
  await tx.query('UPDATE regions SET name = $1 WHERE id = $2', [name, regionId]);
}

/** Move a region under another parent. */
export async function setRegionParent(tx: RegionTx, regionId: number, parentRegionId: number | null): Promise<void> {
  await tx.query('UPDATE regions SET parent_region_id = $1 WHERE id = $2', [parentRegionId, regionId]);
}

/**
 * Move every child of `fromParentId` under `toParentId` (null makes them
 * roots), and answer how many moved. With `worldViewId`, only the children in
 * that world view.
 */
export async function moveChildRegions(
  tx: RegionTx,
  fromParentId: number,
  toParentId: number | null,
  worldViewId?: number,
): Promise<number> {
  const result = worldViewId === undefined
    ? await tx.query('UPDATE regions SET parent_region_id = $1 WHERE parent_region_id = $2', [toParentId, fromParentId])
    : await tx.query(
      'UPDATE regions SET parent_region_id = $1 WHERE parent_region_id = $2 AND world_view_id = $3',
      [toParentId, fromParentId, worldViewId],
    );
  return result.rowCount ?? 0;
}

/** Delete regions by id. Their children, if any are left, become roots (ON DELETE SET NULL). */
export async function deleteRegions(tx: RegionTx, regionIds: readonly number[]): Promise<void> {
  if (regionIds.length === 1) {
    await tx.query('DELETE FROM regions WHERE id = $1', [regionIds[0]]);
    return;
  }
  await tx.query('DELETE FROM regions WHERE id = ANY($1)', [regionIds]);
}

/**
 * Save an outline an admin drew, with the hull drawn beside it where one was.
 * `isCustomBoundary` says whether the shape is drawn rather than derived.
 */
export async function saveDrawnOutline(
  tx: RegionTx,
  regionId: number,
  outline: { geometryJson: string; isCustomBoundary: boolean; hullJson?: string },
): Promise<void> {
  if (outline.hullJson) {
    await tx.query(`
      UPDATE regions
      SET geom = validate_multipolygon(ST_GeomFromGeoJSON($1)),
          is_custom_boundary = $2,
          hull_geom = validate_multipolygon(ST_GeomFromGeoJSON($3))
      WHERE id = $4
    `, [outline.geometryJson, outline.isCustomBoundary, outline.hullJson, regionId]);
    return;
  }
  await tx.query(`
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
 * It runs in the transaction of the change it answers for, so the clearing
 * commits or rolls back with it (#1026). A lock timeout or a deadlock is not
 * swallowed: it has aborted the transaction, and the change fails whole rather
 * than landing with a parent left outside the next run's closure (#689).
 */
export async function invalidateRegionGeometry(tx: RegionTx, regionId: number): Promise<void> {
  await tx.query(`
    UPDATE regions
    SET geom = NULL,
        geom_3857 = NULL,
        geom_simplified_low = NULL,
        geom_simplified_medium = NULL
    WHERE id = $1
      AND is_custom_boundary IS NOT TRUE
  `, [regionId]);
}
