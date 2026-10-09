/**
 * Finding a Wikidata item for each World Heritage component whose reference no
 * item records (#1272), and proposing it to a curator.
 *
 * A component's item gives its card a picture and a description of its own
 * (#1270), and a component without one shows the whole site's picture. The
 * reference resolves 3 933 components on the development catalogue; 2 519
 * have none. Many of those have an item that simply lacks the number — a fort
 * of the Limes, a villa of Aalto's — and the two rules of
 * `componentItemMatching.ts` find it by what the item says it is part of and
 * by what lies near the point. A match by place and name is a proposal, never
 * a fact (ADR-0046): each lands in `experience_component_item_proposals`, and
 * only a curator's answer records an item on the point.
 *
 * Run from the admin panel, like the picture repair: it reads Wikidata for a
 * few minutes and is not part of the source's own run, whose job is to record
 * what UNESCO states.
 */

import { pool } from '../../db/index.js';
import {
  admittedClasses, bestMatch, nearestM, ofTheSitesKind, NEAR_SAME_NAME_RADIUS_M, SAME_NAME_RADIUS_M,
  type CandidateItem, type ComponentMatch, type ComponentPoint,
} from './componentItemMatching.js';
import {
  classesOfItems, itemsInBoxes, labelsOf, partsOfSites, tooHeavy, type Box, type QueryHooks,
} from './componentItemQueries.js';

const UNESCO_SOURCE_ID = 1;
/** Points are asked about in cells of this many degrees: one box query per cell. */
const CELL_DEG = 0.25;
/** How far past its points a cell's box reaches, in degrees of latitude: the same-name radius. */
const BOX_MARGIN_DEG = 0.05;
/** Cells asked about in one query. */
const CELLS_PER_QUERY = 4;
/**
 * A class becomes a catalogue-wide one when the resolved components of at least
 * this many sites are of it: counted by site, so one serial site of four hundred
 * rock-art shelters does not decide what every other site's parts may be.
 */
const CATALOGUE_CLASS_FLOOR = 5;

interface PointRow extends ComponentPoint {
  experienceId: number;
  siteItems: string[];
}

export interface ComponentItemReport {
  /** Components no item records, that no curator has claimed the item of. */
  points: number;
  /** Proposals found by the item's own statement that it is part of the site. */
  partOf: number;
  /** Proposals found near the point among items of the site's kind. */
  near: number;
  /** Of those, the ones with the same name within a few metres. */
  exact: number;
  /** Components whose surroundings the service could not answer for, even asked one area at a time. */
  unsearched: number;
  /** Site items whose parts the service could not answer for, even asked one at a time. */
  unreadSites: number;
  /** Queries sent to Wikidata. */
  queries: number;
}

export interface FinderOptions {
  hooks: QueryHooks;
  /** When false, nothing is written: the matches are returned, for measuring the rules. */
  write: boolean;
  onStage?: (message: string) => void;
}

async function readPoints(): Promise<PointRow[]> {
  const result = await pool.query<{
    id: number; name: string | null; lat: number; lon: number; experience_id: number; wikidata_items: string[] | null;
  }>(
    `SELECT el.id, el.name, ST_Y(el.location) AS lat, ST_X(el.location) AS lon,
            el.experience_id, m.wikidata_items
       FROM experience_locations el
       JOIN experience_kind_memberships m ON m.experience_id = el.experience_id AND m.source_id = $1
      WHERE el.wikidata_item IS NULL
        AND el.external_ref IS NOT NULL
        AND el.missing_since IS NULL
        AND el.merged_into_id IS NULL
        AND NOT el.curated_fields ? 'wikidata_item'`,
    [UNESCO_SOURCE_ID],
  );
  return result.rows.map(row => ({
    locationId: row.id, name: row.name, lat: row.lat, lon: row.lon,
    experienceId: row.experience_id, siteItems: row.wikidata_items ?? [],
  }));
}

/** The items components already are, per site: what the site's kind is learned from, and what is never proposed again. */
async function readResolved(): Promise<Map<number, string[]>> {
  const result = await pool.query<{ experience_id: number; wikidata_item: string }>(
    `SELECT el.experience_id, el.wikidata_item
       FROM experience_locations el
      WHERE el.wikidata_item IS NOT NULL AND el.merged_into_id IS NULL`,
  );
  const bySite = new Map<number, string[]>();
  for (const row of result.rows) bySite.set(row.experience_id, [...(bySite.get(row.experience_id) ?? []), row.wikidata_item]);
  return bySite;
}

