/**
 * The site door: the excavation a traveller stands in (ADR-0058 decision 1).
 *
 * `worship/places.ts`'s shape — a banded pool of what the admitting classes
 * name, the facts about each candidate, the rule, and then the fame line — with
 * two steps of its own, both reads of OpenStreetMap. **The first feeds the
 * pool** (#895, ADR-0060, `siteEntrance.ts`): the map's own list of digs, asked
 * once a run — one question through the mirror, eight through Overpass — and
 * then Wikidata for the sitelinks of what the classes did not name, five
 * hundred to a question, some eighty questions at the measured pool. **The
 * second comes after the pool is known**: what the map carries under each
 * candidate at the line, its own rows included, one question per hundred —
 * fifteen questions over 1,471 items on dry run 137 (2026-09-15), where a
 * question per candidate would be as many requests to somebody else's mirror.
 * The order is the whole of the cost, and every answer is kept for a day
 * (ADR-0030, ADR-0047).
 *
 * Nothing here decides what a site is: that is `siteTest.ts`, over the sets
 * `classes.ts` composes and the objects `osm/` reads. This file is the wiring.
 */

import { chunk, type QueryRunner } from '../wikidataQueries.js';
import {
  fetchBroadPool,
  fetchClassPool,
  fetchEntitiesByIds,
  type PoolEntity,
} from '../publicArt/queries.js';
import { fetchSiteFacts, type SiteFactsRow } from './queries.js';
import { categoryVotes, collectOsmEntrance, withNamed, type SiteEntrance } from './siteEntrance.js';
export type { SiteEntrance } from './siteEntrance.js';
import {
  siteExtent,
  siteVerdict,
  type OsmSignal,
  type SiteFacts,
  type SiteRefusalGroup,
} from './siteTest.js';
import { OSM_KEEP_WKT, SITE_ROOT, type ArchaeologyTrees } from './classes.js';
import type { KeepWkt, OsmObject } from '../osm/types.js';
import { OsmEmptyAnswerError } from '../osm/readOsmObjects.js';
import { lineStanding, type SourceLine } from '../sourceLine.js';
import type { FilteredEntity } from '../syncContract.js';

const CLASS_BATCH = 25;
const FACT_BATCH = 50;

/** The one broad root, asked in fame bands: everything else in the tree is narrow. */
const SITE_POOL_ROOT = { qid: SITE_ROOT, label: 'archaeological site' };

/**
 * How the run asks OpenStreetMap. A function rather than the reader itself, for
 * the reason `deps.categories` is one: this module neither knows how OSM is
 * asked nor needs it to be asked at all in a test.
 *
 * `keep` is handed *in by this module* rather than chosen by whoever wires the
 * reader up, and that is the point of it being a parameter at all: which
 * geometries are worth the wire is the kind's line through OSM's keys
 * (`OSM_KEEP_WKT`), and a caller that forgot it would have the mirror send the
 * administrative outline of every city in the pool — megabytes of geometry this
 * kind never draws.
 */
export type OsmReader = (
  qids: string[],
  keep: KeepWkt,
  run: Pick<QueryRunner, 'phase' | 'step'>,
) => Promise<Map<string, OsmObject[]>>;

/** A site the rule admitted and the line let in, with what the run learned about it. */
export interface SiteCandidate {
  entity: PoolEntity;
  /** Every `P31` it carries, as the catalogue stores them. */
  classes: string[];
  /** What OSM said and when, in the shape the row stores it (ADR-0059 decision 2). */
  osm: OsmSignal & { extentFrom: string | null; readAt: string };
  /** The extent's WKT in EPSG:4326, or null where OSM gave none. */
  extentWkt: string | null;
  /**
   * What the card says of a row the tree did not vouch for — which signal
   * carried it in (#895). Absent on a row admitted by class.
   */
  note?: string;
}

/**
 * A refusal with the answer it came from beside it.
 *
 * The tag rather than the sentence, so the run's summary line can group what it
 * refused without matching words in prose that somebody will reword
 * (`proposal.ts`, `SiteRefusalGroup`).
 */
export interface SiteRefusal extends FilteredEntity {
  group: SiteRefusalGroup;
}

export interface SitesByFame {
  sites: Map<string, SiteCandidate>;
  /** Refusals, most famous first: what the rule turned away, and by what name. */
  filtered: SiteRefusal[];
  /** Every entity this door named, which is what the panel counts as *fetched*. */
  fetched: Set<string>;
}

