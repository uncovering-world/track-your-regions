/**
 * The component-item search's questions answered from the local Wikidata
 * subset (#1435): the classes of the items components already are, the parts
 * each site's item names, the items carrying a component's number, what
 * stands near the points, which of those are settlements, where the near
 * candidates stand, and the register codes of the proposed ones. Each reads
 * a statement as `wdt:` reads it: an item's best statements, never a
 * deprecated one.
 *
 * The subset keeps every item with a coordinate and the places, parts and
 * classes they name (ADR-0105), so the search asks no outside service for
 * them. The labels are the exception (`labelsOf` in `componentItemQueries.ts`):
 * the subset keeps labels in eight languages, and a component is often named
 * only in its own, Romanian for Dacia's castra.
 */

import type { QueryResultRow } from 'pg';
import { pool } from '../../../db/index.js';
import { cancellable } from '../../dumps/wikidata/subsetTables.js';
import { FIND_RECORD_CLASSES, type CandidateItem } from '../componentItemMatching.js';
import { REGISTER_CODES, type ItemCode } from '../componentItemRegisters.js';
import { BEST } from './entities.js';

/** What a step is told of its progress: how many of the asked-about items an answer covered; and whether the pass was cancelled. */
interface Progress {
  onAnswered?: (count: number) => void;
  isCancelled?: () => boolean;
}

/** How often a statement over the whole subset asks whether the pass was cancelled. */
const CANCEL_POLL_MS = 500;

/**
 * A statement that reads the whole subset, cancelled in the database when the
 * pass is: the near rule's read of every coordinate runs for about a minute,
 * and a cancel from the panel must not wait for it to end.
 */
async function wholeSubset<Row extends QueryResultRow>(progress: Progress, sql: string, params: unknown[] = []): Promise<Row[]> {
  const controller = new AbortController();
  const ask = () => { if (progress.isCancelled?.()) controller.abort(); };
  ask();
  const poll = setInterval(ask, CANCEL_POLL_MS);
  try {
    return await cancellable<Row>(controller.signal, sql, params);
  } finally {
    clearInterval(poll);
  }
}

/** Human settlement (Q486972): a town, a village, a commune. */
const SETTLEMENT = 'Q486972';
/**
 * Fortification (Q57821) and archaeological site (Q839954): Wikidata files a
 * castrum under both and under human settlement, and a Roman fort is no
 * settlement.
 */
const NOT_SETTLEMENTS = ['Q57821', 'Q839954'];

/**
 * A coordinate on the Earth: a point on the Moon or Mars, which Wikidata
 * states with its globe, lies near no World Heritage component, however its
 * latitude and longitude read. A value with no globe is the Earth's, as
 * Wikidata reads it.
 */
const ON_EARTH = (alias: string) => `COALESCE(${alias}.value->>'globe', 'http://www.wikidata.org/entity/Q2') = 'http://www.wikidata.org/entity/Q2'`;

/** The item's best coordinates on the Earth, as `[[lat, lon], …]`, the first statement first. */
const coordsSql = (subject: string) => `COALESCE((
  SELECT jsonb_agg(jsonb_build_array((p.value->>'latitude')::float8, (p.value->>'longitude')::float8) ORDER BY p.statement_id)
    FROM wikidata_claims p
   WHERE p.subject = ${subject} AND p.property = 'P625' AND p.rank >= 0 AND p.value ? 'latitude' AND ${ON_EARTH('p')} AND ${BEST('p')}
), '[]'::jsonb)`;

/** The World Heritage references among the item's best statements. */
const referencesSql = (subject: string) => `COALESCE((
  SELECT array_agg(DISTINCT btrim(r.value #>> '{}'))
    FROM wikidata_claims r
   WHERE r.subject = ${subject} AND r.property = 'P757' AND r.rank >= 0 AND jsonb_typeof(r.value) = 'string' AND ${BEST('r')}
), '{}'::text[])`;

