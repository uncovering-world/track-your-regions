/**
 * Works first, museums second.
 *
 * The old import asked which Wikidata entity owns famous paintings and called the answer a
 * museum, which is how the catalogue ended up with four Louvre departments and no Louvre. This
 * pipeline collects the works the world knows, decides where each one actually hangs, and then
 * admits the venues holding them — so every row has a reason that can be named.
 *
 * Nothing here decides anything on its own: each rule lives in its own tested module, and this
 * file is the wiring. The two compositions no single module can see — the transitive ancestor
 * walk placement needs, and the fold map that has to be followed to a fixed point — live in
 * `venueGraph.ts` with the reasoning that makes them load-bearing.
 */

import { boundedClosure, type ClosureOptions } from './artworkClasses.js';
import { placeArtwork } from './placement.js';
import { selectTier1, ICONIC_SITELINKS, type Tier1Result } from './tier1.js';
import { diffPlacements, type PlacementDiff } from './placementDiff.js';
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
  fetchSubclasses,
  fetchMuseumClasses,
  fetchAnchoredPool,
  fetchClassPool,
  fetchVenueStatements,
  chunk,
  unique,
  type PoolWork,
  type QueryRunner,
  type RawStatement,
  type SparqlFn,
} from './queries.js';
import type { FilteredEntity } from '../syncOrchestrator.js';
import type { CollectedMuseum, ProcessedContent } from '../types.js';

const LOG_PREFIX = '[Museum Sync]';

/**
 * The three classes broad enough to need an anchor. Every other class comes out of the closure
 * below them and is fetched whole. Their labels double as the treasure type a reader sees.
 */
const ARTWORK_ROOTS = [
  { qid: 'Q3305213', type: 'painting' },
  { qid: 'Q860861', type: 'sculpture' },
  { qid: 'Q179700', type: 'statue' },
];
const BROAD_TYPES = new Set([...ARTWORK_ROOTS.map((r) => r.type), 'artwork']);

const CLASS_BATCH = 25;
const STATEMENT_BATCH = 50;
/** The width of `treasures.treasure_type`. */
const TREASURE_TYPE_MAX = 50;
/** Enough of the diff to read in a log; the whole of it is returned to the caller. */
const DIFF_LINES = 20;

export interface PipelineDeps {
  sparql: SparqlFn;
  /** Where the previous run left each work, so this run can say what it moved. */
  previousPlacements: Record<string, string[]>;
  /** Injected by the test; fetched from Wikidata (the `P279*` tree under museum) otherwise. */
  museumClasses?: ReadonlySet<string>;
  closure?: ClosureOptions;
  onPhase?: (message: string) => void;
  /** Throws to abandon the run; called before every query. */
  checkCancel?: () => void;
  /** Rate limiting between queries. The test passes nothing. */
  pause?: () => Promise<void>;
}

export interface PipelineResult {
  items: CollectedMuseum[];
  fetched: number;
  filtered: FilteredEntity[];
  diff: PlacementDiff;
}

// =============================================================================
// Stages
// =============================================================================

async function artworkClassesOf(run: QueryRunner, options?: ClosureOptions): Promise<string[]> {
  run.phase('Finding the classes a work of art can be...');
  const { classes, refused } = await boundedClosure(
    ARTWORK_ROOTS.map((r) => r.qid),
    async (qids) => {
      await run.step();
      return fetchSubclasses(run.sparql, qids);
    },
    options,
  );
  for (const r of refused) {
    console.log(
      `${LOG_PREFIX} Class closure stopped at ${r.root} hop ${r.hop}: ${r.offered} classes offered`,
    );
  }
  console.log(`${LOG_PREFIX} Artwork classes: ${classes.length}`);
  return classes;
}

/**
 * A narrow class names a work better than the root it also instantiates, so it wins the type;
 * everything else fills a gap rather than overwriting an answer.
 */