async function readRefused(): Promise<Map<number, Set<string>>> {
  const result = await pool.query<{ location_id: number; wikidata_item: string }>(
    `SELECT location_id, wikidata_item FROM experience_component_item_proposals WHERE answer = 'refused'`,
  );
  const refused = new Map<number, Set<string>>();
  for (const row of result.rows) refused.set(row.location_id, (refused.get(row.location_id) ?? new Set()).add(row.wikidata_item));
  return refused;
}

/** Each site's classes, and the catalogue-wide ones a site with no resolved component falls back to. */
function learnClasses(resolved: Map<number, string[]>, classes: Map<string, string[]>) {
  const bySite = new Map<number, Set<string>>();
  const counts = new Map<string, number>();
  for (const [site, items] of resolved) {
    const set = new Set<string>();
    for (const item of items) for (const cls of classes.get(item) ?? []) set.add(cls);
    bySite.set(site, set);
    for (const cls of set) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  const catalogue = new Set([...counts].filter(([, n]) => n >= CATALOGUE_CLASS_FLOOR).map(([cls]) => cls));
  return { bySite, catalogue };
}

function cellsOf(points: readonly PointRow[]): PointRow[][] {
  const cells = new Map<string, PointRow[]>();
  for (const point of points) {
    const key = `${Math.floor(point.lat / CELL_DEG)}:${Math.floor(point.lon / CELL_DEG)}`;
    cells.set(key, [...(cells.get(key) ?? []), point]);
  }
  return [...cells.values()];
}

function boxOf(points: readonly PointRow[]): Box {
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const south = Math.min(...lats) - BOX_MARGIN_DEG;
  const north = Math.max(...lats) + BOX_MARGIN_DEG;
  const lonMargin = BOX_MARGIN_DEG / Math.max(Math.cos(((south + north) / 2) * Math.PI / 180), 0.1);
  return { south, north, west: Math.min(...lons) - lonMargin, east: Math.max(...lons) + lonMargin };
}

/** One proposal per item: an item two components could be is offered for the one it matches better. */
function onePerItem(matches: ComponentMatch[]): ComponentMatch[] {
  const best = new Map<string, ComponentMatch>();
  for (const match of matches) {
    const held = best.get(match.item);
    if (!held || match.similarity > held.similarity
      || (match.similarity === held.similarity && match.distanceM < held.distanceM)) best.set(match.item, match);
  }
  return [...best.values()];
}

/**
 * The near candidates of every point the part rule left, cell group by cell
 * group; a point absent from the answer is one the service could not answer for.
 */
async function searchNear(
  unmatched: PointRow[], admitted: Map<number, ReadonlySet<string>>, hooks: QueryHooks,
  onStage: ((message: string) => void) | undefined,
  keep: (point: PointRow, items: CandidateItem[]) => CandidateItem[],
): Promise<Map<number, CandidateItem[]>> {
  const nearOf = new Map<number, CandidateItem[]>();
  const cells = cellsOf(unmatched);
  for (let i = 0; i < cells.length; i += CELLS_PER_QUERY) {
    if (hooks.isCancelled?.()) break;
    onStage?.(`Looking near the points: areas ${i + 1}–${Math.min(i + CELLS_PER_QUERY, cells.length)} of ${cells.length}`);
    for (const { cells: answered, items } of await nearbyOf(cells.slice(i, i + CELLS_PER_QUERY), admitted, hooks)) {
      for (const point of answered.flat()) nearOf.set(point.locationId, keep(point, items));
    }
  }
  return nearOf;
}

/**
 * What stands near a group of cells, asked in one query, and where the service
 * could not answer that, one cell at a time. A cell it cannot answer even alone
 * is left out — its points are counted as unsearched — rather than ending the
 * whole pass; a 429 ends it, since the service asked this client to stop.
 */
async function nearbyOf(
  group: PointRow[][], admitted: Map<number, ReadonlySet<string>>, hooks: QueryHooks,
): Promise<Array<{ cells: PointRow[][]; items: CandidateItem[] }>> {
  const classesOf = (cells: PointRow[][]) => [...new Set(cells.flat().flatMap(p => [...admitted.get(p.locationId)!]))];
  try {
    return [{ cells: group, items: await itemsInBoxes(group.map(boxOf), classesOf(group), hooks) }];
  } catch (error) {
    if (!tooHeavy(error) || group.length === 1) {
      if (tooHeavy(error)) return [];
      throw error;
    }
  }
  const answers: Array<{ cells: PointRow[][]; items: CandidateItem[] }> = [];
  for (const cell of group) answers.push(...await nearbyOf([cell], admitted, hooks));
  return answers;
}

/**
 * Replaces the open proposals of the points this pass answered for with what it found.
 * An answered proposal is kept: a refusal is what keeps a candidate from coming
 * back, and an acceptance has already recorded its item on the point.
 */
async function writeProposals(points: readonly PointRow[], matches: readonly ComponentMatch[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM experience_component_item_proposals WHERE answer IS NULL AND location_id = ANY($1::int[])`,
      [points.map(p => p.locationId)],
    );
    await client.query(
      `INSERT INTO experience_component_item_proposals
              (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::int[], $5::real[], $6::bool[], $7::text[])
       ON CONFLICT (location_id, wikidata_item) DO NOTHING`,
      [
        matches.map(m => m.locationId), matches.map(m => m.item), matches.map(m => m.label),
        matches.map(m => m.distanceM), matches.map(m => m.similarity), matches.map(m => m.exact), matches.map(m => m.basis),
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findComponentItems(options: FinderOptions): Promise<{ report: ComponentItemReport; matches: ComponentMatch[] }> {
  const { hooks, onStage } = options;
  let queries = 0;
  const counted: QueryHooks = { ...hooks, onQuery: () => { queries += 1; hooks.onQuery?.(); } };

  const [points, resolved, refused] = await Promise.all([readPoints(), readResolved(), readRefused()]);
  const taken = new Set([...resolved.values()].flat());
  const labels = new Map<string, string[]>();
  /** The candidates of one point that are free and close enough to be read. */
  const reachable = (point: PointRow, candidates: CandidateItem[], radius: number) =>
    candidates.filter(c => !taken.has(c.item) && nearestM(point, c) <= radius);
  const readLabels = async (candidates: Iterable<CandidateItem[]>) => {
    const wanted = [...new Set([...candidates].flat().map(c => c.item))].filter(item => !labels.has(item));
    onStage?.(`Reading the names of ${wanted.length} candidate items`);
    for (const [item, names] of await labelsOf(wanted, counted)) labels.set(item, names);
  };
  const named = (candidates: CandidateItem[]) => candidates.map(c => ({ ...c, labels: labels.get(c.item) ?? [] }));

  onStage?.(`Reading the parts ${new Set(points.flatMap(p => p.siteItems)).size} site items name`);
  const { parts, unread } = await partsOfSites([...new Set(points.flatMap(p => p.siteItems))], counted);
  const partsNear = new Map(points.map(p => [
    p.locationId, reachable(p, p.siteItems.flatMap(item => parts.get(item) ?? []), SAME_NAME_RADIUS_M),
  ]));
  await readLabels(partsNear.values());
  const matches: ComponentMatch[] = [];
  const unmatched: PointRow[] = [];
  for (const point of points) {
    const match = bestMatch(point, named(partsNear.get(point.locationId)!), 'part_of', refused.get(point.locationId));
    if (match) matches.push(match); else unmatched.push(point);
  }

  onStage?.(`Reading the classes of ${taken.size} resolved components`);
  const { bySite, catalogue } = learnClasses(resolved, await classesOfItems([...taken], counted));
  const admitted = new Map(unmatched.map(p => [p.locationId, admittedClasses(bySite.get(p.experienceId) ?? new Set(), catalogue)]));
  const nearOf = await searchNear(unmatched, admitted, counted, onStage, (point, items) =>
    reachable(point, items.filter(c => ofTheSitesKind(c, admitted.get(point.locationId)!)), NEAR_SAME_NAME_RADIUS_M));
  const unsearched = unmatched.filter(p => !nearOf.has(p.locationId)).length;
  await readLabels(nearOf.values());
  for (const point of unmatched) {
    const match = bestMatch(point, named(nearOf.get(point.locationId) ?? []), 'near', refused.get(point.locationId));
    if (match) matches.push(match);
  }

  const proposals = onePerItem(matches);
  // Answered for: a new proposal, or every question this pass asked about the
  // point got an answer. A point whose site's parts or surroundings the service
  // could not answer keeps what an earlier pass proposed for it.
  const unreadSites = new Set(unread);
  const waiting = new Set(unmatched.map(p => p.locationId));
  const proposed = new Set(proposals.map(m => m.locationId));
  const answered = points.filter(p => proposed.has(p.locationId)
    || (!p.siteItems.some(item => unreadSites.has(item)) && (!waiting.has(p.locationId) || nearOf.has(p.locationId))));
  if (options.write && !hooks.isCancelled?.()) await writeProposals(answered, proposals);
  return {
    matches: proposals,
    report: {
      points: points.length,
      partOf: proposals.filter(m => m.basis === 'part_of').length,
      near: proposals.filter(m => m.basis === 'near').length,
      exact: proposals.filter(m => m.exact).length,
      unsearched,
      unreadSites: unread.length,
      queries,
    },
  };
}
