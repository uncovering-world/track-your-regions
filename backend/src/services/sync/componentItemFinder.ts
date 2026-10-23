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
 * what UNESCO states. It reads the local Wikidata subset (#1435,
 * `subset/componentItems.ts`), and Wikidata's own API only for the labels of
 * the candidates; with no subset built, or one a database crash emptied, it
 * refuses to run, since every question would answer nothing and the pass
 * would clear what the last one proposed.
 */

import { pool } from '../../db/index.js';
import { byComponentKey, numberedFor } from './componentItemNumbered.js';
import { listRef, parseWhcRef } from './unescoWikidata.js';
import {
  admittedClasses, bestMatch, namesMoreThanTheTown, nearestM, numberedMatches, ofTheSitesKind, placeAsCandidate, standsAtTheComponent,
  BY_THE_TOWN_ALONE, NEAR_SAME_NAME_RADIUS_M, NEVER_BY_THE_CATALOGUE, NOT_BY_PLACE_NAME_ALONE, SAME_NAME_RADIUS_M,
  type CandidateItem, type ComponentMatch, type ComponentPoint,
} from './componentItemMatching.js';
import { labelsOf, type ItemLabels, type QueryHooks } from './componentItemQueries.js';
import {
  classesOfItems, classesUnder, componentNumbers, itemsInBoxes, itemsUnder, partsOfSites, placesOf, registerCodesOf, settlementsAmong,
  type Box, type StandingPlace,
} from './subset/componentItems.js';
import { entitiesAreHeld, latestSubset } from '../dumps/wikidata/subsetTables.js';
import { withRegisterCodes } from './componentItemRegisters.js';
import { overPlacePoints, type PlacePointArm, placePointsSql, pointsShownSql } from '../../db/placePoints.js';

const UNESCO_SOURCE_ID = 1;
/** Points are asked about in cells of this many degrees: one box per cell. */
const CELL_DEG = 0.25;
/** How far past its points a cell's box reaches, in degrees of latitude: the same-name radius. */
const BOX_MARGIN_DEG = 0.05;
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

export interface ComponentItemReport {
  /** Components no item records, that no curator has claimed the item of, less the whole-site ones. */
  points: number;
  /** Components standing for their whole site, which are not searched (`stands_for_whole_site`). */
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
  /** Requests sent to Wikidata's API, for the candidates' labels. */
  queries: number;
  /** The date of the entities dump the subset the pass read was built from. */
  dumpDate: string;
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
  /** A step of the pass begins (`STEP`): its sentence, and how many items or areas it has to read. */
  onStep?: OnStep;
}

type OnStep = (index: number, sentence: string, total: number) => void;

/**
 * The steps of a pass, in order, as its progress counts them (#1356). A step
 * the pass has nothing for is skipped rather than renumbered, so a step's
 * number means the same on every run.
 */
const STEP = {
  parts: 1, partNames: 2, classes: 3, catalogueKinds: 4, near: 5, settlements: 6,
  nearNames: 7, places: 8, placeSettlements: 9, numbered: 10, numberedNames: 11, codes: 12,
} as const;
export const FINDER_STEPS = Object.keys(STEP).length;

/**
 * A point the World Heritage list gives (`$1` is its source): one a World
 * Heritage membership places, or one no membership places, as every point was
 * before the placements (ADR-0084). A point another kind added to the place —
 * Places of worship's own point on Aachen Cathedral — is that source's, not a
 * component: it carries its item as its reference already, and read as a
 * component it was offered the cathedral's pipe organs.
 */
const listsPoint = (alias: string) => `(EXISTS (SELECT 1 FROM experience_location_placements pl
                    JOIN experience_kind_memberships pm ON pm.id = pl.membership_id
                   WHERE pl.location_id = ${alias}.id AND pm.source_id = $1)
               OR NOT EXISTS (SELECT 1 FROM experience_location_placements any_placement
                   WHERE any_placement.location_id = ${alias}.id))`;

