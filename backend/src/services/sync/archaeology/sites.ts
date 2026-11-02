/**
 * The site door: the excavation a traveller stands in (ADR-0058 decision 1).
 *
 * `worship/places.ts`'s shape — the kind's share of the place gather, the
 * facts about each candidate, the rule, and then the world bars of the place
 * kinds' frame over the sites' own pool (ADR-0175, ADR-0179) — with two steps
 * of its own, both reads of OpenStreetMap. **The first feeds the pool** (#895,
 * ADR-0060, `siteEntrance.ts`): the map's own list of digs, asked once a run,
 * and then Wikidata for the sitelinks of what the classes did not name. **The
 * second comes after the pool is known**: what the map carries under every
 * candidate, one question per hundred through the mirror and one read of the
 * layer, since the rule decides which candidates are sites before the bars are
 * read over them. Every answer is kept for a day (ADR-0030, ADR-0047).
 *
 * Nothing here decides what a site is: that is `siteTest.ts`, over the sets
 * `classes.ts` composes and the objects `osm/` reads. Nothing here decides
 * whether it is famous enough: that is the frame's (`places/worldTier.ts`).
 * This file is the wiring.
 */

import { chunk, type QueryRunner } from '../wikidataQueries.js';
import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare, PlaceKind } from '../places/gather.js';
import { fetchArchaeologyTrees, fetchSiteFacts, type SiteFactsRow } from './queries.js';
import { categoryVotes, collectOsmEntrance, withNamed, type SiteEntrance } from './siteEntrance.js';
export type { SiteEntrance } from './siteEntrance.js';
import {
  siteExtent,
  siteVerdict,
  type OsmSignal,
  type SiteFacts,
  type SiteRefusalGroup,
  type SiteVerdict,
} from './siteTest.js';
import { OSM_KEEP_WKT, SITE_ROOT, type ArchaeologyTrees } from './classes.js';
import type { KeepWkt, OsmObject, OsmReaderName } from '../osm/types.js';
import { OsmEmptyAnswerError } from '../osm/readOsmObjects.js';
import type { FilteredEntity } from '../syncContract.js';
import { inPool, namesRefusal, openWorldTier, type WorldOptions, type WorldTier } from '../places/worldTier.js';
import type { WorldCandidate } from '../places/worldBars.js';

const LOG_PREFIX = '[Archaeology Sync]';

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

/**
 * When and through which door the object a verdict was read from was read:
 * that object's own source where it names one (the layer as of its
 * replication timestamp, or Overpass when it was asked), the run's time and
 * its one door otherwise. A site's objects can come through two doors (the
 * per-item read from the layer, an object only the enumeration named from
 * Overpass), so the source is the deciding object's; only where nothing
 * decided is the first source among its objects taken. A site with no object
 * at all names the run's door and time: with `OSM_READER=local` that is the
 * local door as a whole, the layer or the Overpass it asked for the miss.
 */
export function provenanceOf(objects: OsmObject[], decidedBy: string | null, runReadAt: string): { readAt: string; door?: OsmReaderName } {
  const source = decidedBy
    ? objects.find(object => object.ref === decidedBy)?.source
    : objects.find(object => object.source)?.source;
  return source ? { readAt: source.asOf, door: source.door } : { readAt: runReadAt };
}

/**
 * The extent's own door and time, where the object it was drawn from came
 * through another door, or as of another time, than the object the verdict was
 * read from (the Nemrut shape on a stale layer: the tumulus from Overpass
 * decides, the heritage zone from the layer draws the outline). Nothing where
 * the two agree, so a site read through one door carries one pair.
 */
export function extentProvenanceOf(
  objects: OsmObject[], osm: { object: string | null; extentFrom: string | null }, runReadAt: string,
): { extentDoor?: OsmReaderName; extentReadAt?: string } {
  if (!osm.extentFrom || osm.extentFrom === osm.object) return {};
  const decided = provenanceOf(objects, osm.object, runReadAt);
  const source = objects.find(object => object.ref === osm.extentFrom)?.source;
  if (!source || (source.door === decided.door && source.asOf === decided.readAt)) return {};
  return { extentDoor: source.door, extentReadAt: source.asOf };
}

