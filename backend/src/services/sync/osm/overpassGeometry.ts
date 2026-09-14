/**
 * The geometry of an Overpass answer, as the WKT the rest of the reader
 * already understands.
 *
 * The QLever mirror answers a finished WKT per object, because osm2rdf built
 * the polygons when it loaded the planet. Overpass answers what OSM stores: a
 * node's coordinate, a way's vertices in order (`out geom`), and a relation's
 * members each carrying their own vertices — a multipolygon is a set of ways
 * tagged `outer` and `inner` that only become rings once they are joined end
 * to end. This module does that joining, and nothing downstream can tell
 * which door the polygon came from: `wktIsPolygonal`, `wktAreaOf` and the
 * writer's `ST_GeomFromText` read the text alone.
 *
 * Only what can be drawn honestly is drawn. A `type=multipolygon` or
 * `type=boundary` relation is assembled; a `type=site` relation — the
 * Acropolis has one beside its multipolygon — is a grouping of parts, and
 * joining its member ways into a ring would draw an outline nobody mapped. An
 * outer ring that does not close is dropped rather than closed by hand, and a
 * hole that sits in no outer ring is dropped rather than drawn on its own.
 */

/** One vertex as Overpass writes it. */
export interface OverpassPoint {
  lat: number;
  lon: number;
}

export interface OverpassMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role?: string;
  /** A way member's vertices under `out geom`. */
  geometry?: OverpassPoint[];
}

/** One element of an Overpass JSON answer, with what `out tags` or `out geom` put on it. */
export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: OverpassPoint[];
  members?: OverpassMember[];
}

/** What the reader stores of a geometry: its type word, and the WKT where one can be drawn. */
export interface OverpassGeometry {
  type: string | null;
  wkt: string | null;
}

/** The relations whose member ways are rings, by their own `type` tag. */
const RING_RELATIONS = new Set(['multipolygon', 'boundary']);

const NO_GEOMETRY: OverpassGeometry = { type: null, wkt: null };

function coordinate(point: OverpassPoint): string {
  return `${point.lon} ${point.lat}`;
}

function ringText(ring: OverpassPoint[]): string {
  return `(${ring.map(coordinate).join(',')})`;
}

function same(a: OverpassPoint, b: OverpassPoint): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

function isClosed(points: OverpassPoint[]): boolean {
  return points.length >= 4 && same(points[0], points[points.length - 1]);
}

/**
 * Closed rings joined from way segments, in either direction.
 *
 * A ring is grown from one segment by appending whichever remaining segment
 * starts or ends where the ring currently ends (reversed when it ends there),
 * until the ring meets its own start. Shared nodes carry identical coordinates
 * in an Overpass answer, so exact equality is the join. Segments that never
 * close are dropped: an outline with a gap is not an outline.
 */
export function joinRings(segments: OverpassPoint[][]): OverpassPoint[][] {
  const pool = segments.filter((segment) => segment.length >= 2).map((segment) => [...segment]);
  const rings: OverpassPoint[][] = [];
  while (pool.length > 0) {
    const ring = pool.shift() as OverpassPoint[];
    let grew = true;
    while (!isClosed(ring) && grew) {
      grew = false;
      const tail = ring[ring.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const next = pool[i];
        if (same(next[0], tail)) {
          ring.push(...next.slice(1));
        } else if (same(next[next.length - 1], tail)) {
          ring.push(...next.slice(0, -1).reverse());
        } else {
          continue;
        }
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (isClosed(ring)) rings.push(ring);
  }
  return rings;
}

/** Whether a point lies inside a closed ring, by the even-odd rule. */
function contains(ring: OverpassPoint[], point: OverpassPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crosses = (a.lat > point.lat) !== (b.lat > point.lat)
      && point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * A relation's rings as one MULTIPOLYGON, or nothing.
 *
 * Every outer ring is a polygon; every inner ring is a hole of the first outer
 * ring that contains its first vertex, which is how a multipolygon relation
 * means it. A member with no role is read as `outer`, the reading the
 * multipolygon convention gives an untagged member.
 */
function relationWkt(members: OverpassMember[]): string | null {
  const ways = members.filter((member) => member.type === 'way' && member.geometry);
  const outers = joinRings(
    ways.filter((m) => (m.role ?? '') === 'outer' || (m.role ?? '') === '')
      .map((m) => m.geometry as OverpassPoint[]),
  );
  if (outers.length === 0) return null;
  const inners = joinRings(
    ways.filter((m) => m.role === 'inner').map((m) => m.geometry as OverpassPoint[]),
  );
  const polygons = outers.map((outer) => [outer]);
  for (const inner of inners) {
    const owner = polygons.find(([outer]) => contains(outer, inner[0]));
    if (owner) owner.push(inner);
  }
  const polygonTexts = polygons.map((rings) => `(${rings.map(ringText).join(',')})`);
  return `MULTIPOLYGON(${polygonTexts.join(',')})`;
}

/**
 * The geometry of one element, in the reader's terms.
 *
 * A node is a point whether or not its coordinate was sent; a way is a polygon
 * when its vertices close and a line when they do not; a ring relation is a
 * multipolygon when its members can be joined. An element the query answered
 * with tags alone has a type where the type is knowable and no WKT, which is
 * exactly what the mirror's answer looks like for an object whose geometry the
 * rule keeps off the wire.
 */
export function geometryOf(element: OverpassElement): OverpassGeometry {
  if (element.type === 'node') {
    const wkt = element.lat !== undefined && element.lon !== undefined
      ? `POINT(${coordinate({ lat: element.lat, lon: element.lon })})`
      : null;
    return { type: 'POINT', wkt };
  }
  if (element.type === 'way') {
    const points = element.geometry;
    if (!points || points.length < 2) return NO_GEOMETRY;
    return isClosed(points)
      ? { type: 'POLYGON', wkt: `POLYGON(${ringText(points)})` }
      : { type: 'LINESTRING', wkt: `LINESTRING${ringText(points)}` };
  }
  if (!element.members) return NO_GEOMETRY;
  if (!RING_RELATIONS.has(element.tags?.type ?? '')) {
    return { type: 'GEOMETRYCOLLECTION', wkt: null };
  }
  const wkt = relationWkt(element.members);
  return wkt ? { type: 'MULTIPOLYGON', wkt } : NO_GEOMETRY;
}
