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
import { placeArtwork } from './placement.js';
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
  /** placeArtwork over every work of the pool with the resolver above. */
  placed: Record<string, string[]>;
  folds: Record<string, Fold>;
  afterFolds: Record<string, string[]>;
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

function placeWorks(
  pool: Map<string, PoolWork>,
  statements: Map<string, RawStatement[]>,
  resolve: (qid: string) => string | null,
  ancestors: (qid: string) => ReadonlySet<string>,
): Record<string, string[]> {
  const placements: Record<string, string[]> = {};
  for (const qid of pool.keys()) {
    placements[qid] = placeArtwork(statements.get(qid) ?? [], resolve, ancestors);
  }
  return placements;
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
  const seeds = unique([...statements.values()].flat().map((s) => s.venue));
  const graph = await loadVenueGraph(run, seeds, opts.rule);
  const resolver = makeResolver(graph, opts.rule);
  run.phase('Placing works in the venues that hold them...');
  const placed = placeWorks(pool, statements, resolver.resolve, graph.ancestors);
  const folds = foldVenues(placed, graph, opts.rule);
  return { pool, statements, graph, editionClasses: classes.edition, resolver, placed, folds,
    afterFolds: applyFolds(placed, folds) };
}
