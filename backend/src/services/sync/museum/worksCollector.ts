/**
 * The stages every works kind shares over its share of the gather of works
 * (`worksGather.ts`, #1821): keep the works this kind calls its own, add the
 * ones it names under the pool's floor, build the venue graph their
 * statements name under the kind's own rule, place each work in the venue
 * that survives resolution, and fold the venues that are one visit.
 *
 * A kind that admits churches for the works they hold — relics, tombs — needs
 * them with its own `VenueRule`; `worksOf` parameterises the whole thing, and
 * a caller gets back the pool, the graph and the placements to do its own tail
 * with — the museum's art test and tier among them, still in `pipeline.ts`.
 */

import { collectStatements, gatherWorks, worksShare, type GatheredWorks, type WorksRequest } from './worksGather.js';
import { placeArtwork, whereaboutsUnknown } from './placement.js';
import type { VenueRule } from './venueTest.js';
import type { Fold } from './venueFolds.js';
import type { Resolution } from './resolveVenue.js';
import {
  loadVenueGraph,
  makeResolver,
  foldVenues,
  applyFolds,
  type VenueGraph,
} from './venueGraph.js';
import type { PoolWork, RawStatement } from './queries.js';
import {
  fetchEnglishArticles,
  unique,
  type QueryRunner,
} from '../wikidataQueries.js';
import type { ProcessedContent } from '../types.js';

/**
 * The three classes broad enough that no single query can hold them — `painting` alone has half
 * a million instances — so each is asked in fame bands instead. Their labels double as the
 * treasure type a reader sees.
 */
export const MUSEUM_BROAD_ROOTS = [
  { qid: 'Q3305213', type: 'painting' },
  { qid: 'Q860861', type: 'sculpture' },
  { qid: 'Q179700', type: 'statue' },
];

/**
 * More roots, narrow enough to take whole.
 *
 * No closure reaches them from the three above — a print is not a kind of painting — so leaving
 * them out removes whole traditions rather than trimming a tail. Without them the catalogue
 * holds **zero** prints, engravings, drawings, mosaics and tapestries, and Japanese printmaking
 * is absent as a class. That is not a boundary anyone drew.
 *
 * The last five are what Asian and Islamic collections and treasuries are known for, which no
 * root above reaches (#2150): jade, ritual bronzes (`ding`), illuminated manuscripts, carpets
 * and jewels (`brilliant`). They bring the Green Vault (the Dresden Green Diamond) and the
 * National Museum of Bosnia and Herzegovina (the Sarajevo Haggadah), and on the subset of
 * 2026-10-30 no venue a traveller would not call a museum. The art test counts each as a work
 * that is not sculptural. Places of worship reads the same roots: they admit no new place
 * there, and add the Lichfield Gospels to Lichfield Cathedral, where they are shown. A library's
 * codices stay in the library (`readingRooms`).
 *
 * Taken whole in one query each batch, because they are narrow enough to scan directly — no
 * bands, and no ownership requirement: losing a work on the way in is worse than deciding later
 * that it has no placeable venue.
 */
export const MUSEUM_WHOLE_ROOTS = [
  { qid: 'Q93184', type: 'drawing' },
  { qid: 'Q11060274', type: 'print' },
  { qid: 'Q133067', type: 'mosaic' },
  { qid: 'Q184296', type: 'tapestry' },
  { qid: 'Q60733799', type: 'jade object' },
  { qid: 'Q48498', type: 'illuminated manuscript' },
  { qid: 'Q1204499', type: 'ding' },
  { qid: 'Q163446', type: 'carpet' },
  { qid: 'Q429571', type: 'brilliant' },
];

/**
 * Classes no closure can reach, because they are not kinds of work.
 *
 * A painting series and a group of casts are *collections* of works, so they sit outside the
 * subclass tree under any single work — and they are where several of the most famous things
 * in the catalogue live: Monet's Water Lilies, Van Gogh's Sunflowers, Rodin's Thinker. Without
 * the pin all three are missing, checked by name rather than by QID. A cycle of frescoes and a
 * group of sculptures are the same shape: the Raphael Rooms, which every visitor to the Vatican
 * Museums queues for, and the Benin Bronzes (#1615).
 *
 * The panel forms are here as a floor rather than a necessity: most are reachable under
 * painting, and pinning them means no future tightening of the growth rule can drop them
 * silently. Every QID below was verified against Wikidata — label and description both, on
 * 2026-08-07, and the two collection classes of #1615 by label and `P279` in the local subset
 * on 2026-10-19 — rather than assumed from a name, because "engraving" names a technique and an
 * object with different entities for each.
 */