/**
 * Every entity the site tree names, at the pool's floor or above, once.
 *
 * The root in fame bands and the rest of the tree in batches, which is worship's
 * shape and not the museums': 1,960 candidates carry a coordinate at 15
 * sitelinks (measured 2026-09-14) against the museums' 87, and `archaeological
 * site` alone is most of them.
 *
 * The narrow classes are what carry the canon. Troy is `city-state, polis,
 * Bronze Age settlement, settlement site` and Athens is `big city, largest
 * city, metropolis, free city` — neither carries the root, and both are in this
 * pool because a class of theirs is under it.
 *
 * The rows the source already admits that no class question named — retyped by
 * Wikidata, or fallen below the floor — are asked for by id afterwards, so each
 * gets a refusal with a reason of its own rather than the sweep's silence.
 * `byId` names them, because the collector has to know: a class question
 * vouches that its row is under the tree, and a question by id vouches for
 * nothing but the id.
 */
async function collectPool(
  run: QueryRunner,
  trees: ArchaeologyTrees,
  admitted: ReadonlySet<string>,
  entrance: SiteEntrance,
): Promise<{
  pool: Map<string, PoolEntity>;
  byId: Set<string>;
  /** The rows only OpenStreetMap named (#895): vouched for by a tag, not a class. */
  byOsm: Set<string>;
  /** The objects that named each item, article-carried ones included. */
  named: Map<string, OsmObject[]>;
  /** The items only an article reached: no dig carries their tag, though another object may. */
  byArticleOnly: Set<string>;
}> {
  const pool = new Map<string, PoolEntity>();
  for (const entity of await fetchBroadPool(run, SITE_POOL_ROOT)) pool.set(entity.qid, entity);

  const narrow = [...trees.site].filter((cls) => cls !== SITE_ROOT);
  const batches = chunk(narrow, CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching the narrow site classes (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const entity of await fetchClassPool(run.sparql, batches[i])) {
      if (!pool.has(entity.qid)) pool.set(entity.qid, entity);
    }
  }

  const { byOsm, named, byArticleOnly } = await collectOsmEntrance(run, pool, admitted, entrance);

  const missing = [...admitted].filter((qid) => !pool.has(qid));
  const missingBatches = chunk(missing, FACT_BATCH);
  for (let i = 0; i < missingBatches.length; i++) {
    run.phase(
      `Asking after admitted sites the pool did not name (batch ${i + 1}/${missingBatches.length})...`,
    );
    await run.step();
    const about = 'admitted sites the pool did not name';
    for (const entity of await fetchEntitiesByIds(run.sparql, missingBatches[i], about)) {
      pool.set(entity.qid, entity);
    }
  }
  return { pool, byId: new Set(missing), byOsm, named, byArticleOnly };
}

/**
 * **A row has to carry a site class when its facts are read**, whichever
 * question named it. The rule assumes a site class somewhere on the item, so
 * an item with none would reach the final admit of step 4 and be written as a
 * site for no reason but its fame. Two rows arrive without one: a row the
 * source admits that no class question named — Wikidata has retyped it, and
 * the pool asked for it by id — and, more rarely, a row a class question *did*
 * name whose facts come back with no class at all: the pool is cached for a
 * day and the facts for twelve hours, and an item merged into another, deleted
 * or with its one site statement deprecated in between (Side's is deprecated)
 * answers `wdt:P31` with nothing. Both are refused by name here, before the
 * map is asked about them, and silently `out` where the line already put them
 * out. A whole batch answering nothing is a different thing — `collectFacts`
 * fails the run on it — so one merged item never stops the run.
 */
function refuseRetyped(
  candidates: PoolEntity[],
  facts: ReadonlyMap<string, SiteFactsRow>,
  trees: ArchaeologyTrees,
  admitted: ReadonlySet<string>,
  line: SourceLine,
  named: ReadonlyMap<string, OsmObject[]>,
): { retyped: Set<string>; filtered: SiteRefusal[] } {
  const filtered: SiteRefusal[] = [];
  const retyped = new Set<string>();
  for (const entity of candidates) {
    const classes = facts.get(entity.qid)?.classes ?? [];
    if (classes.some((cls) => trees.site.has(cls))) continue;
    // A row OpenStreetMap names is judged by the map's word, with Wikidata's
    // classes as what can contradict it (#895) — whichever question named it
    // first: a class-pool row whose one site statement was deprecated since
    // the pool was read, and whose excavation the map still tags, is the
    // second entrance's to judge, and the sentence below would be false of it.
    if ((named.get(entity.qid)?.length ?? 0) > 0) continue;
    retyped.add(entity.qid);
    // `out` is the long tail the source never admitted and the line never let
    // in — no rule ran on it, so no refusal names it (`sourceLine.ts`). Only an
    // unadmitted row can be out; an admitted one is `in` or `fell`, both named.
    if (lineStanding(entity.sitelinks, admitted.has(entity.qid), line) === 'out') continue;
    filtered.push({
      externalId: entity.qid,
      name: entity.label,
      // True of both shapes an admitted row can arrive in here: one the
      // classes once vouched for and Wikidata has retyped, and one the map
      // once named and no longer does (#895) — a row the map still names
      // never reaches this line.
      reason: 'no class under archaeological sites on Wikidata, and no OpenStreetMap object tagged as a dig carries it',
      group: 'class-or-name',
    });
  }
  return { retyped, filtered };
}

