/**
 * Archaeology's sites in the surroundings tier (ADR-0171, ADR-0175 decision 3,
 * ADR-0179, ADR-0181): the sites the world bars left out, measured against
 * their neighbours of their own density within 150 km by the cut every place
 * kind reads (`places/surroundingsTier.ts`),
 * then put to the site rule by id — and to two conditions of the kind's own.
 *
 * - **The map shows the place.** A surroundings-tier site needs an OpenStreetMap object
 *   carrying its item that the site rule reads as the place: a ruin or a dig,
 *   or the village the rule lifts a dig over (a verdict other than `none`).
 *   A finds spot with nothing to see (Diepkloof Rock Shelter), a tell in a
 *   field, a place gone under a reservoir has none.
 * - **A part of a place the kind holds is not a place of its own.** The Forum
 *   of Pompeii is part (`P361`) of Pompeii, which the kind holds: the visit is
 *   Pompeii's.
 *
 * A site the World Heritage List inscribes stands in for the map
 * (ADR-0185): the Moidams of Charaideo and Sabratha are ruins a traveller goes
 * to whose items no OpenStreetMap ruin carries. Unless a place the kind holds
 * or admits is part of it: Mérida's listing beside the theatre and circus the
 * kind already holds is the same visit twice.
 *
 * Both are the surroundings tier's alone (`ARCHAEOLOGY_SURROUNDINGS_REGISTER`): on the
 * world tier the first would cost Palenque and Calakmul, the second Giza,
 * Karnak and Stonehenge, each part of a larger whole on Wikidata.
 *
 * Its candidates are the surroundings pool's items of the site classes. The map's
 * entrance (ADR-0060) is the world tier's alone: opened to this tier it would
 * bring some 81 places the measurement never read, a fifth of them bridges,
 * dams, tunnels and museums mapped as ruins. What the world door already read
 * of a survivor — the rule's verdict and the map — is read again from what it
 * hands on (`SiteReading`); only the survivors the world pool never named are
 * asked about, through the run's own doors.
 */

import type { PoolEntity } from '../publicArt/queries.js';
import type { SubjectRunner } from '../publicArt/subjects.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { KindShare } from '../places/gather.js';
import { surroundingsArrivals, type SurroundingsKind, type SurroundingsRuleVerdict } from '../places/surroundingsTier.js';
import { SURROUNDINGS_CUT, type SurroundingsCut } from '../places/surroundingsCut.js';
import type { SurroundingsPool } from '../places/surroundingsPool.js';
import type { WorldMemory } from '../places/worldBars.js';
import { ARCHAEOLOGY_SURROUNDINGS_REGISTER } from '../places/admissionRegister.js';
import { heldPartsOf } from '../subset/heldParts.js';
import { namedRuinsNear, type NamedRuin, type NamedRuins, type PlaceAt } from '../osm/namedRuinsNear.js';
import { OSM_KEEP_WKT, type ArchaeologyTrees } from './classes.js';
import type { SiteRefusalGroup } from './siteTest.js';
import {
  ARCHAEOLOGY_SITE_KIND, collectFacts, emptyFacts, judgeSite, listingOpensTheDoors, placementOf, RETYPED_REASON, siteCandidateOf,
  type JudgedSite, type OsmReader, type SiteCandidate, type SiteReading, type SiteRefusal,
} from './sites.js';

const LOG_PREFIX = '[Archaeology Sync]';

/**
 * The type a place of `classes` takes within Archaeology: a museum where a
 * class of it is under the museum tree, a site where one is under the site
 * tree, none otherwise (ADR-0058 decision 1). A crowded city counts its ten
 * per type, and exempts the museums (ADR-0179).
 */
export function archaeologyTypeOf(classes: readonly string[], trees: ArchaeologyTrees): 'museum' | 'site' | null {
  if (classes.some((cls) => trees.museum.has(cls))) return 'museum';
  return classes.some((cls) => trees.site.has(cls)) ? 'site' : null;
}

/** Archaeology's types, as the coverage report files a survey's entry under them (`entryTypes.ts`). */
export const ARCHAEOLOGY_TYPES: Pick<SurroundingsKind<ArchaeologyTrees, unknown>, 'kind' | 'typeOf'> = {
  kind: ARCHAEOLOGY_SITE_KIND,
  typeOf: archaeologyTypeOf,
};