export const MUSEUM_PINNED_CLASSES: Record<string, string> = {
  Q15727816: 'painting series',
  Q16905550: 'cycle of frescoes',
  Q28890616: 'group of casts',
  Q2293362: 'group of sculptures',
  Q79218: 'triptych',
  Q1278452: 'polyptych',
  Q475476: 'diptych',
  Q15711026: 'altarpiece',
  Q11801536: 'winged altarpiece',
  Q28913685: 'woodblock print',
  // The object, not the technique: the label is also the type a reader sees
  Q11835431: 'engraving',
};

/**
 * The root whose subtree means "this exists in an edition, not as one original".
 *
 * Asked of the tree rather than of a label: the closure records which root each class was
 * reached from, so etching, lithograph, screenprint and woodblock print answer yes without
 * being listed here, and a class labelled "engraving" answers according to which entity it
 * actually is.
 */
export const EDITION_ROOT = 'Q11060274';

/**
 * Pinned classes that are editions, which the tree cannot say because nothing reached them.
 * A cast is to a sculpture what an impression is to a plate.
 */
export const MUSEUM_PINNED_EDITION_CLASSES = new Set(['Q28890616', 'Q28913685', 'Q11835431']);

/** What Art Museums asks the gather of works for (#1821); Places of worship asks it too, with its relics and tombs beside it. */
export const MUSEUM_WORKS: WorksRequest = {
  broadRoots: MUSEUM_BROAD_ROOTS,
  wholeRoots: MUSEUM_WHOLE_ROOTS,
  pinned: MUSEUM_PINNED_CLASSES,
  pinnedEditionClasses: MUSEUM_PINNED_EDITION_CLASSES,
  editionRoot: EDITION_ROOT,
};

export { LOST_WORK_ROOT } from './worksGather.js';

/**
 * Works of the lost tree whose remains are on show, kept by name with the
 * reason — the shape `EDITORIAL_OUT` uses in the other direction.
 *
 * `destroyed artwork` says the original is gone, and of the six works at ten
 * sitelinks or more typed only that (2026-09-12: *The Stone Breakers*, the
 * *World Trade Center Tapestry*, Sutherland's *Portrait of Winston Churchill*,
 * Klimt's University ceiling, *The Floating Piers* and this one) it is right
 * for five. A standing venue statement does not tell the sixth apart — the
 * tapestry and Prague's Stalin Monument carry one too — so the exception is a
 * name. A marked link has no curator's verdict to bring it back until #749,
 * which is why this list exists rather than a curator's hand.
 */
export const REMAINS_ON_SHOW: Record<string, string> = {
  Q1289781: 'Colossus of Constantine — its head, hand and foot stand in the courtyard of the Capitoline Museums',
};

/** Why a work of the pool is placed nowhere: its whereabouts, or its class. */
export const WHEREABOUTS_UNKNOWN = 'whereabouts unknown';

/** The width of `treasures.treasure_type`. */
const TREASURE_TYPE_MAX = 50;

