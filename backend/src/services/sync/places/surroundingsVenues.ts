/**
 * ADR-0192: the venues around the places of a kind that reads them (Squares &
 * streets), for the surroundings tier's venue test (`surroundingsCut.ts`). A
 * street a traveller walks is lined with cafés, restaurants and bars, where a
 * through street of the same fame is not, so the OpenStreetMap layer's
 * food-and-drink venues (ADR-0191) are counted within the venue radius of
 * every place of the kind's classes in the surroundings pool, whatever its
 * editions: the quiet streets set no reference, but they count toward the area
 * the test reads. Each candidate is then measured against the best counts of
 * the kind's places within the radius, in a plain circle (`venuesAround`).
 * A street whose lines the layer keeps (ADR-0194) is measured along them
 * instead, in venues within `venueLineM` of a line per 100 m of it, and read
 * against the streets around it measured so, never against point counts
 * (ADR-0192 decision 1a); where too few are, it is read at its point
 * (`thinlyLined`). An artery is let in by neither reading.
 *
 * The layer is read only when the build in place kept the venues
 * (`selectsVenues`, ADR-0191 decision 3). A build cut before them holds the
 * few venues another tag selected, and is never read as a map with no café:
 * the test is then not read at all (ADR-0175 decision 6). Nor is it where
 * another build was swapped in while the venues were read, since the counts
 * and the lines would then come from two maps.
 */

import type { PoolClient } from 'pg';
import type { LayerState } from '../../dumps/osm/layerTables.js';
import { selectsVenues, VENUE_AMENITIES } from '../../dumps/osm/layerSelection.js';
import type { SurroundingsCut, VenueSurroundings } from './surroundingsCut.js';
import { chordOfKm, SphereIndex, venuesAround, type SpherePoint } from './surroundingsNeighbourhood.js';

/**
 * The venues the pool read for a kind that reads them, or why none were read:
 * each place's measure and each candidate's area. A place measured along its
 * line (`along`, ADR-0194) is measured in venues per 100 m of it, and the rest
 * in venues within the radius of its point; a candidate is read against places
 * measured the same way. An artery has no car-free part, and is not let in by
 * its venues however they are read (`arteries`).
 */
export type PoolVenues =
  | { unread: string }
  | {
    unread?: undefined; counts: ReadonlyMap<string, number>; around: ReadonlyMap<string, VenueSurroundings>;
    along: ReadonlyMap<string, StreetLine>; arteries: ReadonlySet<string>;
  };

/** A street's lines in the layer (ADR-0194): how long they are together, the venues along them, and whether every one is an artery. */
export interface StreetLine {
  metres: number;
  venues: number;
  artery: boolean;
}

/** A place the venues are counted around: its id and point. */
export interface VenuePlace extends SpherePoint {
  qid: string;
}

/** What the venue read reports to its run, where it lets the run stop it, and when it lets the backend's other work through. */
export interface VenueReadRun {
  phase?: (message: string) => void;
  step?: () => Promise<void>;
  slice: { due: () => boolean; yield: () => Promise<void> };
}

/** The `highway` values of an artery: a street with only these is driven through, not walked for its life (ADR-0192). */
const ARTERIES = ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'];

/** How many places' venues one statement counts, between two of the run's stop points. */
const COUNT_BATCH = 5_000;
/** How many candidates' areas are read between two of the run's stop points and status lines. */
const AREA_BATCH = 500;
/** Metres in a degree of latitude, for the box the spatial index answers first. */
const METRES_PER_DEGREE = 111_000;

/** The layer in place (`layerState`) where it can answer the venue test, or why it cannot. */
export function venueLayer(layer: LayerState | null): { layer: LayerState; unread?: undefined } | { unread: string } {
  if (!layer) return { unread: 'No OpenStreetMap layer is in place, so no café, restaurant or bar is read and the venue test is not read (ADR-0192)' };
  if (!selectsVenues(layer.selection)) {
    return {
      unread: 'The OpenStreetMap layer in place was cut before it kept the cafés, restaurants and bars (ADR-0191), '
        + 'so the venue test is not read: nothing enters by it, and a place held by it keeps its standing (ADR-0175 decision 6)',
    };
  }
  return { layer };
}

