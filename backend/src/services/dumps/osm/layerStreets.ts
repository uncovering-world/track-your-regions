/**
 * The streets whose lines the OpenStreetMap layer keeps whole (ADR-0194):
 * the candidates Squares & streets reads, each with its point and every name
 * the local Wikidata subset holds for it. A street's line is how a walked
 * street is read along its length rather than at its point (#2311).
 *
 * The build cuts the ways near those points from the planet once
 * (`streetArea`, an `osmium extract` polygon) and the flex style keeps a
 * highway or a place way whole where its `wikidata` tag is one of the items,
 * or one of its names is an item's name and it lies near that item's point
 * (`streetsFile`). The names are matched in the flex style from a table,
 * never as an `osmium tags-filter` list: tags-filter tries every expression
 * on every way, and 33,208 names read 80 of the planet's 124 GB in 40 minutes
 * (2026-11-10).
 */

import { entitiesAreHeld, latestSubset } from '../wikidata/subsetTables.js';
import { subsetRunner } from '../../sync/subset/reader.js';
import { kindClasses } from '../../sync/places/gather.js';
import { POOL_MIN_SITELINKS } from '../../sync/publicArt/queries.js';
import { subsetIdsOfClasses, subsetPlacedPoolOfIds } from '../../sync/subset/publicArt.js';
import { subsetNamesOf } from '../../sync/subset/kit.js';
import { SQUARES_KIND } from '../../sync/squares/kind.js';

/** One street item: its point and its names. */
export interface StreetItem {
  qid: string;
  lat: number;
  lon: number;
  names: string[];
}

/** How far from an item's point a way of its name may lie and still be its line: a long street's point sits on one stretch of it. */
export const STREET_REACH_M = 1000;

/**
 * The `highway` values a street's line is drawn with: the roads, the paths
 * and the steps one walks or drives along. A stop's platform, a lift or a
 * road still being built is no line of the street it is named after (the bus
 * stop *Bergmannstraße* in Berlin is two platforms).
 */
export const STREET_HIGHWAYS = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'road',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  'living_street', 'pedestrian', 'footway', 'path', 'steps', 'cycleway', 'bridleway', 'track', 'corridor',
] as const;

/** The cell the cut's polygon is drawn in, in degrees: about 1.1 km of latitude. */
const CELL = 0.01;

const METRES_PER_DEGREE = 111_000;

/**
 * The candidates Squares & streets reads, from the subset: every item of the
 * kind's classes at the pool's floor, with its point, as the gather's pool
 * question asks it (`kindClasses`, `subsetIdsOfClasses`), and its names. None
 * while no subset is built.
 */
export async function streetItems(): Promise<StreetItem[]> {
  if (!(await latestSubset()) || !(await entitiesAreHeld())) return [];
  const classes = kindClasses(SQUARES_KIND, await SQUARES_KIND.trees(subsetRunner()));
  const placed = await subsetPlacedPoolOfIds(await subsetIdsOfClasses([...classes], POOL_MIN_SITELINKS));
  const names = await subsetNamesOf(placed.map(entity => entity.qid));
  return placed
    .filter(entity => entity.lat !== null && entity.lon !== null)
    .map(entity => ({ qid: entity.qid, lat: entity.lat as number, lon: entity.lon as number, names: names.get(entity.qid) ?? [] }))
    .sort((a, b) => a.qid.localeCompare(b.qid));
}

/** The cells within the reach of each item's point, by row: the row's index, then its cells' indexes, in `CELL` degrees. */
function cellsByRow(items: readonly StreetItem[]): Map<number, Set<number>> {
  const rows = new Map<number, Set<number>>();
  const dLat = STREET_REACH_M / METRES_PER_DEGREE;
  for (const { lat, lon } of items) {
    const dLon = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    for (let j = Math.floor((lat - dLat) / CELL); j <= Math.floor((lat + dLat) / CELL); j++) {
      const row = rows.get(j) ?? new Set<number>();
      for (let i = Math.floor((lon - dLon) / CELL); i <= Math.floor((lon + dLon) / CELL); i++) row.add(i);
      rows.set(j, row);
    }
  }
  return rows;
}

/** The rectangles of row `j`: one for each run of cells that touch, as a polygon's one ring. */
function rowRectangles(j: number, cells: readonly number[]): number[][][][] {
  const at = (index: number) => Math.round(index * CELL * 1e5) / 1e5;
  const rectangle = (first: number, last: number) => {
    const west = at(first), east = at(last + 1), south = at(j), north = at(j + 1);
    return [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
  };
  const out: number[][][][] = [];
  let first = cells[0];
  for (let k = 1; k < cells.length; k++) {
    if (cells[k] === cells[k - 1] + 1) continue;
    out.push(rectangle(first, cells[k - 1]));
    first = cells[k];
  }
  out.push(rectangle(first, cells[cells.length - 1]));
  return out;
}

/**
 * The polygon the build cuts the street lines from: every cell of `CELL`
 * degrees within `STREET_REACH_M` of an item's point, the cells of a row
 * joined into one rectangle where they touch. A GeoJSON MultiPolygon, as
 * `osmium extract -p` reads it; null where there is no item.
 */
export function streetArea(items: readonly StreetItem[]): object | null {
  const rows = cellsByRow(items);
  if (rows.size === 0) return null;
  const polygons = [...rows.keys()].sort((a, b) => a - b)
    .flatMap(j => rowRectangles(j, [...rows.get(j)!].sort((a, b) => a - b)));
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}

/**
 * The items as the flex style reads them, one a line: `Q123<TAB>lat<TAB>lon<TAB>name|name`.
 * A name holding a tab, a `|` or a line break cannot be written and is left out.
 */
export function streetsFile(items: readonly StreetItem[]): string {
  const lines = items.map(item => {
    const names = item.names.filter(name => !/[\t|\r\n]/.test(name));
    return `${item.qid}\t${item.lat}\t${item.lon}\t${names.join('|')}`;
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}
