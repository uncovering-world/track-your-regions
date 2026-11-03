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
import { OSM_KEEP_WKT, type ArchaeologyTrees } from './classes.js';
import type { SiteRefusalGroup } from './siteTest.js';
import {
  ARCHAEOLOGY_SITE_KIND, collectFacts, emptyFacts, judgeSite, placementOf, RETYPED_REASON, siteCandidateOf,
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
type Decided = { pass: true; judged: JudgedSite } | { pass: false; reason: string; group: SiteRefusalGroup };

/** Why a surroundings-tier site the map does not show is refused (ADR-0179). */
export const UNMAPPED_REASON = 'no OpenStreetMap object carrying its item maps a ruin or a dig there: '
  + 'a site the surroundings tier admits is one the map shows (ADR-0179)';

/** Why a surroundings-tier site that is part of a place the kind holds is refused (ADR-0179). */
export function partOfReason(whole: string): string {
  return `part of ${whole} (P361), which Archaeology holds: in the surroundings tier a part is the whole's visit, not a place of its own (ADR-0179)`;
}

/** The rule's verdict on each survivor: the world door's where it judged one, read now of the rest. */
async function judgeSurvivors(
  survivors: readonly PoolEntity[], input: SurroundingsSitesInput,
): Promise<Map<string, { entity: PoolEntity; judged: JudgedSite }>> {
  const { run, trees, read, osm } = input;
  const unread = survivors.filter((entity) => !read.judged.has(entity.qid));
  const facts = unread.length ? await collectFacts(run, unread.map((entity) => entity.qid), () => true) : new Map();
  const objects = unread.length ? await osm(unread.map((entity) => entity.qid), OSM_KEEP_WKT, run) : new Map();
  const out = new Map<string, { entity: PoolEntity; judged: JudgedSite }>();
  for (const entity of survivors) {
    const known = read.judged.get(entity.qid);
    if (known) {
      out.set(entity.qid, { entity, judged: known });
      continue;
    }
    const mapped = objects.get(entity.qid) ?? [];
    out.set(entity.qid, { entity, judged: { verdict: judgeSite(entity, facts.get(entity.qid) ?? emptyFacts(), mapped, trees), objects: mapped } });
  }
  return out;
}

/** The place a survivor the rule passed is part of, among the places the kind holds or admits, if any. */
function wholeOf(qid: string, share: KindShare<ArchaeologyTrees>, holds: ReadonlySet<string>): string | undefined {
  if (!ARCHAEOLOGY_SURROUNDINGS_REGISTER.partsOfHeld.value) return undefined;
  return (share.facts.get(qid)?.parents ?? []).find((parent) => parent !== qid && holds.has(parent));
}

/** One survivor's answer: the rule's, then where it stands and the two conditions of ADR-0179. */
function decideOne(
  entity: PoolEntity, judged: JudgedSite, whole: string | undefined, nameOf: (qid: string) => string | undefined,
): Decided {
  const { verdict } = judged;
  if (!verdict.pass) return 'out' in verdict ? { pass: false, reason: RETYPED_REASON, group: 'class-or-name' } : verdict;
  const at = placementOf(entity);
  if ('reason' in at) return { pass: false, reason: at.reason, group: 'placeless' };
  if (ARCHAEOLOGY_SURROUNDINGS_REGISTER.mapped.value && verdict.osm.verdict === 'none') {
    return { pass: false, reason: UNMAPPED_REASON, group: 'surroundings' };
  }
  if (whole) {
    const name = nameOf(whole);
    return { pass: false, reason: partOfReason(name ? `${name} (${whole})` : whole), group: 'surroundings' };
  }
  return { pass: true, judged };
}

/**
 * Each survivor's answer. A part is read against every place the kind holds
 * or admits this run, among them the survivors that clear every condition but
 * the part's own: a whole this step refuses as unmapped or placeless is held
 * by no one, and its part is not refused in its name.
 */
function decide(
  judged: ReadonlyMap<string, { entity: PoolEntity; judged: JudgedSite }>, share: KindShare<ArchaeologyTrees>, input: SurroundingsSitesInput,
): Map<string, Decided> {
  const nameOf = (qid: string) => input.nameOf(qid) ?? judged.get(qid)?.entity.label;
  const clearing = [...judged].filter(([, { entity, judged: j }]) => decideOne(entity, j, undefined, nameOf).pass).map(([qid]) => qid);
  const holds = new Set([...input.holds, ...input.admitted, ...clearing]);
  return new Map([...judged].map(([qid, { entity, judged: j }]) => [qid, decideOne(entity, j, wholeOf(qid, share, holds), nameOf)]));
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
      for (const [qid, answer] of decide(await judgeSurvivors(survivors, input), share, input)) decided.set(qid, answer);
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
      return siteCandidateOf(entity, answer.judged.verdict, { classes, objects: answer.judged.objects, readAt: input.read.readAt, note });
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