/** What the surroundings step reads beside the pass's pool. */
export interface SurroundingsSitesInput {
  /** The runner the survivors are asked about by id through, and the run's Wikidata. */
  run: SubjectRunner;
  sparql: SparqlFn;
  /** The pass's surroundings pool (`placePass.ts`); null where the run read the live service. */
  pool: SurroundingsPool | null;
  /** The sites the source's surroundings tier holds before the run, which stay by the cut's stay. */
  held: ReadonlySet<string>;
  trees: ArchaeologyTrees;
  /** The pass's map door, for the survivors the world door never asked about. */
  osm: OsmReader;
  /** What the world door read of its candidates. */
  read: SiteReading;
  /** What this run admits beside the surroundings tier: the world tier's sites and the museums. Never a surroundings-tier candidate. */
  admitted: ReadonlySet<string>;
  /** Every place the kind holds before the run, of either tier and either type: a part of one is no place of its own. */
  holds: ReadonlySet<string>;
  /** The names of the places `admitted` and `holds` name, where the run knows them. */
  nameOf: (qid: string) => string | undefined;
  /** The ruin mapped near each place under one of its names (`namedRuinsNear`, the layer's). */
  namedRuins?: (places: readonly PlaceAt[], radiusM: number) => Promise<NamedRuins>;
  /** Each listed site of `wholes` that has a part among `holds`, with the part (`heldPartsOf`, the subset's). */
  heldParts?: (wholes: readonly string[], holds: ReadonlySet<string>) => Promise<Map<string, string>>;
  cut?: SurroundingsCut;
  /** What the source last read (`worldMemory.ts`), for the guides a run without a usage build cannot read. */
  memory?: WorldMemory;
}

export interface SurroundingsSites {
  sites: Map<string, SiteCandidate>;
  filtered: SiteRefusal[];
  /** Why the tier was not read, when it was not: its rows then stay as they stand (ADR-0175 decision 6). */
  skipped?: string;
}

/** A survivor's answer: the row to write, or the refusal with its group. */
type Decided = { pass: true; judged: JudgedSite; namedRuin?: NamedRuin } | { pass: false; reason: string; group: SiteRefusalGroup };

/** Why a surroundings-tier site the map does not show is refused (ADR-0179). */
export const UNMAPPED_REASON = 'no OpenStreetMap object carrying its item maps a ruin or a dig there: '
  + 'a site the surroundings tier admits is one the map shows (ADR-0179)';

/** What the card says of a site the map shows only by a ruin under its name (ADR-0188). */
export function namedRuinNote(ruin: NamedRuin): string {
  return `OpenStreetMap maps no object carrying its item, and maps ${ruin.name} (${ruin.ref}) nearby under its name (ADR-0188).`;
}

/** Why a listed surroundings-tier site with a part the kind holds is refused (ADR-0185). */
export function heldPartReason(part: string): string {
  return `the World Heritage listing of a place whose part ${part} Archaeology holds: no ruin on the map is its own, `
    + 'and the listing beside its part is the same visit twice (ADR-0185)';
}

/** Why a surroundings-tier site that is part of a place the kind holds is refused (ADR-0179). */
export function partOfReason(whole: string): string {
  return `part of ${whole} (P361), which Archaeology holds: in the surroundings tier a part is the whole's visit, not a place of its own (ADR-0179)`;
}

/** A survivor as judged: the rule's verdict and the map, and whether the World Heritage List inscribes it. */
interface Judged {
  entity: PoolEntity;
  judged: JudgedSite;
  listed: boolean;
  /** The ruin the map shows near the place under its name, without its item (ADR-0188). */
  namedRuin?: NamedRuin;
  /** Whether no layer was in place to read a named ruin, so a held place keeps its standing (ADR-0175 decision 6). */
  namedRuinUnread?: boolean;
}

/** The rule's verdict on each survivor: the world door's where it judged one, read now of the rest. */
async function judgeSurvivors(
  survivors: readonly PoolEntity[], share: KindShare<ArchaeologyTrees>, input: SurroundingsSitesInput,
): Promise<Map<string, Judged>> {
  const { run, trees, read, osm } = input;
  const unread = survivors.filter((entity) => !read.judged.has(entity.qid));
  const facts = unread.length ? await collectFacts(run, unread.map((entity) => entity.qid), () => true) : new Map();
  const objects = unread.length ? await osm(unread.map((entity) => entity.qid), OSM_KEEP_WKT, run) : new Map();
  const out = new Map<string, Judged>();
  for (const entity of survivors) {
    const known = read.judged.get(entity.qid);
    if (known) {
      out.set(entity.qid, { entity, judged: known, listed: read.listed.has(entity.qid) });
      continue;
    }
    const row = facts.get(entity.qid) ?? emptyFacts();
    const mapped = objects.get(entity.qid) ?? [];
    const listed = listingOpensTheDoors(row, share.facts.get(entity.qid)?.parents ?? [], new Set([...input.holds, ...input.admitted]), trees);
    out.set(entity.qid, { entity, judged: { verdict: judgeSite(entity, row, mapped, trees), objects: mapped }, listed });
  }
  return out;
}