/** A site the rule admitted and the frame let in, with what the run learned about it. */
export interface SiteCandidate {
  entity: PoolEntity;
  /** Every `P31` it carries, as the catalogue stores them. */
  classes: string[];
  /**
   * What OSM said and when, in the shape the row stores it (ADR-0059 decision
   * 2), with the door it came through where the run read through more than one
   * (the layer and Overpass, ADR-0134 decision 5).
   */
  osm: OsmSignal & {
    extentFrom: string | null; readAt: string; door?: OsmReaderName;
    /** The extent's own door and time, where it came through another door than the verdict's object (ADR-0134 decision 5). */
    extentDoor?: OsmReaderName; extentReadAt?: string;
  };
  /** The extent's WKT in EPSG:4326, or null where OSM gave none. */
  extentWkt: string | null;
  /**
   * What the card says: which signal carried in a row the tree did not vouch
   * for (#895), and the frame's note where it asks one — a guide's mark, a
   * held place kept while a bar could not be read, or where the surroundings tier
   * measured it. Absent where none speaks.
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
  /**
   * What the door read of every candidate it judged: the facts and the map,
   * which the surroundings tier reads again of a survivor the pool already holds
   * rather than asking twice (`surroundingsSites.ts`).
   */
  read: SiteReading;
}

/** What the door read of the candidates it judged, by item. */
export interface SiteReading {
  /** The rule's verdict on each candidate it judged, with the objects it read it off. */
  judged: ReadonlyMap<string, JudgedSite>;
  /** Each candidate's label, for a sentence that names a place by more than its item. */
  labels: ReadonlyMap<string, string>;
  /** When the map was read, for a site whose objects name no source of their own. */
  readAt: string;
}

/** The rule's verdict on one candidate, and the objects it was read off. */
export interface JudgedSite { verdict: SiteVerdict; objects: OsmObject[] }

/**
 * Archaeology's sites as the place gather reads them (`places/gather.ts`,
 * #1820): the kind's class trees, and the classes whose instances are its
 * candidates — the root in fame bands and the rest of the site tree whole,
 * which is worship's shape and not the museums'. Every class is asked again at
 * the frame's floor of three sitelinks (`admissionPool`, ADR-0176): the pool
 * the world bars are quantiles of, 12,603 sites the rule passes with a point
 * on 2026-11-02 (ADR-0179).
 *
 * The narrow classes are what carry the canon. Troy is `city-state, polis,
 * Bronze Age settlement, settlement site` and Athens is `big city, largest
 * city, metropolis, free city` — neither carries the root, and both are
 * candidates because a class of theirs is under it.
 *
 * The site rule reads facts of its own (`fetchSiteFacts`), so no container is
 * asked about.
 */
export const ARCHAEOLOGY_SITE_KIND: PlaceKind<ArchaeologyTrees> = {
  name: 'archaeological sites',
  trees: fetchArchaeologyTrees,
  poolClasses: (trees) => ({ broad: [SITE_POOL_ROOT], narrow: [...trees.site].filter((cls) => cls !== SITE_ROOT) }),
  readsContainers: false,
  admissionPool: true,
};

/**
 * The site door's pool: the kind's share of the place gather, and the rows
 * only OpenStreetMap named.
 *
 * The map is asked about the rows the class questions named, and a row the
 * source admits that no class question named is one it can still name (#895).
 * Only a row neither entrance named stays a row asked for by id, and `byId`
 * names those, because the collector has to know: a class question vouches
 * that its row is under the tree, and a question by id vouches for nothing but
 * the id.
 */