/** Whether the item states a World Heritage reference among its best statements. */
const referencedSql = (subject: string) => `EXISTS (
  SELECT 1 FROM wikidata_claims r
   WHERE r.subject = ${subject} AND r.property = 'P757' AND r.rank >= 0 AND ${BEST('r')})`;

type Coord = [lat: number, lon: number];

function distinctCoords(coords: Coord[]): Coord[] {
  return coords.filter(([lat, lon], i) => coords.findIndex(([a, b]) => a === lat && b === lon) === i);
}

/** The P31 classes of the given items. */
export async function classesOfItems(items: readonly string[], progress: Progress): Promise<Map<string, string[]>> {
  const result = await pool.query<{ item: string; classes: string[] }>(
    `SELECT c.subject AS item, array_agg(DISTINCT c.value_item ORDER BY c.value_item) AS classes
       FROM wikidata_claims c
      WHERE c.subject = ANY($1::text[]) AND c.property = 'P31' AND c.rank >= 0 AND c.value_item IS NOT NULL AND ${BEST('c')}
      GROUP BY c.subject`,
    [items],
  );
  progress.onAnswered?.(items.length);
  return new Map(result.rows.map(row => [row.item, row.classes]));
}

/** The national register codes the given items carry (`REGISTER_CODES`, #1340). */
export async function registerCodesOf(items: readonly string[], progress: Progress): Promise<Map<string, ItemCode[]>> {
  const result = await pool.query<{ item: string; property: string; code: string }>(
    `SELECT c.subject AS item, c.property, c.value #>> '{}' AS code
       FROM wikidata_claims c
      WHERE c.subject = ANY($1::text[]) AND c.property = ANY($2::text[]) AND c.rank >= 0
        AND jsonb_typeof(c.value) = 'string' AND ${BEST('c')}
      ORDER BY c.subject, c.property, code`,
    [items, REGISTER_CODES.map(r => r.property)],
  );
  const codes = new Map<string, ItemCode[]>();
  for (const row of result.rows) codes.set(row.item, [...(codes.get(row.item) ?? []), { property: row.property, code: row.code }]);
  progress.onAnswered?.(items.length);
  return codes;
}

/**
 * The items each site item names as its part (P361), with their coordinates
 * and their World Heritage references: one the reference reader matched
 * (#1269) is a point's item already and the finder leaves it as taken; one it
 * could not match stays a candidate for a curator, with its references
 * carried so the finder leaves out a part that claims another site (#1344).
 */
export async function partsOfSites(siteItems: readonly string[], progress: Progress): Promise<Map<string, CandidateItem[]>> {
  const result = await pool.query<{ site: string; part: string; coords: Coord[]; refs: string[] }>(
    `SELECT DISTINCT c.value_item AS site, c.subject AS part, ${coordsSql('c.subject')} AS coords, ${referencesSql('c.subject')} AS refs
       FROM wikidata_claims c
      WHERE c.property = 'P361' AND c.value_item = ANY($1::text[]) AND c.rank >= 0 AND ${BEST('c')}
      ORDER BY site, part`,
    [siteItems],
  );
  const parts = new Map<string, CandidateItem[]>();
  for (const row of result.rows) {
    const part: CandidateItem = { item: row.part, labels: [], coords: distinctCoords(row.coords), classes: [] };
    if (row.refs.length) part.references = row.refs;
    parts.set(row.site, [...(parts.get(row.site) ?? []), part]);
  }
  progress.onAnswered?.(siteItems.length);
  return parts;
}

/**
 * Every item that carries a component's World Heritage number (#1394), with
 * the numbers it carries and its coordinates. A number stated only as
 * deprecated is left out, as the reference reader leaves it; every other rank
 * counts, as `p:P757/ps:P757` reads them. On the 2026-10-05 dump, 4,823
 * statements, read in about 20 s, since no index leads with the property.
 */
