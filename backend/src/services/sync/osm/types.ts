/**
 * What an OpenStreetMap object is to this catalogue, and the shapes an answer
 * arrives in.
 *
 * Kind-agnostic on purpose: this module knows that an object has an id, a set
 * of tags and possibly a polygon, and nothing about archaeology. Which tags
 * mean *ruin* and which mean *a town people live in* is the kind's
 * (`archaeology/classes.ts`), because a second kind reading OSM will draw a
 * different line through the same keys and must not have to fork the reader to
 * do it.
 *
 * The provenance shape ADR-0059 decision 2 asks for is built from `ref`: the
 * object (`node/way/relation` and id), the tag read, and the date. `ref` is
 * therefore spelled the way a person quotes one — `way/423938794` — rather than
 * as the URI osm2rdf answers with.
 */

import type { SparqlBinding } from '../wikidataUtils.js';

export type OsmKind = 'node' | 'way' | 'relation';

/** One mapped object carrying `wikidata=<item>`. */
export interface OsmObject {
  /** `way/423938794` — what a reason names and an extent is credited to. */
  ref: string;
  kind: OsmKind;
  /** Only the keys asked for, only where the object carries them. */
  tags: Record<string, string>;
  /** `POLYGON`, `POINT`, … read off the first characters of the WKT; null where the object has none. */
  geometryType: string | null;
  /** The full WKT, only for the objects the query's own rule sends it for. */
  wkt: string | null;
}

/**
 * The tags one question asks for.
 *
 * `name` is here because a refusal a curator reads is better for saying what
 * OSM calls the thing, and `natural` because a lake tagged `natural=water` is
 * how the measurement told Lake Bled from a ruin. `site_type` is deliberately
 * absent: the tagging wiki does not document it for `historic=archaeological_site`
 * and it was unused across all 1,544 objects measured on 2026-09-14.
 */
export const OSM_TAG_KEYS = [
  'historic', 'place', 'archaeological_site', 'ruins', 'heritage',
  'tourism', 'boundary', 'man_made', 'natural', 'name',
] as const;

const OBJECT_URI = /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/(\d+)$/;

/**
 * The object a `?s` binding names, or nothing.
 *
 * Nothing rather than a guess: osm2rdf's subjects include changesets and
 * metadata nodes, and a reference the catalogue stores has to be one a person
 * can open.
 */
export function osmRefOf(uri: string): { ref: string; kind: OsmKind } | null {
  const match = OBJECT_URI.exec(uri);
  if (!match) return null;
  return { ref: `${match[1]}/${match[2]}`, kind: match[1] as OsmKind };
}

/**
 * Whether a WKT string is an extent this catalogue can store.
 *
 * `experiences.boundary` is a `MultiPolygon`, so a point, a line and a
 * geometry collection are not extents — and a collection is what a relation of
 * mixed members answers with (the Acropolis of Athens, measured). Read off the
 * text rather than parsed: the whole of what is needed is the type word in
 * front, and parsing a megabyte of coordinates to learn it would be work for
 * nothing.
 */
