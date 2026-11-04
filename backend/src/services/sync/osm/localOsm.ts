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
 * tags `OSM_TAG_KEYS` reads, and a geometry and its type only for the objects
 * the kind's keep rule draws, the same five clauses `overpassBatchQuery`
 * spells. The layer keeps no full geometry of any other object (ADR-0136).
 */

import { pool } from '../../../db/index.js';
import { LAYER_FRESH_FOR_DAYS } from '../../dumps/osm/layerSchedule.js';
import { layerDraws } from '../../dumps/osm/layerSelection.js';
import { layerState } from '../../dumps/osm/layerTables.js';
import type { QueryRunner } from '../wikidataQueries.js';
import { isQid } from '../wikidataUtils.js';
import { OsmEmptyEnumerationError, readOsmDigs, readOsmObjects, type OsmDoor } from './readOsmObjects.js';
import { OSM_TAG_KEYS, type DigTags, type KeepWkt, type OsmDigs, type OsmKind, type OsmObject } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS: Record<string, OsmKind> = { N: 'node', W: 'way', R: 'relation' };

interface LayerInPlace {
  /** The instant the layer is current to. */
  currentTo: string;
  /** The rule it kept full geometries by; null for a layer that kept every one (ADR-0136). */
  drawn: KeepWkt | null;
}

