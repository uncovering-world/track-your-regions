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
 */

import { pool } from '../../../db/index.js';

/** The licence an OpenStreetMap shape is under, as the store keeps it. */
export const OSM_SHAPE_LICENCE = 'ODbL-1.0';

/** About a hundred metres at the equator: an outline for matching, not for a map. */
const SIMPLIFY_DEGREES = 0.001;

/**
 * Replace the store's OpenStreetMap shapes with those the layer in place
 * draws for `items`, in one statement, so a match reads either the last
 * build's shapes or this one's. A shape no longer drawn, such as an item no
 * import names any more, goes. Answers the items it holds a shape for, and
 * how many shapes went.
 */
export async function refillRegionShapes(items: readonly string[]): Promise<{ held: string[]; dropped: number }> {
  const result = await pool.query<{ held: string[]; dropped: number }>(
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