/** Why the venues read across `before` and `after`, the layer in place when the read began and when it ended, cannot be used, or null where one layer answered it. */
export function layerSwapped(before: LayerState, after: LayerState | null): string | null {
  if (after?.buildId === before.buildId) return null;
  return 'Another OpenStreetMap layer was swapped in while the cafés, restaurants and bars were read, so the counts would mix two maps '
    + 'and the venue test is not read: nothing enters by it, and a place held by it keeps its standing (ADR-0175 decision 6)';
}

/**
 * The food-and-drink venues within `radiusM` of each place of `qids` in the
 * session's table `table` (its `qid`, `lat` and `lon`), counted in the
 * layer through its spatial index: a box in degrees first, wider in longitude
 * as the meridians close towards the poles, then the distance on the
 * spheroid.
 */
export async function countVenues(
  client: PoolClient, table: string, qids: readonly string[], radiusM: number, run?: Omit<VenueReadRun, 'slice'>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let i = 0; i < qids.length; i += COUNT_BATCH) {
    await run?.step?.();
    run?.phase?.(`Counting the cafés, restaurants and bars around the surroundings pool's streets and squares: ${i.toLocaleString('en')} of ${qids.length.toLocaleString('en')}...`);
    const result = await client.query<{ qid: string; venues: number }>(
      `SELECT p.qid, (
         SELECT count(*)::int FROM osm_objects o
          WHERE o.geom && ST_Expand(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326),
                  $2::float8 / greatest(cos(radians(p.lat)), 0.05), $2::float8)
            AND o.tags->>'amenity' = ANY($3::text[])
            AND ST_DWithin(o.geom::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, $4::float8)
       ) AS venues
         FROM ${table} p
        WHERE p.qid = ANY($1::text[])`,
      [qids.slice(i, i + COUNT_BATCH), radiusM / METRES_PER_DEGREE, [...VENUE_AMENITIES], radiusM],
    );
    for (const row of result.rows) counts.set(row.qid, row.venues);
  }
  return counts;
}

/**
 * The lines the layer keeps of each of `qids` (ADR-0194), with the venues
 * within `lineM` of any of them, each venue once, and whether every line is an
 * artery. A closed way kept as an area is measured along half its perimeter.
 * None where the layer in place looked for no street's line.
 */
export async function streetLines(
  client: PoolClient, layer: LayerState, qids: readonly string[], lineM: number, run?: Omit<VenueReadRun, 'slice'>,
): Promise<Map<string, StreetLine>> {
  const lines = new Map<string, StreetLine>();
  if (layer.streets == null) return lines;
  for (let i = 0; i < qids.length; i += COUNT_BATCH) {
    await run?.step?.();
    run?.phase?.(`Reading the cafés, restaurants and bars along the streets' lines: ${i.toLocaleString('en')} of ${qids.length.toLocaleString('en')}...`);
    const result = await client.query<{ qid: string; metres: number; venues: number; artery: boolean }>(
      `WITH line AS (
         SELECT street_item AS qid, geom, tags->>'highway' AS highway FROM osm_objects WHERE street_item = ANY($1::text[])
       )
       SELECT l.qid,
              sum(CASE WHEN GeometryType(l.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN ST_Perimeter(l.geom::geography) / 2
                       ELSE ST_Length(l.geom::geography) END)::float8 AS metres,
              bool_and(l.highway = ANY($4::text[])) AS artery,
              (SELECT count(DISTINCT (o.osm_type, o.osm_id))::int FROM line m JOIN osm_objects o
                 ON o.geom && ST_Expand(m.geom, $3::float8 / greatest(cos(radians(ST_Y(ST_Centroid(m.geom)))), 0.05))
                AND o.tags->>'amenity' = ANY($2::text[])
                AND ST_DWithin(o.geom::geography, m.geom::geography, $5::float8)
               WHERE m.qid = l.qid) AS venues
         FROM line l
        GROUP BY l.qid`,
      [qids.slice(i, i + COUNT_BATCH), [...VENUE_AMENITIES], lineM / METRES_PER_DEGREE, ARTERIES, lineM],
    );
    for (const row of result.rows) lines.set(row.qid, { metres: row.metres, venues: row.venues, artery: row.artery === true });
  }
  return lines;
}