/** The place a survivor the rule passed is part of, among the places the kind holds or admits, if any. */
function wholeOf(qid: string, share: KindShare<ArchaeologyTrees>, holds: ReadonlySet<string>): string | undefined {
  if (!ARCHAEOLOGY_SURROUNDINGS_REGISTER.partsOfHeld.value) return undefined;
  return (share.facts.get(qid)?.parents ?? []).find((parent) => parent !== qid && holds.has(parent));
}

/** Whether a survivor the map does not show is one the World Heritage List stands in for (ADR-0185). */
function listedForTheMap({ judged, listed }: Judged): boolean {
  return ARCHAEOLOGY_SURROUNDINGS_REGISTER.listedStandsForTheMap.value && listed
    && judged.verdict.pass && judged.verdict.osm.verdict === 'none';
}

/** A place by its name and item where the run knows the name, by its item otherwise. */
function named(qid: string, nameOf: (qid: string) => string | undefined): string {
  const name = nameOf(qid);
  return name ? `${name} (${qid})` : qid;
}

/** Whether a survivor is one the map does not show by its item (ADR-0179). */
function unmappedByItem({ judged }: Judged): boolean {
  return judged.verdict.pass && judged.verdict.osm.verdict === 'none';
}

/**
 * The refusal of a survivor the map does not show (ADR-0179), unless the World
 * Heritage List stands in for it and the kind holds no part of it (ADR-0185),
 * or the map shows a ruin near it under its name (ADR-0188); null where the
 * map shows it, or the listing or the named ruin stands in.
 */
function unmappedRefusal(one: Judged, nameOf: (qid: string) => string | undefined, heldPart?: string): Decided | null {
  if (!ARCHAEOLOGY_SURROUNDINGS_REGISTER.mapped.value || !unmappedByItem(one)) return null;
  if (!listedForTheMap(one)) {
    // With no layer to read a named ruin, a held site keeps the standing the map gave it when last read.
    return one.namedRuin || one.namedRuinUnread ? null : { pass: false, reason: UNMAPPED_REASON, group: 'surroundings' };
  }
  return heldPart ? { pass: false, reason: heldPartReason(named(heldPart, nameOf)), group: 'surroundings' } : null;
}

/** One survivor's answer: the rule's, then where it stands, the two conditions of ADR-0179 and the listing's of ADR-0185. */
function decideOne(
  one: Judged, whole: string | undefined, nameOf: (qid: string) => string | undefined, heldPart?: string,
): Decided {
  const { verdict } = one.judged;
  if (!verdict.pass) return 'out' in verdict ? { pass: false, reason: RETYPED_REASON, group: 'class-or-name' } : verdict;
  const at = placementOf(one.entity);
  if ('reason' in at) return { pass: false, reason: at.reason, group: 'placeless' };
  const unmapped = unmappedRefusal(one, nameOf, heldPart);
  if (unmapped) return unmapped;
  if (whole) return { pass: false, reason: partOfReason(named(whole, nameOf)), group: 'surroundings' };
  return { pass: true, judged: one.judged, ...(one.namedRuin && unmappedByItem(one) ? { namedRuin: one.namedRuin } : {}) };
}

/**
 * Whether a ruin named for an item can show it (ADR-0188): not where the item
 * is an archaeology museum, which the kind admits by its finds (the National
 * Archaeological Museum of Paestum beside its site).
 */
function namedByARuin(classes: readonly string[], trees: ArchaeologyTrees): boolean {
  return !classes.some((cls) => trees.museum.has(cls));
}

/**
 * The survivors with the ruin the map shows near each one under its name, read
 * only of those the map does not show by their item, no listing stands in for,
 * and that are no archaeology museum (ADR-0188).
 */