export async function componentNumbers(progress: Progress): Promise<CandidateItem[]> {
  const rows = await wholeSubset<{ item: string; refs: string[]; coords: Coord[] }>(
    progress,
    `SELECT n.subject AS item, array_agg(DISTINCT btrim(n.value #>> '{}') ORDER BY btrim(n.value #>> '{}')) AS refs,
            ${coordsSql('n.subject')} AS coords
       FROM wikidata_claims n
      WHERE n.property = 'P757' AND n.rank >= 0 AND jsonb_typeof(n.value) = 'string' AND strpos(n.value #>> '{}', '-') > 0
      GROUP BY n.subject
      ORDER BY n.subject`,
  );
  progress.onAnswered?.(1);
  return rows.map(row => ({
    item: row.item, labels: [], coords: distinctCoords(row.coords), classes: [], references: row.refs,
  }));
}

export interface Box { south: number; west: number; north: number; east: number }

/** The grid the points' coordinates are first sorted into, in degrees: a hash join on the cell, then the exact box. */
const GRID_DEG = 0.25;
/** A grid cell as one number, from its row and column: both made positive, so no two cells share one. */
const cellKey = (row: number, column: number) => (row + 720) * 2000 + column + 1000;
const CELL_SQL = (lat: string, lon: string) => `((floor(${lat} / $1::float8)::int + 720) * 2000 + floor(${lon} / $1::float8)::int + 1000)`;

/**
 * A box's longitude ranges: one, or two where it runs past the antimeridian (a
 * margin around Kiribati's or Fiji's points), since longitudes there jump from
 * 180 to -180.
 */
export function rangesOf(box: Box): Box[] {
  const ranges = [{ ...box, west: Math.max(box.west, -180), east: Math.min(box.east, 180) }];
  if (box.east > 180) ranges.push({ ...box, west: -180, east: box.east - 360 });
  if (box.west < -180) ranges.push({ ...box, west: box.west + 360, east: 180 });
  return ranges;
}

/**
 * The items inside each box that are of one of `classes`, less those that
 * carry a World Heritage reference or record a find or a dig
 * (`FIND_RECORD_CLASSES`, or a class under one), answered per box. Each
 * candidate names only the classes asked about. One statement for every box:
 * no index holds the coordinates, so the statement reads the subset's
 * coordinates once, sorted into a grid, and keeps those in the cells a box
 * covers.
 */
