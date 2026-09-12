/**
 * The stages every works-first kind shares: find the classes a work of its kind can be, collect
 * the pool of works, read the venue statements they carry, build the venue graph those
 * statements name, place each work in the venue that survives resolution, and fold the venues
 * that are one visit.
 *
 * This is what `museum/pipeline.ts` used to do end to end, before a kind that admits churches for
 * the works they hold — relics, tombs — needed the same stages with its own `VenueRule` and its
 * own extra classes, asked whole beside the narrow ones without a closure. `collectWorks`
 * parameterises the whole thing; a caller supplies its roots, its pinned classes and its rule,
 * and gets back the pool, the graph and the placements to do its own tail with — the museum's
 * art test and tier among them, still in `pipeline.ts`.
 */

import { boundedClosure, type ClosureOptions } from '../classClosure.js';
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
import {
  fetchBroadPool,
  fetchClassPool,
  fetchVenueStatements,
  type PoolWork,
  type RawStatement,
} from './queries.js';
import {
  fetchSubclasses,
  fetchClassTree,
  chunk,
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
 * Four more roots, narrow enough to take whole.
 *
 * No closure reaches them from the three above — a print is not a kind of painting — so leaving
 * them out removes whole traditions rather than trimming a tail. Without them the catalogue
 * holds **zero** prints, engravings, drawings, mosaics and tapestries, and Japanese printmaking
 * is absent as a class. That is not a boundary anyone drew.
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
];

/**
 * Classes no closure can reach, because they are not kinds of work.
 *
 * A painting series and a group of casts are *collections* of works, so they sit outside the
 * subclass tree under any single work — and they are where several of the most famous things
 * in the catalogue live: Monet's Water Lilies, Van Gogh's Sunflowers, Rodin's Thinker. Without
 * the pin all three are missing, checked by name rather than by QID.
 *
 * The panel forms are here as a floor rather than a necessity: most are reachable under
 * painting, and pinning them means no future tightening of the growth rule can drop them
 * silently. Every QID below was verified against Wikidata on 2026-08-07 — label and
 * description both — rather than assumed from a name, because "engraving" names a technique
 * and an object with different entities for each.
 */
