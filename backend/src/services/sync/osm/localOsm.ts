/**
 * The OpenStreetMap layer as a door (ADR-0134 decisions 4 and 5): both reads
 * of the map, the per-item read and the dig enumeration, answered from
 * `osm_objects`, the layer the dump worker cuts from the planet, with a live
 * door for whatever the layer cannot vouch for: Overpass for a run, the
 * mirror for the visit witnesses.
 *
 * - **An object the layer finds is the answer**, whatever the layer's age.
 * - **A miss is a fact only on a fresh layer.** The per-item read asks by the
 *   `wikidata` tag, which the layer's selection keeps on every object, so on a
 *   layer at most `LAYER_FRESH_FOR_DAYS` old an item with no object is one
 *   OpenStreetMap maps nothing for. On an older layer, or with none in place,
 *   the items it did not find are asked of the live door, and only those.
 * - **The enumeration asks only selected tags**, so a fresh layer answers it
 *   whole; an older one hands it to the live door whole. A key's presence names a
 *   dig unless its value is `no`, and an object is filed under its article
 *   only where it carries no item, as `overpassDigsQueries` asks.
 * - **Each object names where it came from** (`OsmObject.source`): the layer
 *   with the instant it is current to, or the live door with the moment it was
 *   asked, which the site's `metadata.osm` carries (ADR-0059 decision 2).
 *
 * The objects answer in the shape both live doors fold into (`types.ts`): the
 * tags `OSM_TAG_KEYS` reads, and a geometry only for the objects the kind's
 * keep rule draws, the same five clauses `overpassBatchQuery` spells.
 */

import { pool } from '../../../db/index.js';
import { LAYER_FRESH_FOR_DAYS } from '../../dumps/osm/layerSchedule.js';
import { layerCurrentTo } from '../../dumps/osm/layerTables.js';
import type { QueryRunner } from '../wikidataQueries.js';
import { isQid } from '../wikidataUtils.js';
import { OsmEmptyEnumerationError, readOsmDigs, readOsmObjects, type OsmDoor } from './readOsmObjects.js';
import { OSM_TAG_KEYS, type DigTags, type KeepWkt, type OsmDigs, type OsmKind, type OsmObject } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS: Record<string, OsmKind> = { N: 'node', W: 'way', R: 'relation' };

/** The layer in place, as the instant it is current to; null where none is. */
async function layerInPlace(): Promise<{ currentTo: string } | null> {
  const currentTo = await layerCurrentTo();
  return currentTo ? { currentTo: currentTo.toISOString() } : null;
}

/**
 * Whether a fresh layer is in place now: what makes the layer every
 * OpenStreetMap read's default. A layer whose state cannot be read is none, so
 * the run opens the mirror rather than failing before any door is chosen.
 */