async function collectPool(
  run: QueryRunner,
  share: KindShare<ArchaeologyTrees>,
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
  const pool = new Map([...share.pool].filter(([qid]) => !share.byId.has(qid)));
  const { byOsm, named, byArticleOnly } = await collectOsmEntrance(run, pool, admitted, entrance);

  const byId = new Set<string>();
  for (const qid of share.byId) {
    if (pool.has(qid)) continue;
    pool.set(qid, share.pool.get(qid)!);
    byId.add(qid);
  }
  return { pool, byId, byOsm, named, byArticleOnly };
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
 * answers `wdt:P31` with nothing. Both are refused before the map is asked
 * about them, by name where the frame names a refusal (`namesRefusal`). A
 * whole batch answering nothing is a different thing — `collectFacts` fails
 * the run on it — so one merged item never stops the run.
 */
function retypedOf(
  candidates: PoolEntity[],
  facts: ReadonlyMap<string, SiteFactsRow>,
  trees: ArchaeologyTrees,
  named: ReadonlyMap<string, OsmObject[]>,
): Set<string> {
  const retyped = new Set<string>();
  for (const entity of candidates) {
    const classes = facts.get(entity.qid)?.classes ?? [];
    if (classes.some((cls) => trees.site.has(cls))) continue;
    // A row OpenStreetMap names is judged by the map's word, with Wikidata's
    // classes as what can contradict it (#895) — whichever question named it
    // first: a class-pool row whose one site statement was deprecated since
    // the pool was read, and whose excavation the map still tags, is the
    // second entrance's to judge, and the refusal below would be false of it.
    if ((named.get(entity.qid)?.length ?? 0) > 0) continue;
    retyped.add(entity.qid);
  }
  return retyped;
}

/**
 * True of both shapes a retyped row can arrive in: one the classes once
 * vouched for and Wikidata has retyped, and one the map once named and no
 * longer does (#895) — a row the map still names never reaches it.
 */
export const RETYPED_REASON = 'no class under archaeological sites on Wikidata, and no OpenStreetMap object tagged as a dig carries it';

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
 * Wikidata changed between the two reads, and `retypedOf` refuses it — and
 * so is the one row of a batch that holds only one: silence on a single row is
 * evidence of nothing, and a tail batch of one (a pool size ending in 1) would
 * otherwise turn one merged item into a run that fails until the day-old pool
 * cache expires. Two or more vouched rows silent at once is what a failed
 * batch looks like.
 */
const SILENT_BATCH_FLOOR = 2;
export async function collectFacts(
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
  };
}

/** Where a candidate stands, or why it cannot be a pin at all. */
export function placementOf(entity: PoolEntity): { lat: number; lon: number } | { reason: string } {
  if (!entity.onEarth) {
    return { reason: 'not on Earth: its coordinate (P625) is on another globe' };
  }
  if (entity.lat === null || entity.lon === null) {
    return { reason: 'no coordinates of its own (P625)' };
  }
  return { lat: entity.lat, lon: entity.lon };
}

export const emptyFacts = (): SiteFactsRow => ({
  classes: [], worldHeritage: false, statesPopulation: false,
});

/**
 * How much of what the mirror was asked about it has to answer for before its
 * answers are read as facts (ADR-0044's shape, for the same reason).
 *
 * The measurement of 2026-09-14: 885 of the 1,126 candidates at the line of
 * the day carry at least one OSM object, which is 79%. The floor is half that share rather
 * than just under it, because the number it exists to catch is *zero* — a
 * renamed `osmkey:` IRI, a rebuilt dataset, the mirror moving host again, any
 * of which answers HTTP 200 with no bindings at all — and a floor set beside
 * the real share would fail the run on an ordinary month's mapping.
 */
const OSM_ANSWER_FLOOR = 0.5;

/**
 * The per-item read that came back too empty to judge anything by — the shape
 * of `OsmEmptyAnswerError` on which the run drops the door's cached answers
 * and, on the mirror, reads the map again through Overpass (`oneDoorPerRun.ts`).
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
 * The objects the rule reads of a candidate: what the map carries under the
 * item — and, where the map's word is what the rule reads, what named it. The
 * per-item read asks by the `wikidata` tag and never sees the object that
 * carried only an article, so the enumeration's objects are merged in by ref.
 * The map's word is read for a row with no class under the tree, whichever
 * question named it first (`retypedOf` and `categoryVotes` draw the same
 * line): a row the map alone vouched for, and a pool row whose site class has
 * since gone. A row that carries a site class is judged as ADR-0058 decision 4
 * judges it, on the objects that carry its item: a ruin node in the Agora
 * whose `wikipedia` tag names Athens would otherwise be the first ruin tag
 * step 2 finds and the city a dig, past the vetoes that exist for that
 * mapping.
 */
function objectsOf(
  qid: string, row: SiteFactsRow, trees: ArchaeologyTrees, byOsm: ReadonlySet<string>,
  objects: ReadonlyMap<string, OsmObject[]>, named: ReadonlyMap<string, OsmObject[]>,
): OsmObject[] {
  const mapsWord = byOsm.has(qid) || !row.classes.some((cls) => trees.site.has(cls));
  return mapsWord ? withNamed(objects.get(qid) ?? [], named.get(qid) ?? []) : objects.get(qid) ?? [];
}

/** The rule's verdict on one candidate, read off its facts and the objects that carry it. */
export function judgeSite(
  entity: PoolEntity, row: SiteFactsRow, objects: OsmObject[], trees: ArchaeologyTrees, namedByCategory = false,
): SiteVerdict {
  return siteVerdict({
    facts: { ...siteFactsOf(entity, row), ...(namedByCategory ? { namedByCategory: true } : {}) },
    objects,
    trees,
  });
}

