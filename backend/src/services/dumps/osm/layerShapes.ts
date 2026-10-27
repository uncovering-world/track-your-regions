/**
 * The region shapes the world-view match reads (`wikidata_geoshapes`, #2085),
 * filled from the OpenStreetMap layer each time a build is swapped in
 * (ADR-0157). The layer keeps whole every object that carries an item
 * `drawnItems` lists, and an item's shape is the largest
 * area among them, a relation before a way. A node, a line or a relation of
 * lines draws no area, so an item drawn by none of those has no shape and is
 * matched by its markers.
 *
 * The shape is simplified to about a hundred metres and made valid: the match
 * compares it with GADM's outlines simplified at a kilometre
 * (`geom_simplified_medium`), so the detail it drops is detail never read.
 * It is OpenStreetMap's work under ODbL, so it is kept with that licence and
 * credited wherever it is drawn (`shapeCredit.ts`). The store's Commons map
 * shapes (`commons:<file>`) are another source's, and a refill leaves them.
 *
 * A region whose item no relation or way draws, such as the Middle East or
 * West Africa, which no boundary encloses, is given the union of its child
 * regions' shapes when every child has one (ADR-0159, #2113), under the same
 * licence, and `composite_of` says how many shapes it is the union of.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../../db/index.js';

/** The licence an OpenStreetMap shape is under, as the store keeps it. */
export const OSM_SHAPE_LICENCE = 'ODbL-1.0';

/** About a hundred metres at the equator: an outline for matching, not for a map. */
const SIMPLIFY_DEGREES = 0.001;

/**
 * How many times composites are built over again, each pass on the
 * composites of the last, so a region of regions that are composites
 * themselves gets one too. Three passes reached every one on the development
 * catalogue (2026-10-27); a deeper tree stops here.
 */
export const COMPOSITE_PASSES = 8;

/** What a refill holds: the items the layer draws a shape for, the composites built, and what went. */
export interface RefilledShapes {
  held: string[];
  dropped: number;
  /** The items given a composite of their child regions' shapes. */
  composed: string[];
  /** Items of regions with children that got none, because a child has no shape. */
  uncomposed: number;
}

/**
 * Replace the store's OpenStreetMap shapes with those the layer in place
 * draws for `items`, then build the composites over them, in one
 * transaction, so a match reads either the last build's shapes or this
 * one's. A shape no longer drawn, such as an item no import names any more,
 * goes, and so does every composite before it is built again.
 */