export interface WorksCollectorOptions extends WorksRequest {
  /**
   * What this kind calls the things it collects, singular and plural, for the
   * phase lines a person watches: `work of art`/`artworks` for a museum,
   * `treasure`/`treasures` for a place of worship. "Fetching narrow artwork
   * classes" is the wrong sentence over a run collecting relics and tombs.
   */
  noun: { work: string; works: string };
  rule: VenueRule;
  logPrefix: string;
  /**
   * What else the kind needs to know about each work of the pool before it can
   * say which of them are its own: the classes the item carries and where it
   * was discovered. Asked once, of the whole pool, and it batches inside
   * itself — the pool is tens of thousands of QIDs.
   *
   * Optional, because a kind that keeps everything it collects needs nothing
   * beyond the pool row. The facts are handed to `keep` and not kept here: a
   * caller that needs them again — the discovery place goes on the treasure —
   * holds them in the closure it passes.
   */
  workFacts?: (run: QueryRunner, qids: string[]) => Promise<Map<string, WorkFacts>>;
  /**
   * Which works of the pool are this kind's. Applied before the venue
   * statements are read, so a work that is dropped costs no query.
   *
   * The art pool is collected whole by the roots above and then cut: the
   * Archaeology kind reads sculpture and statue in bands the way the art
   * museums do, and keeps the ones that were dug up. Absent, nothing is
   * dropped and the pool is the collection, which is what the art museums and
   * the places of worship ask for.
   */
  keep?: (work: PoolWork, facts: WorkFacts | undefined) => boolean;
  /**
   * Works under the pool's floor the kind wants asked about all the same,
   * read once the pool is collected and `keep` has run over it: the finds the
   * year reads at the finds door's bar in fewer editions than the floor
   * (ADR-0165). The pool handed in is the kept one, the tier the kind's doors
   * read, and every joiner goes through the same `keep` before it is placed
   * and counted as any pool work is. Absent, the pool is what the classes
   * collect.
   */
  underFloor?: (run: QueryRunner, pool: ReadonlyMap<string, PoolWork>) => Promise<PoolWork[]>;
}

/**
 * What a kind's `keep` is told about a work beyond its pool row: every `P31`
 * the item carries, and its discovery place (`P189`) where it has one.
 *
 * Defined here rather than in the kind that needs it, because the hook above is
 * this module's: nothing under `museum/` may import from a kind's directory.
 */
export interface WorkFacts {
  classes: string[];
  discoveryPlace: { qid: string; label: string } | null;
}

export interface WorksCollection {
  pool: Map<string, PoolWork>;
  statements: Map<string, RawStatement[]>;
  graph: VenueGraph;
  editionClasses: ReadonlySet<string>;
  resolver: { resolve: (qid: string) => string | null; resolution: (qid: string) => Resolution; keptBack: (qid: string) => boolean };
  /**
   * placeArtwork over every work of the pool with the resolver above — except
   * a work that cannot be seen, which is placed nowhere (`unseen`).
   */
  placed: Record<string, string[]>;
  /**
   * The works placed nowhere because nobody can see them (#868): why, and
   * where the statements would have put them, so a kind can name what a venue
   * lost when it is refused for holding nothing else.
   */
  unseen: Record<string, UnseenWork>;
  folds: Record<string, Fold>;
  afterFolds: Record<string, string[]>;
  /**
   * Every class the pool asked for: the closure, the pinned classes and the
   * extra ones. What the venue-side read (`venueSide.ts`, #890) keeps of an
   * admitted venue's holdings for a kind with no `keep` of its own — the
   * pool's own vocabulary, asked of an object the class questions never
   * reached.
   */
  askedClasses: ReadonlySet<string>;
  /** The lost tree (`LOST_WORK_ROOT`), for the same read to ask of an object's own classes. */
  lostClasses: ReadonlySet<string>;
  /**
   * The pool works the kind's `keep` turned down, by id. The pool's decision
   * stands, kept or refused: the venue-side read skips these as it skips what
   * the pool kept, rather than re-fetching a painting the find rule already
   * refused and naming it twice on the report.
   */
  refusedByKeep: ReadonlySet<string>;
}

export interface UnseenWork {
  /** `WHEREABOUTS_UNKNOWN`, or the lost-tree class the work carries (`lost painting`). */
  reason: string;
  /** Where `placeArtwork` would have put it, read as if it could be seen. */
  wouldBe: string[];
}

/**
 * Cut the pool down to the works this kind keeps, in place.
 *
 * Between the pool and the placement, and deliberately: a kind decides on the
 * pool row and the facts it asks for, before any venue is walked for a work it
 * drops. A kind with no `keep` leaves with the pool it collected, and one with
 * no `workFacts` decides on the pool row alone.
 */
async function keepOurs(
  run: QueryRunner,
  pool: Map<string, PoolWork>,
  opts: WorksCollectorOptions,
): Promise<Set<string>> {
  const refused = new Set<string>();
  if (!opts.workFacts && !opts.keep) return refused;
  const facts = opts.workFacts
    ? await opts.workFacts(run, [...pool.keys()])
    : new Map<string, WorkFacts>();
  const keep = opts.keep;
  if (!keep) return refused;
  const collected = pool.size;
  for (const [qid, work] of pool) {
    if (!keep(work, facts.get(qid))) {
      pool.delete(qid);
      refused.add(qid);
    }
  }
  console.log(
    `${opts.logPrefix} Kept ${pool.size} of ${collected} pool works as ${opts.noun.works}`,
  );
  return refused;
}

