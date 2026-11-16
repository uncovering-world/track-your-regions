/**
 * A place's line (`experiences.path`, ADR-0207, ADR-0212): a bridge, a
 * tunnel, a causeway, a dam or an aqueduct drawn from the OpenStreetMap layer,
 * which places the place in every leaf it crosses. This module is the
 * column's one writer (ADR-0069), and says which places take a line, so the
 * layer keeps whole the objects the writer reads (`drawnItems`,
 * `layerSelection.ts`).
 *
 * A place takes a line when a kind that draws lines offers it: today
 * Bridges & engineering marvels, whose records know a place by its Wikidata
 * item. Its line is read after each layer swap, in one statement, from the
 * ways and relations that carry its item within `LINE_REACH_M` of its point
 * and draw the structure itself (`drawsTheStructureSql`): a closed way or an
 * area gives its outer ring, the rest their lines, merged into as few lines
 * as they make. The source owns the line it drew, as an outline is owned
 * (ADR-0146): it never replaces another source's line or one a curator
 * claimed, and a place whose objects are gone, or that its kind no longer
 * offers, keeps no line of its.
 *
 * One statement on the pool and no object lock, as missing detection's mark
 * (`db/locks.ts`): the rows it writes are locked in id order and held only as
 * long as it runs.
 */

import { pool } from './index.js';
import { membershipOfferedSql, MEMBERSHIPS } from './membership.js';
import { hasPinSql } from './readerPredicates.js';

/** How far from a place's point an object carrying its item may lie and still be its line: the Øresund Bridge's ways run 4 km from its point. */
export const LINE_REACH_M = 5000;

/** A Wikidata item as a record of a Wikidata source holds it. */
const ITEM = '^Q[1-9][0-9]*$';

/**
 * The records whose place takes a line, from the source `$1`: offered in its
 * kind (`membershipOfferedSql`, a record in a kind), and known by an item. A pending arrival takes
 * its line from the first layer built after a curator passes it.
 */
function linedRecordsSql(alias: string): string {
  return `${alias}.source_id = $1 AND ${membershipOfferedSql(alias)} AND ${alias}.external_id ~ '${ITEM}'`;
}

/**
 * The layer object `o` draws the structure itself, not a thing the item also
 * names: a way that is a highway, a railway, a dam or a bridge; an area
 * relation that is one of those; and a route or a tunnel relation, whose ways
 * are the line through (the Channel Tunnel's railway route). A bridge
 * relation is left out, since its members include what passes under the
 * bridge: Charles Bridge's names 40 km of the Vltava. So are a site relation
 * (Hoover Dam's groups its power station and visitor centre), a street
 * relation's houses, a pipeline laid on a bridge, and the reservoir behind a
 * dam: Katse Dam's lies 24 m from its point, and its 198 km of shore would put
 * the dam in every district around the lake.
 */
function drawsTheStructureSql(o: string): string {
  const structure = `(${o}.tags ? 'highway' OR ${o}.tags ? 'railway' OR ${o}.tags->>'waterway' = 'dam'
                      OR ${o}.tags->>'man_made' = 'bridge')`;
  return `((${o}.osm_type = 'W' AND ${structure})
           OR (${o}.osm_type = 'R' AND ${o}.tags->>'type' = 'multipolygon' AND ${structure})
           OR (${o}.osm_type = 'R' AND ${o}.tags->>'type' IN ('route', 'tunnel')))`;
}

/**
 * Every place's line as the layer in place draws it, keyed by place: the
 * statement the writer runs, kept apart so a measurement can run it against
 * another table of objects. `$1` is the source, `$2` the reach in metres.
 */
