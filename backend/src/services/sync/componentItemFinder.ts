/**
 * Finding a Wikidata item for each World Heritage component whose reference no
 * item records (#1272), and proposing it to a curator.
 *
 * A component's item gives its card a picture and a description of its own
 * (#1270), and a component without one shows the whole site's picture. The
 * reference resolves 3 933 components on the development catalogue; 2 519
 * have none. Many of those have an item that simply lacks the number — a fort
 * of the Limes, a villa of Aalto's — and the rules of
 * `componentItemMatching.ts` find it by what the item says it is part of, by
 * what lies near the point — named like the component or for a place in its
 * name — and by the component's number under another inscription
 * (`componentItemNumbered.ts`). A match by place and name is a proposal, never
 * a fact (ADR-0046): each lands in `experience_component_item_proposals`, and
 * only a curator's answer records an item on the point.
 *
 * Run from the admin panel, like the picture repair: it reads Wikidata for a
 * few minutes and is not part of the source's own run, whose job is to record
 * what UNESCO states.
 */

import { pool } from '../../db/index.js';
import { byComponentKey, numberedFor } from './componentItemNumbered.js';
import { listRef, parseWhcRef } from './unescoWikidata.js';
import {
  admittedClasses, bestMatch, nearestM, numberedMatches, ofTheSitesKind, placeAsCandidate, standsAtTheComponent, standsForWholeSite,
  NEAR_SAME_NAME_RADIUS_M, SAME_NAME_RADIUS_M,
  type CandidateItem, type ComponentMatch, type ComponentPoint, type MatchBasis,
} from './componentItemMatching.js';
import {
  classesOfItems, componentNumbers, itemsInBoxes, labelsOf, partsOfSites, placesOf, registerCodesOf, settlementsAmong, tooHeavy,
  type Box, type ItemLabels,
  type StandingPlace,
  type QueryHooks,
} from './componentItemQueries.js';
import { withRegisterCodes } from './componentItemRegisters.js';
import { overPlacePoints, type PlacePointArm, placePointsSql, pointsShownSql } from '../../db/placePoints.js';

const UNESCO_SOURCE_ID = 1;
/** Points are asked about in cells of this many degrees: one box query per cell. */
const CELL_DEG = 0.25;
/** How far past its points a cell's box reaches, in degrees of latitude: the same-name radius. */
const BOX_MARGIN_DEG = 0.05;
/**
 * Cells asked about in one question. An unloaded QLever mirror answers a
 * filter over a class's coordinates in under a second however many boxes it
 * holds (a loaded one in about 15 s, `itemsInBoxes`), so the near rule asks
 * it about 52 questions for the 1,292 cells of 2026-10-09; a group it cannot
 * answer is asked one cell at a time.
 */
const CELLS_PER_QUERY = 25;
/**
 * A class becomes a catalogue-wide one when the resolved components of at least
 * this many sites are of it: counted by site, so one serial site of four hundred
 * rock-art shelters does not decide what every other site's parts may be.
 */
const CATALOGUE_CLASS_FLOOR = 5;

interface PointRow extends ComponentPoint {
  experienceId: number;
  siteItems: string[];
  /** The component's World Heritage reference, whose property number says which site a part's own reference must name. */
  externalRef: string;
}

interface PointRead extends PointRow {
  siteName: string;
  standingPoints: number;
}

export interface ComponentItemReport {
  /** Components no item records, that no curator has claimed the item of, less the whole-site ones. */
  points: number;
  /** Components standing for their whole site, which are not searched (`standsForWholeSite`). */
  wholeSites: number;
  /** Near candidates set aside as settlements, on sites whose parts are not settlements. */
  settlements: number;
  /** Near candidates set aside as things at the component, on sites none of whose components resolve. */
  atTheComponent: number;
  /** Proposals found by the item's own statement that it is part of the site. */
  partOf: number;
  /** Proposals found near the point among items of the site's kind. */
  near: number;
  /** Proposals carrying the component's number under another inscription (#1394). */
  numbered: number;
  /** Proposals near the point among items of the site's kind whose label holds a place name of the component's (#1340). */
  toponym: number;
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
  /**
   * One site's components only (#1429): its own areas asked about, its own points
   * written and cleared. Every rule is the whole pass's; the classes a site is
   * judged by are still learned from the whole catalogue's resolved components.
   */
  siteId?: number;
  /** When false, nothing is written: the matches are returned, for measuring the rules. */
  write: boolean;
  onStage?: (message: string) => void;
}