/**
 * One arm of the points a World Heritage site shows (ADR-0100): its own, and
 * its parts' — the Temple of Karnak is read as a component of Ancient Thebes,
 * and the site's standing points count it. Only the points the list gives
 * (`listsPoint`) are counted, and each read point says whether it is one
 * (`listed`), so another kind's point neither stands as a component nor makes
 * a one-point site look like two, while a proposal an earlier pass made for
 * it can still be cleared.
 */
function sitePointsArm({ from, placeId }: PlacePointArm): string {
  return `SELECT el.id, el.name, ST_Y(el.location) AS lat, ST_X(el.location) AS lon, el.approximate IS NOT NULL AS approximate,
            ${placeId} AS experience_id, el.external_ref, m.wikidata_items,
            ${listsPoint('el')} AS listed,
            stands_for_whole_site(el.name, el.external_ref, e.name, m.external_id,
              (SELECT count(*)::int FROM ${pointsShownSql(placeId, 's')}
                WHERE s.missing_since IS NULL AND s.merged_into_id IS NULL AND ${listsPoint('s')})) AS whole_site
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
 * ones that stand for their whole site (`stands_for_whole_site` in the schema):
 * a site of one point, a point carrying the site's own reference, or a point
 * named like the site, is the site's own item, and anything
 * near it is a building inside rather than the place. `clearedIds` are the
 * points the pass answers for without searching them: those whole-site
 * points, and the points another kind gives the place, whose open proposals
 * from an earlier pass are cleared (the Aachen organ, offered before
 * `listsPoint`).
 */
async function readPoints(siteId?: number): Promise<{ points: PointRow[]; wholeSites: number; clearedIds: number[] }> {
  const result = await pool.query<{
    id: number; name: string | null; lat: number; lon: number; approximate: boolean; experience_id: number; external_ref: string;
    wikidata_items: string[] | null; whole_site: boolean; listed: boolean;
  }>(
    overPlacePoints(sitePointsArm),
    [UNESCO_SOURCE_ID],
  );
  const rows = result.rows.filter(row => siteId === undefined || row.experience_id === siteId);
  const listed = rows.filter(row => row.listed);
  const points: PointRow[] = listed.filter(row => !row.whole_site).map(row => ({
    locationId: row.id, name: row.name, lat: row.lat, lon: row.lon, approximate: row.approximate,
    experienceId: row.experience_id, siteItems: row.wikidata_items ?? [], externalRef: row.external_ref,
  }));
  const wholeSiteIds = listed.filter(row => row.whole_site).map(row => row.id);
  const othersIds = rows.filter(row => !row.listed).map(row => row.id);
  return { points, wholeSites: wholeSiteIds.length, clearedIds: [...wholeSiteIds, ...othersIds] };
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

/** The proposals with their national register codes (#1340). */
async function coded(
  proposals: ComponentMatch[], points: readonly PointRow[], hooks: QueryHooks, onStep: OnStep | undefined,
): Promise<ComponentMatch[]> {
  const siteOf = new Map(points.map(p => [p.locationId, p.experienceId]));
  const items = [...new Set(proposals.map(m => m.item))];
  onStep?.(STEP.codes, `Reading the register codes of ${items.length} candidate items`, items.length);
  const codes = await registerCodesOf(items, hooks);
  return withRegisterCodes(proposals, codes, locationId => siteOf.get(locationId) ?? 0);
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
 * The near candidates of every point the part rule left: what stands in each
 * cell's box, of a class some point of the pass admits, asked in one question.
 */
async function searchNear(
  unmatched: PointRow[], admitted: Map<number, ReadonlySet<string>>, hooks: QueryHooks,
  onStep: OnStep | undefined,
  keep: (point: PointRow, items: CandidateItem[]) => CandidateItem[],
): Promise<Map<number, CandidateItem[]>> {
  const nearOf = new Map<number, CandidateItem[]>();
  const cells = cellsOf(unmatched);
  onStep?.(STEP.near, `Looking near ${unmatched.length} points, ${cells.length} areas`, cells.length);
  const classes = [...new Set(unmatched.flatMap(p => [...admitted.get(p.locationId)!]))];
  const inBoxes = await itemsInBoxes(cells.map(boxOf), classes, hooks);
  cells.forEach((cell, index) => {
    for (const point of cell) nearOf.set(point.locationId, keep(point, inBoxes.get(index) ?? []));
  });
  return nearOf;
}

/**
 * Which near candidates are settlements, and which sites admit them, asked of
 * the class tree (`settlementsAmong`) before the best match is chosen, so a
 * village set aside gives way to the next candidate rather than to nothing.
 */
async function settlementsNear(
  nearOf: Map<number, CandidateItem[]>, admitted: Map<number, ReadonlySet<string>>, hooks: QueryHooks,
  onStep: OnStep | undefined,
): Promise<{ settled: Set<string>; settlementKinds: Set<string>; museums: Set<string>; byTownAlone: Set<string> }> {
  const items = [...new Set([...nearOf.values()].flat().map(c => c.item))];
  const classes = [...new Set([...admitted.values()].flatMap(c => [...c]))];
  // The candidates (thrice: settlements, museums, archaeological sites) and the sites' classes are asked side by side, so the step counts all four.
  onStep?.(STEP.settlements, `Telling ${items.length} near candidates that are settlements, museums or archaeological sites from the rest`,
    3 * items.length + classes.length);
  const [settled, settlementKinds, museums, byTownAlone] = await Promise.all([
    settlementsAmong(items, hooks),
    settlementsAmong(classes, hooks, true),
    itemsUnder(items, Object.keys(NOT_BY_PLACE_NAME_ALONE), hooks),
    itemsUnder(items, Object.keys(BY_THE_TOWN_ALONE), hooks),
  ]);
  return { settled, settlementKinds, museums, byTownAlone };
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
  museums: ReadonlySet<string>, byTownAlone: ReadonlySet<string>,
): { chosen: ComponentMatch[]; atTheComponent: number } {
  const chosen: ComponentMatch[] = [];
  let atTheComponent = 0;
  for (const point of points) {
    const ofKind = ofKindOf.get(point.locationId)!;
    const fallingBack = fallsBack(point);
    const { candidates, setAside } = fallingBack ? atThePoint(point, ofKind, places, notOffered) : { candidates: ofKind, setAside: 0 };
    atTheComponent += setAside;
    // The place-name rule only where the name rule finds nothing: a match by
    // name is the better evidence, and one question per point by this door.
    // On the catalogue's classes it never takes a museum (NOT_BY_PLACE_NAME_ALONE),
    // and by the town's name alone only an archaeological site (BY_THE_TOWN_ALONE).
    const byPlaceName = fallingBack
      ? candidates.filter(c => !museums.has(c.item) && (byTownAlone.has(c.item) || namesMoreThanTheTown(point, c)))
      : candidates;
    const match = bestMatch(point, candidates, 'near', refused.get(point.locationId))
      ?? bestMatch(point, byPlaceName, 'toponym', refused.get(point.locationId));
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
 * the points.
 */
async function placesNear(
  fallingBack: readonly PointRow[], ofKindOf: Map<number, CandidateItem[]>, refused: Map<number, Set<string>>,
  nearOf: Map<number, CandidateItem[]>, hooks: QueryHooks, onStep: OnStep | undefined,
): Promise<{ places: Map<string, StandingPlace[]>; settledPlaces: Set<string>; museumPlaces: Set<string> }> {
  const contenders = new Map(fallingBack.filter(p => nearOf.has(p.locationId)).map(p => [p.locationId,
    ofKindOf.get(p.locationId)!.filter(c => (['near', 'toponym'] as const)
      .some(basis => bestMatch(p, [c], basis, refused.get(p.locationId)) !== null))]));
  const items = [...new Set([...contenders.values()].flat().map(c => c.item))];
  if (items.length === 0) return { places: new Map(), settledPlaces: new Set(), museumPlaces: new Set() };
  onStep?.(STEP.places, `Reading where ${items.length} near candidates stand`, items.length);
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
  if (offerable.length === 0) return { places, settledPlaces: new Set(), museumPlaces: new Set() };
  // A place offered in a thing's stead is asked the place-name rule's museum question too (NOT_BY_PLACE_NAME_ALONE).
  onStep?.(STEP.placeSettlements, `Telling which of ${offerable.length} places named like a component are settlements or museums`, 2 * offerable.length);
  const [settledPlaces, museumPlaces] = await Promise.all([
    settlementsAmong(offerable, hooks),
    itemsUnder(offerable, Object.keys(NOT_BY_PLACE_NAME_ALONE), hooks),
  ]);
  return { places, settledPlaces, museumPlaces };
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
 * Replaces the open proposals of the points this pass answered for with what it found.
 * An answered proposal is kept: a refusal is what keeps a candidate from coming
 * back, and an acceptance has already recorded its item on the point. A candidate
 * a curator took back (#1336) is open and marked: found again, it takes the
 * pass's measures and keeps its mark; not found, it goes the way every open
 * candidate the pass does not find goes.
 */
async function writeProposals(
  locationIds: readonly number[], matches: readonly ComponentMatch[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM experience_component_item_proposals p
        WHERE p.answer IS NULL AND p.location_id = ANY($1::int[])
          AND (p.taken_back_at IS NULL
               OR NOT EXISTS (SELECT 1 FROM unnest($2::int[], $3::text[]) AS f(location_id, item)
                               WHERE f.location_id = p.location_id AND f.item = p.wikidata_item))`,
      [locationIds, matches.map(m => m.locationId), matches.map(m => m.item)],
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
  const { hooks, onStep } = options;
  // The subset's tables are unlogged: a database crash empties them while the
  // build's record stands, and a pass over empty tables would clear every open proposal.
  const subset = await latestSubset();
  if (!subset || !(await entitiesAreHeld())) {
    throw new Error('The local Wikidata subset is not built (or a database crash emptied it): build it under Public Dumps before finding component items');
  }
  let queries = 0;
  const counted: QueryHooks = { ...hooks, onQuery: () => { queries += 1; hooks.onQuery?.(); } };

  const [{ points, wholeSites, clearedIds }, resolved, refused] = await Promise.all([readPoints(options.siteId), readResolved(), readRefused()]);
  const taken = new Set([...resolved.values()].flat());
  const labels = new Map<string, ItemLabels>();
  /** The candidates of one point that are free and close enough to be read. */
  const reachable = (point: PointRow, candidates: CandidateItem[], radius: number) =>
    candidates.filter(c => !taken.has(c.item) && nearestM(point, c) <= radius);
  const readLabels = async (step: number, candidates: Iterable<CandidateItem[]>) => {
    const wanted = [...new Set([...candidates].flat().map(c => c.item))].filter(item => !labels.has(item));
    onStep?.(step, `Reading the names of ${wanted.length} candidate items`, wanted.length);
    for (const [item, names] of await labelsOf(wanted, counted)) labels.set(item, names);
  };
  const named = (candidates: CandidateItem[]) => candidates.map(c => ({
    ...c, labels: labels.get(c.item)?.all ?? [], englishLabel: labels.get(c.item)?.english ?? null,
  }));

  const siteItems = [...new Set(points.flatMap(p => p.siteItems))];
  onStep?.(STEP.parts, `Reading the parts ${siteItems.length} site items name`, siteItems.length);
  const parts = await partsOfSites(siteItems, counted);
  const partsNear = new Map(points.map(p => [
    p.locationId, reachable(p, p.siteItems.flatMap(item => parts.get(item) ?? []).filter(c => !claimsAnotherSite(c, p)), SAME_NAME_RADIUS_M),
  ]));
  await readLabels(STEP.partNames, partsNear.values());
  const matches: ComponentMatch[] = [];
  const unmatched: PointRow[] = [];
  for (const point of points) {
    const match = bestMatch(point, named(partsNear.get(point.locationId)!), 'part_of', refused.get(point.locationId));
    if (match) matches.push(match); else unmatched.push(point);
  }

  onStep?.(STEP.classes, `Reading the classes of ${taken.size} resolved components`, taken.size);
  const { bySite, catalogue } = learnClasses(resolved, await classesOfItems([...taken], counted));
  // Two questions of the same classes, so the step counts both.
  onStep?.(STEP.catalogueKinds,
    `Telling the settlement kinds, hotels and stations among the ${catalogue.size} classes of the resolved components`, 2 * catalogue.size);
  // The catalogue-wide classes less the settlement kinds among them: judged by
  // the same class tree the candidates are, not by a list.
  const catalogueKinds = await settlementsAmong([...catalogue], counted, true);
  const neverByTheCatalogue = await classesUnder([...catalogue], Object.keys(NEVER_BY_THE_CATALOGUE), counted);
  const fallsBack = (p: PointRow) => (bySite.get(p.experienceId)?.size ?? 0) === 0;
  const admitted = new Map(unmatched.map(p =>
    [p.locationId, admittedClasses(bySite.get(p.experienceId) ?? new Set(), catalogue, catalogueKinds, neverByTheCatalogue)]));
  const nearOf = await searchNear(unmatched, admitted, counted, onStep, (point, items) =>
    reachable(point, items.filter(c => (c.classes ?? []).some(k => admitted.get(point.locationId)!.has(k))), NEAR_SAME_NAME_RADIUS_M));
  const { settled, settlementKinds, museums, byTownAlone } = await settlementsNear(nearOf, admitted, counted, onStep);
  await readLabels(STEP.nearNames, nearOf.values());
  let settlements = 0;
  const ofKindOf = new Map<number, CandidateItem[]>();
  for (const point of unmatched) {
    const ownClasses = admitted.get(point.locationId)!;
    const siteAdmits = [...ownClasses].some(c => settlementKinds.has(c));
    const candidates = named(nearOf.get(point.locationId) ?? []);
    const ofKind = candidates.filter(c => ofTheSitesKind(c, ownClasses, settled.has(c.item), siteAdmits));
    settlements += candidates.length - ofKind.length;
    ofKindOf.set(point.locationId, ofKind);
  }
  const { places, settledPlaces, museumPlaces } = await placesNear(unmatched.filter(fallsBack), ofKindOf, refused, nearOf, counted, onStep);
  const { chosen, atTheComponent } = chooseNear(
    unmatched, ofKindOf, places, fallsBack, refused, new Set([...taken, ...settledPlaces]), new Set([...museums, ...museumPlaces]),
    byTownAlone);
  matches.push(...chosen);

  // The third door, beside the others' answers rather than instead of them (#1394).
  onStep?.(STEP.numbered, 'Reading the items that carry a component\'s number under another inscription', 1);
  const byKey = byComponentKey(await componentNumbers(counted));
  const numberedOf = new Map(points.map(p => [p.locationId, reachable(p, numberedFor(p, byKey), SAME_NAME_RADIUS_M)]));
  await readLabels(STEP.numberedNames, numberedOf.values());
  for (const point of points) {
    matches.push(...numberedMatches(point, named(numberedOf.get(point.locationId)!), refused.get(point.locationId)));
  }

  const proposals = await coded(onePerItem(matches), points, counted, onStep);
  // Every question the pass asks has an answer, so the pass answers for every
  // point it read: what an earlier pass proposed and this one does not find
  // is cleared. A point that stands for its whole site, and a point another
  // kind gives the place, are answered for too: nothing is proposed for them.
  if (options.write && !hooks.isCancelled?.()) {
    await writeProposals([...points.map(p => p.locationId), ...clearedIds], proposals);
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
      queries,
      dumpDate: subset.dumpDate,
    },
  };
}