export async function itemsInBoxes(
  boxes: readonly Box[], classes: readonly string[], progress: Progress,
): Promise<Map<number, CandidateItem[]>> {
  const byBox = new Map<number, CandidateItem[]>();
  if (boxes.length === 0 || classes.length === 0) return byBox;
  const ranges = boxes.flatMap((box, index) => rangesOf(box).map(range => ({ ...range, index })));
  const keys: Array<{ cell: number; range: number }> = [];
  ranges.forEach((range, r) => {
    const cells = new Set<number>();
    for (let row = Math.floor(range.south / GRID_DEG); row <= Math.floor(range.north / GRID_DEG); row += 1) {
      for (let column = Math.floor(range.west / GRID_DEG); column <= Math.floor(range.east / GRID_DEG); column += 1) {
        cells.add(cellKey(row, column));
      }
    }
    for (const cell of cells) keys.push({ cell, range: r });
  });
  const rows = await wholeSubset<{ box: number; item: string; lat: number; lon: number; class: string }>(
    progress,
    `WITH ranges AS (
       SELECT * FROM unnest($2::int[], $3::float8[], $4::float8[], $5::float8[], $6::float8[])
              WITH ORDINALITY AS r(box, south, west, north, east, n)
     ), keys AS (
       SELECT * FROM unnest($7::int[], $8::int[]) AS k(cell, n)
     ), placed AS MATERIALIZED (
       SELECT p.subject AS item, p.rank, q.lat, q.lon, r.box
         FROM wikidata_claims p
        CROSS JOIN LATERAL (SELECT (p.value->>'latitude')::float8 AS lat, (p.value->>'longitude')::float8 AS lon) q
         JOIN keys k ON k.cell = ${CELL_SQL('q.lat', 'q.lon')}
         JOIN ranges r ON r.n = k.n + 1
        WHERE p.property = 'P625' AND p.rank >= 0 AND p.value ? 'latitude' AND ${ON_EARTH('p')}
          AND q.lat BETWEEN r.south AND r.north AND q.lon BETWEEN r.west AND r.east
     )
     SELECT DISTINCT pl.box, pl.item, pl.lat, pl.lon, c.value_item AS class
       FROM placed pl
       JOIN wikidata_claims c ON c.subject = pl.item AND c.property = 'P31' AND c.rank >= 0
                             AND c.value_item = ANY($9::text[]) AND ${BEST('c')}
      WHERE NOT EXISTS (SELECT 1 FROM wikidata_claims h WHERE h.subject = pl.item AND h.property = 'P625' AND h.rank > pl.rank)
        AND NOT ${referencedSql('pl.item')}
        AND NOT EXISTS (
          SELECT 1 FROM wikidata_claims t JOIN wikidata_class_closure k ON k.class = t.value_item
           WHERE t.subject = pl.item AND t.property = 'P31' AND t.rank >= 0 AND ${BEST('t')} AND k.ancestor = ANY($10::text[]))
      ORDER BY pl.box, pl.item, pl.lat, pl.lon, class`,
    [
      GRID_DEG,
      ranges.map(r => r.index), ranges.map(r => r.south), ranges.map(r => r.west), ranges.map(r => r.north), ranges.map(r => r.east),
      keys.map(k => k.cell), keys.map(k => k.range),
      classes, Object.keys(FIND_RECORD_CLASSES),
    ],
  );
  for (const row of rows) {
    const inBox = byBox.get(row.box) ?? byBox.set(row.box, []).get(row.box)!;
    let candidate = inBox.find(c => c.item === row.item);
    if (!candidate) {
      candidate = { item: row.item, labels: [], coords: [], classes: [] };
      inBox.push(candidate);
    }
    if (!candidate.coords.some(([lat, lon]) => lat === row.lat && lon === row.lon)) candidate.coords.push([row.lat, row.lon]);
    if (!candidate.classes!.includes(row.class)) candidate.classes!.push(row.class);
  }
  progress.onAnswered?.(boxes.length);
  return byBox;
}

/**
 * Which of the given items are settlements — a town, a village, a commune —
 * or, with `asClasses`, which of the given classes are kinds of settlement,
 * through the class tree (`wikidata_class_closure`) rather than a list:
 * Passau's old town is an *Altstadt*, a class under *human settlement* no list
 * named. Judged class by class: a settlement is an item with a class that is a
 * kind of human settlement and is not itself a kind of fortification or of
 * archaeological site. Wikidata files a castrum under all three, so a Roman
 * fort is no settlement, while Tarentum is a *city* beside being a *polis* — a
 * dig — and a city is what the near rule must set aside for a site whose parts
 * are not towns. The closure follows every subclass statement that is not
 * deprecated, where `wdt:P279*` followed the best ones.
 */
export async function settlementsAmong(ids: readonly string[], progress: Progress, asClasses = false): Promise<Set<string>> {
  const settled = (cls: string) => `EXISTS (SELECT 1 FROM wikidata_class_closure k WHERE k.class = ${cls} AND k.ancestor = $2)
    AND NOT EXISTS (SELECT 1 FROM wikidata_class_closure k WHERE k.class = ${cls} AND k.ancestor = ANY($3::text[]))`;
  const result = await pool.query<{ id: string }>(
    asClasses
      ? `SELECT q.id FROM unnest($1::text[]) AS q(id) WHERE ${settled('q.id')} ORDER BY q.id`
      : `SELECT DISTINCT c.subject AS id FROM wikidata_claims c
          WHERE c.subject = ANY($1::text[]) AND c.property = 'P31' AND c.rank >= 0 AND c.value_item IS NOT NULL
            AND ${BEST('c')} AND ${settled('c.value_item')}
          ORDER BY id`,
    [ids, SETTLEMENT, NOT_SETTLEMENTS],
  );
  progress.onAnswered?.(ids.length);
  return new Set(result.rows.map(row => row.id));
}