/**
 * One arm of the points a World Heritage site shows (ADR-0100): its own, and
 * its parts' — the Temple of Karnak is read as a component of Ancient Thebes,
 * and the site's standing points count it.
 */
function sitePointsArm({ from, placeId }: PlacePointArm): string {
  return `SELECT el.id, el.name, ST_Y(el.location) AS lat, ST_X(el.location) AS lon,
            ${placeId} AS experience_id, el.external_ref, m.wikidata_items, e.name AS site_name,
            (SELECT count(*)::int FROM ${pointsShownSql(placeId, 's')}
              WHERE s.missing_since IS NULL AND s.merged_into_id IS NULL) AS standing_points
       FROM ${from}
       JOIN experience_kind_memberships m ON m.experience_id = ${placeId} AND m.source_id = $1
      WHERE el.wikidata_item IS NULL
        AND el.external_ref IS NOT NULL
        AND el.missing_since IS NULL
        AND el.merged_into_id IS NULL
        AND NOT el.curated_fields ? 'wikidata_item'`;
}

/**
 * The components no item records and no curator has claimed one for, less the
 * ones that stand for their whole site (`standsForWholeSite`): a site of one
 * point, or a point named like the site, is the site's own item, and anything
 * near it is a building inside rather than the place.
 */
async function readPoints(siteId?: number): Promise<{ points: PointRow[]; wholeSites: number; wholeSiteIds: number[] }> {
  const result = await pool.query<{
    id: number; name: string | null; lat: number; lon: number; experience_id: number; external_ref: string;
    wikidata_items: string[] | null; site_name: string; standing_points: number;
  }>(
    overPlacePoints(sitePointsArm),
    [UNESCO_SOURCE_ID],
  );
  const read: PointRead[] = result.rows.filter(row => siteId === undefined || row.experience_id === siteId).map(row => ({
    locationId: row.id, name: row.name, lat: row.lat, lon: row.lon,
    experienceId: row.experience_id, siteItems: row.wikidata_items ?? [], externalRef: row.external_ref,
    siteName: row.site_name, standingPoints: row.standing_points,
  }));
  const points = read.filter(p => !standsForWholeSite(p.name, p.siteName, p.standingPoints));
  const wholeSiteIds = read.filter(p => !points.includes(p)).map(p => p.locationId);
  return { points, wholeSites: wholeSiteIds.length, wholeSiteIds };
}