/** A street's measure along its line: venues per 100 m, where its lines run `minM` or more. */
export function venuesAlong(line: StreetLine | undefined, minM: number): number | null {
  return line && line.metres >= minM ? (100 * line.venues) / line.metres : null;
}

/**
 * The streets of `lined` with fewer streets read along their lines within the
 * radius, themselves included, than the venue test reads an area by
 * (`venueGroupFloor`). Such a street is read at its point, as a street with
 * no line is (ADR-0194): the layer finds the lines of streets tagged with
 * their items, which few are in some cities (Tokyo's, Valletta's), and too few
 * lines around a street make no reference to read it against. Counted again
 * among the streets left until none falls under the floor, since a street
 * whose neighbours are read at their points may itself be left with too few.
 * Yields to the backend's other work as the run's slice asks.
 */
export async function thinlyLined(
  places: readonly VenuePlace[], lined: ReadonlySet<string>, cut: Pick<SurroundingsCut, 'radiusKm' | 'venueGroupFloor'>, slice?: VenueReadRun['slice'],
): Promise<Set<string>> {
  const chord = chordOfKm(cut.radiusKm);
  const thin = new Set<string>();
  for (;;) {
    const group = places.filter((place) => lined.has(place.qid) && !thin.has(place.qid));
    const index = new SphereIndex(group);
    const before = thin.size;
    for (let i = 0; i < group.length; i++) {
      let around = 0;
      index.forEachWithin(i, chord, () => { around += 1; });
      if (around < cut.venueGroupFloor) thin.add(group[i].qid);
      if (slice?.due()) await slice.yield();
    }
    if (thin.size === before) return thin;
  }
}

/**
 * The area of each of `candidates` among `places`, the kind's places the
 * venues were counted around: how many lie within the cut's radius and the
 * best counts among them (`venuesAround`). Read in batches the run can stop
 * between.
 */
export async function venueAreas(
  places: readonly VenuePlace[], counts: ReadonlyMap<string, number>, candidates: ReadonlySet<string>, cut: SurroundingsCut, run: VenueReadRun,
  along: ReadonlySet<string> = new Set(),
): Promise<Map<string, VenueSurroundings>> {
  const out = new Map<string, VenueSurroundings>();
  // A place measured along its line is read against the others measured so, and a place read at its point against those: never one unit against the other.
  for (const lined of [false, true]) {
    const group = places.filter((place) => along.has(place.qid) === lined);
    const index = new SphereIndex(group);
    const venues = Float64Array.from(group, (place) => counts.get(place.qid) ?? 0);
    const at = group.flatMap((place, i) => (candidates.has(place.qid) ? [i] : []));
    for (let i = 0; i < at.length; i += AREA_BATCH) {
      await run.step?.();
      run.phase?.(`Measuring streets and squares against the liveliest around them: ${i.toLocaleString('en')} of ${at.length.toLocaleString('en')}...`);
      for (const j of at.slice(i, i + AREA_BATCH)) {
        out.set(group[j].qid, { ...venuesAround(index, venues, j, cut.radiusKm, cut.best), along: lined });
        if (run.slice.due()) await run.slice.yield();
      }
    }
  }
  return out;
}