/** The row the run would write of a candidate the rule passed, with the card's note. */
export function siteCandidateOf(
  entity: PoolEntity,
  verdict: Extract<SiteVerdict, { pass: true }>,
  input: { classes: string[]; objects: OsmObject[]; readAt: string; note?: string },
): SiteCandidate {
  const { objects, readAt } = input;
  const extent = siteExtent(objects);
  const note = [verdict.note, input.note].filter(Boolean).join(' ');
  return {
    entity,
    classes: input.classes,
    osm: { ...verdict.osm, ...provenanceOf(objects, verdict.osm.object, readAt), ...extentProvenanceOf(objects, verdict.osm, readAt) },
    extentWkt: extent ? extent.wkt : null,
    ...(note ? { note } : {}),
  };
}

const candidateOf = (entity: PoolEntity): WorldCandidate => ({ qid: entity.qid, editions: entity.sitelinks });

/**
 * Where one candidate the rule judged ends: the row the run would write, the
 * refusal a curator reads, or nothing. A refusal is named where the frame
 * names one (`namesRefusal`): a row the source holds, one the shared pool named
 * at its floor, or one a bar would admit. The rest is the long tail of the
 * pool, and naming a living village there would bury the refusals a curator
 * has to read — Athens, Cairo, Rhodes, Sabratha.
 */
function settle(
  entity: PoolEntity,
  verdict: SiteVerdict,
  input: { held: boolean; osmOnly: boolean; tier: WorldTier; classes: string[]; objects: OsmObject[]; readAt: string },
): SiteCandidate | SiteRefusal | null {
  const { held, tier } = input;
  const c = candidateOf(entity);
  const refusal = (reason: string, group: SiteRefusalGroup): SiteRefusal | null =>
    (namesRefusal(c, held, tier) ? { externalId: entity.qid, name: entity.label, reason, group } : null);
  if (!verdict.pass) return 'out' in verdict ? null : refusal(verdict.reason, verdict.group);
  const at = placementOf(entity);
  if ('reason' in at) {
    // A row only the map named that has no coordinate claimed no place — a
    // mapper's tag naming a person, a class, an event — and is out, never
    // refused: dry run 136 named 43 such rows, "tumulus" and "Nikola Tesla"
    // among them. A held row that lost its coordinate is still named.
    if (input.osmOnly && !held) return null;
    return refusal(at.reason, 'placeless');
  }
  const stands = tier.standing(c, held);
  if (stands === 'out') return null;
  if ('fell' in stands) return { externalId: entity.qid, name: entity.label, reason: stands.fell, group: 'under-the-bars' };
  return siteCandidateOf(entity, verdict, { ...input, note: tier.noteOf(c, stands) });
}

/** The refusal of a retyped row (`retypedOf`), where the frame names one. */
function retypedRefusal(entity: PoolEntity, held: boolean, tier: WorldTier): SiteRefusal | null {
  return namesRefusal(candidateOf(entity), held, tier)
    ? { externalId: entity.qid, name: entity.label, reason: RETYPED_REASON, group: 'class-or-name' }
    : null;
}

/**
 * The sites this run admits to the world tier, and every candidate the rule
 * or the bars refused that is worth naming, with the reason.
 *
 * The rule runs over every candidate first, since the world bars are
 * quantiles of the sites it passes (ADR-0175, ADR-0179): every item of the
 * site classes with a point and at least three sitelinks that a class question
 * of the kind named (`inPool`). A row only the map named, or only asked for by
 * id, is decided by the bars but does not set them (ADR-0176 decision 3).
 * Candidates are judged most famous first, which is the order the refusals
 * are reported in.
 *
 * `admitted` is what the source's world tier holds as **sites**, not as
 * museums. One source fills both doors, and the museums are the other door's
 * to ask after: asked for by id here, a museum the museum door had stopped
 * admitting — folded, vetoed, no longer a museum to Wikipedia — would carry no
 * kill class, no OSM signal and no settlement class, reach the final admit of
 * step 4, and be written as a site. A row the surroundings tier holds is that
 * tier's (`surroundingsSites.ts`). `world` hands a run the source's history, for
 * what it cannot read (ADR-0175 decision 6), and a test the world's signals
 * and the bars where it is not about the pool (`WorldOptions`).
 */