export const MUSEUM_PINNED_CLASSES: Record<string, string> = {
  Q15727816: 'painting series',
  Q28890616: 'group of casts',
  Q79218: 'triptych',
  Q1278452: 'polyptych',
  Q475476: 'diptych',
  Q15711026: 'altarpiece',
  Q11801536: 'winged altarpiece',
  Q28913685: 'woodblock print',
  Q11835431: 'engraving (the object, not the technique)',
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

/**
 * The root of the classes a work that no longer exists carries: `lost artwork`
 * (Q4140840), whose `P279*` tree is `destroyed artwork`, `lost sculpture` and
 * `lost painting` (measured 2026-09-12: four classes, read whole by
 * `fetchClassTree` and never pinned, so a class Wikidata adds under it counts).
 *
 * A work in it admits no venue and is nobody's treasure (#868): the Isabella
 * Stewart Gardner Museum was in the world tier for *The Storm on the Sea of
 * Galilee*, stolen in 1990 and never found, and a traveller who went for it
 * would find an empty frame. Read off the work's own classes rather than off
 * the class it was collected under, because the closure under `painting`
 * reaches `lost painting` but not `lost artwork`: *Portrait of a Courtesan* is
 * a `painting` and a `lost artwork`, and arrives typed `painting`. A theft
 * (`P793`) is deliberately not read — 414 of 425 theft events carry no end
 * time, and most of those works were recovered long ago.
 *
 * Places of worship reads the same tree through the same stage: the Statue of
 * Zeus at Olympia opens no door for its temple (ADR-0052 decision 3).
 */
export const LOST_WORK_ROOT = 'Q4140840';

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

const CLASS_BATCH = 25;
const STATEMENT_BATCH = 50;
/** The width of `treasures.treasure_type`. */
const TREASURE_TYPE_MAX = 50;

export interface WorksCollectorOptions {
  /** The broad roots asked in fame bands, with the treasure type their label gives. */
  broadRoots: { qid: string; type: string }[];
  /** Roots narrow enough to take whole (drawing, print, …). */
  wholeRoots: { qid: string; type: string }[];
  /** Classes no closure reaches, pinned by name (label for the log). */
  pinned: Record<string, string>;
  /** Classes asked whole beside the narrow ones, without a closure: a kind's own roots (relic, tomb). */
  extraClasses?: Record<string, string>;
  /** Pinned classes that are editions. */
  pinnedEditionClasses: ReadonlySet<string>;
  editionRoot: string;
  /**
   * What this kind calls the things it collects, singular and plural, for the
   * phase lines a person watches: `work of art`/`artworks` for a museum,
   * `treasure`/`treasures` for a place of worship. "Fetching narrow artwork
   * classes" is the wrong sentence over a run collecting relics and tombs.
   */
  noun: { work: string; works: string };
  rule: VenueRule;
  closure?: ClosureOptions;
  logPrefix: string;
}

export interface WorksCollection {
  pool: Map<string, PoolWork>;
  statements: Map<string, RawStatement[]>;
  graph: VenueGraph;
  editionClasses: ReadonlySet<string>;
  resolver: { resolve: (qid: string) => string | null; resolution: (qid: string) => Resolution };
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
}

export interface UnseenWork {
  /** `WHEREABOUTS_UNKNOWN`, or the lost-tree class the work carries (`lost painting`). */
  reason: string;
  /** Where `placeArtwork` would have put it, read as if it could be seen. */
  wouldBe: string[];
}

interface ArtworkClasses {
  all: string[];
  /** Classes whose works exist in editions rather than as a single original. */
  edition: ReadonlySet<string>;
}

async function artworkClassesOf(
  run: QueryRunner,
  opts: WorksCollectorOptions,
): Promise<ArtworkClasses> {
  run.phase(`Finding the classes a ${opts.noun.work} can be...`);
  const artworkRoots = [...opts.broadRoots, ...opts.wholeRoots];
  const { classes, refused, byRoot } = await boundedClosure(
    artworkRoots.map((r) => r.qid),
    async (qids) => {
      await run.step();
      return fetchSubclasses(run.sparql, qids);
    },
    opts.closure,
  );
  for (const r of refused) {
    console.log(
      `${opts.logPrefix} Class closure stopped at ${r.root} hop ${r.hop}: ${r.offered} classes offered`,
    );
  }
  const all = [...new Set([...classes, ...Object.keys(opts.pinned)])];
  const edition = new Set([...(byRoot[opts.editionRoot] ?? []), ...opts.pinnedEditionClasses]);
  console.log(`${opts.logPrefix} Artwork classes: ${all.length} (${edition.size} of them editions)`);
  return { all, edition };
}

/**
 * A narrow class names a work better than the root it also instantiates, so it wins the type;
 * everything else fills a gap rather than overwriting an answer.
 */
function mergeWork(existing: PoolWork, incoming: PoolWork, broadTypes: ReadonlySet<string>): void {
  if (broadTypes.has(existing.type) && !broadTypes.has(incoming.type)) {
    existing.type = incoming.type;
    // The qid travels with the label it explains, or the medium test would be
    // answered about a class the reader is not being shown.
    existing.typeQid = incoming.typeQid;
  }
  if (!existing.imageUrl) existing.imageUrl = incoming.imageUrl;
  // A list, and still a gap being filled rather than an answer overwritten: both
  // answers are the same work's `P170` statements, and a short one can only come
  // from a truncated pool, which `failIfTruncated` refuses outright.
  if (existing.creators.length === 0) existing.creators = incoming.creators;
  if (existing.year === null) existing.year = incoming.year;
  if (incoming.sitelinks > existing.sitelinks) existing.sitelinks = incoming.sitelinks;
}

async function collectPool(
  run: QueryRunner,
  classes: string[],
  opts: WorksCollectorOptions,
): Promise<Map<string, PoolWork>> {
  const broadTypes = new Set([...opts.broadRoots, ...opts.wholeRoots].map((r) => r.type).concat('artwork'));
  const pool = new Map<string, PoolWork>();
  const add = (works: PoolWork[]) => {
    for (const work of works) {
      const existing = pool.get(work.qid);
      if (existing) mergeWork(existing, work, broadTypes);
      else pool.set(work.qid, { ...work });
    }
  };

  // Each broad root paces and reports its own bands: they are minutes apart, not seconds.
  for (const root of opts.broadRoots) {
    add(await fetchBroadPool(run, root));
  }

  // Everything the broad fetch did not already cover: the whole roots the closure found, and any
  // extra classes asked without a closure at all — a kind's own roots, such as relic or tomb.
  // Deduped: an extra class the closure also reached would otherwise be asked for twice.
  const narrow = classes.filter((c) => !opts.broadRoots.some((r) => r.qid === c));
  const extra = Object.keys(opts.extraClasses ?? {});
  const batches = chunk(unique([...narrow, ...extra]), CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching narrow classes of ${opts.noun.works} ${i + 1}/${batches.length}...`);
    await run.step();
    add(await fetchClassPool(run.sparql, batches[i]));
  }

  console.log(`${opts.logPrefix} Pool: ${pool.size} works`);
  return pool;
}

async function collectStatements(
  run: QueryRunner,
  workQids: string[],
): Promise<Map<string, RawStatement[]>> {
  const byWork = new Map<string, RawStatement[]>();
  const batches = chunk(workQids, STATEMENT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Reading venue statements ${i + 1}/${batches.length}...`);
    await run.step();
    for (const statement of await fetchVenueStatements(run.sparql, batches[i])) {
      const held = byWork.get(statement.work) ?? [];
      held.push(statement);
      byWork.set(statement.work, held);
    }
  }
  return byWork;
}