/**
 * Which of the given classes are kinds of one of the given ancestors, each
 * ancestor counting as a kind of itself, through the class tree
 * (`wikidata_class_closure`): an *ethnographic museum* is a museum no list of
 * museum classes named.
 */
export async function classesUnder(
  classes: readonly string[], ancestors: readonly string[], progress: Progress,
): Promise<Set<string>> {
  const result = await pool.query<{ id: string }>(
    `SELECT DISTINCT k.class AS id FROM wikidata_class_closure k
      WHERE k.class = ANY($1::text[]) AND k.ancestor = ANY($2::text[])
      ORDER BY id`,
    [classes, ancestors],
  );
  progress.onAnswered?.(classes.length);
  return new Set(result.rows.map(row => row.id));
}

/**
 * Which of the given items have a class (P31, any rank but deprecated) that is
 * a kind of one of the given ancestors, through the class tree: every class,
 * not only the best-ranked one, since a museum typed a palace first is still a
 * museum, and not only the classes it was fetched through.
 */
export async function itemsUnder(
  items: readonly string[], ancestors: readonly string[], progress: Progress,
): Promise<Set<string>> {
  const result = await pool.query<{ id: string }>(
    `SELECT DISTINCT c.subject AS id FROM wikidata_claims c
       JOIN wikidata_class_closure k ON k.class = c.value_item
      WHERE c.subject = ANY($1::text[]) AND c.property = 'P31' AND c.rank >= 0
        AND k.ancestor = ANY($2::text[])
      ORDER BY id`,
    [items, ancestors],
  );
  progress.onAnswered?.(items.length);
  return new Set(result.rows.map(row => row.id));
}

/** A place an item stands in (P131, P276) or is part of (P361), as the near rule reads it. */
export interface StandingPlace {
  item: string;
  /** Its English and multilingual names. */
  names: string[];
  /** Every coordinate it states. */
  coords: Coord[];
  /** Whether it carries a World Heritage reference of its own: then the reference reader is what finds it, never the near rule. */
  referenced: boolean;
}

/**
 * The places each item stands in (P131, P276) or is part of (P361), with
 * their English or multilingual names, coordinates and whether they carry a
 * World Heritage reference: what tells a museum in Herrnhut from the
 * settlement of Herrnhut (`standsAtTheComponent`), and what offers the islet
 * of Mjölnareholmen in the place of the gunpowder house on it
 * (`placeAsCandidate`). A place with neither name is left out, and an item
 * that names no such place is absent from the answer.
 */
export async function placesOf(items: readonly string[], progress: Progress): Promise<Map<string, StandingPlace[]>> {
  const result = await pool.query<{ item: string; place: string; names: string[]; coords: Coord[]; referenced: boolean }>(
    `SELECT h.item, h.place,
            array_agg(DISTINCT l.label ORDER BY l.label) AS names,
            ${coordsSql('h.place')} AS coords, ${referencedSql('h.place')} AS referenced
       FROM (SELECT DISTINCT c.subject AS item, c.value_item AS place
               FROM wikidata_claims c
              WHERE c.subject = ANY($1::text[]) AND c.property = ANY(ARRAY['P131', 'P276', 'P361'])
                AND c.rank >= 0 AND c.value_item IS NOT NULL AND ${BEST('c')}) h
       JOIN wikidata_labels l ON l.id = h.place AND l.language IN ('en', 'mul') AND l.label IS NOT NULL
      GROUP BY h.item, h.place
      ORDER BY h.item, h.place`,
    [items],
  );
  const places = new Map<string, StandingPlace[]>();
  for (const row of result.rows) {
    const place = { item: row.place, names: row.names, coords: distinctCoords(row.coords), referenced: row.referenced };
    places.set(row.item, [...(places.get(row.item) ?? []), place]);
  }
  progress.onAnswered?.(items.length);
  return places;
}