export function wktIsPolygonal(wkt: string | null): boolean {
  if (!wkt) return false;
  return /^\s*(POLYGON|MULTIPOLYGON)\s*\(/i.test(wkt);
}

/** The geometry type word of a WKT prefix (`POLYGON((26.` → `POLYGON`), or null. */
function typeOf(prefix: string | undefined): string | null {
  if (!prefix) return null;
  const word = /^\s*([A-Z]+)/i.exec(prefix);
  return word ? word[1].toUpperCase() : null;
}

/**
 * The keys this reader asked for, taken off one row onto one object.
 *
 * The first value of each key wins, as the pool parses do: a key carrying two
 * values on one object cross-multiplies in SPARQL, and a second row about the
 * same object must not overwrite what the first said.
 */
function mergeTags(row: SparqlBinding, tags: Record<string, string>): void {
  for (const key of OSM_TAG_KEYS) {
    const value = row[key]?.value;
    if (value && tags[key] === undefined) tags[key] = value;
  }
}

/**
 * One answer's rows folded into the map, each under the item that was asked
 * about.
 *
 * Only items already in the map are filled, and every asked item is in it
 * before the question is sent: absence from the map means the caller never
 * asked, and an empty list means OSM maps nothing carrying this item. A row
 * about anything else is dropped with no key invented for it — a key nobody
 * asked about would be read later as an answer.
 *
 * Rows about one object are merged rather than listed twice: a key with two
 * values on one object cross-multiplies in SPARQL, and the first value of each
 * key is taken, as the pool parses do.
 */
export function foldOsmRows(rows: SparqlBinding[], into: Map<string, OsmObject[]>): void {
  for (const row of rows) {
    const qid = row.q?.value;
    if (!qid) continue;
    const objects = into.get(qid);
    if (!objects) continue;
    const named = osmRefOf(row.s?.value ?? '');
    if (!named) continue;
    let object = objects.find((o) => o.ref === named.ref);
    if (!object) {
      object = { ref: named.ref, kind: named.kind, tags: {}, geometryType: null, wkt: null };
      objects.push(object);
    }
    mergeTags(row, object.tags);
    object.geometryType ??= typeOf(row.geomType?.value);
    // The empty string is what the query binds where its own rule says not to
    // send the geometry. That is no geometry, not an empty one.
    const wkt = row.wkt?.value;
    if (wkt && object.wkt === null) object.wkt = wkt;
  }
}

/**
 * The ground a polygonal WKT covers, as a number good for ranking: the
 * shoelace area of each polygon's outer ring less its holes, in degrees with
 * the longitudes scaled by the cosine of the latitude, so a shape at 60° north
 * is not read as wider than it is.
 *
 * Not a measurement anybody stores — PostGIS measures the chosen polygon
 * properly the moment it is written (`area_km2`) — and enough to tell the
 * Nazca Lines' 774 km² World Heritage zone from the 0.0015 km² ruin object
 * inside it. Anything that is not polygonal covers nothing.
 */
export function wktAreaOf(wkt: string | null): number {
  if (!wktIsPolygonal(wkt) || !wkt) return 0;
  let area = 0;
  // A walk over the parentheses rather than a regular expression: each
  // polygon is `((outer), (hole), …)`, so a ring opened straight after a `(`
  // is an outer ring and adds, and one opened after a `,` is a hole and takes
  // away. Linear in the text, which a 60,000-character tracing asks for.
  let at = 0;
  for (;;) {
    const open = wkt.indexOf('(', at);
    if (open === -1) break;
    let next = open + 1;
    while (wkt[next] === ' ') next += 1;
    if (wkt[next] === '(') {
      at = next;
      continue;
    }
    const close = wkt.indexOf(')', open);
    if (close === -1) break;
    let before = open - 1;
    while (before >= 0 && wkt[before] === ' ') before -= 1;
    const ring = ringArea(wkt.slice(open + 1, close));
    area += wkt[before] === '(' ? ring : -ring;
    at = close + 1;
  }
  return area;
}

function ringArea(ring: string): number {
  const points = ring.split(',').map((pair) => {
    const [lon, lat] = pair.trim().split(' ').filter(Boolean).map(Number);
    return [lon, lat] as const;
  });
  if (points.length < 3 || points.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat))) {
    return 0;
  }
  const meanLat = points.reduce((sum, [, lat]) => sum + lat, 0) / points.length;
  const scale = Math.cos((meanLat * Math.PI) / 180);
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * scale * y2 - x2 * scale * y1;
  }
  return Math.abs(twice) / 2;
}

/**
 * The object covering the most ground, by the area its WKT traces.
 *
 * By area and not by the length of the text: two polygons of one site differ
 * by how finely they are traced as much as by how much they enclose, and a
 * small ruin surveyed vertex by vertex would outweigh the park drawn around it
 * in four corners.
 */
export function largestByArea(objects: OsmObject[]): OsmObject | null {
  let best: OsmObject | null = null;
  let bestArea = 0;
  for (const object of objects) {
    if (!object.wkt) continue;
    const area = wktAreaOf(object.wkt);
    if (!best || area > bestArea) {
      best = object;
      bestArea = area;
    }
  }
  return best;
}