/**
 * Which works of the pool no longer exist, by the lost-tree class each carries.
 *
 * The tree is asked whole (`fetchClassTree`, four classes) and then asked for
 * its works the way a narrow class is (`fetchClassPool`, one cached question,
 * 27 rows at the pool's floor on 2026-09-12); what that answer has in common
 * with the pool is lost. Intersected rather than added: a lost work that is
 * not otherwise a work of this kind is nobody's business here, and the class
 * pool's label — `lost painting`, `destroyed artwork` — is the reason a person
 * reads.
 */
async function collectLost(
  run: QueryRunner,
  pool: Map<string, PoolWork>,
  opts: WorksCollectorOptions,
): Promise<Map<string, string>> {
  run.phase(`Asking which ${opts.noun.works} no longer exist...`);
  await run.step();
  const tree = await fetchClassTree(run.sparql, LOST_WORK_ROOT, 'lost artwork classes');
  const lost = new Map<string, string>();
  // A step before each query, as every other stage takes one: the pause and the
  // cancel check land between the two questions, not only before the first.
  await run.step();
  for (const work of await fetchClassPool(run.sparql, [...tree])) {
    if (pool.has(work.qid)) lost.set(work.qid, work.type);
  }
  return lost;
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
): { placed: Record<string, string[]>; unseen: Record<string, UnseenWork> } {
  const placed: Record<string, string[]> = {};
  const unseen: Record<string, UnseenWork> = {};
  for (const qid of pool.keys()) {
    const own = statements.get(qid) ?? [];
    const venues = placeArtwork(own, resolve, ancestors);
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

function unseenReason(
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
  };
}

export async function collectWorks(run: QueryRunner, opts: WorksCollectorOptions): Promise<WorksCollection> {
  const classes = await artworkClassesOf(run, opts);
  const pool = await collectPool(run, classes.all, opts);
  const statements = await collectStatements(run, [...pool.keys()]);
  const lost = await collectLost(run, pool, opts);
  // An unknown value names no venue to load.
  const seeds = unique(
    [...statements.values()].flat().map((s) => s.venue).filter((v): v is string => v !== null),
  );
  const graph = await loadVenueGraph(run, seeds, opts.rule);
  const resolver = makeResolver(graph, opts.rule);
  run.phase('Placing works in the venues that hold them...');
  const { placed, unseen } = placeWorks(pool, statements, lost, resolver.resolve, graph.ancestors);
  const unseenCount = Object.keys(unseen).length;
  const lostCount = Object.values(unseen).filter((u) => u.reason !== WHEREABOUTS_UNKNOWN).length;
  console.log(
    `${opts.logPrefix} Works nobody can see, placed nowhere: ${unseenCount} `
    + `(${unseenCount - lostCount} of unknown whereabouts, ${lostCount} lost or destroyed)`,
  );
  const folds = foldVenues(placed, graph, opts.rule);
  return { pool, statements, graph, editionClasses: classes.edition, resolver, placed, unseen, folds,
    afterFolds: applyFolds(placed, folds) };
}
