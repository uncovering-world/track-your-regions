/**
 * What the OpenStreetMap layer keeps (ADR-0134 decisions 2 and 3), stated
 * once: the tags that select an object, and the objects the catalogue names,
 * which are kept whatever their tags.
 *
 * The selection is written as an `osmium tags-filter` expression file, and
 * the layer's flex style (`layer.lua`) reads the same file to decide which of
 * the objects osmium let through become rows: osmium also passes the nodes a
 * kept way is drawn from and the members of a kept relation, which give the
 * geometry and are not rows themselves. One file, so the cut and the rows
 * cannot disagree.
 */

import { pool } from '../../../db/index.js';

/**
 * The selection, one `osmium tags-filter` expression per entry: a key on its
 * own keeps any value of it, `key=a,b` those values only. An address is not
 * among them: every house with an address would bring in most of the mapped
 * world's buildings, and an object kept for another tag keeps its `addr:*`
 * tags with the rest.
 */
export const LAYER_SELECTION = [
  'wikidata',
  'wikipedia',
  'historic',
  'heritage',
  'archaeological_site',
  'ruins',
  'amenity=place_of_worship',
  'tourism',
  'man_made',
  'place',
  'boundary=protected_area,national_park',
] as const;

/** The expression file `osmium tags-filter -e` and the flex style read: every selector, for nodes, ways and relations. */
export function selectionFile(): string {
  const lines = LAYER_SELECTION.map(selector => `nwr/${selector}`);
  return `${lines.join('\n')}\n`;
}

const OSM_REF = /^(node|way|relation)\/([1-9]\d*)$/;

/** `node/123` as `osmium getid` names it, `n123`; null for anything that is not an OSM object. */
export function getidOf(ref: string): string | null {
  const match = OSM_REF.exec(ref);
  return match ? `${match[1][0]}${match[2]}` : null;
}

/**
 * Every OSM object the catalogue names, as `osmium getid` names them: the
 * object a place's OSM facts were read from and the one its extent was drawn
 * from (`metadata.osm.object` and `extentFrom`, ADR-0059 decision 2). A cached
 * OSM answer names nothing beyond the selection: it was asked by a `wikidata`
 * tag or by the dig tags, both of which select.
 */
export async function pinnedObjects(): Promise<string[]> {
  const result = await pool.query<{ ref: string }>(
    `SELECT DISTINCT refs.ref
       FROM experiences e
       CROSS JOIN LATERAL (VALUES (e.metadata->'osm'->>'object'), (e.metadata->'osm'->>'extentFrom')) AS refs(ref)
      WHERE e.metadata ? 'osm' AND refs.ref IS NOT NULL`,
  );
  return result.rows.map(row => getidOf(row.ref)).filter((id): id is string => id !== null).sort();
}