export async function freshLayerInPlace(now = new Date()): Promise<boolean> {
  try {
    return layerVouches(await layerInPlace(), now);
  } catch (err) {
    console.warn(`[OSM layer] Could not read the layer's state, reading the mirror: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Whether a layer current to `currentTo` vouches for its misses at `now`: it is
 * at most `LAYER_FRESH_FOR_DAYS` old (ADR-0134 decision 4). The age is the
 * layer's own; a later update that failed left the layer as it was.
 */
export function layerVouches(layer: { currentTo: string } | null, now: Date): boolean {
  return layer !== null && now.getTime() - Date.parse(layer.currentTo) <= LAYER_FRESH_FOR_DAYS * DAY_MS;
}

interface LayerRow {
  osm_type: string;
  osm_id: string;
  tags: Record<string, string>;
  wikidata: string | null;
  wikipedia: string | null;
  geometry_type: string | null;
  wkt: string | null;
}

/** A row of the layer as the object both live doors answer with, from the layer as of `currentTo`. */
function objectOf(row: LayerRow, currentTo: string): OsmObject {
  const kind = KINDS[row.osm_type.trim()];
  const tags: Record<string, string> = {};
  for (const key of OSM_TAG_KEYS) {
    const value = row.tags[key];
    if (typeof value === 'string') tags[key] = value;
  }
  return {
    ref: `${kind}/${row.osm_id}`, kind, tags, geometryType: row.geometry_type?.toUpperCase() ?? null, wkt: row.wkt,
    source: { door: 'local', asOf: currentTo },
  };
}

/** What the layer maps carrying each item's `wikidata` tag, with a geometry where the keep rule draws one. */
async function layerObjects(qids: string[], keep: KeepWkt, currentTo: string): Promise<Map<string, OsmObject[]>> {
  const result = await pool.query<LayerRow>(
    `SELECT osm_type, osm_id::text AS osm_id, tags, wikidata, wikipedia, GeometryType(geom) AS geometry_type,
            CASE WHEN tags->>'historic' = ANY($2::text[])
                   OR (tags ? 'ruins' AND tags->>'ruins' <> 'no')
                   OR (tags ? 'archaeological_site' AND tags->>'archaeological_site' <> 'no')
                   OR tags->>'man_made' = ANY($3::text[])
                   OR tags->>'boundary' = ANY($4::text[])
                 THEN ST_AsText(geom) END AS wkt
       FROM osm_objects
      WHERE wikidata = ANY($1::text[])
      ORDER BY osm_type, osm_id`,
    [qids, keep.historic, keep.manMade, keep.boundary],
  );
  const found = new Map<string, OsmObject[]>();
  for (const row of result.rows) {
    const objects = found.get(row.wikidata!) ?? [];
    objects.push(objectOf(row, currentTo));
    found.set(row.wikidata!, objects);
  }
  return found;
}

/** How the misses the layer cannot vouch for are asked of the live door. */
export type LiveRead = (qids: string[], keep: KeepWkt, run: Pick<QueryRunner, 'phase' | 'step'>) => Promise<Map<string, OsmObject[]>>;

/**
 * The per-item read: what the layer maps at each item, and, where the layer
 * cannot vouch for a miss, what the live door maps at the items it did not
 * find. `live` is the pass's door with the run's cache over it, and its answers
 * carry its name; `askLive` is how they are asked, every batch whole unless
 * the caller tolerates a dropped one (the visit witnesses, `mapOfWhatAnswered`).
 */
export function localOsmReader(
  live: OsmDoor, now: () => Date = () => new Date(),
  askLive: LiveRead = (qids, keep, run) => readOsmObjects(live, qids, keep, run),
) {
  return async (qids: string[], keep: KeepWkt, run: Pick<QueryRunner, 'phase' | 'step'>): Promise<Map<string, OsmObject[]>> => {
    const asked = [...new Set(qids.filter(isQid))];
    const out = new Map<string, OsmObject[]>(asked.map(qid => [qid, []]));
    if (!asked.length) return out;
    run.phase(`Reading what the OpenStreetMap layer maps at ${asked.length.toLocaleString('en')} sites...`);
    await run.step();
    const layer = await layerInPlace();
    if (layer) for (const [qid, objects] of await layerObjects(asked, keep, layer.currentTo)) out.set(qid, objects);
    if (layerVouches(layer, now())) return out;
    const misses = asked.filter(qid => out.get(qid)!.length === 0);
    if (!misses.length) return out;
    // Only what the live door answered is set: an item a dropped batch left
    // out stays unread, never "OpenStreetMap maps nothing there".
    for (const qid of misses) out.delete(qid);
    const askedAt = now().toISOString();
    for (const [qid, objects] of await askLive(misses, keep, run)) {
      out.set(qid, objects.map(object => ({ ...object, source: { door: live.name, asOf: askedAt } })));
    }
    return out;
  };
}

/**
 * The dig enumeration: every object tagged as a dig or as ruins that names an
 * item or an article, from a fresh layer whole, or from Overpass whole.
 */
export function localDigsReader(live: OsmDoor, tags: DigTags, now: () => Date = () => new Date()) {
  return async (run: Pick<QueryRunner, 'phase' | 'step'>): Promise<OsmDigs> => {
    const layer = await layerInPlace();
    if (!layerVouches(layer, now())) {
      // The live door's answer, stamped as the per-item misses are: a site's
      // verdict may be read from an object the enumeration alone brought.
      const askedAt = now().toISOString();
      const digs = await readOsmDigs(live, tags, run);
      const stamped = (objects: OsmObject[]) => objects.map(object => ({ ...object, source: { door: live.name, asOf: askedAt } }));
      return {
        byItem: new Map([...digs.byItem].map(([key, objects]) => [key, stamped(objects)])),
        byArticle: new Map([...digs.byArticle].map(([key, objects]) => [key, stamped(objects)])),
      };
    }
    run.phase('Reading every dig and ruin the OpenStreetMap layer maps...');
    await run.step();
    const result = await pool.query<LayerRow>(
      `SELECT osm_type, osm_id::text AS osm_id, tags, wikidata, wikipedia, NULL AS geometry_type, NULL AS wkt
         FROM osm_objects
        WHERE (wikidata IS NOT NULL OR wikipedia IS NOT NULL)
          AND (tags->>'historic' = ANY($1::text[])
               OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS dig(key) WHERE tags ? dig.key AND tags->>dig.key <> 'no'))`,
      [tags.historic, tags.keys],
    );
    const digs: OsmDigs = { byItem: new Map(), byArticle: new Map() };
    for (const row of result.rows) {
      const object = objectOf(row, layer!.currentTo);
      const [under, key] = row.wikidata ? [digs.byItem, row.wikidata] : [digs.byArticle, row.wikipedia!];
      under.set(key, [...(under.get(key) ?? []), object]);
    }
    if (digs.byItem.size === 0 && digs.byArticle.size === 0) throw new OsmEmptyEnumerationError();
    return digs;
  };
}