/** The items components already are, per site: what the site's kind is learned from, and what is never proposed again. */
async function readResolved(): Promise<Map<number, string[]>> {
  const result = await pool.query<{ experience_id: number; wikidata_item: string }>(
    // Under every place that shows the point, so a part's item is its site's too (ADR-0100).
    `SELECT pp.place_id AS experience_id, el.wikidata_item
       FROM ${placePointsSql()} pp
       JOIN experience_locations el ON el.id = pp.location_id
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

/**
 * The proposals with their national register codes (#1340). A read that fails
 * for any reason but a cancelled pass — a heavy question, a refusal, a spent
 * wait budget — leaves the codes off rather than the proposals: a code is a
 * second key, the name and place are what proposed the candidate, and the
 * proposals are a day's QLever pass.
 */
async function coded(
  proposals: ComponentMatch[], points: readonly PointRow[], hooks: QueryHooks, onStage: ((message: string) => void) | undefined,
): Promise<ComponentMatch[]> {
  const siteOf = new Map(points.map(p => [p.locationId, p.experienceId]));
  onStage?.(`Reading the register codes of ${proposals.length} candidate items`);
  try {
    const codes = await registerCodesOf([...new Set(proposals.map(m => m.item))], hooks);
    return withRegisterCodes(proposals, codes, locationId => siteOf.get(locationId) ?? 0);
  } catch (error) {
    if (hooks.isCancelled?.()) throw error;
    console.warn('[Component items] Register codes not read:', error instanceof Error ? error.message : error);
    return proposals;
  }
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
 * The settlement kinds among the catalogue-wide classes, or null where QLever
 * could not answer. A site with no resolved components falls back on those
 * classes less their settlement kinds, so without the answer it has no
 * admitted classes to search by: its points are left unsearched, keeping an
 * earlier pass's proposals, rather than searched with the settlement rule
 * quietly off.
 */
async function catalogueSettlementKinds(classes: string[], hooks: QueryHooks): Promise<Set<string> | null> {
  try {
    return await settlementsAmong(classes, hooks, true);
  } catch (error) {
    if (!tooHeavy(error)) throw error;
    return null;
  }
}

/**
 * Which near candidates are settlements, and which sites admit them, asked of
 * the class tree on QLever (`settlementsAmong`) before the best match is
 * chosen, so a village set aside gives way to the next candidate rather than
 * to nothing. A batch QLever cannot answer leaves every point it was asked for
 * unanswered — they keep an earlier pass's proposals — rather than ending the
 * pass once every other question has its answer.
 */
async function settlementsNear(
  nearOf: Map<number, CandidateItem[]>, admitted: Map<number, ReadonlySet<string>>, hooks: QueryHooks,
  onStage: ((message: string) => void) | undefined,
): Promise<{ settled: Set<string>; settlementKinds: Set<string>; unanswered: Set<number> } > {
  const items = [...new Set([...nearOf.values()].flat().map(c => c.item))];
  const classes = [...new Set([...admitted.values()].flatMap(c => [...c]))];
  onStage?.(`Telling ${items.length} near candidates that are settlements from the rest`);
  try {
    const [settled, settlementKinds] = await Promise.all([
      settlementsAmong(items, hooks),
      settlementsAmong(classes, hooks, true),
    ]);
    return { settled, settlementKinds, unanswered: new Set() };
  } catch (error) {
    if (!tooHeavy(error)) throw error;
    return { settled: new Set(), settlementKinds: new Set(), unanswered: new Set(nearOf.keys()) };
  }
}


/**
 * The near rule's candidates for one point of a site none of whose components
 * resolve: its site's kind less the things standing at the component
 * (`standsAtTheComponent`), and in their stead the places they stand in that
 * are named like the component (`placeAsCandidate`), are no settlement and are
 * no other component's item already.
 */
function atThePoint(
  point: PointRow, ofKind: CandidateItem[], places: Map<string, StandingPlace[]>, notOffered: ReadonlySet<string>,
): { candidates: CandidateItem[]; setAside: number } {
  const namesOf = (c: CandidateItem) => (places.get(c.item) ?? []).flatMap(place => place.names);
  const setAside = ofKind.filter(c => standsAtTheComponent(point, c, namesOf(c)));
  const wholes = new Map<string, CandidateItem>();
  for (const place of setAside.flatMap(c => places.get(c.item) ?? [])) {
    const whole = placeAsCandidate(point, place);
    if (whole && !notOffered.has(whole.item)) wholes.set(whole.item, whole);
  }
  return { candidates: [...ofKind.filter(c => !setAside.includes(c)), ...wholes.values()], setAside: setAside.length };
}

/**
 * The near rule's choice for each point among the candidates of its site's
 * kind — on a site none of whose components resolve, less the things at the
 * component and with the places they stand in (`atThePoint`) — and how many
 * it set aside.
 */
function chooseNear(
  points: readonly PointRow[], ofKindOf: Map<number, CandidateItem[]>, places: Map<string, StandingPlace[]>,
  fallsBack: (point: PointRow) => boolean, refused: Map<number, Set<string>>, notOffered: ReadonlySet<string>,
): { chosen: ComponentMatch[]; atTheComponent: number } {
  const chosen: ComponentMatch[] = [];
  let atTheComponent = 0;
  for (const point of points) {
    const ofKind = ofKindOf.get(point.locationId)!;
    const { candidates, setAside } = fallsBack(point) ? atThePoint(point, ofKind, places, notOffered) : { candidates: ofKind, setAside: 0 };
    atTheComponent += setAside;
    // The place-name rule only where the name rule finds nothing: a match by
    // name is the better evidence, and one question per point by this door.
    const match = bestMatch(point, candidates, 'near', refused.get(point.locationId))
      ?? bestMatch(point, candidates, 'toponym', refused.get(point.locationId));
    if (match) chosen.push(match);
  }
  return { chosen, atTheComponent };
}

/**
 * The places the contenders of sites none of whose components resolve stand
 * in (`placesOf`), so a museum in Herrnhut is not offered as Herrnhut and an
 * islet is offered for the gunpowder house on it, with which of those places
 * are settlements (`settlementsAmong`), never offered. Asked only of a
 * candidate the near rule would take on its own — the place cannot change the
 * choice among candidates the rule refuses — never of every building around
 * the points. A batch QLever cannot answer leaves those points unanswered —
 * they keep an earlier pass's proposals — as the settlement question does,
 * rather than offering what the rule would have set aside.
 */
async function placesNear(
  fallingBack: readonly PointRow[], ofKindOf: Map<number, CandidateItem[]>, refused: Map<number, Set<string>>,
  nearOf: Map<number, CandidateItem[]>, hooks: QueryHooks, onStage: ((message: string) => void) | undefined,
): Promise<{ places: Map<string, StandingPlace[]>; settledPlaces: Set<string> }> {
  const contenders = new Map(fallingBack.filter(p => nearOf.has(p.locationId)).map(p => [p.locationId,
    ofKindOf.get(p.locationId)!.filter(c => (['near', 'toponym'] as const)
      .some(basis => bestMatch(p, [c], basis, refused.get(p.locationId)) !== null))]));
  const items = [...new Set([...contenders.values()].flat().map(c => c.item))];
  if (items.length === 0) return { places: new Map(), settledPlaces: new Set() };
  onStage?.(`Reading where ${items.length} near candidates stand`);
  try {
    const places = await placesOf(items, hooks);
    // A settlement is never offered in a thing's stead: the site's parts are
    // not known to be towns, and a church named after its village is not the
    // village. Asked of the same class tree as the candidates are, and only of
    // the places that could be offered: those a set-aside contender stands in
    // that are named like its component.
    const offerable = [...new Set([...contenders].flatMap(([locationId, theirs]) => {
      const point = fallingBack.find(p => p.locationId === locationId)!;
      return theirs.flatMap(c => {
        const own = places.get(c.item) ?? [];
        if (!standsAtTheComponent(point, c, own.flatMap(place => place.names))) return [];
        return own.filter(place => placeAsCandidate(point, place) !== null).map(place => place.item);
      });
    }))];
    return { places, settledPlaces: offerable.length > 0 ? await settlementsAmong(offerable, hooks) : new Set() };
  } catch (error) {
    if (!tooHeavy(error)) throw error;
    for (const [locationId, theirs] of contenders) if (theirs.length > 0) nearOf.delete(locationId);
    return { places: new Map(), settledPlaces: new Set() };
  }
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
 * Whether a part's own World Heritage references all name a property other
 * than the point's: a part of a site item that is also a component of another
 * property is that property's, not this one's. A part with no reference, or
 * with this property's number under any variant of the inscription (Kyiv's
 * Lavra is 527-002 on Wikidata and 527ter-002 on the list), stays a candidate:
 * the reference reader matches a reference exactly, since an extension can
 * renumber the parts, so a curator is the one to say the two are the same
 * place (#1344).
 */
function claimsAnotherSite(candidate: CandidateItem, point: PointRow): boolean {
  const own = parseWhcRef(listRef(point.externalRef))?.site;
  const claimed = (candidate.references ?? []).map(ref => parseWhcRef(ref)?.site).filter((site): site is string => !!site);
  return claimed.length > 0 && !!own && !claimed.includes(own);
}

/**
 * Replaces the open proposals of the points this pass answered for with what it found,
 * but those of a rule whose question went unanswered (`unasked`), which stand.
 * An answered proposal is kept: a refusal is what keeps a candidate from coming
 * back, and an acceptance has already recorded its item on the point. A candidate
 * a curator took back (#1336) is open and marked: found again, it takes the
 * pass's measures and keeps its mark; not found, it goes the way every open
 * candidate the pass does not find goes.
 */
async function writeProposals(
  locationIds: readonly number[], matches: readonly ComponentMatch[], unasked: MatchBasis | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM experience_component_item_proposals p
        WHERE p.answer IS NULL AND p.location_id = ANY($1::int[])
          AND ($4::text IS NULL OR p.basis <> $4)
          AND (p.taken_back_at IS NULL
               OR NOT EXISTS (SELECT 1 FROM unnest($2::int[], $3::text[]) AS f(location_id, item)
                               WHERE f.location_id = p.location_id AND f.item = p.wikidata_item))`,
      [locationIds, matches.map(m => m.locationId), matches.map(m => m.item), unasked],
    );
    // With the item's coordinate nearest the point, so the card can show the
    // candidate beside the component; none where the item states no coordinate.
    // The only rows left to conflict with are answered ones, kept as they are,
    // and marked open ones, rewritten with the mark kept.
    await client.query(
      `INSERT INTO experience_component_item_proposals AS p
              (location_id, wikidata_item, item_label, distance_m, name_similarity, exact, basis, item_location,
               register_code, register_disagrees)
       SELECT m.location_id, m.item, m.label, m.distance_m, m.similarity, m.exact, m.basis,
              CASE WHEN m.lon IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(m.lon, m.lat), 4326) END,
              m.register_code, m.register_disagrees
         FROM unnest($1::int[], $2::text[], $3::text[], $4::int[], $5::real[], $6::bool[], $7::text[],
                     $8::float8[], $9::float8[], $10::text[], $11::bool[])
              AS m(location_id, item, label, distance_m, similarity, exact, basis, lon, lat, register_code, register_disagrees)
       ON CONFLICT (location_id, wikidata_item) DO UPDATE
          SET item_label = EXCLUDED.item_label, distance_m = EXCLUDED.distance_m,
              name_similarity = EXCLUDED.name_similarity, exact = EXCLUDED.exact, basis = EXCLUDED.basis,
              item_location = EXCLUDED.item_location, register_code = EXCLUDED.register_code,
              register_disagrees = EXCLUDED.register_disagrees, proposed_at = NOW()
        WHERE p.answer IS NULL`,
      [
        matches.map(m => m.locationId), matches.map(m => m.item), matches.map(m => m.label),
        matches.map(m => m.distanceM), matches.map(m => m.similarity), matches.map(m => m.exact), matches.map(m => m.basis),
        matches.map(m => m.itemLon), matches.map(m => m.itemLat),
        matches.map(m => m.registerCode ?? null), matches.map(m => m.registerDisagrees ?? false),
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

  const [{ points, wholeSites, wholeSiteIds }, resolved, refused] = await Promise.all([readPoints(options.siteId), readResolved(), readRefused()]);
  const taken = new Set([...resolved.values()].flat());
  const labels = new Map<string, ItemLabels>();
  /** The candidates of one point that are free and close enough to be read. */
  const reachable = (point: PointRow, candidates: CandidateItem[], radius: number) =>
    candidates.filter(c => !taken.has(c.item) && nearestM(point, c) <= radius);
  const readLabels = async (candidates: Iterable<CandidateItem[]>) => {
    const wanted = [...new Set([...candidates].flat().map(c => c.item))].filter(item => !labels.has(item));
    onStage?.(`Reading the names of ${wanted.length} candidate items`);
    for (const [item, names] of await labelsOf(wanted, counted)) labels.set(item, names);
  };
  const named = (candidates: CandidateItem[]) => candidates.map(c => ({
    ...c, labels: labels.get(c.item)?.all ?? [], englishLabel: labels.get(c.item)?.english ?? null,
  }));

  onStage?.(`Reading the parts ${new Set(points.flatMap(p => p.siteItems)).size} site items name`);
  const { parts, unread } = await partsOfSites([...new Set(points.flatMap(p => p.siteItems))], counted);
  const partsNear = new Map(points.map(p => [
    p.locationId, reachable(p, p.siteItems.flatMap(item => parts.get(item) ?? []).filter(c => !claimsAnotherSite(c, p)), SAME_NAME_RADIUS_M),
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
  // The catalogue-wide classes less the settlement kinds among them: judged by
  // the same class tree the candidates are, not by a list.
  const catalogueKinds = await catalogueSettlementKinds([...catalogue], counted);
  const fallsBack = (p: PointRow) => (bySite.get(p.experienceId)?.size ?? 0) === 0;
  const searchable = catalogueKinds === null ? unmatched.filter(p => !fallsBack(p)) : unmatched;
  const admitted = new Map(searchable.map(p =>
    [p.locationId, admittedClasses(bySite.get(p.experienceId) ?? new Set(), catalogue, catalogueKinds ?? new Set())]));
  const nearOf = await searchNear(searchable, admitted, counted, onStage, (point, items) =>
    reachable(point, items.filter(c => (c.classes ?? []).some(k => admitted.get(point.locationId)!.has(k))), NEAR_SAME_NAME_RADIUS_M));
  const { settled, settlementKinds, unanswered } = await settlementsNear(nearOf, admitted, counted, onStage);
  for (const locationId of unanswered) nearOf.delete(locationId);
  await readLabels(nearOf.values());
  let settlements = 0;
  const ofKindOf = new Map<number, CandidateItem[]>();
  for (const point of searchable) {
    const ownClasses = admitted.get(point.locationId)!;
    const siteAdmits = [...ownClasses].some(c => settlementKinds.has(c));
    const candidates = named(nearOf.get(point.locationId) ?? []);
    const ofKind = candidates.filter(c => ofTheSitesKind(c, ownClasses, settled.has(c.item), siteAdmits));
    settlements += candidates.length - ofKind.length;
    ofKindOf.set(point.locationId, ofKind);
  }
  const { places, settledPlaces } = await placesNear(searchable.filter(fallsBack), ofKindOf, refused, nearOf, counted, onStage);
  const unsearched = unmatched.filter(p => !nearOf.has(p.locationId)).length;
  const { chosen, atTheComponent } = chooseNear(searchable.filter(p => nearOf.has(p.locationId)), ofKindOf, places, fallsBack, refused, new Set([...taken, ...settledPlaces]));
  matches.push(...chosen);

  // The third door, beside the others' answers rather than instead of them (#1394).
  onStage?.('Reading the items that carry a component\'s number under another inscription');
  let byKey = new Map<string, CandidateItem[]>();
  let numberedUnread = false;
  try {
    byKey = byComponentKey(await componentNumbers(counted));
  } catch (error) {
    if (!tooHeavy(error)) throw error;
    numberedUnread = true;
  }
  const numberedOf = new Map(points.map(p => [p.locationId, reachable(p, numberedFor(p, byKey), SAME_NAME_RADIUS_M)]));
  await readLabels(numberedOf.values());
  for (const point of points) {
    matches.push(...numberedMatches(point, named(numberedOf.get(point.locationId)!), refused.get(point.locationId)));
  }

  const proposals = await coded(onePerItem(matches), points, counted, onStage);
  // Answered for: a new proposal, or every question this pass asked about the
  // point got an answer. A point whose site's parts or surroundings the service
  // could not answer keeps what an earlier pass proposed for it.
  const unreadSites = new Set(unread);
  const waiting = new Set(unmatched.map(p => p.locationId));
  // A number under another inscription is asked beside the other doors, so it
  // does not make a point answered for that the other doors did not answer.
  const proposed = new Set(proposals.filter(m => m.basis !== 'numbered').map(m => m.locationId));
  // A point one of whose site items went unread is not answered for, even
  // with a part found under another: the pass did not see all of it, and
  // writing would drop the open candidates it did not evaluate.
  const answered = points.filter(p => !p.siteItems.some(item => unreadSites.has(item))
    && (proposed.has(p.locationId) || !waiting.has(p.locationId) || nearOf.has(p.locationId)));
  // A point that stands for its whole site is answered for too: nothing is
  // proposed for it, and what an earlier pass proposed is cleared.
  if (options.write && !hooks.isCancelled?.()) {
    await writeProposals([...answered.map(p => p.locationId), ...wholeSiteIds], proposals, numberedUnread ? 'numbered' : null);
  }
  return {
    matches: proposals,
    report: {
      points: points.length,
      partOf: proposals.filter(m => m.basis === 'part_of').length,
      near: proposals.filter(m => m.basis === 'near').length,
      numbered: proposals.filter(m => m.basis === 'numbered').length,
      toponym: proposals.filter(m => m.basis === 'toponym').length,
      exact: proposals.filter(m => m.exact).length,
      wholeSites,
      settlements,
      atTheComponent,
      unsearched,
      unreadSites: unread.length,
      queries,
    },
  };
}