async function withNamedRuins(
  judged: ReadonlyMap<string, Judged>, share: KindShare<ArchaeologyTrees>, input: SurroundingsSitesInput,
): Promise<Map<string, Judged>> {
  const out = new Map(judged);
  const radius = ARCHAEOLOGY_SURROUNDINGS_REGISTER.namedRuinWithinMetres.value;
  if (!ARCHAEOLOGY_SURROUNDINGS_REGISTER.mapped.value || radius <= 0) return out;
  const named = (qid: string) => namedByARuin(share.facts.get(qid)?.classes ?? [], input.trees);
  const asked = [...judged.values()]
    .filter((one) => unmappedByItem(one) && !listedForTheMap(one) && named(one.entity.qid) && one.entity.lat !== null && one.entity.lon !== null)
    .map((one) => ({ qid: one.entity.qid, lat: one.entity.lat!, lon: one.entity.lon! }));
  const found = await (input.namedRuins ?? namedRuinsNear)(asked, radius);
  if (found === null) {
    // No layer in place: no new site enters by a name, and a held one is not dropped for it.
    for (const { qid } of asked) if (input.held.has(qid)) out.set(qid, { ...out.get(qid)!, namedRuinUnread: true });
    return out;
  }
  for (const [qid, ruin] of found) out.set(qid, { ...out.get(qid)!, namedRuin: ruin });
  return out;
}

/**
 * Each survivor's answer. A part is read against every place the kind holds
 * or admits this run, among them the survivors that clear every condition but
 * the part's own: a whole this step refuses as unmapped or placeless is held
 * by no one, and its part is not refused in its name.
 */
async function decide(
  read: ReadonlyMap<string, Judged>, share: KindShare<ArchaeologyTrees>, input: SurroundingsSitesInput,
): Promise<Map<string, Decided>> {
  const judged = await withNamedRuins(read, share, input);
  const nameOf = (qid: string) => input.nameOf(qid) ?? judged.get(qid)?.entity.label;
  // A listing the map does not show stands in for it unless the kind holds or
  // admits a part of it outside this step. Never against this step's own
  // survivors, where a listing and its part would refuse each other; and read
  // before the clearing, so a listing refused for its held part holds no one.
  const listings = [...judged].filter(([, one]) => listedForTheMap(one)).map(([qid]) => qid);
  const heldParts = await (input.heldParts ?? heldPartsOf)(listings, new Set([...input.holds, ...input.admitted]));
  const clearing = [...judged].filter(([qid, one]) => decideOne(one, undefined, nameOf, heldParts.get(qid)).pass).map(([qid]) => qid);
  const holds = new Set([...input.holds, ...input.admitted, ...clearing]);
  return new Map([...judged].map(([qid, one]) => [qid, decideOne(one, wholeOf(qid, share, holds), nameOf, heldParts.get(qid))]));
}

/**
 * The sites the surroundings tier admits this run, and what it refuses by name:
 * a survivor of the cut the rule or a condition refuses, and a site it held
 * that no longer clears the cut.
 */
export async function collectSurroundingsSites(input: SurroundingsSitesInput): Promise<SurroundingsSites> {
  const decided = new Map<string, Decided>();
  const surroundings: SurroundingsKind<ArchaeologyTrees, null> = {
    kind: ARCHAEOLOGY_SITE_KIND,
    classesOf: (trees) => trees.site,
    typeOf: archaeologyTypeOf,
    context: async (survivors, share) => {
      for (const [qid, answer] of await decide(await judgeSurvivors(survivors, share, input), share, input)) decided.set(qid, answer);
      return null;
    },
    verdict: (entity): SurroundingsRuleVerdict => {
      const answer = decided.get(entity.qid);
      if (!answer) return { pass: false, reason: RETYPED_REASON };
      return answer.pass ? { pass: true, type: 'site' } : { pass: false, reason: answer.reason };
    },
    logPrefix: LOG_PREFIX,
  };
  const arrivals = await surroundingsArrivals(
    input.run, input.sparql, surroundings, input.trees, input.admitted,
    (entity, classes, _verdict, note) => {
      const answer = decided.get(entity.qid);
      if (!answer?.pass || !answer.judged.verdict.pass) throw new Error(`A surroundings-tier site the rule did not pass reached the writer: ${entity.qid}`);
      const shown = answer.namedRuin ? `${note} ${namedRuinNote(answer.namedRuin)}` : note;
      return siteCandidateOf(entity, answer.judged.verdict, { classes, objects: answer.judged.objects, readAt: input.read.readAt, note: shown });
    },
    input.pool, input.held, input.cut ?? SURROUNDINGS_CUT, input.memory,
  );
  const groupOf = (qid: string): SiteRefusalGroup => {
    const answer = decided.get(qid);
    return answer && !answer.pass ? answer.group : 'surroundings';
  };
  return {
    sites: new Map(arrivals.items.map((site) => [site.entity.qid, site])),
    filtered: arrivals.filtered.map((entity) => ({ ...entity, group: groupOf(entity.externalId) })),
    ...(arrivals.skipped ? { skipped: arrivals.skipped } : {}),
  };
}