/** The layer in place; null where none is. */
async function layerInPlace(): Promise<LayerInPlace | null> {
  const state = await layerState();
  return state ? { currentTo: state.currentTo.toISOString(), drawn: state.drawn } : null;
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

/** A row of the layer as the object both live doors answer with, from the layer as of `currentTo`, with the tags of `keys`. */
function objectOf(
  row: Pick<LayerRow, 'osm_type' | 'osm_id' | 'tags' | 'geometry_type' | 'wkt'>, currentTo: string, keys: readonly string[] = OSM_TAG_KEYS,
): OsmObject {
  const kind = KINDS[row.osm_type.trim()];
  const tags: Record<string, string> = {};
  for (const key of keys) {
    const value = row.tags[key];
    if (typeof value === 'string') tags[key] = value;
  }
  return {
    ref: `${kind}/${row.osm_id}`, kind, tags, geometryType: row.geometry_type?.toUpperCase() ?? null, wkt: row.wkt,
    source: { door: 'local', asOf: currentTo },
  };
}

/**
 * What the layer maps carrying each item's `wikidata` tag, with its geometry
 * and the geometry's type where the keep rule draws one. The layer keeps a
 * point for most objects (ADR-0136), and a full geometry for what a kind
 * draws and for the objects of the items `drawnItems` lists
 * (ADR-0157), so it answers no type for an object the rule does not draw,
 * whatever the layer kept of it: its point or outline is not this kind's.
 */
async function layerObjects(qids: string[], keep: KeepWkt, currentTo: string): Promise<Map<string, OsmObject[]>> {
  const result = await pool.query<LayerRow>(
    `SELECT osm_type, osm_id::text AS osm_id, tags, wikidata, wikipedia,
            CASE WHEN rule.draws THEN GeometryType(shape.geom) END AS geometry_type,
            CASE WHEN rule.draws THEN ST_AsText(shape.geom) END AS wkt
       FROM osm_objects
      CROSS JOIN LATERAL (SELECT tags->>'historic' = ANY($2::text[])
                                 OR (tags ? 'ruins' AND tags->>'ruins' <> 'no')
                                 OR (tags ? 'archaeological_site' AND tags->>'archaeological_site' <> 'no')
                                 OR tags->>'man_made' = ANY($3::text[])
                                 OR tags->>'boundary' = ANY($4::text[]) AS draws) AS rule
      -- A closed way as its area, as both live doors draw it: osm2pgsql keeps
      -- a ring that crosses itself as its line (Viminacium's way/1568883618).
      CROSS JOIN LATERAL (SELECT CASE WHEN GeometryType(geom) = 'LINESTRING' AND ST_IsClosed(geom) AND ST_NPoints(geom) >= 4
                                      THEN ST_MakePolygon(geom) ELSE geom END AS geom) AS shape
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
    // A layer cut with a drawn rule narrower than `keep` holds points where
    // this read wants outlines: it answers nothing here, and the read goes
    // live whole until a layer cut with the wider rule is in place (ADR-0136).
    const placed = await layerInPlace();
    const layer = placed && layerDraws(placed.drawn, keep) ? placed : null;
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

/** A place asked of `layerStructuresReader`: its item, its point, and the objects the item says it is mapped as (`node/123`). */
export interface StructureQuestion {
  qid: string;
  lat: number;
  lon: number;
  refs: readonly string[];
}

/**
 * What the layer maps for one place: every object that carries its item, by
 * its `wikidata` tag or as an object the item names, and, where none does, the
 * nearest structure within the radius that carries no item.
 */
export interface MappedStructure {
  carried: OsmObject[];
  nearest: (OsmObject & { metres: number }) | null;
}

/** The structures read, and whether the layer vouches for its misses (`layerVouches`): only then is "no object carries the item" a fact. */
export interface StructuresRead {
  byItem: Map<string, MappedStructure>;
  missesAreFacts: boolean;
}

/** What a structures read asks for: the `man_made` values a structure is, the tags it keeps, and how far a nearest one may stand. */
export interface StructureTags {
  manMade: readonly string[];
  keys: readonly string[];
  radiusMetres: number;
}

/** Metres in a degree of latitude, near enough for a search box. */
const METRES_PER_DEGREE = 111_000;

const REF = /^(node|way|relation)\/(\d+)$/;
const LAYER_TYPES: Record<OsmKind, string> = { node: 'N', way: 'W', relation: 'R' };

interface StructureRow {
  found: 'carried' | 'nearest';
  qid: string;
  osm_type: string;
  osm_id: string;
  tags: Record<string, string>;
  metres: number | null;
}

/**
 * The structures the layer maps at each place, in one statement for the whole
 * batch: the objects that carry its item, by the `wikidata` tag or as the
 * object the item names (`refs`: Wikidata's OpenStreetMap node and way ids),
 * and, for a place no object carries, the nearest object whose `man_made` is
 * one of `tags.manMade` within `tags.radiusMetres` and that carries no item,
 * since an object naming another item is that item's. The box around each
 * point is what the spatial index answers before any distance is measured, as
 * the point hints ask (`pointHints.ts`). Null where no layer is in place.
 *
 * The layer alone: an object it finds is the answer whatever its age, and a
 * miss is a fact only while the layer vouches for one (ADR-0134 decision 4).
 * No live door is asked, since a structure's nearest neighbour is no question
 * either live door answers.
 */
export function layerStructuresReader(now: () => Date = () => new Date()) {
  return async (places: readonly StructureQuestion[], tags: StructureTags): Promise<StructuresRead | null> => {
    const layer = await layerInPlace();
    if (!layer) return null;
    const asked = places.filter((place) => isQid(place.qid));
    const byItem = new Map<string, MappedStructure>(asked.map((place) => [place.qid, { carried: [], nearest: null }]));
    if (!asked.length) return { byItem, missesAreFacts: layerVouches(layer, now()) };
    const refs = asked.flatMap((place) => place.refs.flatMap((ref) => {
      const match = REF.exec(ref);
      return match ? [{ qid: place.qid, type: LAYER_TYPES[match[1] as OsmKind], id: match[2] }] : [];
    }));
    const result = await pool.query<StructureRow>(
      `WITH asked AS (
         SELECT a.qid, ST_SetSRID(ST_MakePoint(a.lon, a.lat), 4326) AS at
           FROM unnest($1::text[], $2::float8[], $3::float8[]) AS a(qid, lat, lon)
       ), stated AS (
         SELECT * FROM unnest($4::text[], $5::text[], $6::bigint[]) AS s(qid, osm_type, osm_id)
       ), carried AS (
         SELECT a.qid, o.osm_type, o.osm_id, o.tags FROM asked a JOIN osm_objects o ON o.wikidata = a.qid
         UNION
         SELECT s.qid, o.osm_type, o.osm_id, o.tags FROM stated s
           JOIN osm_objects o ON o.osm_type = s.osm_type AND o.osm_id = s.osm_id
       )
       SELECT 'carried' AS found, qid, osm_type, osm_id::text AS osm_id, tags, NULL::float8 AS metres FROM carried
       UNION ALL
       SELECT 'nearest', a.qid, n.osm_type, n.osm_id::text, n.tags, n.metres
         FROM asked a
        CROSS JOIN LATERAL (
          SELECT o.osm_type, o.osm_id, o.tags, ST_Distance(o.geom::geography, a.at::geography) AS metres
            FROM osm_objects o
           -- The box first, wider in longitude as the meridians close towards the poles.
           WHERE o.geom && ST_Expand(a.at, $8 / greatest(cos(radians(ST_Y(a.at))), 0.05), $8)
             AND o.wikidata IS NULL
             AND o.tags->>'man_made' = ANY($7::text[])
             AND ST_DWithin(o.geom::geography, a.at::geography, $9)
           ORDER BY metres, o.osm_type, o.osm_id
           LIMIT 1) n
        WHERE NOT EXISTS (SELECT 1 FROM carried c WHERE c.qid = a.qid)
        ORDER BY qid, found, osm_type, osm_id`,
      [
        asked.map((place) => place.qid), asked.map((place) => place.lat), asked.map((place) => place.lon),
        refs.map((ref) => ref.qid), refs.map((ref) => ref.type), refs.map((ref) => ref.id),
        tags.manMade, tags.radiusMetres / METRES_PER_DEGREE, tags.radiusMetres,
      ],
    );
    for (const row of result.rows) {
      const object = objectOf({ ...row, geometry_type: null, wkt: null }, layer.currentTo, tags.keys);
      const mapped = byItem.get(row.qid)!;
      if (row.found === 'carried') mapped.carried.push(object);
      else mapped.nearest = { ...object, metres: Number(row.metres) };
    }
    return { byItem, missesAreFacts: layerVouches(layer, now()) };
  };
}