/**
 * Every work of the pool placed, less the ones nobody can see.
 *
 * A work whose whereabouts the source calls unknown, or that carries a class of
 * the lost tree, is placed nowhere and recorded with its reason and the venues
 * its statements still remember — the older venue is exactly what the reader
 * must not be sent to. `REMAINS_ON_SHOW` is the one exception, by name.
 */
function placeWorks(
  pool: Map<string, PoolWork>,
  statements: Map<string, RawStatement[]>,
  lost: ReadonlyMap<string, string>,
  resolve: (qid: string) => string | null,
  ancestors: (qid: string) => ReadonlySet<string>,
  keptBack: (qid: string) => boolean,
  standsForHouses: (qid: string) => boolean,
): { placed: Record<string, string[]>; unseen: Record<string, UnseenWork> } {
  const placed: Record<string, string[]> = {};
  const unseen: Record<string, UnseenWork> = {};
  for (const qid of pool.keys()) {
    const own = statements.get(qid) ?? [];
    const venues = placeArtwork(own, resolve, ancestors, keptBack, standsForHouses);
    const reason = unseenReason(qid, own, lost);
    if (reason === null) {
      placed[qid] = venues;
    } else {
      placed[qid] = [];
      unseen[qid] = { reason, wouldBe: venues };
    }
  }
  return { placed, unseen };
}

/**
 * Why a work is placed nowhere, or null where it can be seen. Exported for the
 * venue-side read, which places an object it kept by the rule a pool work is
 * placed by — the lost class it hands in is read off the object's own classes.
 */
export function unseenReason(
  qid: string,
  statements: RawStatement[],
  lost: ReadonlyMap<string, string>,
): string | null {
  if (REMAINS_ON_SHOW[qid]) return null;
  if (whereaboutsUnknown(statements)) return WHEREABOUTS_UNKNOWN;
  return lost.get(qid) ?? null;
}

export function heldBy(
  pool: Map<string, PoolWork>,
  placements: Record<string, string[]>,
): Map<string, PoolWork[]> {
  const held = new Map<string, PoolWork[]>();
  for (const work of pool.values()) {
    for (const venue of placements[work.qid] ?? []) {
      const list = held.get(venue) ?? [];
      list.push(work);
      held.set(venue, list);
    }
  }
  for (const list of held.values()) list.sort((a, b) => b.sitelinks - a.sitelinks);
  return held;
}

/**
 * The English Wikipedia article of every work a run will write (#1608), set on
 * its content as `wikipediaUrl` (`null` where it has none). Asked of the
 * contents of the admitted venues once those are settled, so of the works a
 * card will show, the objects the venue-side read brought (#890) included,
 * and of nothing else in the pool.
 */
export async function withEnglishArticles(run: QueryRunner, contents: ProcessedContent[]): Promise<void> {
  const qids = unique(contents.map((content) => content.externalId));
  if (!qids.length) return;
  run.phase(`Reading the English articles of ${qids.length} works...`);
  const articles = await fetchEnglishArticles(run.sparql, qids, run.step);
  for (const content of contents) content.wikipediaUrl = articles.get(content.externalId) ?? null;
}

/** The treasure a venue's work becomes. */
export function toContent(work: PoolWork): ProcessedContent {
  return {
    externalId: work.qid,
    name: work.label,
    // `treasures.treasure_type` is varchar(50) and the type is now a Wikidata class label rather
    // than one of two literals: "Anthropomorphic wooden cult figurines of Central and Northern
    // Europe" (Q574422) is 68 characters. An over-long value would make the insert throw, which
    // the orchestrator would record as the whole venue failing, losing its remaining treasures
    // with it. A clipped display string is the cheaper failure.
    treasureType: work.type.slice(0, TREASURE_TYPE_MAX),
    artists: work.creators,
    year: work.year,
    imageUrl: work.imageUrl,
    sitelinksCount: work.sitelinks,
    ...(work.handedBy ? { handedBy: work.handedBy } : {}),
    ...(work.placedBy !== undefined ? { placedBy: work.placedBy } : {}),
  };
}