export async function refillRegionShapes(items: readonly string[]): Promise<RefilledShapes> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const refilled = await refillDrawnShapes(client, items);
    const composed: string[] = [];
    for (let pass = 0; pass < COMPOSITE_PASSES; pass += 1) {
      const built = await composeShapes(client);
      if (built.length === 0) break;
      composed.push(...built);
    }
    const uncomposed = await uncomposedItems(client);
    await client.query('COMMIT');
    return { ...refilled, composed, uncomposed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The drawn shapes, in one statement: every item-keyed row the layer no longer draws goes, composites among them. */
async function refillDrawnShapes(client: PoolClient, items: readonly string[]): Promise<{ held: string[]; dropped: number }> {
  const result = await client.query<{ held: string[]; dropped: number }>(
    `WITH shapes AS (
       SELECT DISTINCT ON (o.wikidata) o.wikidata AS item, shape.geom
         FROM osm_objects o
         CROSS JOIN LATERAL (
           SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
             ST_SimplifyPreserveTopology(ST_CollectionExtract(o.geom, 3), $2)), 3)) AS geom
         ) shape
        WHERE o.wikidata = ANY($1::text[]) AND o.osm_type IN ('R', 'W') AND NOT ST_IsEmpty(shape.geom)
        ORDER BY o.wikidata, o.osm_type = 'R' DESC, ST_Area(shape.geom) DESC
     ), held AS (
       INSERT INTO wikidata_geoshapes (wikidata_id, geom, licence, attribution)
       SELECT item, geom, $3, NULL FROM shapes
       ON CONFLICT (wikidata_id) DO UPDATE SET geom = EXCLUDED.geom, not_available = FALSE, composite_of = NULL,
         licence = EXCLUDED.licence, attribution = EXCLUDED.attribution
       RETURNING wikidata_id
     ), dropped AS (
       DELETE FROM wikidata_geoshapes g
        WHERE g.wikidata_id ~ '^Q[1-9][0-9]*$' AND NOT EXISTS (SELECT 1 FROM shapes s WHERE s.item = g.wikidata_id)
       RETURNING 1
     )
     SELECT COALESCE((SELECT array_agg(wikidata_id) FROM held), '{}') AS held, (SELECT count(*) FROM dropped)::int AS dropped`,
    [items, SIMPLIFY_DEGREES, OSM_SHAPE_LICENCE],
  );
  return result.rows[0];
}

/**
 * The regions whose item holds no shape and every one of whose child regions
 * holds an OpenStreetMap one, one region per item: of the regions that share
 * an item, the first world view's that qualifies, since any complete union of
 * an item's children is its outline. A partial union would be a wrong
 * outline, and a Commons map file's shape is under another licence than the
 * composite's.
 */
const COMPOSABLE_SQL = `
  SELECT DISTINCT ON (ps.source_external_id) ps.source_external_id AS item, r.id AS region_id
    FROM region_import_state ps
    JOIN regions r ON r.id = ps.region_id
   WHERE ps.source_external_id ~ '^Q[1-9][0-9]*$'
     AND NOT EXISTS (SELECT 1 FROM wikidata_geoshapes g WHERE g.wikidata_id = ps.source_external_id)
     AND EXISTS (SELECT 1 FROM regions c WHERE c.parent_region_id = r.id)
     AND NOT EXISTS (
       SELECT 1 FROM regions c
         LEFT JOIN region_import_state cs ON cs.region_id = c.id
         LEFT JOIN wikidata_geoshapes cg ON cg.wikidata_id = cs.source_external_id
                                       AND cg.geom IS NOT NULL AND cg.licence = $1
        WHERE c.parent_region_id = r.id AND cg.wikidata_id IS NULL)
   ORDER BY ps.source_external_id, r.world_view_id, r.id`;

/** One pass of composites: the union of each composable region's children's shapes. Answers the items given one. */
async function composeShapes(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ wikidata_id: string }>(
    `WITH composable AS (${COMPOSABLE_SQL}),
     unions AS (
       SELECT p.item, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(cg.geom)), 3)) AS geom,
              count(DISTINCT cg.wikidata_id)::int AS parts
         FROM composable p
         JOIN regions c ON c.parent_region_id = p.region_id
         JOIN region_import_state cs ON cs.region_id = c.id
         JOIN wikidata_geoshapes cg ON cg.wikidata_id = cs.source_external_id
        GROUP BY p.item
     )
     INSERT INTO wikidata_geoshapes (wikidata_id, geom, licence, attribution, composite_of)
     SELECT item, geom, $1, NULL, parts FROM unions WHERE NOT ST_IsEmpty(geom)
     RETURNING wikidata_id`,
    [OSM_SHAPE_LICENCE],
  );
  return result.rows.map(row => row.wikidata_id);
}

/** How many items of regions with children still hold no shape: a child of theirs has none. */
async function uncomposedItems(client: PoolClient): Promise<number> {
  const result = await client.query<{ n: number }>(
    `SELECT count(DISTINCT ps.source_external_id)::int AS n
       FROM region_import_state ps
       JOIN regions r ON r.id = ps.region_id
      WHERE ps.source_external_id ~ '^Q[1-9][0-9]*$'
        AND NOT EXISTS (SELECT 1 FROM wikidata_geoshapes g WHERE g.wikidata_id = ps.source_external_id)
        AND EXISTS (SELECT 1 FROM regions c WHERE c.parent_region_id = r.id)`,
  );
  return result.rows[0].n;
}