export async function collectSitesByFame(
  run: QueryRunner,
  share: KindShare<ArchaeologyTrees>,
  admitted: ReadonlySet<string>,
  osm: OsmReader,
  entrance: SiteEntrance,
  world?: WorldOptions,
): Promise<SitesByFame> {
  const { trees } = share;
  const { pool, byId, byOsm, named, byArticleOnly } = await collectPool(run, share, admitted, entrance);
  const qids = [...pool.keys()];
  // Vouched for by a class question or by the map: a row asked for by id
  // vouches for nothing but the id. A row the map named carries no class
  // under the tree by its shape, but an item answers *something* — a class,
  // a listing, a population — and every veto the second entrance reads is
  // read off those facts, so a batch of such rows that answers nothing is
  // the same quiet failure, with a comune walking in on the map's note.
  const facts = await collectFacts(run, qids, (qid) => !byId.has(qid));
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  const retyped = retypedOf(candidates, facts, trees, named);

  // One read, here: after the pool is known and before a single verdict, of
  // every candidate the rule can judge, since the bars are read over what it
  // passes. The run's time is what a site's row stores where its objects name
  // no source of their own (a live door's read, asked once); the layer's door
  // stamps each object with its door and time (`provenanceOf`, ADR-0059
  // decision 2).
  const asked = candidates.filter((entity) => !retyped.has(entity.qid)).map((entity) => entity.qid);
  const objects = await osm(asked, OSM_KEEP_WKT, run);
  const readAt = new Date().toISOString();
  // After the read, since a place used today is said so by its objects (#1352).
  const namedByCategory = await categoryVotes(run, candidates, facts, trees, named, entrance, objects);

  // **And an empty answer is not a fact.** A mirror that answers 200 with no
  // bindings says "no OSM object carries this item" about every candidate at
  // once, which is exactly the sentence that refuses the settlement branch,
  // and the sweep would then withdraw the sites the ruin signal admits. So the
  // share that came back with an object is counted before any verdict is
  // taken, and a run below the floor fails with its own name on it. Measured
  // on the rows the read can be expected to answer about. An item under
  // `byItem` carries the `wikidata` tag on a dig, so the read answers about it
  // or is silent for the reason the floor exists. An item the enumeration
  // reached through an article alone may carry the tag on some other object
  // or on none — Nemrut's peak node carries the item while its tumulus
  // carries the article — so its silence is evidence neither way, and it is
  // counted on neither side (#895).
  const measured = asked.filter((qid) => !byArticleOnly.has(qid));
  const answered = measured.filter((qid) => (objects.get(qid)?.length ?? 0) > 0).length;
  if (measured.length > 0 && answered / measured.length < OSM_ANSWER_FLOOR) {
    throw new OsmAnswerFloorError(measured.length, answered);
  }

  const verdicts = new Map<string, JudgedSite>();
  for (const entity of candidates) {
    if (retyped.has(entity.qid)) continue;
    const row = facts.get(entity.qid) ?? emptyFacts();
    const read = objectsOf(entity.qid, row, trees, byOsm, objects, named);
    verdicts.set(entity.qid, { verdict: judgeSite(entity, row, read, trees, namedByCategory.has(entity.qid)), objects: read });
  }
  const tier = await openWorldTier({
    pool: candidates.filter((entity) => verdicts.get(entity.qid)?.verdict.pass && inPool(share, entity.qid, entity)).map(candidateOf),
    qids: candidates.map((entity) => entity.qid),
    poolRead: share.admissionPool !== null,
    sparql: run.sparql,
    logPrefix: LOG_PREFIX,
    ...world,
  });

  const sites = new Map<string, SiteCandidate>();
  const filtered: SiteRefusal[] = [];
  for (const entity of candidates) {
    const held = admitted.has(entity.qid);
    const judged = verdicts.get(entity.qid);
    const settled = judged
      ? settle(entity, judged.verdict, {
        held, osmOnly: byOsm.has(entity.qid), tier, classes: facts.get(entity.qid)?.classes ?? [], objects: judged.objects, readAt,
      })
      : retypedRefusal(entity, held, tier);
    if (settled === null) continue;
    if ('group' in settled) filtered.push(settled);
    else sites.set(entity.qid, settled);
  }

  // What the run admitted is said once, by `reportProposal`, where the museums
  // are counted too: two lines with the same number in them is one line a
  // reader has to reconcile with the other.
  const labels = new Map(candidates.map((entity) => [entity.qid, entity.label]));
  return { sites, filtered, fetched: new Set(qids), read: { judged: verdicts, labels, readAt } };
}