/**
 * What each candidate is, in batches of fifty: the classes and the two disputed
 * facts.
 *
 * **A batch that answered nothing is not read as "no facts".** Every row the
 * pool vouched for — by a class question, or by the map (#895) — is an item
 * that answers *something*: a class-named row carries a `P31` under the tree,
 * which is how it was named, and a map-named row carries no such class by its
 * shape but has classes, a listing or a population all the same, and every
 * veto the second entrance reads is read off those. So a batch whose vouched
 * rows *all* come back with none of the three is a batch that failed quietly,
 * and a rule reading their empty facts would put every city in it on the site
 * branch and admit it at step 4 — or, on the entrance's rows, let a comune or
 * a business in on the map's note with nothing left to veto it. The run fails
 * by name instead. One silent row in an otherwise answered batch is an item
 * Wikidata changed between the two reads, and `refuseRetyped` names it — and
 * so is the one row of a batch that holds only one: silence on a single row is
 * evidence of nothing, and a tail batch of one (a pool size ending in 1) would
 * otherwise turn one merged item into a run that fails until the day-old pool
 * cache expires. Two or more vouched rows silent at once is what a failed
 * batch looks like.
 */
const SILENT_BATCH_FLOOR = 2;
async function collectFacts(
  run: QueryRunner,
  qids: string[],
  vouched: (qid: string) => boolean,
): Promise<Map<string, SiteFactsRow>> {
  const facts = new Map<string, SiteFactsRow>();
  const batches = chunk(qids, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking what each site candidate is (batch ${i + 1}/${batches.length})...`);
    await run.step();
    const answered = await fetchSiteFacts(run.sparql, batches[i]);
    for (const [qid, row] of answered) facts.set(qid, row);
    const named = batches[i].filter(vouched);
    const saidNothing = (qid: string): boolean => {
      const row = answered.get(qid);
      return !row || (row.classes.length === 0 && !row.worldHeritage && !row.statesPopulation);
    };
    const silent = named.every(saidNothing);
    if (named.length >= SILENT_BATCH_FLOOR && silent) {
      throw new Error(
        `The facts read answered nothing about any of the ${named.length} rows the pool vouched for `
        + `by a class question or by the map in batch ${i + 1}/${batches.length} (${named.slice(0, 3).join(', ')}…); `
        + 'a batch that answers nothing is not read as "no facts"',
      );
    }
  }
  return facts;
}

/**
 * The row's facts as the rule takes them: what the pool answered, and nothing
 * derived.
 *
 * Which branch the item came in on is *not* here. It is a question about the
 * class tree — is any of its `P31`s under `human settlement` — and the rule
 * holds the trees, so the rule asks it (`siteVerdict`). Handed over as a
 * boolean it was a fact a caller could forget, and a forgotten one defaults to
 * "not a settlement", which is the difference between refusing Athens and
 * admitting it.
 */
function siteFactsOf(entity: PoolEntity, row: SiteFactsRow): SiteFacts {
  return {
    qid: entity.qid,
    classes: row.classes,
    worldHeritage: row.worldHeritage,
    statesPopulation: row.statesPopulation,
    sitelinks: entity.sitelinks,
  };
}

/** Where a candidate stands, or why it cannot be a pin at all. */
function placementOf(entity: PoolEntity): { lat: number; lon: number } | { reason: string } {
  if (!entity.onEarth) {
    return { reason: 'not on Earth: its coordinate (P625) is on another globe' };
  }
  if (entity.lat === null || entity.lon === null) {
    return { reason: 'no coordinates of its own (P625)' };
  }
  return { lat: entity.lat, lon: entity.lon };
}

const emptyFacts = (): SiteFactsRow => ({
  classes: [], worldHeritage: false, statesPopulation: false,
});

/**
 * How much of what the mirror was asked about it has to answer for before its
 * answers are read as facts (ADR-0044's shape, for the same reason).
 *
 * The measurement of 2026-09-14: 885 of the 1,126 world-tier candidates carry
 * at least one OSM object, which is 79%. The floor is half that share rather
 * than just under it, because the number it exists to catch is *zero* — a
 * renamed `osmkey:` IRI, a rebuilt dataset, the mirror moving host again, any
 * of which answers HTTP 200 with no bindings at all — and a floor set beside
 * the real share would fail the run on an ordinary month's mapping.
 */
const OSM_ANSWER_FLOOR = 0.5;

/**
 * The per-item read that came back too empty to judge anything by — the shape
 * of `OsmEmptyAnswerError` the run's boundary drops the cached answers on.
 *
 * `measured` is the share the floor is read over: every candidate asked about
 * except those the enumeration reached through an article alone, whose silence
 * says nothing either way because no dig carries their tag (#895).
 */
export class OsmAnswerFloorError extends OsmEmptyAnswerError {
  constructor(public readonly measured: number, public readonly answered: number) {
    super(
      `OpenStreetMap answered for ${answered} of ${measured} site candidates it can answer `
      + `about (${Math.round((answered / measured) * 100)}%), below the floor of `
      + `${Math.round(OSM_ANSWER_FLOOR * 100)}%: OpenStreetMap is not answering about this `
      + 'catalogue, and reading that as "no ruin is mapped here" would refuse the sites '
      + 'the rule exists to admit',
    );
    this.name = 'OsmAnswerFloorError';
  }
}

/**
 * One candidate through the rule: the row the run would write, the refusal a
 * curator reads, or nothing — `out` is the long tail nobody has heard of, and
 * no rule is reported on it, for the reason `sourceLine.ts` states for every
 * kind.
 */
function judgeCandidate(
  entity: PoolEntity,
  input: {
    facts: SiteFactsRow;
    objects: OsmObject[];
    namedByCategory: boolean;
    /** Whether only the map named it (`byOsm`), and no class question did. */
    osmOnly: boolean;
    trees: ArchaeologyTrees;
    admitted: ReadonlySet<string>;
    line: SourceLine;
    readAt: string;
  },
): SiteCandidate | SiteRefusal | null {
  const { objects, trees, admitted, line, readAt } = input;
  const verdict = siteVerdict({
    facts: {
      ...siteFactsOf(entity, input.facts),
      ...(input.namedByCategory ? { namedByCategory: true } : {}),
    },
    objects, trees, admitted, line,
  });
  if (!verdict.pass) {
    if ('out' in verdict) return null;
    return { externalId: entity.qid, name: entity.label, reason: verdict.reason, group: verdict.group };
  }
  const at = placementOf(entity);
  if ('reason' in at) {
    // A row only the map named that has no coordinate claimed no place — a
    // mapper's tag naming a person, a class, an event — and is out, never
    // refused: dry run 136 named 43 such rows, "tumulus" and "Nikola Tesla"
    // among them. An admitted row that lost its coordinate is still named.
    if (input.osmOnly && !admitted.has(entity.qid)) return null;
    return { externalId: entity.qid, name: entity.label, reason: at.reason, group: 'placeless' };
  }
  const extent = siteExtent(objects);
  return {
    entity,
    classes: input.facts.classes,
    osm: { ...verdict.osm, readAt },
    extentWkt: extent ? extent.wkt : null,
    ...(verdict.note ? { note: verdict.note } : {}),
  };
}

/**
 * The sites this run would admit, and every candidate the rule refused with the
 * reason it gave.
 *
 * Candidates are judged most famous first, which is the order the refusals are
 * reported in.
 *
 * `admitted` is what the source holds as **sites**, not as museums. One source
 * fills both doors, and the museums are the other door's to ask after: asked
 * for by id here, a museum the museum door had stopped admitting — folded,
 * vetoed, no longer a museum to Wikipedia — would carry no kill class, no OSM
 * signal and no settlement class, reach the final admit of step 4 on its own
 * fame, and be written as a site.
 */
export async function collectSitesByFame(
  run: QueryRunner,
  trees: ArchaeologyTrees,
  admitted: ReadonlySet<string>,
  line: SourceLine,
  osm: OsmReader,
  entrance: SiteEntrance,
): Promise<SitesByFame> {
  const { pool, byId, byOsm, named, byArticleOnly } = await collectPool(run, trees, admitted, entrance);
  const qids = [...pool.keys()];
  // Vouched for by a class question or by the map: a row asked for by id
  // vouches for nothing but the id. A row the map named carries no class
  // under the tree by its shape, but an item answers *something* — a class,
  // a listing, a population — and every veto the second entrance reads is
  // read off those facts, so a batch of such rows that answers nothing is
  // the same quiet failure, with a comune walking in on the map's note.
  const facts = await collectFacts(run, qids, (qid) => !byId.has(qid));
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  const { retyped, filtered } = refuseRetyped(candidates, facts, trees, admitted, line, named);
  const namedByCategory = await categoryVotes(run, candidates, facts, trees, named, line, admitted, entrance);

  // **Only the candidates the line would let speak.** `siteVerdict` answers
  // `out` for every row below the line that the source does not already admit,
  // whatever the map says about it — so asking the mirror about them buys
  // nothing and spends somebody else's bandwidth on it. 830 of this pool's
  // rows sit between 15 and 21 sitelinks: at the measured pool that is a third
  // of the questions, and the register record's promise is that this connector
  // is not a heavy user.
  const asked = candidates
    .filter((entity) => !retyped.has(entity.qid))
    .filter((entity) => lineStanding(entity.sitelinks, admitted.has(entity.qid), line) !== 'out')
    .map((entity) => entity.qid);

  // One read, here: after the pool is known and before a single verdict. The
  // date is the run's rather than each object's, because it is one question
  // asked once and the row stores when it was asked (ADR-0059 decision 2).
  const objects = await osm(asked, OSM_KEEP_WKT, run);
  const readAt = new Date().toISOString();

  // **And an empty answer is not a fact.** A mirror that answers 200 with no
  // bindings says "no OSM object carries this item" about every candidate at
  // once, which is exactly the sentence that refuses the settlement branch —
  // some 261 rows the ruin signal admits — and the sweep would then withdraw
  // them. So the share that came back with an object is counted before any
  // verdict is taken, and a run below the floor fails with its own name on it.
  // Measured on the rows the read can be expected to answer about. An item
  // under `byItem` carries the `wikidata` tag on a dig, so the read answers
  // about it or is silent for the reason the floor exists. An item the
  // enumeration reached through an article alone may carry the tag on some
  // other object or on none — Nemrut's peak node carries the item while its
  // tumulus carries the article — so its silence is evidence neither way,
  // and it is counted on neither side (#895).
  const measured = asked.filter((qid) => !byArticleOnly.has(qid));
  const answered = measured.filter((qid) => (objects.get(qid)?.length ?? 0) > 0).length;
  if (measured.length > 0 && answered / measured.length < OSM_ANSWER_FLOOR) {
    throw new OsmAnswerFloorError(measured.length, answered);
  }

  const sites = new Map<string, SiteCandidate>();
  for (const entity of candidates) {
    if (retyped.has(entity.qid)) continue;
    const row = facts.get(entity.qid) ?? emptyFacts();
    // What the map carries under the item — and, where the map's word is what
    // the rule reads, what named it: the per-item read asks by the `wikidata`
    // tag and never sees the object that carried only an article, so the
    // enumeration's objects are merged in by ref. The map's word is read for
    // a row with no class under the tree, whichever question named it first
    // (`refuseRetyped` and `categoryVotes` draw the same line): a row the map
    // alone vouched for, and a pool row whose site class has since gone —
    // dropped in silence otherwise, since the read never saw its node. A row
    // that carries a site class is judged as ADR-0058 decision 4 judges it, on
    // the objects that carry its item: a ruin node in the Agora whose
    // `wikipedia` tag names Athens would otherwise be the first ruin tag step
    // 2 finds and the city a dig, past the vetoes that exist for that mapping.
    const mapsWord = byOsm.has(entity.qid) || !row.classes.some((cls) => trees.site.has(cls));
    const judged = judgeCandidate(entity, {
      facts: row,
      objects: mapsWord
        ? withNamed(objects.get(entity.qid) ?? [], named.get(entity.qid) ?? [])
        : objects.get(entity.qid) ?? [],
      namedByCategory: namedByCategory.has(entity.qid),
      osmOnly: byOsm.has(entity.qid),
      trees, admitted, line, readAt,
    });
    if (judged === null) continue;
    if ('group' in judged) filtered.push(judged);
    else sites.set(entity.qid, judged);
  }

  // What the run admitted is said once, by `reportProposal`, where the museums
  // are counted too: two lines with the same number in them is one line a
  // reader has to reconcile with the other.
  return { sites, filtered, fetched: new Set(qids) };
}