/**
 * The works the kind names under the pool's floor, joining the kept pool
 * (`underFloor`) through the kind's own `keep`: what it refuses is refused by
 * name, as a pool work is.
 */
async function addUnderFloor(
  run: QueryRunner, pool: Map<string, PoolWork>, refusedByKeep: Set<string>, opts: WorksCollectorOptions,
): Promise<void> {
  if (!opts.underFloor) return;
  const joining = new Map(
    (await opts.underFloor(run, pool)).filter((work) => !pool.has(work.qid)).map((work) => [work.qid, work]),
  );
  if (!joining.size) return;
  for (const qid of await keepOurs(run, joining, opts)) refusedByKeep.add(qid);
  for (const [qid, work] of joining) pool.set(qid, work);
  console.log(`${opts.logPrefix} Under the pool's floor: ${joining.size} read at the door's bar, joining the pool`);
}

/**
 * A kind's works out of the gather (`worksGather.ts`, #1821): its share, the
 * works it keeps of it and those it names under the pool's floor, placed in
 * the venues its own rule walks to, and folded.
 *
 * The venue graph stays the kind's: what the walk follows depends on the
 * kind's rule (a place of worship's chapel, a museum's rooms), so one graph
 * for every kind would answer a fold or a house differently. The walk itself
 * is the one resolver of #1819.
 */
export async function worksOf(
  run: QueryRunner, gathered: GatheredWorks, opts: WorksCollectorOptions,
): Promise<WorksCollection> {
  const { pool, classes, narrowAndExtra } = worksShare(gathered, opts);
  console.log(
    `${opts.logPrefix} Artwork classes: ${classes.all.length} (${classes.edition.size} of them editions); `
    + `${pool.size} works as ${opts.noun.works}`,
  );
  const refusedByKeep = await keepOurs(run, pool, opts);
  await addUnderFloor(run, pool, refusedByKeep, opts);
  // The gather read the statements of its pool; a work joining under the floor is read here.
  const unread = [...pool.keys()].filter((qid) => !gathered.statements.has(qid) && !gathered.pool.has(qid));
  const joined = unread.length ? await collectStatements(run, unread) : new Map<string, RawStatement[]>();
  const statements = new Map<string, RawStatement[]>();
  for (const qid of pool.keys()) {
    const own = gathered.statements.get(qid) ?? joined.get(qid);
    if (own) statements.set(qid, own);
  }
  const lost = new Map([...pool.keys()].flatMap((qid) => {
    const type = gathered.lostPool.get(qid);
    return type === undefined ? [] : [[qid, type] as const];
  }));
  // An unknown value names no venue to load.
  const seeds = unique(
    [...statements.values()].flat().map((s) => s.venue).filter((v): v is string => v !== null),
  );
  const graph = await loadVenueGraph(run, seeds, opts.rule);
  const resolver = makeResolver(graph, opts.rule);
  run.phase('Placing works in the venues that hold them...');
  const { placed, unseen } = placeWorks(
    pool, statements, lost, resolver.resolve, graph.ancestors, resolver.keptBack, resolver.standsForHouses,
  );
  const unseenCount = Object.keys(unseen).length;
  const lostCount = Object.values(unseen).filter((u) => u.reason !== WHEREABOUTS_UNKNOWN).length;
  console.log(
    `${opts.logPrefix} Works nobody can see, placed nowhere: ${unseenCount} `
    + `(${unseenCount - lostCount} of unknown whereabouts, ${lostCount} lost or destroyed)`,
  );
  const folds = foldVenues(placed, graph, opts.rule);
  return {
    pool, statements, graph, editionClasses: classes.edition, resolver, placed, unseen, folds,
    afterFolds: applyFolds(placed, folds),
    askedClasses: new Set([...classes.all, ...narrowAndExtra]),
    lostClasses: gathered.lostClasses,
    refusedByKeep,
  };
}

/** One kind's works, gathered for it alone: what a run outside a pass, and a spec, reads. */
export async function collectWorks(run: QueryRunner, opts: WorksCollectorOptions): Promise<WorksCollection> {
  return worksOf(run, await gatherWorks(run, [opts], { logPrefix: opts.logPrefix, noun: opts.noun }), opts);
}