export const LINES_SQL = `
  WITH lined AS MATERIALIZED (
    SELECT m.experience_id AS id, m.external_id AS item, e.location
      FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
     WHERE ${linedRecordsSql('m')} AND ${hasPinSql('e')} AND e.merged_into_id IS NULL),
  drawn AS (
    SELECT lined.id, o.osm_type || o.osm_id AS ref, o.geom
      FROM lined JOIN osm_objects o ON o.wikidata = lined.item
     WHERE ${drawsTheStructureSql('o')}
       AND ST_DWithin(o.geom::geography, lined.location::geography, $2)),
  pieces AS (
    SELECT drawn.id, drawn.ref, piece.geom
      FROM drawn CROSS JOIN LATERAL (
        SELECT line.geom FROM ST_Dump(ST_CollectionExtract(drawn.geom, 2)) line
        UNION ALL
        SELECT ST_ExteriorRing(area.geom) FROM ST_Dump(ST_CollectionExtract(drawn.geom, 3)) area
      ) piece)
  SELECT pieces.id,
         ST_Multi(ST_LineMerge(ST_UnaryUnion(ST_Collect(pieces.geom)))) AS path,
         'osm:' || string_agg(DISTINCT pieces.ref, ',' ORDER BY pieces.ref) AS ref
    FROM pieces
   GROUP BY pieces.id`;

/** The items of the places the source `sourceId` draws a line for: the objects the layer keeps whole for them (ADR-0212). */
export async function linedItems(sourceId: number): Promise<string[]> {
  const result = await pool.query<{ item: string }>(
    `SELECT DISTINCT m.external_id AS item FROM ${MEMBERSHIPS} m WHERE ${linedRecordsSql('m')} ORDER BY 1`,
    [sourceId],
  );
  return result.rows.map(row => row.item);
}

/** What one writing of the lines did: the places whose line changed, and how many hold one. */
export interface LinesWritten {
  changed: number[];
  held: number;
}

/**
 * Write the line of every place the source `sourceId` draws one for, from the
 * layer in place, current to `layerInstant`: a line where the layer draws one,
 * none where it no longer does or the kind no longer offers the place. A line
 * another source drew, or one a curator claimed, is left as it is. Every line
 * the source holds is stamped with the layer it was read from, and the places
 * whose line changed (a new one, another, or none any more) are answered. The
 * statement commits on its own; the build then places every place
 * `placedByLines` names, so a build stopped in between leaves nothing the
 * next one does not place.
 */
export async function writeLines(sourceId: number, layerInstant: Date): Promise<LinesWritten> {
  const result = await pool.query<{ id: number; changed: boolean; held: boolean }>(
    `WITH lines AS MATERIALIZED (${LINES_SQL}),
     mine AS (
       SELECT e.id, lines.path, lines.ref,
              (e.path IS NULL) <> (lines.path IS NULL)
                OR (e.path IS NOT NULL AND NOT ST_Equals(e.path, lines.path)) AS changed
         FROM experiences e LEFT JOIN lines ON lines.id = e.id
        WHERE (lines.id IS NOT NULL OR e.path_source_id = $1)
          AND (e.path_source_id IS NULL OR e.path_source_id = $1)
          AND NOT (COALESCE(e.curated_fields, '[]'::jsonb) ? 'path')
        ORDER BY e.id
        FOR UPDATE OF e)
     UPDATE experiences e
        SET path = mine.path,
            path_source_id = CASE WHEN mine.path IS NULL THEN NULL ELSE $1 END,
            path_source_ref = mine.ref,
            path_updated_at = CASE WHEN mine.path IS NULL THEN NULL ELSE $3::timestamptz END
       FROM mine
      WHERE e.id = mine.id
     RETURNING e.id, mine.changed, mine.path IS NOT NULL AS held`,
    [sourceId, LINE_REACH_M, layerInstant],
  );
  return {
    changed: result.rows.filter(row => row.changed).map(row => row.id).sort((a, b) => a - b),
    held: result.rows.filter(row => row.held).length,
  };
}

/**
 * The places whose regions a line decides, which each build places again
 * (ADR-0212): every place that holds a line, and every place a line placed
 * before (an `experience_shape_regions` row of basis `line`). The second set
 * holds a place whose line is gone and whose regions still carry it. A build
 * stopped between writing the lines and placing them leaves both sets as
 * they were, so the next build places what the stopped one did not, though
 * no line changes then.
 */
export async function placedByLines(): Promise<number[]> {
  const result = await pool.query<{ id: number }>(
    `SELECT e.id FROM experiences e WHERE e.path IS NOT NULL
     UNION
     SELECT esr.experience_id FROM experience_shape_regions esr WHERE esr.basis = 'line'
     ORDER BY 1`,
  );
  return result.rows.map(row => row.id);
}