function mergeWork(existing: PoolWork, incoming: PoolWork): void {
  if (BROAD_TYPES.has(existing.type) && !BROAD_TYPES.has(incoming.type)) {
    existing.type = incoming.type;
  }
  if (!existing.imageUrl) existing.imageUrl = incoming.imageUrl;
  if (!existing.creator) existing.creator = incoming.creator;
  if (existing.year === null) existing.year = incoming.year;
  if (incoming.sitelinks > existing.sitelinks) existing.sitelinks = incoming.sitelinks;
}

async function collectPool(run: QueryRunner, classes: string[]): Promise<Map<string, PoolWork>> {
  const pool = new Map<string, PoolWork>();
  const add = (works: PoolWork[]) => {
    for (const work of works) {
      const existing = pool.get(work.qid);
      if (existing) mergeWork(existing, work);
      else pool.set(work.qid, { ...work });
    }
  };

  for (const root of ARTWORK_ROOTS) {
    for (const anchor of ['P195', 'P276'] as const) {
      run.phase(`Fetching ${root.type}s by ${anchor}...`);
      await run.step();
      add(await fetchAnchoredPool(run.sparql, root, anchor));
    }
  }

  const narrow = classes.filter((c) => !ARTWORK_ROOTS.some((r) => r.qid === c));
  const batches = chunk(narrow, CLASS_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Fetching narrow artwork classes ${i + 1}/${batches.length}...`);
    await run.step();
    add(await fetchClassPool(run.sparql, batches[i]));
  }

  console.log(`${LOG_PREFIX} Pool: ${pool.size} works`);
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

// =============================================================================
// What the run hands back
// =============================================================================

function toContent(work: PoolWork): ProcessedContent {
  return {
    externalId: work.qid,
    name: work.label,
    // `treasures.treasure_type` is varchar(50) and the type is now a Wikidata class label rather
    // than one of two literals: "Anthropomorphic wooden cult figurines of Central and Northern
    // Europe" (Q574422) is 68 characters. An over-long value would make the insert throw, which
    // the orchestrator would record as the whole museum failing, losing its remaining treasures
    // with it. A clipped display string is the cheaper failure.
    treasureType: work.type.slice(0, TREASURE_TYPE_MAX),
    artist: work.creator,
    year: work.year,
    imageUrl: work.imageUrl,
    sitelinksCount: work.sitelinks,
  };
}

function heldBy(
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

function buildItems(
  tier: Tier1Result,
  pool: Map<string, PoolWork>,
  placements: Record<string, string[]>,
  graph: VenueGraph,
): CollectedMuseum[] {
  const held = heldBy(pool, placements);
  const items: CollectedMuseum[] = [];

  for (const [venue, iconic] of tier.museums) {
    const row = graph.details.get(venue);
    if (!row || row.lat === null || row.lon === null) continue;
    const works = held.get(venue) ?? [];
    const admittedBy = iconic
      .map((qid) => pool.get(qid))
      .filter((work): work is PoolWork => !!work)
      .sort((a, b) => b.sitelinks - a.sitelinks)[0];

    items.push({
      qid: venue,
      label: row.label,
      admittedFor: admittedBy ? { qid: admittedBy.qid, label: admittedBy.label } : undefined,
      artworks: works.map(toContent),
      details: {
        museumQid: venue,
        museumLabel: row.label,
        description: row.description,
        lat: row.lat,
        lon: row.lon,
        countryLabel: row.countryLabel,
        imageUrl: row.imageUrl,
        website: row.website,
        articleUrl: row.articleUrl,
      },
    });
  }
  return items.sort((a, b) => b.artworks.length - a.artworks.length);
}

/**
 * Why a candidate the works pointed at is not in the catalogue.
 *
 * Restricted to candidates an *iconic* work named, plus every fold: a rejection that cost the
 * catalogue nothing is noise on the curation screen, and the pool names some 1500 entities.
 */
function nameFiltered(
  pool: Map<string, PoolWork>,
  statements: Map<string, RawStatement[]>,
  resolution: (qid: string) => Resolution,
  graph: VenueGraph,
  folds: Record<string, Fold>,
): FilteredEntity[] {
  const nameOf = (qid: string) => graph.details.get(qid)?.label ?? qid;
  const filtered = new Map<string, FilteredEntity>();

  for (const work of pool.values()) {
    if (work.sitelinks < ICONIC_SITELINKS) continue;
    for (const statement of statements.get(work.qid) ?? []) {
      const found = resolution(statement.venue);
      if ('venue' in found || filtered.has(statement.venue)) continue;
      filtered.set(statement.venue, {
        externalId: statement.venue,
        name: nameOf(statement.venue),
        reason: `${found.unresolved} — named by ${work.label} (${work.sitelinks} sitelinks)`,
      });
    }
  }

  for (const [qid, fold] of Object.entries(folds)) {
    filtered.set(qid, {
      externalId: qid,
      name: nameOf(qid),
      reason: `folded into ${nameOf(fold.into)} — ${fold.why}, ${fold.metres} m away`,
    });
  }
  return [...filtered.values()];
}

function logDiff(diff: PlacementDiff, nameOf: (qid: string) => string): void {
  console.log(
    `${LOG_PREFIX} Placement diff: ${diff.moved.length} moved, ${diff.gained.length} gained, `
    + `${diff.lost.length} lost, ${diff.dropped.length} dropped`,
  );
  for (const move of diff.moved.slice(0, DIFF_LINES)) {
    console.log(
      `${LOG_PREFIX}   moved ${nameOf(move.work)}: `
      + `${move.from.map(nameOf).join(', ')} -> ${move.to.map(nameOf).join(', ')}`,
    );
  }
  for (const work of diff.lost.slice(0, DIFF_LINES)) {
    console.log(`${LOG_PREFIX}   lost ${nameOf(work)}: still in the pool, placed nowhere`);
  }
}

function makeRun(deps: PipelineDeps): QueryRunner {
  return {
    sparql: deps.sparql,
    phase: (message) => deps.onPhase?.(message),
    step: async () => {
      deps.checkCancel?.();
      if (deps.pause) await deps.pause();
    },
  };
}

// =============================================================================
// The pipeline
// =============================================================================

export async function collectTier1Museums(deps: PipelineDeps): Promise<PipelineResult> {
  const run = makeRun(deps);

  let museumClasses = deps.museumClasses;
  if (!museumClasses) {
    run.phase('Fetching the classes a museum can be...');
    await run.step();
    museumClasses = await fetchMuseumClasses(run.sparql);
  }

  const classes = await artworkClassesOf(run, deps.closure);
  const pool = await collectPool(run, classes);
  const statements = await collectStatements(run, [...pool.keys()]);

  const seeds = unique([...statements.values()].flat().map((s) => s.venue));
  const graph = await loadVenueGraph(run, seeds);
  const { resolve, resolution } = makeResolver(graph, museumClasses);

  run.phase('Placing works in the venues that hold them...');
  const placed = placeWorks(pool, statements, resolve, graph.ancestors);
  const folds = foldVenues(placed, graph);
  const afterFolds = applyFolds(placed, folds);

  const tier = selectTier1([...pool.values()].map((work) => ({
    qid: work.qid,
    sitelinks: work.sitelinks,
    venues: afterFolds[work.qid] ?? [],
  })));

  // What the run will actually write: a work is only stored as a treasure of a museum this run
  // admits, so the diff has to be measured against the same thing the database will hold.
  const admitted = new Set(tier.museums.keys());
  const current: Record<string, string[]> = {};
  for (const qid of pool.keys()) {
    current[qid] = (afterFolds[qid] ?? []).filter((venue) => admitted.has(venue));
  }

  const items = buildItems(tier, pool, current, graph);
  const filtered = nameFiltered(pool, statements, resolution, graph, folds);
  const diff = diffPlacements(deps.previousPlacements, current);

  console.log(
    `${LOG_PREFIX} Admitted ${items.length} museums; ${Object.keys(folds).length} folds, `
    + `${tier.homeless.length} iconic works with no venue, ${tier.shared.length} held too widely`,
  );
  logDiff(diff, (qid) => pool.get(qid)?.label ?? graph.details.get(qid)?.label ?? qid);

  return { items, fetched: pool.size, filtered, diff };
}
