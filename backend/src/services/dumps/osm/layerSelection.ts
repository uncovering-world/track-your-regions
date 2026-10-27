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
import { OSM_KEEP_WKT } from '../../sync/archaeology/siteClasses.js';
import type { KeepWkt } from '../../sync/osm/types.js';

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

/**
 * The objects whose full geometry the layer keeps (ADR-0136): those a kind's
 * keep rule draws, which today is Archaeology's alone — a ruin, a dig, or the
 * protected area drawn around one. The objects that carry an item a
 * world-view import names are kept whole too (`drawnItems`, ADR-0157). Every
 * other object keeps a point.
 */
export const LAYER_DRAWN: KeepWkt = OSM_KEEP_WKT;

/**
 * The drawn rule as the flex style reads it, one key a line: `key=a,b` draws
 * those values, a key on its own draws any value but `no` (`ruins`,
 * `archaeological_site`), the five clauses every door spells.
 */
export function drawnFile(): string {
  const valued = (key: string, values: string[]) => (values.length ? [`${key}=${values.join(',')}`] : []);
  const lines = [
    ...valued('historic', LAYER_DRAWN.historic),
    'ruins',
    'archaeological_site',
    ...valued('man_made', LAYER_DRAWN.manMade),
    ...valued('boundary', LAYER_DRAWN.boundary),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Whether a layer cut with the drawn rule `drawn` keeps the full geometry of
 * every object `keep` asks one for. A layer cut before ADR-0136 (`null`) kept
 * every one. A reader asking for more asks those outlines live.
 */
export function layerDraws(drawn: KeepWkt | null, keep: KeepWkt): boolean {
  if (drawn === null) return true;
  const within = (asked: string[], kept: string[]) => asked.every(value => kept.includes(value));
  return within(keep.historic, drawn.historic) && within(keep.manMade, drawn.manMade) && within(keep.boundary, drawn.boundary);
}

/**
 * The Wikidata items the world-view imports name (#2085, ADR-0157), whose
 * objects the layer also keeps whole: a region is matched by its shape, and
 * the store of region shapes is filled from the layer once a build is swapped
 * in (`layerShapes.ts`). An import that names a new item has it drawn from
 * the next build; until then the region is matched by its markers.
 */
export async function drawnItems(): Promise<string[]> {
  const result = await pool.query<{ item: string }>(
    `SELECT DISTINCT source_external_id AS item FROM region_import_state
      WHERE source_external_id ~ '^Q[1-9][0-9]*$' ORDER BY 1`,
  );
  return result.rows.map(row => row.item);
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
